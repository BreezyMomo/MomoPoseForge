import {Quaternion,Vector3,type Bone} from 'three';

export function bendFrame(bones:Record<string,Bone>,chain:readonly string[],reference:Vector3){
  const [upper,middle,end]=chain,a=bones[upper].getWorldPosition(new Vector3()),b=bones[middle].getWorldPosition(new Vector3()),c=bones[end].getWorldPosition(new Vector3()),axis=c.clone().sub(a);
  if(axis.lengthSq()<1e-12)return null;axis.normalize();
  const radial=b.clone().sub(a).addScaledVector(axis,-b.clone().sub(a).dot(axis));
  if(radial.lengthSq()<1e-8)return null;radial.normalize();
  const zero=reference.clone().addScaledVector(axis,-reference.dot(axis));
  if(zero.lengthSq()<1e-8){zero.set(Math.abs(axis.x)<.8?1:0,Math.abs(axis.x)<.8?0:1,0);zero.addScaledVector(axis,-zero.dot(axis));}zero.normalize();
  const angle=Math.atan2(axis.dot(new Vector3().crossVectors(zero,radial)),zero.dot(radial));
  return {a,b,c,axis,radial,zero,angle};
}
/** Rotate the bend plane around the shoulder/wrist or hip/ankle chord.
 * Both endpoint position and orientation are invariant; bone lengths stay fixed. */
export function swivelChain(bones:Record<string,Bone>,chain:readonly string[],axis:Vector3,angle:number){
  const upper=bones[chain[0]],end=bones[chain.at(-1)!],orientation=end.getWorldQuaternion(new Quaternion()).normalize();
  const world=new Quaternion().setFromAxisAngle(axis,angle).multiply(upper.getWorldQuaternion(new Quaternion()).normalize());
  upper.quaternion.copy(upper.parent!.getWorldQuaternion(new Quaternion()).normalize().invert().multiply(world).normalize());upper.updateWorldMatrix(false,true);
  end.quaternion.copy(end.parent!.getWorldQuaternion(new Quaternion()).normalize().invert().multiply(orientation).normalize());end.updateWorldMatrix(false,true);
}
