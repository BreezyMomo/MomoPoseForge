import {Euler,MathUtils,Quaternion,Vector3} from 'three';
import type {RigJointControl} from './rigs';
import type {Vec3} from './types';
import {twistAngle} from './articulation';

/** FK values are deltas in the joint's bind frame, not absolute asset quaternions. */
export function fkAngles(local:Quaternion,rest:Quaternion,joint?:RigJointControl):Vec3{
  const delta=rest.clone().invert().multiply(local);
  if(joint?.hinge!==undefined){const values:Vec3=[0,0,0];values[joint.hinge]=twistAngle(delta,new Vector3().setComponent(joint.hinge,1));return values.map(MathUtils.radToDeg) as Vec3;}
  const e=new Euler().setFromQuaternion(delta,'XYZ');return [e.x,e.y,e.z].map(MathUtils.radToDeg) as Vec3;
}
export function fkRotation(angles:Vec3,rest:Quaternion,joint?:RigJointControl){
  const rad=angles.map(MathUtils.degToRad);
  const delta=joint?.hinge===undefined?new Quaternion().setFromEuler(new Euler(rad[0],rad[1],rad[2],'XYZ')):new Quaternion().setFromAxisAngle(new Vector3().setComponent(joint.hinge,1),rad[joint.hinge]);
  return rest.clone().multiply(delta);
}
export function constrainFk(local:Quaternion,rest:Quaternion,joint?:RigJointControl){
  if(!joint?.limits)return local.clone();
  const angles=fkAngles(local,rest,joint).map((v,i)=>MathUtils.clamp(v,joint.limits![0][i],joint.limits![1][i])) as Vec3,limited=fkRotation(angles,rest,joint);
  // Preserve exact valid input on repeated restore; no cumulative conversion drift.
  return local.angleTo(limited)<1e-7?local.clone():limited;
}
