import {Quaternion,Vector3,type Bone,type Object3D} from 'three';
import type {RigDefinition} from './rigs';
import type {PoseDocument} from './types';
import {constrainFk} from './fkControls';
import {LOCAL_AXES,solveConstrainedIK,type SolverJoint} from './fullBodyIK';

export type ArticulatedRig={rig:RigDefinition;bones:Record<string,Bone>;rest:PoseDocument;model:Object3D};
const world=(state:ArticulatedRig,name:string)=>state.bones[name].getWorldPosition(new Vector3());
function controls(state:ArticulatedRig,name:string){return state.rig.jointControls?.find(j=>j.name===name);}
export function projectRigJoint(state:ArticulatedRig,name:string){
  const bone=state.bones[name],rest=new Quaternion().fromArray(state.rest.joints[name].quaternion);
  bone.quaternion.copy(constrainFk(bone.quaternion,rest,controls(state,name)));bone.updateWorldMatrix(false,true);
}
function setEndOrientation(state:ArticulatedRig,end:string,quaternion:Quaternion){
  const bone=state.bones[end],parent=bone.parent!.getWorldQuaternion(new Quaternion()),rest=new Quaternion().fromArray(state.rest.joints[end].quaternion);
  const local=constrainFk(parent.invert().multiply(quaternion),rest,controls(state,end));
  if(bone.quaternion.angleTo(local)>1e-7)bone.quaternion.copy(local);bone.updateWorldMatrix(false,true);
}

/** The chain length, local bind frames and admissible axes all come from the rig. */
export function solveRigChain(state:ArticulatedRig,end:string,target:Vector3,orientation?:Quaternion){
  const chain=state.rig.chains[end];if(!chain||chain.length<3||chain.at(-1)!==end)throw new Error('IK 链定义无效');
  const endOrientation=orientation??state.bones[end].getWorldQuaternion(new Quaternion());
  const joints:SolverJoint[]=chain.slice(0,-1).map(name=>{
    const joint=controls(state,name),rest=new Quaternion().fromArray(state.rest.joints[name].quaternion);
    const axes=joint?.hinge===undefined?LOCAL_AXES:[new Vector3().setComponent(joint.hinge,1).applyQuaternion(rest)];
    return {bone:state.bones[name],axes,mobility:1};
  });
  const result=solveConstrainedIK(state.bones,joints,[{name:end,target,weight:1}],name=>projectRigJoint(state,name),48);
  setEndOrientation(state,end,endOrientation);
  return {...result,error:world(state,end).distanceTo(target),position:world(state,end)};
}

export function solveRigContacts(state:ArticulatedRig,pins:PoseDocument['pins']){
  for(const end of state.rig.contacts){const pin=pins[end];if(pin)solveRigChain(state,end,new Vector3().fromArray(pin.position),pin.orientation?new Quaternion().fromArray(pin.quaternion):undefined);}
  let positionError=0,orientationError=0;
  for(const end of state.rig.contacts){const pin=pins[end];if(!pin)continue;positionError=Math.max(positionError,world(state,end).distanceTo(new Vector3().fromArray(pin.position)));if(pin.orientation)orientationError=Math.max(orientationError,state.bones[end].getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().fromArray(pin.quaternion)));}
  return {positionError,orientationError};
}
