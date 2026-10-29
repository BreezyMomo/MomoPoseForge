import {Bone,MathUtils,Quaternion,Vector3} from 'three';

export type JointLimits={bend:[number,number];side:number;twist:number};
// Conservative posing limits in degrees, relative to the model's bind pose.
// These are editor defaults, not a clinical range-of-motion model.
export const JOINT_LIMITS:Record<string,JointLimits>={
  Spine:{bend:[-20,35],side:20,twist:20},
  Spine1:{bend:[-15,25],side:15,twist:15},
  Chest:{bend:[-15,20],side:15,twist:20},
  UpperChest:{bend:[-10,15],side:10,twist:10},
  Neck:{bend:[-25,35],side:25,twist:45},
  Head:{bend:[-30,30],side:25,twist:60},
};
export const SPINE_CHAIN=['Spine','Spine1'] as const;
const UP=new Vector3(0,1,0);
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));

/** Swing moves the bone's up axis; twist turns around it. Keeping them separate
 * avoids Euler branch flips and lets translation preserve the existing twist. */
export function decomposeJointRotation(rotation:Quaternion,rest=new Quaternion()){
  const relative=rest.clone().invert().multiply(rotation).normalize();
  if(relative.w<0)relative.set(-relative.x,-relative.y,-relative.z,-relative.w);
  const axial=new Quaternion(0,relative.y,0,relative.w);
  if(axial.lengthSq()<1e-12)axial.identity();else axial.normalize();
  const swing=relative.clone().multiply(axial.clone().invert()).normalize();
  const length=Math.hypot(swing.x,swing.z),angle=2*Math.atan2(length,Math.max(0,swing.w));
  return {bend:length>1e-10?swing.x/length*angle:0,side:length>1e-10?swing.z/length*angle:0,twist:wrap(2*Math.atan2(axial.y,axial.w))};
}

export function constrainJointRotation(name:string,rotation:Quaternion,rest=new Quaternion(),heldTwist?:number){
  const limits=JOINT_LIMITS[name];if(!limits)return rotation.clone();
  const a=decomposeJointRotation(rotation,rest),toRad=MathUtils.degToRad;
  const bendLimit=toRad(a.bend<0?-limits.bend[0]:limits.bend[1]),sideLimit=toRad(limits.side);
  // An elliptical swing cone prevents simultaneous maximum forward and side bend.
  const radius=Math.hypot(a.bend/bendLimit,a.side/sideLimit),scale=radius>1?1/radius:1;
  const bend=a.bend*scale,side=a.side*scale,angle=Math.hypot(bend,side);
  const swing=angle>1e-10?new Quaternion().setFromAxisAngle(new Vector3(bend/angle,0,side/angle),angle):new Quaternion();
  const twist=MathUtils.clamp(heldTwist??a.twist,-toRad(limits.twist),toRad(limits.twist));
  return rest.clone().multiply(swing).multiply(new Quaternion().setFromAxisAngle(UP,twist)).normalize();
}

/** Constrained CCD for the chest. Local axial twist is held throughout positional
 * editing, so circling a target cannot wind up the spine. Bone lengths are fixed. */
export function solveSpineTarget(bones:Record<string,Bone>,target:Vector3,rest:Record<string,{quaternion:number[]}>){
  const joints=SPINE_CHAIN.map(name=>bones[name]),end=bones.Chest;
  const twists=joints.map(j=>decomposeJointRotation(j.quaternion,new Quaternion().fromArray(rest[j.name].quaternion)).twist);
  for(let step=0;step<20;step++){
    for(let i=joints.length-1;i>=0;i--){
      const joint=joints[i],origin=joint.getWorldPosition(new Vector3());
      const from=end.getWorldPosition(new Vector3()).sub(origin),to=target.clone().sub(origin);
      if(from.lengthSq()<1e-12||to.lengthSq()<1e-12)continue;
      const swing=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
      // Small angular steps keep targets behind/below the pelvis from flipping a joint.
      const angle=swing.angleTo(new Quaternion());
      if(angle>.15)swing.slerpQuaternions(new Quaternion(),swing.clone(),.15/angle);
      const world=swing.multiply(joint.getWorldQuaternion(new Quaternion()));
      const parent=joint.parent!.getWorldQuaternion(new Quaternion());
      const local=parent.invert().multiply(world);
      joint.quaternion.copy(constrainJointRotation(joint.name,local,new Quaternion().fromArray(rest[joint.name].quaternion),twists[i]));
      joint.updateWorldMatrix(false,true);
    }
    if(end.getWorldPosition(new Vector3()).distanceToSquared(target)<1e-8)break;
  }
  return end.getWorldPosition(new Vector3()).distanceTo(target);
}

export function controlDescription(name:string){
  if(/^(Left|Right)(Thumb|Index|Middle|Ring|Little)[123]$/.test(name))return {label:'手指关节',help:'使用下方手指精调逐节弯曲和张开，也可用旋转控制器调整。'};
  if(name.endsWith('ToeBase'))return {label:'脚趾弯曲',help:'控制前脚掌抬起或下弯，脚踝位置保持不变。'};
  if(name.endsWith('Shoulder'))return {label:'肩部旋转',help:'旋转锁骨带动上臂；需要固定手位时先固定对应的手。'};
  if(name.endsWith('Arm')&&!name.endsWith('ForeArm'))return {label:'上臂旋转',help:'旋转上臂调整手臂方向；手脚固定的 IK 目标优先。'};
  if(name.endsWith('UpLeg'))return {label:'髋部旋转',help:'旋转髋部带动整条腿；固定脚后优先保持脚的目标位置。'};
  if(name.endsWith('Hand')||name.endsWith('Foot'))return {label:'手脚 IK',help:'移动控制整条手臂或腿；切换旋转可调整手掌、脚掌朝向。'};
  if(name==='Hips')return {label:'骨盆移动',help:'移动身体根部；开启固定的手脚保持原位置。'};
  if(name==='Chest')return {label:'胸腔弯曲',help:'移动调整前后弯与侧弯，保留当前扭转；转身请切换旋转。'};
  if(name.endsWith('ForeArm')||name==='LeftLeg'||name==='RightLeg')return {label:'肘膝朝向',help:'移动改变弯曲方向，手脚保持当前目标位置。'};
  return {label:'关节旋转',help:'旋转调整关节方向；脊柱、颈部和头部受角度范围约束。'};
}
