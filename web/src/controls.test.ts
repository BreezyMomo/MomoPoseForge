import {describe,it,expect} from 'vitest';
import {Bone,Group,Object3D,Vector3,Quaternion,MathUtils,Euler} from 'three';
import {PoseEngine} from './PoseEngine';
import rig from '../public/models/xbot-profile.json';
import {JOINT_LIMITS,constrainJointRotation,decomposeJointRotation} from './poseControls';

function makeEngine(){
  const root=new Group(),bones:Record<string,Bone>={};
  const profile=rig.bones as Record<string,{parent:string|null;position:number[]}>;
  for(const name of Object.keys(profile)){bones[name]=new Bone();bones[name].name=name;}
  for(const[name,b]of Object.entries(profile)){
    bones[name].position.fromArray(b.position);
    if(b.parent){bones[name].position.sub(new Vector3().fromArray(profile[b.parent].position));bones[b.parent].add(bones[name]);}else root.add(bones[name]);
  }
  root.updateMatrixWorld(true);
  const engine=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(engine,{model:root,bones,gizmo:new Object3D(),selected:'Chest',mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:[],ground:false,profile:rig,dragBefore:null,transform:{setMode(){},attach(){}}});
  for(const end of ['LeftHand','RightHand','LeftFoot','RightFoot']){engine.targets[end]=engine.world(end).toArray();engine.poles[end]=engine.world(end).add(new Vector3(0,0,.8)).toArray();}
  engine.rest=engine.snapshot();
  return engine;
}
function moveChest(engine:PoseEngine,target:Vector3){
  engine.gizmo.position.copy(target);
  (engine as unknown as {manipulate():void}).manipulate();
}
const twist=(q:Quaternion)=>MathUtils.euclideanModulo(2*Math.atan2(q.y,q.w)+Math.PI,2*Math.PI)-Math.PI;

describe('实际控制器的连续拖动回归',()=>{
  it('可达的前倾和侧弯目标会实际移动胸腔',()=>{
    for(const rotation of [new Euler(.2,0,0),new Euler(0,0,-.2)]){
      const reference=makeEngine(),engine=makeEngine();reference.bones.Spine.quaternion.setFromEuler(rotation);reference.model.updateMatrixWorld(true);
      const target=reference.world('Chest'),before=engine.world('Chest');moveChest(engine,target);
      expect(engine.world('Chest').distanceTo(before)).toBeGreaterThan(.02);
      expect(engine.world('Chest').distanceTo(target)).toBeLessThan(.001);
    }
  });
  it('胸腔绕身体连续拖动时，腰部和脊柱不会累积轴向扭转',()=>{
    const engine=makeEngine(),pivot=engine.world('Spine');
    for(let i=0;i<240;i++){
      const a=i*Math.PI/30;
      moveChest(engine,pivot.clone().add(new Vector3(.4*Math.cos(a),.12+.3*Math.sin(a*.7),.4*Math.sin(a))));
      expect(Math.abs(twist(engine.bones.Spine.quaternion))).toBeLessThanOrEqual(MathUtils.degToRad(20)+1e-6);
      expect(Math.abs(twist(engine.bones.Spine1.quaternion))).toBeLessThanOrEqual(MathUtils.degToRad(15)+1e-6);
    }
  });
  it('从头部旋转切换到手脚时，恢复末端移动操作',()=>{
    const engine=makeEngine();engine.select('Head');expect(engine.mode).toBe('rotate');
    engine.select('LeftHand');expect(engine.mode).toBe('translate');
    engine.select('Head');engine.select('RightFoot');expect(engine.mode).toBe('translate');
  });
  it('位置输入超过可达范围后，操纵器回到实际关节位置',()=>{
    const engine=makeEngine();Object.assign(engine,{ready:true,update(){},fit(){},onInfo(){},onCommit(){}});
    engine.setSelectedPosition(0,.35);
    expect(engine.world('Chest').x).toBeLessThan(.1);
    expect(engine.gizmo.position.distanceTo(engine.world('Chest'))).toBeLessThan(1e-9);
  });
  it('一次拖动中绕行再回到同一目标，结果与直接移动一致',()=>{
    const a=makeEngine(),b=makeEngine(),pivot=a.world('Spine');
    Object.assign(a,{dragBefore:a.snapshot()});Object.assign(b,{dragBefore:b.snapshot()});
    for(let i=0;i<100;i++)moveChest(a,pivot.clone().add(new Vector3(.35*Math.cos(i),.12,.35*Math.sin(i))));
    const target=pivot.clone().add(new Vector3(.04,.18,.09));moveChest(a,target);moveChest(b,target);
    for(const name of ['Spine','Spine1','Chest'])expect(a.bones[name].quaternion.angleTo(b.bones[name].quaternion)).toBeLessThan(1e-7);
  });
  it('移动胸腔保留已有转身角，且不改变任何骨段长度',()=>{
    const engine=makeEngine();engine.bones.Hips.quaternion.setFromEuler(new Euler(0,.8,0));engine.bones.Spine.quaternion.setFromEuler(new Euler(.1,.2,0));engine.model.updateMatrixWorld(true);
    const before=decomposeJointRotation(engine.bones.Spine.quaternion).twist;
    for(let i=0;i<60;i++){
      moveChest(engine,engine.world('Spine').add(new Vector3(.3*Math.cos(i*.1),.1,.3*Math.sin(i*.1))));
      expect(decomposeJointRotation(engine.bones.Spine.quaternion).twist).toBeCloseTo(before,9);
      for(const name of ['Spine','Spine1','Chest']){
        const bone=engine.bones[name];expect(bone.getWorldPosition(new Vector3()).distanceTo(bone.parent!.getWorldPosition(new Vector3()))).toBeCloseTo(bone.position.length(),10);
      }
    }
  });
  it('固定脚后移动骨盆，脚的位置和方向保持不变',()=>{
    const engine=makeEngine(),end='LeftFoot',p=engine.world(end),q=engine.bones[end].getWorldQuaternion(new Quaternion());
    engine.pins.LeftFoot={position:p.toArray(),quaternion:q.toArray(),orientation:true};engine.selected='Hips';
    engine.gizmo.position.copy(engine.world('Hips')).add(new Vector3(.015,-.03,.015));
    (engine as unknown as {manipulate():void}).manipulate();
    expect(engine.world(end).distanceTo(p)).toBeLessThan(.0001);
    expect(engine.bones[end].getWorldQuaternion(new Quaternion()).angleTo(q)).toBeLessThan(1e-7);
  });
  it('局部角度输入和旧工程恢复都执行同一套头颈与脊柱限位',()=>{
    const engine=makeEngine();engine.selected='Head';engine.setSelectedRotation(1,180);
    expect(decomposeJointRotation(engine.bones.Head.quaternion).twist).toBeCloseTo(MathUtils.degToRad(60),8);
    engine.setSelectedRotation(1,-180);expect(decomposeJointRotation(engine.bones.Head.quaternion).twist).toBeCloseTo(-MathUtils.degToRad(60),8);
    const old=engine.snapshot();old.joints.Spine.quaternion=new Quaternion().setFromEuler(new Euler(0,2,0)).toArray();engine.apply(old,false);
    expect(Math.abs(decomposeJointRotation(engine.bones.Spine.quaternion).twist)).toBeCloseTo(MathUtils.degToRad(20),8);
    expect(old.joints.Spine.quaternion).toEqual(new Quaternion().setFromEuler(new Euler(0,2,0)).toArray());
  });
});

describe('脊柱与头颈的摆动锥和扭转限位',()=>{
  for(const[name,limits]of Object.entries(JOINT_LIMITS))it(`${name}在极端输入下保持有限且不会越过角度范围`,()=>{
    const rest=new Quaternion().setFromEuler(new Euler(.2,-.3,.1));
    for(let i=0;i<200;i++){
      const input=rest.clone().multiply(new Quaternion().setFromEuler(new Euler(Math.sin(i)*Math.PI,Math.cos(i*.3)*Math.PI,Math.sin(i*.7)*Math.PI)));
      const q=constrainJointRotation(name,input,rest),a=decomposeJointRotation(q,rest),rad=MathUtils.degToRad;
      expect(q.length()).toBeCloseTo(1,10);expect(Math.abs(a.twist)).toBeLessThanOrEqual(rad(limits.twist)+1e-8);
      expect(Math.hypot(a.bend/rad(a.bend<0?-limits.bend[0]:limits.bend[1]),a.side/rad(limits.side))).toBeLessThanOrEqual(1+1e-8);
      expect(q.angleTo(constrainJointRotation(name,q,rest))).toBeLessThan(1e-7);
    }
  });
});
