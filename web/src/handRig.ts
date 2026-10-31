import {Quaternion,Vector3,type Bone,type Object3D} from 'three';
import {fingerAxes,fingerPart,fingerRotation} from './articulation';
import {DIGITS,type Digit,type PoseDocument,type Side,type HandValues} from './types';
import type {RigDefinition} from './rigs';
import {restFrames} from './restFrames';

export const handBone=(rig:RigDefinition,side:Side)=>rig.handSkeleton?.[side].wrist??`${side}Hand`;
export const fingerBone=(rig:RigDefinition,side:Side,digit:Digit,joint:number)=>rig.handSkeleton?.[side].digits[digit][joint-1]??`${side}${digit}${joint}`;
export function requiredHandBones(rig:RigDefinition){return rig.handSkeleton?Object.values(rig.handSkeleton).flatMap(hand=>[hand.wrist,...Object.values(hand.digits).flat()]):[];}
export function rigFinger(rig:RigDefinition,name:string){
  if(!rig.capabilities.hands)return null;
  if(!rig.handSkeleton){const part=fingerPart(name);return part?{side:part[1] as Side,digit:part[2] as Digit,joint:Number(part[3])}:null;}
  for(const side of ['Left','Right'] as const)for(const digit of DIGITS){const index=rig.handSkeleton[side].digits[digit].indexOf(name);if(index>=0)return {side,digit,joint:index+1};}return null;
}
type FingerFrame={rest:Quaternion;curl:Vector3;spread:Vector3};
const cache=new WeakMap<PoseDocument,Map<string,Map<string,FingerFrame>>>();
export function rigFingerFrame(rig:RigDefinition,model:Object3D,bones:Record<string,Bone>,rest:PoseDocument,side:Side,digit:Digit,joint:number,normalSign=-1):FingerFrame{
  if(!rig.handSkeleton)return {rest:new Quaternion(),...fingerAxes(rest.joints,side,digit,joint,normalSign)};
  let rigs=cache.get(rest);if(!rigs){rigs=new Map();cache.set(rest,rigs);}let frames=rigs.get(rig.id);
  if(!frames){
    frames=new Map();rigs.set(rig.id,frames);const matrices=restFrames(model,rest),position=(name:string)=>new Vector3().setFromMatrixPosition(matrices.get(bones[name])!);
    for(const s of ['Left','Right'] as const){
      const origin=position(handBone(rig,s)),index=position(fingerBone(rig,s,'Index',1)).sub(origin),little=position(fingerBone(rig,s,'Little',1)).sub(origin);
      const normal=new Vector3().crossVectors(index,little).normalize().multiplyScalar(s==='Left'?-1:1);
      for(const d of DIGITS)for(let j=1;j<=3;j++){
        const name=fingerBone(rig,s,d,j),next=fingerBone(rig,s,d,j===3?2:j+1),direction=j===3?position(name).sub(position(next)):position(next).sub(position(name));
        const inverse=new Quaternion().setFromRotationMatrix(matrices.get(bones[name])!).normalize().invert();
        frames.set(name,{rest:new Quaternion().fromArray(rest.joints[name].quaternion).normalize(),curl:new Vector3().crossVectors(direction,normal).normalize().applyQuaternion(inverse).normalize(),spread:normal.clone().applyQuaternion(inverse).normalize()});
      }
    }
  }
  return frames.get(fingerBone(rig,side,digit,joint))!;
}
export function writeRigHand(rig:RigDefinition,model:Object3D,bones:Record<string,Bone>,rest:PoseDocument,side:Side,values:HandValues,normalSign=-1){
  for(const digit of DIGITS)for(let joint=1;joint<=3;joint++){
    const frame=rigFingerFrame(rig,model,bones,rest,side,digit,joint,normalSign),value=values[digit];
    bones[fingerBone(rig,side,digit,joint)].quaternion.copy(frame.rest.clone().multiply(fingerRotation(digit,joint,value.curl[joint-1]*Math.PI/180,joint===1?value.spread*(side==='Right'?-1:1)*Math.PI/180:0,frame)));
  }
}
