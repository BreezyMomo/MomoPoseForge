import {beforeAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Bone,Group,Object3D,Texture,Vector3,Quaternion} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {FOX_RIG} from './foxRig';
import {PoseEngine} from './PoseEngine';
import {DEFAULT_VIEWS} from './types';
import {fkAngles} from './fkControls';
import {parseDocument} from './files';
import {solveRigChain,solveRigContacts,type ArticulatedRig} from './articulatedIK';

let gltf:GLTF;
beforeAll(async()=>{const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURE',loadTexture:async()=>new Texture()}));gltf=await loader.parseAsync(Uint8Array.from(readFileSync(new URL('../public/models/fox/fox.glb',import.meta.url))).buffer,'');});
function fixture(){
  const model=new Group(),bones:Record<string,Bone>={};model.add(clone(gltf.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const engine=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(engine,{rigDefinition:FOX_RIG,model,bones,gizmo:new Object3D(),selected:FOX_RIG.initialSelection,mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'狐狸 IK 验收',ground:false,fullBody:false,warning:'',handDetail:null,transform:{setMode(){},attach(){},reset(){}},onInfo(){},onCommit(){}});
  for(const end of FOX_RIG.contacts)engine.targets[end]=engine.world(end).toArray();engine.rest=engine.snapshot();
  const state:ArticulatedRig={rig:FOX_RIG,model,bones,rest:engine.rest};return {engine,state};
}
function assertLimits(state:ArticulatedRig,rootMayMove=false){
  for(const joint of FOX_RIG.jointControls!){const a=fkAngles(state.bones[joint.name].quaternion,new Quaternion().fromArray(state.rest.joints[joint.name].quaternion),joint);a.forEach((v,i)=>{expect(v,joint.name).toBeGreaterThanOrEqual(joint.limits![0][i]-1e-5);expect(v,joint.name).toBeLessThanOrEqual(joint.limits![1][i]+1e-5);});}
  for(const[name,bone]of Object.entries(state.bones))if(!rootMayMove||name!==state.rig.root)expect(bone.position.toArray(),name).toEqual(state.rest.joints[name].position);
}
describe('可变链长的四足 IK',()=>{
  for(const end of FOX_RIG.contacts)it(`${end}三段/四段链可抬爪并保持骨长和限位`,()=>{
    const {engine,state}=fixture(),target=engine.world(end).add(new Vector3(0,.1,.035));
    const result=solveRigChain(state,end,target);expect(result.error).toBeLessThan(.002);assertLimits(state);
  });
  it('超出可达范围时保持有限值和关节边界',()=>{
    const {engine,state}=fixture(),end=FOX_RIG.contacts[0],result=solveRigChain(state,end,engine.world(end).add(new Vector3(2,1,0)));expect(result.error).toBeGreaterThan(1);assertLimits(state);
    for(const bone of Object.values(engine.bones))expect(bone.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });
  it('四肢持续跨过伸直与侧移附近时不反折、不改变骨段长度',()=>{
    for(const end of FOX_RIG.contacts){const {engine:e,state}=fixture(),start=e.world(end);for(let i=0;i<60;i++){solveRigChain(state,end,start.clone().add(new Vector3(Math.sin(i*.17)*.07,.07+Math.cos(i*.21)*.08,Math.sin(i*.13)*.12)));assertLimits(state);}}
  });
  it('链和固定点数量由定义决定，不要求固定四条肢体',()=>{
    const {engine:e,state}=fixture(),end=FOX_RIG.contacts[2],rig={...FOX_RIG,id:'test-single-chain',chains:{[end]:FOX_RIG.chains[end]},contacts:[end]};state.rig=rig;Object.assign(e,{rigDefinition:rig});e.setFeetPin(true);expect(Object.keys(e.pins)).toEqual([end]);e.select(rig.root);e.setSelectedPosition(0,.03);expect(errors(e).position).toBeLessThan(.0015);expect(e.info().fixedContacts).toBe(1);
  });
  it('下移根部时四个固定点可同时恢复',()=>{
    const {engine,state}=fixture();for(const end of FOX_RIG.contacts)engine.pins[end]={position:engine.world(end).toArray(),quaternion:engine.bones[end].getWorldQuaternion(new Quaternion()).toArray(),orientation:false};
    const root=engine.bones[FOX_RIG.root],target=engine.world(FOX_RIG.root).add(new Vector3(0,-.05,0));root.position.copy(root.parent!.worldToLocal(target));root.updateWorldMatrix(false,true);
    const result=solveRigContacts(state,engine.pins);expect(result.positionError).toBeLessThan(.0015);assertLimits({...state,rest:{...state.rest,joints:{...state.rest.joints,[FOX_RIG.root]:{...state.rest.joints[FOX_RIG.root],position:root.position.toArray()}}}});
  });
});

const errors=(e:PoseEngine)=>Object.entries(e.pins).reduce((result,[end,pin])=>{if(pin){result.position=Math.max(result.position,e.world(end).distanceTo(new Vector3().fromArray(pin.position)));if(pin.orientation)result.orientation=Math.max(result.orientation,e.bones[end].getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().fromArray(pin.quaternion)));}return result;},{position:0,orientation:0});
describe('四爪编辑、固定与工程兼容',()=>{
  it('选中爪子默认进入移动，抬起时其余关节不被联动修改',()=>{
    const {engine:e,state}=fixture(),end=FOX_RIG.contacts[0],before=e.snapshot(),target=e.world(end).y+.1;e.select(end);expect(e.mode).toBe('translate');e.setSelectedPosition(1,target);expect(e.world(end).y).toBeCloseTo(target,3);assertLimits(state);
    const chain=FOX_RIG.chains[end];for(const[name,bone]of Object.entries(e.bones))if(!chain.includes(name))expect(bone.quaternion.toArray()).toEqual(before.joints[name].quaternion);
    expect(e.canTranslate('b_Head_05')).toBe(false);expect(e.canTranslate('b_Tail01_012')).toBe(false);
  });
  it('固定四爪后下移根部，身体确实移动且各固定点保留',()=>{
    const {engine:e}=fixture();e.setFeetPin(true);const before=e.world(FOX_RIG.root);e.select(FOX_RIG.root);e.setSelectedPosition(1,before.y-.05);expect(e.world(FOX_RIG.root).y).toBeCloseTo(before.y-.05,4);expect(errors(e).position).toBeLessThan(.0015);expect(e.info().fixedContacts).toBe(4);e.setFeetPin(false);expect(e.pins).toEqual({});
  });
  it('角色整体旋转平移后，世界空间拖爪和固定支撑仍成立',()=>{
    const {engine:e}=fixture();e.model.position.set(1,0,-.5);e.model.quaternion.setFromAxisAngle(new Vector3(0,1,0),Math.PI/3);e.model.updateMatrixWorld(true);
    const end=FOX_RIG.contacts[0];e.select(end);const target=e.world(end).y+.08;e.setSelectedPosition(1,target);expect(e.world(end).y).toBeCloseTo(target,3);e.setFeetPin(true);e.select(FOX_RIG.root);const before=e.world(FOX_RIG.root).y;e.setSelectedPosition(1,before-.025);expect(errors(e).position).toBeLessThan(.0015);
  });
  it('固定方向后身体移动仍保留爪子朝向',()=>{
    const {engine:e}=fixture();for(const end of FOX_RIG.contacts){e.select(end);e.setPin(true,true);}const before=e.world(FOX_RIG.root);e.select(FOX_RIG.root);e.setSelectedPosition(1,before.y-.04);expect(before.y-e.world(FOX_RIG.root).y).toBeGreaterThan(.01);expect(errors(e).position).toBeLessThan(.0015);expect(errors(e).orientation).toBeLessThan(.009);
  });
  it('固定爪子后超出身体可达范围时限制位移并提示，不让支撑点滑走',()=>{
    const {engine:e,state}=fixture();e.setFeetPin(true);const before=e.world(FOX_RIG.root);e.select(FOX_RIG.root);e.setSelectedPosition(1,before.y+.5);expect(e.world(FOX_RIG.root).y-before.y).toBeLessThan(.05);expect(errors(e).position).toBeLessThan(.001501);expect(e.warning).toContain('固定爪子');assertLimits(state,true);e.setFeetPin(false);expect(e.warning).toBe('');
    for(const bone of Object.values(e.bones))expect(bone.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });
  it('固定爪子拒绝直接移动；解除选中爪后可移动且其他锚点保持不动',()=>{
    const {engine:e}=fixture();e.setFeetPin(true);const end=FOX_RIG.contacts[0];e.select(end);const before=e.snapshot();e.setSelectedPosition(1,e.world(end).y+.07);expect(e.snapshot()).toEqual(before);expect(e.warning).toContain('固定');
    e.setPin(false);const y=e.world(end).y;e.setSelectedPosition(1,y+.07);expect(e.world(end).y-y).toBeGreaterThan(.06);expect(errors(e).position).toBeLessThan(.0015);for(const other of FOX_RIG.contacts)if(other!==end)expect(e.pins[other]).toEqual(before.pins[other]);
  });
  it('头尾 FK 精调与固定爪子可以并用，固定方向后禁止爪子直接旋转',()=>{
    const {engine:e}=fixture();e.setFeetPin(true);const before=e.snapshot();e.select('b_Head_05');e.setSelectedRotation(1,20);e.select('b_Tail01_012');e.setSelectedRotation(1,35);expect(e.info().rotation[1]).toBeCloseTo(35);expect(errors(e).position).toBeLessThan(.0015);
    for(const[name,bone]of Object.entries(e.bones))if(!['b_Head_05','b_Tail01_012'].includes(name))expect(bone.quaternion.toArray()).toEqual(before.joints[name].quaternion);
    const end=FOX_RIG.contacts[0];e.select(end);e.setPin(true,true);const pinned=e.snapshot();e.setSelectedRotation(1,10);expect(e.snapshot()).toEqual(pinned);expect(errors(e).orientation).toBeLessThan(.009);
  });
  it('同一次拖动的路径和重复事件不会累积扭转，取消时恢复全部状态',()=>{
    const {engine:e}=fixture(),end=FOX_RIG.contacts[2];e.select(end);const before=e.snapshot(),start=e.world(end),drag=e as unknown as {dragBefore:typeof before;manipulate():void};drag.dragBefore=before;
    for(let i=0;i<40;i++){e.gizmo.position.copy(start).add(new Vector3(Math.sin(i*.2)*.025,.08+Math.cos(i*.15)*.025,Math.sin(i*.1)*.03));drag.manipulate();}
    const target=start.clone().add(new Vector3(0,.1,.025));e.gizmo.position.copy(target);drag.manipulate();const first=e.snapshot();for(let i=0;i<15;i++)drag.manipulate();expect(e.snapshot()).toEqual(first);expect(e.world(end).distanceTo(target)).toBeLessThan(.002);e.cancelDrag();expect(e.snapshot()).toEqual(before);
  });
  it('旧 FK 工程原姿态不变，IK 目标从实际关节派生；新文件损坏控制点会拒绝',()=>{
    const {engine:e}=fixture();e.select('b_Tail01_012');e.setSelectedRotation(1,30);e.select(FOX_RIG.root);e.setSelectedPosition(0,.2);const old=e.snapshot();delete old.ikVersion;old.targets={};old.poles={};
    const {engine:target}=fixture();target.apply(parseDocument(JSON.stringify(old),target.rest));expect(target.snapshot().joints).toEqual(old.joints);expect(target.snapshot().ikVersion).toBe(1);for(const end of FOX_RIG.contacts)expect(target.targets[end]).toEqual(target.world(end).toArray());
    const fresh=target.snapshot(),other=fixture().engine;other.apply(parseDocument(JSON.stringify(fresh),other.rest));expect(other.snapshot()).toEqual(fresh);
    expect(()=>parseDocument(JSON.stringify({...fresh,targets:{}}),other.rest)).toThrow('IK');expect(()=>parseDocument(JSON.stringify({...fresh,ikVersion:2}),other.rest)).toThrow('IK 控制版本');
  });
});
