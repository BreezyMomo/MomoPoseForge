import {Matrix4,Quaternion,Vector3,type Object3D} from 'three';
import type {PoseDocument} from './types';

/** Bind frames in model coordinates, computed without touching the current pose. */
export function restFrames(model:Object3D,rest:PoseDocument){
  const frames=new Map<Object3D,Matrix4>();frames.set(model,new Matrix4());
  const visit=(parent:Object3D)=>{for(const child of parent.children){
    const joint=rest.joints[child.name],local=joint?new Matrix4().compose(new Vector3().fromArray(joint.position),new Quaternion().fromArray(joint.quaternion),child.scale):new Matrix4().compose(child.position,child.quaternion,child.scale);
    frames.set(child,frames.get(parent)!.clone().multiply(local));visit(child);
  }};visit(model);return frames;
}
