import {MathUtils,Quaternion,Vector3,type Bone,type Object3D} from 'three';
import {twistAngle} from './articulation';
import type {RigDefinition} from './rigs';
import type {PoseDocument} from './types';
import {constrainFk} from './fkControls';
import {LOCAL_AXES,solveConstrainedIK,type SolverJoint} from './fullBodyIK';
import {bendFrame,swivelChain} from './bendControls';

export type ArticulatedRig={rig:RigDefinition;bones:Record<string,Bone>;rest:PoseDocument;model:Object3D};
const world=(state:ArticulatedRig,name:string)=>state.bones[name].getWorldPosition(new Vector3());
function controls(state:ArticulatedRig,name:string){return state.rig.jointControls?.find(j=>j.name===name);}
export function projectRigJoint(state:ArticulatedRig,name:string){
  const bone=state.bones[name],rest=new Quaternion().fromArray(state.rest.joints[name].quaternion),hinge=controls(state,name)?.ikHinge;
  if(hinge){
    const axis=new Vector3().fromArray(hinge.axis).normalize(),angle=twistAngle(rest.clone().invert().multiply(bone.quaternion),axis);
    bone.quaternion.copy(rest.multiply(new Quaternion().setFromAxisAngle(axis,MathUtils.degToRad(MathUtils.clamp(MathUtils.radToDeg(angle),hinge.min,hinge.max)))));bone.updateWorldMatrix(false,true);return;
  }
  bone.quaternion.copy(constrainFk(bone.quaternion,rest,controls(state,name)));bone.updateWorldMatrix(false,true);
}
function setEndOrientation(state:ArticulatedRig,end:string,quaternion:Quaternion){
  const bone=state.bones[end],parent=bone.parent!.getWorldQuaternion(new Quaternion()),rest=new Quaternion().fromArray(state.rest.joints[end].quaternion);
  const local=constrainFk(parent.invert().multiply(quaternion),rest,controls(state,end));
  if(bone.quaternion.angleTo(local)>1e-7)bone.quaternion.copy(local);bone.updateWorldMatrix(false,true);
}

/** The chain length, local bind frames and admissible axes all come from the rig. */
export function solveRigChain(state:ArticulatedRig,end:string,target:Vector3,orientation?:Quaternion,pole?:Vector3){
  const chain=state.rig.chains[end];if(!chain||chain.length<3||chain.at(-1)!==end)throw new Error('IK 链定义无效');
  const endOrientation=orientation??state.bones[end].getWorldQuaternion(new Quaternion());
  const joints:SolverJoint[]=chain.slice(0,-1).map(name=>{
    const joint=controls(state,name),rest=new Quaternion().fromArray(state.rest.joints[name].quaternion);
    const axes=joint?.ikHinge?[new Vector3().fromArray(joint.ikHinge.axis).normalize().applyQuaternion(rest)]:joint?.hinge===undefined?LOCAL_AXES:[new Vector3().setComponent(joint.hinge,1).applyQuaternion(rest)];
    return {bone:state.bones[name],axes,mobility:1};
  });
  // Existing FK poses may use all rotational axes. Projection belongs to an
  // explicit IK edit, so opening an old project never rewrites that pose.
  for(const joint of joints)projectRigJoint(state,joint.bone.name);
  // At full extension the position Jacobian cannot discover a bend toward an
  // inward target. Seed the calibrated hinge from the triangle's side lengths.
  // The existing upper-joint rotation still determines the bend plane.
  if(chain.length===3){
    const lower=state.bones[chain[1]],hinge=controls(state,chain[1])?.ikHinge;
    if(hinge){
      const rest=new Quaternion().fromArray(state.rest.joints[chain[1]].quaternion),axis=new Vector3().fromArray(hinge.axis).normalize();
      const angle=MathUtils.radToDeg(twistAngle(rest.clone().invert().multiply(lower.quaternion),axis));
      const origin=world(state,chain[0]),middle=world(state,chain[1]),tip=world(state,end),a=origin.distanceTo(middle),b=middle.distanceTo(tip),d=origin.distanceTo(target);
      const bend=Math.acos(MathUtils.clamp((d*d-a*a-b*b)/(2*a*b),-1,1));
      const straight=hinge.straight??hinge.min;
      if(Math.abs(angle-straight)<2&&bend>MathUtils.degToRad(3)){
        lower.quaternion.copy(rest.multiply(new Quaternion().setFromAxisAngle(axis,MathUtils.degToRad(MathUtils.clamp(straight+MathUtils.radToDeg(bend),hinge.min,hinge.max)))));lower.updateWorldMatrix(false,true);
      }
    }
  }
  const result=solveConstrainedIK(state.bones,joints,[{name:end,target,weight:1}],name=>projectRigJoint(state,name),48);
  if(pole&&state.rig.bendControls?.[end]){
    const frame=bendFrame(state.bones,chain,pole.clone().sub(world(state,chain[0])));
    if(frame)swivelChain(state.bones,chain,frame.axis,-frame.angle);
  }
  setEndOrientation(state,end,endOrientation);
  return {...result,error:world(state,end).distanceTo(target),position:world(state,end)};
}

export function solveRigContacts(state:ArticulatedRig,pins:PoseDocument['pins']){
  for(const end of state.rig.contacts){const pin=pins[end];if(pin)solveRigChain(state,end,new Vector3().fromArray(pin.position),pin.orientation?new Quaternion().fromArray(pin.quaternion):undefined);}
  let positionError=0,orientationError=0;
  for(const end of state.rig.contacts){const pin=pins[end];if(!pin)continue;positionError=Math.max(positionError,world(state,end).distanceTo(new Vector3().fromArray(pin.position)));if(pin.orientation)orientationError=Math.max(orientationError,state.bones[end].getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().fromArray(pin.quaternion)));}
  return {positionError,orientationError};
}
