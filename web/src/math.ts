import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';

/** Analytic two-link solution. The pole fixes the bend plane; lengths never change. */
export function solveTwoBone(start: Vector3, target: Vector3, pole: Vector3, upper: number, lower: number, maxFlex = 155) {
  if (!(upper > 0 && lower > 0)) throw new Error('骨段长度无效');
  const ray = target.clone().sub(start);
  const requested = ray.length();
  const direction = requested > 1e-8 ? ray.divideScalar(requested) : new Vector3(0, -1, 0);
  const min = Math.max(1e-5, Math.sqrt(Math.max(0, upper ** 2 + lower ** 2 + 2 * upper * lower * Math.cos(MathUtils.degToRad(maxFlex)))));
  const distance = MathUtils.clamp(requested, min, upper + lower - 1e-6);
  const bend = pole.clone().sub(start);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-10) {
    bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(direction, -direction.x);
  }
  bend.normalize();
  const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
  const elbow = start.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  const end = start.clone().addScaledVector(direction, distance);
  return { elbow, end, error: end.distanceTo(target) };
}

/** Align both the upper-bone direction AND its hinge axis; a swing-only rotation
 * reaches the target but can twist a mechanical elbow or knee backwards. */
export function solveLimbRotations(upperRest:Vector3,lowerRest:Vector3,hingeAxis:Vector3,upperDirection:Vector3,lowerDirection:Vector3,maxFlex=155){
  const u=upperRest.clone().normalize(),v=lowerRest.clone().normalize(),h=hingeAxis.clone().normalize();
  // Keep the declared mechanical hinge exact; remove tiny bind-pose axis noise
  // from the reference direction rather than tilting the hinge itself.
  u.addScaledVector(h,-h.dot(u)).normalize();
  const U=upperDirection.clone().normalize(),L=lowerDirection.clone().normalize();
  const H=new Vector3().crossVectors(U,L);
  if(H.lengthSq()<1e-14)throw new Error('IK 弯曲平面退化');
  H.normalize();
  const source=new Matrix4().makeBasis(u,new Vector3().crossVectors(h,u).normalize(),h);
  const destination=new Matrix4().makeBasis(U,new Vector3().crossVectors(H,U).normalize(),H);
  const upperWorld=new Quaternion().setFromRotationMatrix(destination.multiply(source.transpose())).normalize();
  const desiredLocal=L.clone().applyQuaternion(upperWorld.clone().invert());
  const signedAngle=(a:Vector3,b:Vector3)=>Math.atan2(h.dot(new Vector3().crossVectors(a,b)),MathUtils.clamp(a.dot(b),-1,1));
  const restFlex=signedAngle(u,v);
  const angle=MathUtils.clamp(signedAngle(v,desiredLocal),-restFlex,MathUtils.degToRad(maxFlex)-restFlex);
  return {upperWorld,lowerLocal:new Quaternion().setFromAxisAngle(h,angle),flexion:restFlex+angle};
}

export function projectPoint(point: Vector3, camera: import('three').Camera, width: number, height: number) {
  const p = point.clone().project(camera);
  const visible = Number.isFinite(p.x + p.y + p.z) && p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
  return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, valid: visible };
}
