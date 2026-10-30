import {AnimationClip} from 'three';
import type {RigDefinition} from './rigs';
import type {PoseDocument} from './types';
import {importedMotion,MOTION_ADAPTER_VERSION,MAX_MOTION_SECONDS} from './mixamoMotion';
import {checkMotionAbort} from './motionImport';
import {assetRequest,assetTransaction,assetsChanged} from './assetDatabase';

export type MotionAsset={key:string;rig:string;rigVersion:number;adapterVersion:number;clips:ReturnType<AnimationClip['toJSON']>[];deletedClips?:Record<string,number>};
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
    if(!info||typeof info.fileName!=='string'||info.fileName.length>120||!['fbx','glb'].includes(info.format)||info.sampleRate!==30||!['skin-bind','node-rest'].includes(info.reference)||!Number.isInteger(info.mappedBones)||info.mappedBones<1||info.mappedBones>Object.keys(rest.joints).length||!Number.isInteger(info.ignoredTranslations)||info.ignoredTranslations<0||info.rig!==rig.id||info.rigVersion!==rig.version||info.adapterVersion!==MOTION_ADAPTER_VERSION||info.root!==rig.root||!Array.isArray(info.rootOrigin)||info.rootOrigin.length!==3||info.rootOrigin.some((v,i)=>v!==rest.joints[rig.root].position[i])||!/^([a-f0-9]{64})$/.test(info.assetId)||asset.key!==`${rig.id}@${rig.version}:${info.assetId}:v${MOTION_ADAPTER_VERSION}`||!Array.from({length:24},(_,i)=>`${rig.id}@${rig.version}:${info.assetId}:${i}:v${MOTION_ADAPTER_VERSION}`).includes(clip.uuid))throw new Error('本地动画适配信息无效');
    return clip;
  });
}
export const motionLibrary={
  async all(){return await assetRequest('motions','readonly',s=>s.getAll()) as MotionAsset[];},
  async list(rig:RigDefinition){return (await this.all()).filter(a=>a.rig===rig.id&&a.rigVersion===rig.version).map(a=>({...a,clips:a.clips.filter(c=>!a.deletedClips?.[c.uuid])})).filter(a=>a.clips.length);},
  async put(asset:MotionAsset,signal?:AbortSignal){checkMotionAbort(signal);await assetTransaction<void>(['motions'],'readwrite',tx=>{const s=tx.objectStore('motions'),q=s.get(asset.key);q.onsuccess=()=>{const old=q.result as MotionAsset|undefined;s.put({...asset,clips:asset.clips.map(c=>({...c,name:old?.clips.find(o=>o.uuid===c.uuid)?.name??c.name}))});};},signal);assetsChanged();},
  async edit(key:string,id:string,change:{name?:string;deleted?:boolean}){
    if(change.name!==undefined&&(!change.name.trim()||change.name.trim().length>80))throw new Error('名称须为 1–80 个字符');
    await assetTransaction<void>(['motions'],'readwrite',tx=>{const s=tx.objectStore('motions'),q=s.get(key);q.onsuccess=()=>{const a=q.result as MotionAsset|undefined,c=a?.clips.find(c=>c.uuid===id);if(!a||!c)return;if(change.name!==undefined)c.name=change.name.trim();if(change.deleted!==undefined){a.deletedClips={...a.deletedClips};if(change.deleted)a.deletedClips[id]=Date.now();else delete a.deletedClips[id];}s.put(a);};});assetsChanged();
  },
};
