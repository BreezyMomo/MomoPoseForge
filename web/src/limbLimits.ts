import {MathUtils,Quaternion,Vector3} from 'three';

type Range=[number,number];
export type LimbLimits={forward:Range;side:Range;twist:number};
// Editorial defaults for this rig, relative to its T-pose. They are not a
// medical range-of-motion model. Side is elevation for arms, abduction for hips.
export const LIMB_LIMITS:Record<string,LimbLimits>={
  LeftShoulder:{forward:[-25,35],side:[-15,35],twist:20},
  RightShoulder:{forward:[-25,35],side:[-15,35],twist:20},
  LeftArm:{forward:[-65,145],side:[-105,105],twist:100},
  RightArm:{forward:[-65,145],side:[-105,105],twist:100},
  LeftUpLeg:{forward:[-40,135],side:[-35,80],twist:50},
  RightUpLeg:{forward:[-40,135],side:[-35,80],twist:50},
};
export function limbAxes(name:string,childPosition:Vector3){
  const axis=childPosition.clone().normalize(),forward=new Vector3().crossVectors(axis,new Vector3(0,0,1)).normalize();
  const direction=name.endsWith('UpLeg')?new Vector3(name.startsWith('Left')?1:-1,0,0):new Vector3(0,1,0);
  const side=new Vector3().crossVectors(axis,direction);side.addScaledVector(forward,-side.dot(forward)).normalize();
  return {axis,forward,side};
}
type Axes=ReturnType<typeof limbAxes>;
export function decomposeLimb(rotation:Quaternion,axes:Axes,rest=new Quaternion()){
  const q=rest.clone().invert().multiply(rotation).normalize();if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);
  const projection=new Vector3(q.x,q.y,q.z).dot(axes.axis),twistQ=new Quaternion(axes.axis.x*projection,axes.axis.y*projection,axes.axis.z*projection,q.w);
  if(twistQ.lengthSq()<1e-12)twistQ.identity();else twistQ.normalize();
  const swing=q.clone().multiply(twistQ.clone().invert()).normalize(),length=Math.hypot(swing.x,swing.y,swing.z);
  const vector=new Vector3(swing.x,swing.y,swing.z).multiplyScalar(length>1e-10?2*Math.atan2(length,Math.max(0,swing.w))/length:0);
  const twist=2*Math.atan2(new Vector3(twistQ.x,twistQ.y,twistQ.z).dot(axes.axis),twistQ.w);
  return {forward:vector.dot(axes.forward),side:vector.dot(axes.side),twist:Math.atan2(Math.sin(twist),Math.cos(twist))};
}
export function constrainLimb(name:string,rotation:Quaternion,axes:Axes,rest=new Quaternion()){
  const limits=LIMB_LIMITS[name];if(!limits)return rotation.clone();
  const a=decomposeLimb(rotation,axes,rest),rad=MathUtils.degToRad;
  const forward=rad(a.forward<0?-limits.forward[0]:limits.forward[1]),side=rad(a.side<0?-limits.side[0]:limits.side[1]);
  const radius=Math.hypot(a.forward/forward,a.side/side),scale=radius>1?1/radius:1;
  const vector=axes.forward.clone().multiplyScalar(a.forward*scale).addScaledVector(axes.side,a.side*scale),angle=vector.length();
  const swing=angle>1e-10?new Quaternion().setFromAxisAngle(vector.divideScalar(angle),angle):new Quaternion();
  return rest.clone().multiply(swing).multiply(new Quaternion().setFromAxisAngle(axes.axis,MathUtils.clamp(a.twist,-rad(limits.twist),rad(limits.twist)))).normalize();
}
