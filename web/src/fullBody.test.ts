import {describe,it,expect} from 'vitest';
import {Bone,Group,Object3D,Vector3,Quaternion,Euler,MathUtils} from 'three';
import {PoseEngine} from './PoseEngine';
import {LIMB_LIMITS,constrainLimb,decomposeLimb,limbAxes} from './limbLimits';
import {JOINT_LIMITS,decomposeJointRotation} from './poseControls';
import {forearmAngles} from './articulation';
import {PRESETS} from './presets';
import {DEFAULT_VIEWS,END_EFFECTORS,type Effector} from './types';
import {parseDocument} from './files';
import rig from '../public/models/xbot-profile.json';
import {writeFileSync,mkdirSync} from 'node:fs';

const rad=MathUtils.degToRad;
function fixture(preset='neutral'){
  const model=new Group(),bones:Record<string,Bone>={},profile=rig.bones as Record<string,{parent:string|null;position:number[]}>;
  for(const name of Object.keys(profile)){bones[name]=new Bone();bones[name].name=name;}
  for(const[name,b]of Object.entries(profile)){bones[name].position.fromArray(b.position);if(b.parent){bones[name].position.sub(new Vector3().fromArray(profile[b.parent].position));bones[b.parent].add(bones[name]);}else model.add(bones[name]);}
  model.updateMatrixWorld(true);const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{model,bones,gizmo:new Object3D(),selected:'LeftHand',mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'全身验收',ground:true,fullBody:true,profile:rig,dragBefore:null,handDetail:null,transform:{setMode(){},attach(){}}});
  for(const end of END_EFFECTORS){e.targets[end]=e.world(end).toArray();e.poles[end]=e.world(end).add(new Vector3(0,0,end.endsWith('Hand')?-.7:.8)).toArray();}
  e.rest=e.snapshot();e.applyPreset(PRESETS.find(p=>p.id===preset)!,false);return e;
}
function child(name:string){return name.endsWith('Shoulder')?name.replace('Shoulder','Arm'):name.endsWith('UpLeg')?name.replace('UpLeg','Leg'):name.replace('Arm','ForeArm');}
function assertLimits(e:PoseEngine){
  for(const[name,limits]of Object.entries(LIMB_LIMITS)){
    const a=decomposeLimb(e.bones[name].quaternion,limbAxes(name,new Vector3().fromArray(e.rest.joints[child(name)].position)));
    expect(Math.hypot(a.forward/rad(a.forward<0?-limits.forward[0]:limits.forward[1]),a.side/rad(a.side<0?-limits.side[0]:limits.side[1])),name).toBeLessThanOrEqual(1+1e-7);
    expect(Math.abs(a.twist),name).toBeLessThanOrEqual(rad(limits.twist)+1e-7);
  }
  for(const[name,limits]of Object.entries(JOINT_LIMITS)){
    const a=decomposeJointRotation(e.bones[name].quaternion);expect(Math.abs(a.twist),name).toBeLessThanOrEqual(rad(limits.twist)+1e-7);
    expect(Math.hypot(a.bend/rad(a.bend<0?-limits.bend[0]:limits.bend[1]),a.side/rad(limits.side)),name).toBeLessThanOrEqual(1+1e-7);
  }
  for(const name of ['LeftLeg','RightLeg']){
    const q=e.bones[name].quaternion,u=new Vector3().fromArray(e.rest.joints[name].position).normalize(),v=new Vector3().fromArray(e.rest.joints[name.replace('Leg','Foot')].position).normalize();
    const bindFlex=Math.atan2(new Vector3(1,0,0).dot(new Vector3().crossVectors(u,v)),u.dot(v)),flex=bindFlex+2*Math.atan2(q.x,q.w);
    expect(Math.abs(q.y)+Math.abs(q.z)).toBeLessThan(1e-8);expect(flex).toBeGreaterThan(-1e-7);expect(flex).toBeLessThan(rad(150)+1e-7);
  }
  for(const name of ['LeftForeArm','RightForeArm'] as const){const a=forearmAngles(e.bones[name].quaternion,new Vector3().fromArray(rig.hingeAxes[name]),e.bones[name.replace('ForeArm','Hand')].position);expect(a.bend).toBeGreaterThan(-.001);expect(a.bend).toBeLessThan(rad(156));}
  for(const[name,bone]of Object.entries(e.bones)){
    expect(bone.quaternion.toArray().every(Number.isFinite),name).toBe(true);
    if(name!=='Hips')expect(bone.position.distanceTo(new Vector3().fromArray(e.rest.joints[name].position)),name).toBeLessThan(1e-9);
  }
}
function pin(e:PoseEngine,names:readonly Effector[]=['LeftFoot','RightFoot']){for(const end of names)e.pins[end]={position:e.world(end).toArray(),quaternion:e.bones[end].getWorldQuaternion(new Quaternion()).toArray(),orientation:true};}
function move(e:PoseEngine,name:string,target:Vector3){e.selected=name;e.mode='translate';e.gizmo.position.copy(target);(e as unknown as {manipulate():void}).manipulate();}
function assertPins(e:PoseEngine,tolerance=.00151){for(const[end,p]of Object.entries(e.pins)){expect(e.world(end).distanceTo(new Vector3().fromArray(p!.position)),end).toBeLessThan(tolerance);if(p!.orientation)expect(e.bones[end].getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().fromArray(p!.quaternion))).toBeLessThan(1e-6);}}

describe('肩髋约束与受约束全身联动',()=>{
  for(const name of Object.keys(LIMB_LIMITS))it(`${name}限位在极端输入下连续、可重复且不会越界`,()=>{
    const e=fixture(),axes=limbAxes(name,new Vector3().fromArray(e.rest.joints[child(name)].position)),rest=new Quaternion().setFromEuler(new Euler(.1,-.2,.15));
    for(let i=0;i<160;i++){
      const input=rest.clone().multiply(new Quaternion().setFromEuler(new Euler(Math.sin(i)*Math.PI,Math.cos(i*.3)*Math.PI,Math.sin(i*.7)*Math.PI))),q=constrainLimb(name,input,axes,rest),a=decomposeLimb(q,axes,rest),limits=LIMB_LIMITS[name];
      expect(q.length()).toBeCloseTo(1,10);expect(q.angleTo(constrainLimb(name,q,axes,rest))).toBeLessThan(1e-7);
      expect(Math.hypot(a.forward/rad(a.forward<0?-limits.forward[0]:limits.forward[1]),a.side/rad(a.side<0?-limits.side[0]:limits.side[1]))).toBeLessThanOrEqual(1+1e-8);expect(Math.abs(a.twist)).toBeLessThanOrEqual(rad(limits.twist)+1e-8);
    }
  });
  for(const preset of PRESETS)it(`${preset.name}通过真实控制器后保持关节范围、骨长及末端精度`,()=>{
    const e=fixture(preset.id);assertLimits(e);for(const end of END_EFFECTORS)expect(e.world(end).distanceTo(new Vector3().fromArray(e.targets[end])),end).toBeLessThan(.005);
  });
  it('FK 输入和旧工程恢复使用同样的肩髋限位',()=>{
    const e=fixture();for(const name of Object.keys(LIMB_LIMITS)){e.selected=name;e.setSelectedRotation(0,180);e.setSelectedRotation(1,-170);e.setSelectedRotation(2,160);}assertLimits(e);
    const doc=e.snapshot();for(const name of Object.keys(LIMB_LIMITS))doc.joints[name].quaternion=new Quaternion().setFromEuler(new Euler(2.5,-2.5,2.5)).toArray();e.apply(doc,false);assertLimits(e);
  });
  it('固定双脚向下及向前拖骨盆，双腿配合且脚位方向保持',()=>{
    const e=fixture();pin(e);const target=e.world('Hips').add(new Vector3(.03,-.3,.12));move(e,'Hips',target);
    expect(e.world('Hips').distanceTo(target)).toBeLessThan(.005);assertPins(e);assertLimits(e);
  });
  it('胸腔超出原脊柱范围时，骨盆和双腿协同下沉',()=>{
    const e=fixture();pin(e);const hips=e.world('Hips'),target=e.world('Chest').add(new Vector3(.05,-.22,.19));move(e,'Chest',target);
    expect(e.world('Hips').distanceTo(hips)).toBeGreaterThan(.06);expect(e.world('Chest').distanceTo(target)).toBeLessThan(.015);assertPins(e);assertLimits(e);
  });
  it('较远手部目标由肩、躯干共同够取，固定双脚仍保持',()=>{
    const a=fixture(),b=fixture(),target=new Vector3(.85,1.58,.25);a.fullBody=false;pin(a);pin(b);move(a,'LeftHand',target);move(b,'LeftHand',target);
    expect(b.world('LeftHand').distanceTo(target)).toBeLessThan(a.world('LeftHand').distanceTo(target)*.35);expect(b.world('LeftHand').distanceTo(target)).toBeLessThan(.015);
    expect(b.bones.LeftShoulder.quaternion.angleTo(a.bones.LeftShoulder.quaternion)).toBeGreaterThan(.02);assertPins(b);assertLimits(b);
  });
  it('极端不可达目标保留固定脚，提示边界，身体不会无限跟随',()=>{
    const e=fixture();pin(e);const origin=e.world('Hips');move(e,'LeftHand',new Vector3(5,3,2));assertPins(e);assertLimits(e);expect(e.warning).toContain('边界');expect(e.world('Hips').distanceTo(origin)).toBeLessThanOrEqual(.35001);
    move(e,'Hips',e.world('Hips').add(new Vector3(0,2,0)));assertPins(e);assertLimits(e);expect(e.warning).toContain('边界');
  });
  it('同一次拖动绕行后回到目标，结果与直接移动一致',()=>{
    const a=fixture(),b=fixture();pin(a);pin(b);Object.assign(a,{dragBefore:a.snapshot()});Object.assign(b,{dragBefore:b.snapshot()});
    for(let i=0;i<20;i++)move(a,'LeftHand',new Vector3(.6+.4*Math.sin(i),1.5+.2*Math.cos(i),.2+.3*Math.sin(i*.7)));
    const target=new Vector3(.8,1.5,.25);move(a,'LeftHand',target);move(b,'LeftHand',target);
    for(const name of Object.keys(a.bones)){expect(a.bones[name].position.distanceTo(b.bones[name].position),name).toBeLessThan(1e-8);expect(a.bones[name].quaternion.angleTo(b.bones[name].quaternion),name).toBeLessThan(1e-6);}assertPins(a);
  });
  it('四个固定末端同时存在时，躯干调整不会让固定点累积漂移',()=>{
    const e=fixture();pin(e,END_EFFECTORS);Object.assign(e,{dragBefore:e.snapshot()});const target=e.world('Chest'),pins=structuredClone(e.pins);
    for(let i=0;i<25;i++){move(e,'Chest',target.clone().add(new Vector3(.04*Math.sin(i*.2),-.06,.06)));assertPins(e);assertLimits(e);expect(e.pins).toEqual(pins);expect(e.selected).toBe('Chest');}
  });
  it('地面约束开启时，贴地脚成为临时支撑，关闭联动后可单独移动骨盆',()=>{
    const e=fixture(),left=e.world('LeftFoot'),right=e.world('RightFoot');move(e,'Hips',e.world('Hips').add(new Vector3(0,-.2,.08)));
    expect(e.world('LeftFoot').distanceTo(left)).toBeLessThan(.00151);expect(e.world('RightFoot').distanceTo(right)).toBeLessThan(.00151);expect(Object.keys(e.pins)).toHaveLength(0);
    e.fullBody=false;const foot=e.world('LeftFoot');move(e,'Hips',e.world('Hips').add(new Vector3(0,.1,0)));expect(e.world('LeftFoot').y-foot.y).toBeCloseTo(.1,6);
  });
  it('联动状态可保存和恢复，旧工程仍可打开，错误字段被拒绝',()=>{
    const e=fixture();e.fullBody=false;const doc=parseDocument(JSON.stringify(e.snapshot()),e.rest);e.fullBody=true;e.apply(doc,false);expect(e.fullBody).toBe(false);
    delete doc.fullBody;e.apply(parseDocument(JSON.stringify(doc),e.rest),false);expect(e.fullBody).toBe(true);
    expect(()=>parseDocument(JSON.stringify({...doc,fullBody:'on'}),e.rest)).toThrow('全身联动设置无效');
  });
  it('左右够取、镜像和前臂翻转共同使用时仍保持约束及固定点',()=>{
    const e=fixture();pin(e);e.setForearmTwist('Right',-65);move(e,'RightHand',new Vector3(-.82,1.55,.22));assertPins(e);assertLimits(e);
    const angle=forearmAngles(e.bones.RightForeArm.quaternion,new Vector3().fromArray(rig.hingeAxes.RightForeArm),e.bones.RightHand.position);expect(angle.twist).toBeCloseTo(rad(-65),5);
    const before=e.snapshot();e.mirror();assertLimits(e);assertPins(e);e.mirror();for(const name of Object.keys(e.bones))expect(e.bones[name].quaternion.angleTo(new Quaternion().fromArray(before.joints[name].quaternion)),name).toBeLessThan(1e-6);
  });
  it('固定脚时的极端 FK 骨盆旋转受可达范围限制，不能把脚拉走',()=>{
    const e=fixture();pin(e);e.selected='Hips';e.setSelectedRotation(2,120);assertPins(e);assertLimits(e);expect(e.warning).toContain('边界');
  });
  for(const preset of ['squat','kneel','both-kneel','lunge','raise','sit-lean'])it(`${preset}姿态连续调整胸腔时，固定脚不漂移且保持全部限位`,()=>{
    const e=fixture(preset);pin(e);const target=e.world('Chest');Object.assign(e,{dragBefore:e.snapshot()});
    for(let i=0;i<24;i++){move(e,'Chest',target.clone().add(new Vector3(.06*Math.sin(i*.2),-.08,.08*Math.sin(i*.15))));assertPins(e);assertLimits(e);}
  });
  it('固定手掌方向后拒绝数值旋转，解除方向固定后可旋转且位置不变',()=>{
    const e=fixture();pin(e,END_EFFECTORS);const before=e.bones.LeftHand.getWorldQuaternion(new Quaternion()),pins=structuredClone(e.pins);e.selected='LeftHand';e.setSelectedRotation(0,30);assertPins(e);expect(e.bones.LeftHand.getWorldQuaternion(new Quaternion()).angleTo(before)).toBeLessThan(1e-7);expect(e.pins).toEqual(pins);
    e.setPin(true,false);e.setSelectedRotation(0,30);assertPins(e);expect(e.bones.LeftHand.getWorldQuaternion(new Quaternion()).angleTo(before)).toBeGreaterThan(.2);expect(e.pins.LeftHand!.position).toEqual(pins.LeftHand!.position);
    e.selected='LeftShoulder';e.setSelectedRotation(2,30);e.resetSelected();assertPins(e);assertLimits(e);
  });
  it('连续越过单臂边界时不会突然跳到另一姿态，并记录求解开销',()=>{
    const e=fixture();pin(e);const baseline=e.snapshot();Object.assign(e,{dragBefore:baseline});
    let previous=e.snapshot(),maxJointStep=0,maxRootStep=0,maxPinError=0;const times:number[]=[],errors:number[]=[];
    for(let i=0;i<100;i++){
      const t=i/99,target=new Vector3(.235+.62*t,.93+.65*t,.02+.23*t);move(e,'LeftHand',target);assertPins(e);assertLimits(e);
      for(const name of ['Spine','Spine1','Chest','UpperChest','LeftShoulder','LeftArm','LeftForeArm','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg'])maxJointStep=Math.max(maxJointStep,e.bones[name].quaternion.angleTo(new Quaternion().fromArray(previous.joints[name].quaternion)));
      maxRootStep=Math.max(maxRootStep,e.bones.Hips.position.distanceTo(new Vector3().fromArray(previous.joints.Hips.position)));
      maxPinError=Math.max(maxPinError,...Object.entries(e.pins).map(([n,p])=>e.world(n).distanceTo(new Vector3().fromArray(p!.position))));times.push(e.lastSolveStats.milliseconds);errors.push(e.world('LeftHand').distanceTo(target));previous=e.snapshot();
    }
    const presetErrors=Object.fromEntries(PRESETS.map(p=>{const pose=fixture(p.id);return[p.name,Math.max(...END_EFFECTORS.map(end=>pose.world(end).distanceTo(new Vector3().fromArray(pose.targets[end]))))*1000];}));
    times.sort((a,b)=>a-b);const report={node:process.version,frames:100,scope:'CPU controller only, no WebGL rendering',maximumJointStepDegrees:MathUtils.radToDeg(maxJointStep),maximumPelvisStepMillimetres:maxRootStep*1000,maximumPinErrorMillimetres:maxPinError*1000,lastReachErrorMillimetres:errors.at(-1)!*1000,medianMilliseconds:times[50],p95Milliseconds:times[95],maximumMilliseconds:times.at(-1),presetMaximumTargetErrorMillimetres:presetErrors};
    mkdirSync(new URL('../../artifacts/',import.meta.url),{recursive:true});writeFileSync(new URL('../../artifacts/fullbody-evaluation.json',import.meta.url),JSON.stringify(report,null,2));
    expect(maxJointStep).toBeLessThan(rad(18));expect(maxRootStep).toBeLessThan(.02);
  });
});
