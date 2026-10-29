import {MathUtils,Quaternion,Vector3} from 'three';
import {DIGITS,type Digit,type Side,type HandValues} from './types';

type Rest=Record<string,{position:number[];quaternion:number[]}>;
const rad=MathUtils.degToRad;
export const FOREARM_TWIST_LIMIT=90;
export const FINGER_CURL_LIMITS:Record<Digit,[number,number,number]>={Thumb:[55,80,70],Index:[90,105,80],Middle:[90,105,80],Ring:[90,105,80],Little:[90,105,80]};
export const fingerPart=(name:string)=>/^(Left|Right)(Thumb|Index|Middle|Ring|Little)([123])$/.exec(name);
export const emptyHandValues=()=>Object.fromEntries(DIGITS.map(d=>[d,{curl:[0,0,0],spread:0}])) as HandValues;

export function twistAngle(q:Quaternion,axis:Vector3){
  const projection=new Vector3(q.x,q.y,q.z).dot(axis);
  return Math.atan2(Math.sin(2*Math.atan2(projection,q.w)),Math.cos(2*Math.atan2(projection,q.w)));
}

/** q = hinge bend * axial roll. Roll is about the child-bone direction, so it
 * changes forearm/hand orientation without moving the wrist or bending sideways. */
export function forearmAngles(q:Quaternion,hinge:Vector3,lower:Vector3){
  const axis=lower.clone().normalize(),from=axis.clone().addScaledVector(hinge,-axis.dot(hinge));
  const to=axis.clone().applyQuaternion(q);to.addScaledVector(hinge,-to.dot(hinge));
  // The bind-pose hinge and bone axis are only approximately perpendicular.
  // Measure bend from the child direction first; a twist projection alone
  // otherwise leaks a tiny bend component into roll on every IK update.
  const bend=Math.atan2(hinge.dot(new Vector3().crossVectors(from,to)),from.dot(to));
  const roll=new Quaternion().setFromAxisAngle(hinge,-bend).multiply(q);
  return {bend,twist:twistAngle(roll,axis)};
}
export function forearmRotation(bend:number,twist:number,hinge:Vector3,lower:Vector3){
  return new Quaternion().setFromAxisAngle(hinge,bend).multiply(new Quaternion().setFromAxisAngle(lower.clone().normalize(),MathUtils.clamp(twist,-rad(FOREARM_TWIST_LIMIT),rad(FOREARM_TWIST_LIMIT)))).normalize();
}

export function fingerAxes(rest:Rest,side:Side,digit:Digit,joint:number,normalSign=-1){
  const index=new Vector3().fromArray(rest[`${side}Index1`].position),little=new Vector3().fromArray(rest[`${side}Little1`].position);
  const normal=new Vector3().crossVectors(index,little).normalize().multiplyScalar((side==='Right'?-1:1)*normalSign);
  const direction=new Vector3().fromArray(rest[`${side}${digit}${joint+1}`].position).normalize();
  return {curl:new Vector3().crossVectors(direction,normal).normalize(),spread:normal};
}
export function fingerAngles(q:Quaternion,axes:{curl:Vector3;spread:Vector3}){
  const curl=twistAngle(q,axes.curl),swing=q.clone().multiply(new Quaternion().setFromAxisAngle(axes.curl,-curl));
  return {curl,spread:twistAngle(swing,axes.spread)};
}
export function fingerRotation(digit:Digit,joint:number,curl:number,spread:number,axes:{curl:Vector3;spread:Vector3}){
  const max=rad(FINGER_CURL_LIMITS[digit][joint-1]),spreadLimit=joint===1?rad(digit==='Thumb'?40:20):0;
  return new Quaternion().setFromAxisAngle(axes.spread,MathUtils.clamp(spread,-spreadLimit,spreadLimit))
    .multiply(new Quaternion().setFromAxisAngle(axes.curl,MathUtils.clamp(curl,rad(-10),max))).normalize();
}
