import {describe,it,expect} from 'vitest';
import {Bone,Group,Object3D,Vector3,Quaternion,MathUtils} from 'three';
import {PoseEngine} from './PoseEngine';
import {BODY_PART_NAMES,FINGER_PART_NAMES,PART_NAMES,DIGITS,DEFAULT_VIEWS,type Side} from './types';
import {forearmAngles,forearmRotation,fingerAngles,fingerAxes,FINGER_CURL_LIMITS} from './articulation';
import {PRESETS} from './presets';
import {parseDocument} from './files';
import rig from '../public/models/xbot-profile.json';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {SkinnedMesh} from 'three';

function fixture(){
  const model=new Group(),bones:Record<string,Bone>={};
  const profile=rig.bones as Record<string,{parent:string|null;position:number[]}>;
  for(const name of Object.keys(profile)){bones[name]=new Bone();bones[name].name=name;}
  for(const[name,b]of Object.entries(profile)){bones[name].position.fromArray(b.position);if(b.parent){bones[name].position.sub(new Vector3().fromArray(profile[b.parent].position));bones[b.parent].add(bones[name]);}else model.add(bones[name]);}
  model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{model,bones,gizmo:new Object3D(),selected:'LeftHand',mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'精细关节测试',ground:false,profile:rig,dragBefore:null,handDetail:null,transform:{setMode(){},attach(){}}});
  for(const end of ['LeftHand','RightHand','LeftFoot','RightFoot']){e.targets[end]=e.world(end).toArray();e.poles[end]=e.world(end).add(new Vector3(0,0,end.endsWith('Hand')?-.7:.8)).toArray();}
  e.rest=e.snapshot();e.applyPreset(PRESETS[0],false);return e;
}
const rad=MathUtils.degToRad;
const forearm=(e:PoseEngine,side:Side)=>forearmAngles(e.bones[`${side}ForeArm`].quaternion,new Vector3().fromArray(rig.hingeAxes[`${side}ForeArm`]),new Vector3().fromArray(e.rest.joints[`${side}Hand`].position));

describe('已存在的骨骼开放控制',()=>{
  it('23 个身体关节与 30 个指骨均对应真实骨骼，末端占位不作为关节开放',()=>{
    const e=fixture();expect(Object.keys(BODY_PART_NAMES)).toHaveLength(23);expect(Object.keys(FINGER_PART_NAMES)).toHaveLength(30);expect(Object.keys(PART_NAMES)).toHaveLength(53);
    for(const name of Object.keys(PART_NAMES))expect(e.bones[name]).toBeInstanceOf(Bone);
    expect(Object.keys(FINGER_PART_NAMES).some(n=>n.endsWith('4'))).toBe(false);
    e.select('RightThumb2');expect(e.handDetail).toBe('Right');expect(e.mode).toBe('rotate');
    e.setHandDetail(null);expect(e.selected).toBe('RightHand');
    for(const name of ['LeftShoulder','RightArm','LeftUpLeg','Neck','LeftToeBase']){e.select(name);expect(e.mode).toBe('rotate');}
  });
  for(const side of ['Left','Right'] as const)it(`${side}每节手指均可弯曲，骨长保持且不会修改另一只手`,()=>{
    const e=fixture(),other=side==='Left'?'Right':'Left',before=e.world(`${side}Index4`),palm=e.world(`${side}Hand`),otherBefore=e.world(`${other}Index4`);
    for(const digit of DIGITS)for(let i=1;i<=3;i++){
      e.setFinger(side,digit,i,180,'curl');const bone=e.bones[`${side}${digit}${i}`];
      const a=fingerAngles(bone.quaternion,fingerAxes(e.rest.joints,side,digit,i,-1));expect(a.curl).toBeCloseTo(rad(FINGER_CURL_LIMITS[digit][i-1]),7);
      expect(bone.getWorldPosition(new Vector3()).distanceTo(bone.parent!.getWorldPosition(new Vector3()))).toBeCloseTo(bone.position.length(),9);
    }
    expect(e.world(`${side}Index4`).distanceTo(before)).toBeGreaterThan(.05);expect(e.world(`${side}Index4`).distanceTo(palm)).toBeLessThan(before.distanceTo(palm));
    expect(e.world(`${other}Index4`).distanceTo(otherBefore)).toBeLessThan(1e-9);expect(e.hands[side]).toBe('自定义');
  });
  it('手指张开与屈曲可以独立调整，预设能恢复整只手',()=>{
    const e=fixture();e.setFinger('Left','Index',1,55,'curl');e.setFinger('Left','Index',1,15,'spread');
    let a=fingerAngles(e.bones.LeftIndex1.quaternion,fingerAxes(e.rest.joints,'Left','Index',1,-1));expect(a.curl).toBeCloseTo(rad(55),7);expect(a.spread).toBeCloseTo(rad(15),7);
    e.setFinger('Left','Index',2,90,'spread');a=fingerAngles(e.bones.LeftIndex2.quaternion,fingerAxes(e.rest.joints,'Left','Index',2,-1));expect(a.spread).toBeCloseTo(0,7);
    e.setHand('Left','张手');for(const digit of DIGITS)for(let i=1;i<=3;i++)expect(e.bones[`Left${digit}${i}`].quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
    expect(e.hands.Left).toBe('张手');
  });
  for(const side of ['Left','Right'] as const)it(`${side}前臂翻转保留弯肘及手腕位置，之后 IK 仍保留翻转角`,()=>{
    const e=fixture(),hand=`${side}Hand`,p=e.world(hand),bend=forearm(e,side).bend;
    e.setForearmTwist(side,75);expect(e.world(hand).distanceTo(p)).toBeLessThan(1e-8);expect(forearm(e,side).bend).toBeCloseTo(bend,6);expect(forearm(e,side).twist).toBeCloseTo(rad(75),6);
    for(let i=0;i<100;i++){
      const t=i/100,target=new Vector3((side==='Left'?1:-1)*(.24+.1*Math.sin(t*Math.PI)),.99+.3*Math.sin(t*Math.PI),.08+.12*Math.sin(t*Math.PI*2));
      e.solve(hand,target);expect(e.world(hand).distanceTo(target)).toBeLessThan(.00003);expect(forearm(e,side).twist).toBeCloseTo(rad(75),5);
      const a=forearm(e,side);expect(a.bend).toBeGreaterThan(-.0001);expect(a.bend).toBeLessThan(rad(156));
    }
  });
  it('允许前臂翻转但反向弯肘仍被限制，膝盖仍是单轴',()=>{
    const e=fixture(),name='LeftForeArm',h=new Vector3().fromArray(rig.hingeAxes.LeftForeArm),v=new Vector3().fromArray(e.rest.joints.LeftHand.position);
    e.bones[name].quaternion.copy(forearmRotation(-.7,.8,h,v));(e as unknown as {limitJoint(n:string):void}).limitJoint(name);
    expect(forearm(e,'Left').bend).toBeGreaterThan(-.001);expect(forearm(e,'Left').twist).toBeCloseTo(.8,6);
    e.bones.LeftLeg.quaternion.setFromAxisAngle(new Vector3(0,1,0),1);(e as unknown as {limitJoint(n:string):void}).limitJoint('LeftLeg');expect(Math.abs(e.bones.LeftLeg.quaternion.y)).toBeLessThan(1e-8);
  });
  it('固定手掌方向时，翻转前臂不会破坏固定位置和方向',()=>{
    const e=fixture(),p=e.world('LeftHand'),q=e.bones.LeftHand.getWorldQuaternion(new Quaternion());e.pins.LeftHand={position:p.toArray(),quaternion:q.toArray(),orientation:true};
    e.setForearmTwist('Left',-65);expect(e.world('LeftHand').distanceTo(p)).toBeLessThan(.00003);expect(e.bones.LeftHand.getWorldQuaternion(new Quaternion()).angleTo(q)).toBeLessThan(1e-6);expect(forearm(e,'Left').twist).toBeCloseTo(rad(-65),5);
  });
  it('脚趾可弯曲且有范围限制，不挪动脚踝和另一只脚',()=>{
    const e=fixture(),ankle=e.world('LeftFoot'),other=e.world('RightToe_End'),tip=e.world('LeftToe_End');
    e.setToeBend('Left',180);expect(e.info().toes.Left).toBeCloseTo(65,7);expect(e.world('LeftToe_End').distanceTo(tip)).toBeGreaterThan(.02);expect(e.world('LeftFoot').distanceTo(ankle)).toBeLessThan(1e-9);expect(e.world('RightToe_End').distanceTo(other)).toBeLessThan(1e-9);
    e.setToeBend('Left',-180);expect(e.info().toes.Left).toBeCloseTo(-45,7);
  });
  it('手指、脚趾和前臂修改可保存恢复，镜像两次也能恢复',()=>{
    const e=fixture();e.setFinger('Left','Thumb',1,35,'curl');e.setFinger('Left','Little',2,80,'curl');e.setToeBend('Right',35);e.setForearmTwist('Left',60);
    const doc=e.snapshot(),loaded=parseDocument(JSON.stringify(doc),e.rest);e.applyPreset(PRESETS[0],false);e.apply(loaded,false);
    for(const name of Object.keys(e.bones))expect(e.bones[name].quaternion.angleTo(new Quaternion().fromArray(doc.joints[name].quaternion))).toBeLessThan(1e-6);
    e.mirror();e.mirror();for(const name of Object.keys(e.bones))expect(e.bones[name].quaternion.angleTo(new Quaternion().fromArray(doc.joints[name].quaternion))).toBeLessThan(1e-6);
  });
  it('真实 GLB 的手指和前脚掌蒙皮随编辑变形，恢复工程可恢复顶点',async()=>{
    const bytes=readFileSync(new URL('../public/models/xbot.glb',import.meta.url));
    const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const e=fixture(),model=new Group(),bones:Record<string,Bone>={},meshes:SkinnedMesh[]=[];model.add(scene);
    scene.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;if(o instanceof SkinnedMesh)meshes.push(o);});
    Object.assign(e,{model,bones});model.updateMatrixWorld(true);e.rest=e.snapshot();e.applyPreset(PRESETS[0],false);
    const vertices=()=>{model.updateMatrixWorld(true);return meshes.flatMap(mesh=>{mesh.skeleton.update();return Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld));});};
    const doc=e.snapshot(),before=vertices(),other=e.world('RightIndex4');
    e.setFinger('Left','Index',1,65,'curl');e.setFinger('Left','Index',2,85,'curl');e.setFinger('Left','Index',3,55,'curl');
    const afterFinger=vertices();expect(afterFinger.filter((v,i)=>v.distanceTo(before[i])>.003).length).toBeGreaterThan(40);expect(e.world('RightIndex4').distanceTo(other)).toBeLessThan(1e-8);
    e.setFinger('Right','Thumb',1,40,'curl');e.setToeBend('Left',45);e.setToeBend('Right',-25);e.setForearmTwist('Right',80);
    const edited=vertices();expect(edited.every(v=>Number.isFinite(v.x+v.y+v.z))).toBe(true);expect(edited.filter((v,i)=>v.distanceTo(afterFinger[i])>.003).length).toBeGreaterThan(100);
    e.apply(doc,false);const restored=vertices();expect(Math.max(...restored.map((v,i)=>v.distanceTo(before[i])))).toBeLessThan(1e-6);
  });
});
