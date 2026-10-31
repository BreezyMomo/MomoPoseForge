import {MathUtils,Quaternion,Vector3,type Bone} from 'three';
import type {RigDefinition} from './rigs';
import type {PoseDocument} from './types';
import type {ArticulatedRig} from './articulatedIK';

export function usesLegacyCalibration(doc:PoseDocument,rig:RigDefinition){
  return !!rig.calibration&&(doc.rigCalibrationVersion===undefined||!!rig.calibration.legacyVersions?.includes(doc.rigCalibrationVersion))&&Object.entries(rig.calibration.legacyPositions).every(([name,position])=>Array.isArray(doc.joints[name]?.position)&&doc.joints[name].position.length===3&&doc.joints[name].position.every((v,i)=>Math.abs(v-position[i])<=.0001));
}

/** Move corrected pivots while retaining the old feet, bend planes and FK twists.
 * This is a one-time geometric retarget, not a fresh IK edit/limit projection.
 * In particular, old multi-axis FK knees must remain readable.
 */
export function migrateCalibration(state:ArticulatedRig,doc:PoseDocument){
  if(!usesLegacyCalibration(doc,state.rig))return false;
  const {bones,rig,rest,model}=state;
  model.updateMatrixWorld(true);
  const world=(name:string)=>bones[name].getWorldPosition(new Vector3());
  const goals=rig.calibration!.chains.map(end=>{
    const [upper,middle]=rig.chains[end],pin=doc.pins[end];
    return {end,upper,middle,position:pin?new Vector3().fromArray(pin.position):world(end),orientation:pin?.orientation?new Quaternion().fromArray(pin.quaternion):bones[end].getWorldQuaternion(new Quaternion()),knee:world(middle)};
  });
  for(const name of Object.keys(rig.calibration!.legacyPositions))bones[name].position.fromArray(rest.joints[name].position);
  model.updateMatrixWorld(true);
  const aim=(bone:Bone,from:Vector3,to:Vector3)=>{
    const q=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize()).multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(q));bone.updateWorldMatrix(false,true);
  };
  for(const goal of goals){
    const origin=world(goal.upper),middle=world(goal.middle),tip=world(goal.end),a=origin.distanceTo(middle),b=middle.distanceTo(tip);
    const direction=goal.position.clone().sub(origin),distance=direction.length();
    if(distance<1e-9)direction.copy(tip).sub(origin);direction.normalize();
    const reach=MathUtils.clamp(distance,Math.abs(a-b)+1e-8,a+b-1e-8),along=(a*a-b*b+reach*reach)/(2*reach),height=Math.sqrt(Math.max(0,a*a-along*along));
    let radial=goal.knee.clone().sub(origin);radial.addScaledVector(direction,-radial.dot(direction));
    if(radial.lengthSq()<1e-12){radial=middle.clone().sub(origin);radial.addScaledVector(direction,-radial.dot(direction));}
    if(radial.lengthSq()<1e-12){radial.set(0,0,1);if(Math.abs(radial.dot(direction))>.9)radial.set(1,0,0);radial.addScaledVector(direction,-radial.dot(direction));}
    const knee=origin.clone().addScaledVector(direction,along).addScaledVector(radial.normalize(),height),end=origin.clone().addScaledVector(direction,reach);
    aim(bones[goal.upper],middle.sub(origin),knee.clone().sub(origin));
    aim(bones[goal.middle],world(goal.end).sub(world(goal.middle)),end.sub(world(goal.middle)));
    bones[goal.end].quaternion.copy(bones[goal.end].parent!.getWorldQuaternion(new Quaternion()).invert().multiply(goal.orientation));bones[goal.end].updateWorldMatrix(false,true);
  }
  return {positionError:Math.max(0,...goals.map(goal=>world(goal.end).distanceTo(goal.position)))};
}
