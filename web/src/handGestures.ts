import {MathUtils,type Bone} from 'three';
import {DIGITS,type FingerValues,type HandValues,type PoseDocument,type Side} from './types';
import {emptyHandValues,FINGER_CURL_LIMITS,fingerAxes,fingerRotation} from './articulation';
import {XBOT_RIG,type RigDefinition} from './rigs';

export type HandGesture={id:string;name:string;values:HandValues};
const finger=(curl:[number,number,number],spread=0):FingerValues=>({curl,spread});
const pose=(thumb:FingerValues,index:FingerValues,middle:FingerValues,ring:FingerValues,little:FingerValues):HandValues=>({Thumb:thumb,Index:index,Middle:middle,Ring:ring,Little:little});
const closed=()=>finger([70,95,65]);
export const HAND_GESTURES:HandGesture[]=[
  {id:'open',name:'张手',values:emptyHandValues()},
  {id:'fist',name:'握拳',values:pose(finger([0,0,24],-32),closed(),closed(),closed(),closed())},
  {id:'point',name:'指向',values:pose(finger([0,5,15],-25),finger([0,0,0]),closed(),closed(),closed())},
  {id:'relaxed',name:'放松手',values:pose(finger([10,15,10],4),finger([15,20,10]),finger([20,25,15]),finger([25,30,20]),finger([30,35,25],3))},
  {id:'peace',name:'V 手势',values:pose(finger([0,0,24],-32),finger([0,0,0],13),finger([0,0,0],-10),closed(),closed())},
  {id:'thumbs-up',name:'点赞',values:pose(finger([0,0,0],25),closed(),closed(),closed(),closed())},
  {id:'okay',name:'OK 手势',values:pose(finger([0,21,11],-30),finger([42,67,30]),finger([5,8,5]),finger([8,10,5],-5),finger([10,12,8],-12))},
  {id:'pinch',name:'捏合',values:pose(finger([1,6,3],-27),finger([30,50,25],14),finger([45,60,35]),finger([55,70,45]),finger([60,75,50]))},
  {id:'grip',name:'握杆',values:pose(finger([5,15,10],-22),finger([45,70,45]),finger([50,75,45]),finger([55,80,50]),finger([60,85,50]))},
  {id:'cup',name:'托物',values:pose(finger([12,18,12],10),finger([25,35,20],-5),finger([30,40,25]),finger([35,45,30],4),finger([40,50,35],8))},
  {id:'together',name:'并拢手',values:pose(finger([5,5,0],-25),finger([0,0,0]),finger([0,0,0]),finger([0,0,0]),finger([0,0,0]))},
  {id:'hook',name:'勾指',values:pose(finger([0,5,15],-25),finger([10,100,65]),closed(),closed(),closed())},
];
export const MAX_SAVED_HANDS=24;
export const HAND_LIBRARY_KEY=`momo-pose-forge:hand-library:${XBOT_RIG.id}`;
export function handLibraryKey(rig:RigDefinition){if(!rig.capabilities.hands)throw new Error('此骨架不支持手势');return `momo-pose-forge:hand-library:${rig.id}:v${rig.version}`;}
export const handShapeValid=(name:unknown)=>typeof name==='string'&&(name==='自定义'||HAND_GESTURES.some(g=>g.name===name));

export function validHandValues(value:unknown):value is HandValues{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==5)return false;
  return DIGITS.every(d=>{const f=(value as HandValues)[d];return !!f&&typeof f==='object'&&Array.isArray(f.curl)&&f.curl.length===3&&f.curl.every((v,i)=>typeof v==='number'&&Number.isFinite(v)&&v>=-10&&v<=FINGER_CURL_LIMITS[d][i])&&typeof f.spread==='number'&&Number.isFinite(f.spread)&&Math.abs(f.spread)<=(d==='Thumb'?40:20);});
}
export function normalizedHandValues(values:HandValues):HandValues{
  const next=emptyHandValues(),round=(v:number)=>Math.round(v*1e6)/1e6||0;
  for(const d of DIGITS){next[d].curl=values[d].curl.map((v,i)=>round(MathUtils.clamp(v,-10,FINGER_CURL_LIMITS[d][i]))) as [number,number,number];next[d].spread=round(MathUtils.clamp(values[d].spread,d==='Thumb'?-40:-20,d==='Thumb'?40:20));}return next;
}
export function writeHandValues(bones:Record<string,Bone>,rest:PoseDocument['joints'],side:Side,values:HandValues,normalSign=-1){
  // The curl axes already mirror; the palm normal used for spread is a vector,
  // so its signed angle must flip on the right for one shared gesture definition.
  for(const d of DIGITS)for(let j=1;j<=3;j++)bones[`${side}${d}${j}`].quaternion.copy(fingerRotation(d,j,MathUtils.degToRad(values[d].curl[j-1]),MathUtils.degToRad(j===1?values[d].spread*(side==='Right'?-1:1):0),fingerAxes(rest,side,d,j,normalSign)));
}
export function handLibraryDocument(gestures:HandGesture[],rig:RigDefinition=XBOT_RIG){if(!rig.capabilities.hands)throw new Error('此骨架不支持手势');return {format:'momo-pose-forge-hand-library',version:1,rig:rig.id,rigVersion:rig.version,gestures};}
export function parseHandLibrary(text:string,rig:RigDefinition=XBOT_RIG):HandGesture[]{
  if(text.length>150_000)throw new Error('手势库超过 150 KB');
  let doc;try{doc=JSON.parse(text);}catch{throw new Error('手势库不是有效的 JSON 文件');}
  if(!rig.capabilities.hands||!doc||doc.format!=='momo-pose-forge-hand-library'||doc.version!==1||doc.rig!==rig.id||(doc.rigVersion??1)!==rig.version||!Array.isArray(doc.gestures)||doc.gestures.length>MAX_SAVED_HANDS)throw new Error('手势库格式、骨架版本或数量无效');
  const ids=new Set<string>();for(const g of doc.gestures){if(!g||typeof g.id!=='string'||!g.id.trim()||g.id.length>80||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.length>40||/[\x00-\x1f]/.test(g.name)||!validHandValues(g.values))throw new Error('手势名称、指骨角度或编号无效');ids.add(g.id);}
  return structuredClone(doc.gestures);
}
