import {AnimationClip} from 'three';
import type {RigDefinition} from './rigs';
import type {PoseDocument} from './types';
import {importedMotion,MOTION_ADAPTER_VERSION,MAX_MOTION_SECONDS} from './mixamoMotion';
import {checkMotionAbort} from './motionImport';

export type MotionAsset={key:string;rig:string;rigVersion:number;adapterVersion:number;clips:ReturnType<AnimationClip['toJSON']>[]};
export function packMotionAsset(clips:AnimationClip[]):MotionAsset{
  const info=clips[0]&&importedMotion(clips[0]);if(!info)throw new Error('动画缺少骨架适配信息');
  return {key:`${info.rig}@${info.rigVersion}:${info.assetId}:v${info.adapterVersion}`,rig:info.rig,rigVersion:info.rigVersion,adapterVersion:info.adapterVersion,clips:clips.map(c=>c.toJSON())};
}
/** Stored clips still go through target/version and transform validation before binding. */
export function unpackMotionAsset(asset:MotionAsset,rig:RigDefinition,rest:PoseDocument):AnimationClip[]{
  if(asset.rig!==rig.id||asset.rigVersion!==rig.version||asset.adapterVersion!==MOTION_ADAPTER_VERSION||!Array.isArray(asset.clips)||!asset.clips.length||asset.clips.length>24)throw new Error('本地动画与当前骨架版本不兼容');
  let sampleBudget=0;
  return asset.clips.map(json=>{
    if(typeof json.name!=='string'||json.name.length>80||typeof json.uuid!=='string'||!Number.isFinite(json.duration)||json.duration<=0||json.duration>MAX_MOTION_SECONDS||!Array.isArray(json.tracks)||json.tracks.length!==Object.keys(rest.joints).length+1)throw new Error('本地动画结构无效');
    const names=new Set<string>();
    for(const t of json.tracks){
      if(names.has(t.name))throw new Error('本地动画关节轨道重复');names.add(t.name);
      const root=t.name===`${rig.root}.position`,name=t.name.replace(/\.quaternion$/,'');
      if(!root&&(!rest.joints[name]||t.name!==`${name}.quaternion`))throw new Error('本地动画包含当前骨架外的轨道');
      const size=root?3:4;
      if(t.type!==(root?'vector':'quaternion')||!Array.isArray(t.times)||!t.times.length||t.times.length>3601||!Array.isArray(t.values)||t.values.length!==t.times.length*size||!t.times.every((v,i,a)=>Number.isFinite(v)&&v>=0&&v<=json.duration+1e-3&&(i===0||v>a[i-1]))||!t.values.every(v=>Number.isFinite(v)&&Math.abs(v)<=(root?20:1.01)))throw new Error('本地动画变换数据无效');
      if(!root)for(let i=0;i<t.values.length;i+=4){const norm=t.values.slice(i,i+4).reduce((s,v)=>s+v*v,0);if(Math.abs(norm-1)>.01)throw new Error('本地动画旋转无效');}
    }
    if(!names.has(`${rig.root}.position`))throw new Error('本地动画缺少根骨轨道');
    sampleBudget+=Math.max(...json.tracks.map(t=>t.times.length));if(sampleBudget>12_000)throw new Error('本地动画采样总量过大');
    const clip=AnimationClip.parse(json),info=importedMotion(clip);
    if(!info||typeof info.fileName!=='string'||info.fileName.length>120||!['fbx','glb'].includes(info.format)||info.sampleRate!==30||!['skin-bind','node-rest'].includes(info.reference)||!Number.isInteger(info.mappedBones)||info.mappedBones<1||info.mappedBones>Object.keys(rest.joints).length||!Number.isInteger(info.ignoredTranslations)||info.ignoredTranslations<0||info.rig!==rig.id||info.rigVersion!==rig.version||info.adapterVersion!==MOTION_ADAPTER_VERSION||info.root!==rig.root||!Array.isArray(info.rootOrigin)||info.rootOrigin.length!==3||info.rootOrigin.some((v,i)=>v!==rest.joints[rig.root].position[i])||!/^([a-f0-9]{64})$/.test(info.assetId)||asset.key!==`${rig.id}@${rig.version}:${info.assetId}:v${MOTION_ADAPTER_VERSION}`)throw new Error('本地动画适配信息无效');
    return clip;
  });
}
const database=()=>new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('momo-pose-forge:motions',1);req.onupgradeneeded=()=>req.result.createObjectStore('motions',{keyPath:'key'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('浏览器无法打开本地动画库'));});
async function operation<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>,signal?:AbortSignal):Promise<T>{
  checkMotionAbort(signal);const db=await database();
  try{checkMotionAbort(signal);return await new Promise<T>((resolve,reject)=>{
    const tx=db.transaction('motions',mode),req=run(tx.objectStore('motions'));let result:T;
    const cancel=()=>tx.abort(),cleanup=()=>signal?.removeEventListener('abort',cancel);signal?.addEventListener('abort',cancel,{once:true});
    req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>{cleanup();resolve(result);};
    tx.onerror=tx.onabort=()=>{cleanup();reject(signal?.aborted?new DOMException('动画导入已取消','AbortError'):new Error('本地动画保存失败，请检查可用空间'));};
  });}finally{db.close();}
}
export const motionLibrary={
  async list(rig:RigDefinition){return (await operation('readonly',s=>s.getAll()) as MotionAsset[]).filter(a=>a.rig===rig.id&&a.rigVersion===rig.version);},
  async put(asset:MotionAsset,signal?:AbortSignal){await operation('readwrite',s=>s.put(asset),signal);},
};
