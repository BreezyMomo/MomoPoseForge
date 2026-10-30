import {MathUtils,Quaternion,Vector3} from 'three';
import type {Pin,Vec3} from './types';

/** Calibrated in the foot bone's local coordinates, in metres. A rig must
 * explicitly supply these; ankle height alone is not a sole definition. */
export type SoleDefinition={toe:string;heel:Vec3;ball:Vec3;ballHull:readonly Vec3[]};
export type SoleContact={mode:'flat'|'ball';angle:number};
export type FootContactMode='free'|SoleContact['mode'];
export const validSoleContact=(value:unknown):value is SoleContact=>{
  if(!value||typeof value!=='object')return false;
  const s=value as SoleContact;
  return (s.mode==='flat'||s.mode==='ball')&&Number.isFinite(s.angle)&&s.angle>=0&&s.angle<=45&&(s.mode!=='flat'||s.angle===0);
};
export function solePoint(position:Vec3,quaternion:number[],local:Vec3){return new Vector3().fromArray(local).applyQuaternion(new Quaternion().fromArray(quaternion)).add(new Vector3().fromArray(position));}
/** Lowest point of the rounded rigid forefoot, rather than its toe joint pivot.
 * A discrete convex envelope is exact between its supporting surface vertices. */
export function soleBall(sole:SoleDefinition,contact?:SoleContact):Vec3{
  if(!contact||contact.mode==='flat')return sole.ball;
  const angle=MathUtils.degToRad(contact.angle),height=(p:Vec3)=>p[1]*Math.cos(angle)-p[2]*Math.sin(angle);
  return sole.ballHull.reduce((low,p)=>height(p)<height(low)?p:low,sole.ball);
}

/** Plant the ball at the requested ground point. Flat also places the heel on
 * the plane; ball mode raises the heel while the toe segment stays horizontal. */
export function plantedFoot(sole:SoleDefinition,anchor:Vector3,heading:number,contact:SoleContact):Pin{
  const quaternion=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),heading).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),MathUtils.degToRad(contact.angle)));
  const position=anchor.clone().sub(new Vector3().fromArray(soleBall(sole,contact)).applyQuaternion(quaternion));
  return {position:position.toArray(),quaternion:quaternion.toArray(),orientation:true,sole:contact};
}
