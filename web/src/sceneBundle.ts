import type {AnimationClip} from 'three';
import type {MotionState} from './motionPreview';
import {readSceneDocument,sceneFromPose,type SceneDocument} from './sceneDocument';
import {requireRig} from './rigs';
import {validAppearance,type AppearanceRef} from './characterAppearance';
import {characterKey,characterLibrary,type CharacterAsset} from './characterLibrary';
import {packMotionAsset,unpackMotionAsset,type MotionAsset} from './motionLibrary';
import {readProjectBundle,MAX_PROJECT_BYTES,inspectZip,readEntry,sha256,type Entry,type MotionBookmark} from './projectBundle';
import {assetTransaction,assetsChanged} from './assetDatabase';
import type {PoseEngine,SceneLoadOptions} from './PoseEngine';

type ActorMotions={actorId:string;name:string;clips:AnimationClip[];state?:MotionState};
type MotionUse={actorId:string;clips:string[];bookmark?:MotionBookmark};
type SceneManifest={format:'momo-pose-forge-project';version:2;project:Entry;characters:{ref:AppearanceRef;file:Entry}[];motions:Entry[];actors:MotionUse[]};
export type ScenePackage={scene:SceneDocument;characters:CharacterAsset[];motions:MotionAsset[];actors:MotionUse[]};
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).buffer;
export const sceneClipKey=(actorId:string,clipId:string)=>`${actorId}/${clipId}`;
export async function createSceneBundle(scene:SceneDocument,actorMotions:ActorMotions[],selected:string[]){
  const {default:JSZip}=await import('jszip'),zip=new JSZip();let total=0;
  const add=async(path:string,bytes:ArrayBuffer):Promise<Entry>=>{total+=bytes.byteLength;if(bytes.byteLength>32*1024*1024||total>MAX_PROJECT_BYTES)throw new Error('工程资源过大，请减少携带的动画');zip.file(path,bytes,{createFolders:false});return {path,bytes:bytes.byteLength,sha256:await sha256(bytes)};};
  const m:SceneManifest={format:'momo-pose-forge-project',version:2,project:await add('scene.json',encode(scene)),characters:[],motions:[],actors:[]},seenCharacters=new Set<string>(),clips=new Map<string,AnimationClip>();
  for(const actor of scene.actors){const ref=actor.pose.appearance,rig=requireRig(actor.pose.rig);if(ref&&!rig.appearances?.some(a=>a.id===ref.id)&&!seenCharacters.has(characterKey(ref))){const a=await characterLibrary.get(ref);if(!a||await sha256(a.bytes)!==ref.id)throw new Error(`缺少角色“${actor.name}”的源文件`);seenCharacters.add(characterKey(ref));m.characters.push({ref,file:await add(`characters/${m.characters.length}.${ref.format??'glb'}`,a.bytes)});}}
  for(const entry of actorMotions){const used=entry.clips.filter(c=>selected.includes(sceneClipKey(entry.actorId,c.uuid)));used.forEach(c=>clips.set(c.uuid,c));const use:MotionUse={actorId:entry.actorId,clips:used.map(c=>c.uuid)},state=entry.state,current=state?.clips.find(c=>c.id===state.clip);
    if(state&&current&&(!current.imported||used.some(c=>c.uuid===current.id)))use.bookmark={...(current.imported?{id:current.id}:{builtinName:current.name}),time:state.time,speed:state.speed,loop:state.loop,inPlace:state.inPlace};m.actors.push(use);
  }
  if(clips.size>24)throw new Error('完整工程最多携带 24 个不同的外部动画');
  for(const clip of clips.values())m.motions.push(await add(`motions/${m.motions.length}.json`,encode(packMotionAsset([clip]))));
  zip.file('manifest.json',JSON.stringify(m),{createFolders:false});return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
}
export async function readSceneBundle(bytes:ArrayBuffer):Promise<ScenePackage>{
  inspectZip(bytes,/^(manifest\.json|project\.json|scene\.json|character\.(glb|fbx)|characters\/\d+\.(glb|fbx)|motions\/\d+\.json)$/,40);
  const {default:JSZip}=await import('jszip'),zip=await JSZip.loadAsync(bytes),mf=zip.file('manifest.json');if(!mf)throw new Error('缺少工程清单');const m=JSON.parse(new TextDecoder().decode(await readEntry(mf,64*1024))) as SceneManifest;
  if(m.format!=='momo-pose-forge-project')throw new Error('工程格式无效');
  if(m.version as number===1){const legacy=await readProjectBundle(bytes),scene=sceneFromPose(JSON.parse(legacy.text));return {scene,characters:legacy.character?[legacy.character]:[],motions:legacy.motions,actors:[{actorId:scene.activeActor,clips:legacy.motions.flatMap(a=>a.clips.map(c=>c.uuid)),bookmark:legacy.bookmark}]};}
  if(m.version!==2||!Array.isArray(m.characters)||m.characters.length>8||!Array.isArray(m.motions)||m.motions.length>24||!Array.isArray(m.actors)||m.actors.length>8)throw new Error('场景工程清单无效');
  const paths=new Set(['manifest.json']);let total=0;
  const read=async(e:Entry,pattern:RegExp)=>{if(!e||!pattern.test(e.path)||paths.has(e.path)||!Number.isSafeInteger(e.bytes)||e.bytes<1||e.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(e.sha256))throw new Error('工程资源描述无效');paths.add(e.path);total+=e.bytes;if(total>MAX_PROJECT_BYTES)throw new Error('工程资源过大');const f=zip.file(e.path);if(!f)throw new Error(`缺少工程资源：${e.path}`);const b=await readEntry(f,e.bytes);if(b.byteLength!==e.bytes||await sha256(b)!==e.sha256)throw new Error(`工程资源校验失败：${e.path}`);return b;};
  const scene=readSceneDocument(new TextDecoder().decode(await read(m.project,/^scene\.json$/))),characters:CharacterAsset[]=[],motions:MotionAsset[]=[],characterIds=new Set<string>();
  for(const c of m.characters){const rig=requireRig(c?.ref?.rig);if(!validAppearance(c.ref,rig)||characterIds.has(characterKey(c.ref))||!c.file.path.endsWith(`.${c.ref.format??'glb'}`))throw new Error('角色资源引用无效');const data=await read(c.file,/^characters\/\d+\.(glb|fbx)$/);if(await sha256(data)!==c.ref.id)throw new Error('角色资源哈希不一致');characterIds.add(characterKey(c.ref));characters.push({ref:c.ref,bytes:data,key:characterKey(c.ref)});}
  for(const actor of scene.actors){const ref=actor.pose.appearance,rig=requireRig(actor.pose.rig);if(ref&&!rig.appearances?.some(a=>a.id===ref.id)&&!characters.some(a=>characterKey(a.ref)===characterKey(ref)&&(a.ref.format??'glb')===(ref.format??'glb')))throw new Error(`工程缺少角色“${actor.name}”的外观`);}
  for(const e of m.motions)motions.push(JSON.parse(new TextDecoder().decode(await read(e,/^motions\/\d+\.json$/))));
  if(Object.keys(zip.files).some(p=>!paths.has(p)))throw new Error('工程包含未声明资源');
  const actorIds=new Set<string>();for(const use of m.actors){if(!use||!scene.actors.some(a=>a.id===use.actorId)||actorIds.has(use.actorId)||!Array.isArray(use.clips)||use.clips.length>24||use.clips.some(id=>typeof id!=='string'||id.length>200)||new Set(use.clips).size!==use.clips.length)throw new Error('角色动画引用无效');actorIds.add(use.actorId);if(use.bookmark){const b=use.bookmark;if((typeof b.id==='string')===(typeof b.builtinName==='string')||!Number.isFinite(b.time)||b.time<0||b.time>120||![.25,.5,1,2].includes(b.speed)||typeof b.loop!=='boolean'||typeof b.inPlace!=='boolean'||b.id&&!use.clips.includes(b.id)||(b.builtinName?.length??0)>80)throw new Error('动画书签无效');}}
  const jsonClips=motions.flatMap(a=>a.clips??[]),ids=jsonClips.map(c=>c.uuid);if(jsonClips.length>24||new Set(ids).size!==ids.length||m.actors.some(a=>a.clips.some(id=>!ids.includes(id)))||ids.some(id=>!m.actors.some(a=>a.clips.includes(id))))throw new Error('工程动画缺失、重复或未关联到角色');
  if(characters.some(c=>!scene.actors.some(a=>a.pose.appearance&&characterKey(a.pose.appearance)===characterKey(c.ref))))throw new Error('工程包含未使用的角色资源');
  return {scene,characters,motions,actors:m.actors};
}
async function storeScenePackage(packet:ScenePackage,signal:AbortSignal){
  if(!packet.characters.length&&!packet.motions.length)return;
  await assetTransaction<void>(['characters','motions'],'readwrite',tx=>{
    for(const a of packet.characters){const s=tx.objectStore('characters'),r=s.get(characterKey(a.ref));r.onsuccess=()=>{if(!r.result)s.put({...a,key:characterKey(a.ref)});};}
    const grouped=new Map<string,MotionAsset>();for(const a of packet.motions){const old=grouped.get(a.key);grouped.set(a.key,{...a,clips:[...(old?.clips??[]),...a.clips]});}
    for(const a of grouped.values()){const s=tx.objectStore('motions'),r=s.get(a.key);r.onsuccess=()=>{const old=r.result as MotionAsset|undefined;s.put(old?{...old,clips:[...old.clips,...a.clips.filter(c=>!old.clips.some(p=>p.uuid===c.uuid))]}:a);};}
  },signal);assetsChanged();
}
export function scenePackageOptions(packet:ScenePackage):SceneLoadOptions{
  let sampleCount=0;const validated=new Set<string>();
  return {appearanceBytes:ref=>packet.characters.find(a=>characterKey(a.ref)===characterKey(ref))?.bytes,
    prepareActor:async(local:PoseEngine,id:string)=>{const use=packet.actors.find(a=>a.actorId===id);if(!use)return;for(const asset of packet.motions){const selected=asset.clips?.filter(c=>use.clips.includes(c.uuid))??[];if(!selected.length)continue;if(!local.activeRig.motionImport)throw new Error('当前角色骨架未适配包内动画');const clips=unpackMotionAsset({...asset,clips:selected},local.activeRig,local.rest);for(const c of clips){if(!validated.has(c.uuid)){sampleCount+=Math.max(...c.tracks.map(t=>t.times.length));validated.add(c.uuid);}if(sampleCount>12_000)throw new Error('工程动画采样总量过大');local.motion?.remove(c.uuid);local.installImportedMotions([c]);}}
      const b=use.bookmark;if(b){const clipId=b.id??local.motion?.state().clips.find(c=>!c.imported&&c.name===b.builtinName)?.id;if(!clipId||!local.motion)throw new Error('角色动画书签引用无效');local.motion.remember(clipId,b.time);local.motion.speed=b.speed;local.motion.loop=b.loop;local.motion.inPlace=b.inPlace;}},
    beforeCommit:signal=>storeScenePackage(packet,signal)};
}
