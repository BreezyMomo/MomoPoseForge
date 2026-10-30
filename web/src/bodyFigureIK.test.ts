import {beforeAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Bone,Group,Object3D,Quaternion,SkinnedMesh,Vector3} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {BODYCHAN_RIG,BODYKUN_RIG} from './bodyFigureRigs';
import {PoseEngine} from './PoseEngine';
import {DEFAULT_VIEWS} from './types';
import type {RigDefinition} from './rigs';
import {solveRigChain,type ArticulatedRig} from './articulatedIK';
import {twistAngle} from './articulation';
import {parseDocument} from './files';

const loaded=new Map<string,GLTF>();
beforeAll(async()=>{for(const rig of [BODYCHAN_RIG,BODYKUN_RIG]){const bytes=readFileSync(new URL(`../public${rig.asset.kind==='gltf'?rig.asset.url:''}`,import.meta.url));loaded.set(rig.id,await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));}});
function fixture(rig:RigDefinition){
  const model=new Group(),bones:Record<string,Bone>={};model.add(clone(loaded.get(rig.id)!.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{rigDefinition:rig,model,bones,gizmo:new Object3D(),helpers:new Group(),boneDisplay:new Group(),handles:[],selected:rig.initialSelection,mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'素体 IK',ground:false,fullBody:false,warning:'',handDetail:null,transform:{setMode(){},attach(){},detach(){},reset(){},enabled:true},onInfo(){},onCommit:vi.fn(),fit(){}});
  for(const end of rig.contacts)e.targets[end]=e.world(end).toArray();e.rest=e.snapshot();
  return {e,state:{rig,model,bones,rest:e.rest} satisfies ArticulatedRig};
}
function assertPose(state:ArticulatedRig){
  for(const [name,b]of Object.entries(state.bones)){
    if(name!==state.rig.root)expect(b.position.toArray(),name).toEqual(state.rest.joints[name].position);
    expect(b.quaternion.toArray().every(Number.isFinite),name).toBe(true);
  }
  for(const joint of state.rig.jointControls??[])if(joint.ikHinge){const h=joint.ikHinge,angle=twistAngle(new Quaternion().fromArray(state.rest.joints[joint.name].quaternion).invert().multiply(state.bones[joint.name].quaternion),new Vector3().fromArray(h.axis).normalize())*180/Math.PI;expect(angle,joint.name).toBeGreaterThanOrEqual(h.min-1e-4);expect(angle,joint.name).toBeLessThanOrEqual(h.max+1e-4);}
}
function pinError(e:PoseEngine){return Math.max(0,...Object.entries(e.pins).map(([n,p])=>p?e.world(n).distanceTo(new Vector3().fromArray(p.position)):0));}

for(const rig of [BODYCHAN_RIG,BODYKUN_RIG])describe(`${rig.name} 四肢 IK`,()=>{
  for(const end of rig.contacts)it(`${end}可抬起和前伸，其他肢体及手指不动、骨长与弯曲方向保持`,()=>{
    const {e,state}=fixture(rig),before=e.snapshot(),target=e.world(end).add(new Vector3(.015,.12,.06));
    e.select(end);expect(e.mode).toBe('translate');e.setSelectedPosition(1,target.y);e.setSelectedPosition(2,target.z);
    expect(e.world(end).distanceTo(new Vector3(e.world(end).x,target.y,target.z))).toBeLessThan(.003);assertPose(state);
    const chain=rig.chains[end];for(const[n,b]of Object.entries(e.bones))if(!chain.includes(n))expect(b.quaternion.toArray(),n).toEqual(before.joints[n].quaternion);
  });
  it('双脚固定只固定两脚，骨盆下沉且脚位/朝向保持；超出范围时不滑脚',()=>{
    const {e,state}=fixture(rig);e.setFeetPin(true);expect(Object.keys(e.pins)).toEqual(['left_foot','right_foot']);const pins=structuredClone(e.pins),y=e.world(rig.root).y;
    e.select(rig.root);e.setSelectedPosition(1,y-.07);expect(y-e.world(rig.root).y).toBeGreaterThan(.06);expect(pinError(e)).toBeLessThan(.0015);
    for(const end of rig.supportContacts!)expect(e.bones[end].getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().fromArray(pins[end]!.quaternion))).toBeLessThan(.009);
    e.setSelectedPosition(1,y+1);expect(pinError(e)).toBeLessThan(.001501);expect(e.world(rig.root).y).toBeLessThan(y+.05);expect(e.warning).toContain('固定手脚');assertPose(state);
  });
  it('手脚可分别固定，位置/方向锁阻止直接编辑，解除后恢复；整角色平移连同锚点搬动',()=>{
    const {e}=fixture(rig);e.select('left_hand');e.setPin(true,true);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();
    e.setSelectedPosition(1,e.world('left_hand').y+.1);e.setSelectedRotation(0,30);expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    e.select('head');e.setSelectedRotation(1,20);expect(pinError(e)).toBeLessThan(.0015);e.moveActor([1,.2,-.5],40);expect(pinError(e)).toBeLessThan(.0015);
    e.select('left_hand');e.setPin(false);const y=e.world('left_hand').y;e.setSelectedPosition(1,y+.06);expect(e.world('left_hand').y-y).toBeGreaterThan(.05);
  });
  it('从完全伸直重新折回、连续目标与不可达目标均有限且不反折',()=>{
    for(const end of rig.contacts){const {e,state}=fixture(rig),chain=rig.chains[end],origin=e.world(chain[0]),initial=e.world(end),length=origin.distanceTo(e.world(chain[1]))+e.world(chain[1]).distanceTo(initial),direction=initial.clone().sub(origin).normalize();
      solveRigChain(state,end,origin.clone().addScaledVector(direction,length+.03));assertPose(state);
      const target=origin.clone().addScaledVector(direction,length*.8).add(new Vector3(0,0,.02));expect(solveRigChain(state,end,target).error).toBeLessThan(.003);assertPose(state);
      for(let i=0;i<12;i++){solveRigChain(state,end,target.clone().add(new Vector3(.02*Math.sin(i),.02*Math.cos(i),.02*Math.sin(i*.4))));assertPose(state);}
    }
  });
  it('旧 FK 工程原样恢复，IK 目标从真实姿势派生；新工程校验控制点',()=>{
    const {e}=fixture(rig);e.select('left_forearm');e.setSelectedRotation(0,60);const legacy=e.snapshot();delete legacy.ikVersion;legacy.targets={};legacy.poles={};legacy.pins={};
    const other=fixture(rig).e;other.apply(parseDocument(JSON.stringify(legacy),other.rest));expect(JSON.stringify(other.snapshot().joints)).toEqual(JSON.stringify(legacy.joints));expect(other.snapshot().ikVersion).toBe(1);
    for(const end of rig.contacts)expect(other.targets[end]).toEqual(other.world(end).toArray());const doc=other.snapshot();expect(()=>parseDocument(JSON.stringify({...doc,targets:{}}),other.rest)).toThrow('IK');
  });
  it('拖动结果不随事件次数累积，取消恢复姿态、锚点与目标；真实表面随 IK 变形',()=>{
    const {e,state}=fixture(rig);e.select('left_hand');const before=e.snapshot(),target=e.world('left_hand').add(new Vector3(0,.15,.04));
    const vertices=()=>{e.model.updateMatrixWorld(true);const out:Vector3[]=[];e.model.traverse(o=>{if(o instanceof SkinnedMesh){o.skeleton.update();for(let i=0;i<o.geometry.getAttribute('position').count;i+=3)out.push(o.getVertexPosition(i,new Vector3()).applyMatrix4(o.matrixWorld));}});return out;};
    const points=vertices(),drag=e as unknown as {dragBefore:typeof before;manipulate():void};drag.dragBefore=before;e.gizmo.position.copy(target);drag.manipulate();expect(e.world('left_hand').distanceTo(target)).toBeLessThan(.003);
    const once=e.snapshot();for(let i=0;i<8;i++)drag.manipulate();expect(e.snapshot()).toEqual(once);expect(vertices().filter((p,i)=>p.distanceTo(points[i])>.003).length).toBeGreaterThan(50);assertPose(state);
    e.cancelDrag();expect(e.snapshot()).toEqual(before);
  });
});
