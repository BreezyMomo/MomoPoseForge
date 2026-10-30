import {Quaternion} from 'three';
import type {Side} from './types';

export type SymmetrySettings={arms:boolean;legs:boolean};
export type SymmetryGroup=keyof SymmetrySettings;
export const defaultSymmetry=():SymmetrySettings=>({arms:false,legs:false});
export function validSymmetry(value:unknown):value is SymmetrySettings{
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&typeof (value as SymmetrySettings).arms==='boolean'&&typeof (value as SymmetrySettings).legs==='boolean';
}
export function symmetricLimb(name:string){
  const match=/^(Left|Right)(Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase)$/.exec(name);if(!match)return null;
  const side=match[1] as Side,group:SymmetryGroup=['Shoulder','Arm','ForeArm','Hand'].includes(match[2])?'arms':'legs';
  return {side,other:side==='Left'?'Right' as const:'Left' as const,group};
}
export const limbParts=(group:SymmetryGroup)=>group==='arms'?['Shoulder','Arm','ForeArm','Hand']:['UpLeg','Leg','Foot','ToeBase'];
// S R S for a reflection S across local X. Parents are UpperChest / Hips,
// so the symmetry plane follows the character rather than the scene camera.
export const mirroredRotation=(q:Quaternion)=>new Quaternion(q.x,-q.y,-q.z,q.w);
