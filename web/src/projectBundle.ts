import type JSZip from 'jszip';
import type {AnimationClip} from 'three';
import type {PoseDocument} from './types';
import type {RigDefinition} from './rigs';
import {documentRig,parseDocument} from './files';
import {validAppearance,type AppearanceRef,MAX_CHARACTER_BYTES} from './characterAppearance';
import {characterLibrary,characterKey,type CharacterAsset} from './characterLibrary';
import {packMotionAsset,unpackMotionAsset,type MotionAsset} from './motionLibrary';
import type {MotionState} from './motionPreview';
import {assetTransaction,assetsChanged} from './assetDatabase';

export const MAX_PROJECT_BYTES=128*1024*1024;
const ENTRY_LIMIT=32*1024*1024;
type Entry={path:string;sha256:string;bytes:number};
export type MotionBookmark={id?:string;builtinName?:string;time:number;speed:number;loop:boolean;inPlace:boolean};
type Manifest={format:'momo-pose-forge-project';version:1;rig:string;rigVersion:number;project:Entry;appearance?:{ref:AppearanceRef;file:Entry};motions:Entry[];bookmark?:MotionBookmark};
export type ProjectBundle={text:string;rig:RigDefinition;character?:CharacterAsset;motions:MotionAsset[];bookmark?:MotionBookmark};
export async function sha256(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).buffer;
export async function createProjectBundle(document:PoseDocument,rig:RigDefinition,clips:AnimationClip[],state?:MotionState):Promise<Blob>{
  const {default:JSZip}=await import('jszip');const zip=new JSZip();let total=0;
  const add=async(path:string,bytes:ArrayBuffer):Promise<Entry>=>{total+=bytes.byteLength;if(bytes.byteLength>ENTRY_LIMIT||total>MAX_PROJECT_BYTES)throw new Error('工程资源过大，请减少勾选的动画');zip.file(path,bytes,{createFolders:false});return {path,bytes:bytes.byteLength,sha256:await sha256(bytes)};};
  const manifest:Manifest={format:'momo-pose-forge-project',version:1,rig:rig.id,rigVersion:rig.version,project:await add('project.json',encode(document)),motions:[]};
  if(document.appearance&&!rig.appearances?.some(a=>a.id===document.appearance!.id)){
    const character=await characterLibrary.get(document.appearance);if(!character)throw new Error('缺少当前角色源文件，无法生成完整工程包');
    if(await sha256(character.bytes)!==document.appearance.id)throw new Error('当前角色资源损坏');
    manifest.appearance={ref:document.appearance,file:await add(`character.${document.appearance.format??'glb'}`,character.bytes)};
  }
  if(clips.length>24)throw new Error('一个工程最多携带 24 个外部动画');
  for(let i=0;i<clips.length;i++)manifest.motions.push(await add(`motions/${i}.json`,encode(packMotionAsset([clips[i]]))));
  const selected=state?.clips.find(c=>c.id===state.clip);
  if(state&&selected&&(!selected.imported||clips.some(c=>c.uuid===selected.id)))manifest.bookmark={...(selected.imported?{id:selected.id}:{builtinName:selected.name}),time:state.time,speed:state.speed,loop:state.loop,inPlace:state.inPlace};
  zip.file('manifest.json',JSON.stringify(manifest),{createFolders:false});
  return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
}
/** Reject duplicate/path-rewritten entries and oversized expansion before JSZip allocates it. */
function inspectZip(bytes:ArrayBuffer){
  if(bytes.byteLength>MAX_PROJECT_BYTES||bytes.byteLength<22)throw new Error('完整工程包须在 128 MB 以内');
  const d=new DataView(bytes);let end=-1;
  for(let i=bytes.byteLength-22;i>=Math.max(0,bytes.byteLength-65557);i--)if(d.getUint32(i,true)===0x06054b50&&i+22+d.getUint16(i+20,true)===bytes.byteLength){end=i;break;}
  if(end<0||d.getUint16(end+4,true)||d.getUint16(end+6,true))throw new Error('工程 ZIP 结构无效');
  const count=d.getUint16(end+10,true),offset=d.getUint32(end+16,true),size=d.getUint32(end+12,true);
  if(count<2||count>28||offset+size!==end||d.getUint16(end+8,true)!==count)throw new Error('工程 ZIP 目录无效');
  let p=offset,total=0;const names=new Set<string>();
  for(let i=0;i<count;i++){
    if(p+46>end||d.getUint32(p,true)!==0x02014b50||d.getUint16(p+8,true)&1)throw new Error('不支持加密或损坏的工程包');
    const n=d.getUint16(p+28,true),extra=d.getUint16(p+30,true),comment=d.getUint16(p+32,true),length=d.getUint32(p+24,true);
    if(p+46+n+extra+comment>end)throw new Error('工程目录越界');
    const name=new TextDecoder().decode(new Uint8Array(bytes,p+46,n));
    if(!/^(manifest\.json|project\.json|character\.(glb|fbx)|motions\/\d+\.json)$/.test(name)||names.has(name))throw new Error('工程包含重复或未知文件');
    names.add(name);total+=length;if(length>ENTRY_LIMIT||total>MAX_PROJECT_BYTES)throw new Error('工程解压大小超过限制');p+=46+n+extra+comment;
  }
  if(p!==end)throw new Error('工程目录长度无效');
}
async function readEntry(file:JSZip.JSZipObject,limit:number):Promise<ArrayBuffer>{
  // JSZip exposes the browser stream at runtime, but omits it from JSZipObject's types.
  type Stream={on:(event:string,fn:(data:Uint8Array)=>void)=>Stream;resume:()=>void;pause:()=>void};
  const stream=(file as unknown as {internalStream:(type:string)=>Stream}).internalStream('uint8array');
  return new Promise((resolve,reject)=>{let size=0,failed=false;const chunks:Uint8Array[]=[];
    stream.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>limit){failed=true;stream.pause();reject(new Error('工程文件解压大小超过限制'));}else chunks.push(chunk);});
    stream.on('error',e=>reject(e));stream.on('end',()=>{if(failed)return;const result=new Uint8Array(size);let p=0;for(const c of chunks){result.set(c,p);p+=c.length;}resolve(result.buffer);});stream.resume();
  });
}
export async function readProjectBundle(bytes:ArrayBuffer):Promise<ProjectBundle>{
  inspectZip(bytes);const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(bytes),manifestFile=zip.file('manifest.json');if(!manifestFile)throw new Error('缺少工程清单');
  const m=JSON.parse(new TextDecoder().decode(await readEntry(manifestFile,64*1024))) as Manifest;
  if(m.format!=='momo-pose-forge-project'||m.version!==1||!Array.isArray(m.motions)||m.motions.length>24)throw new Error('工程包格式或版本不兼容');
  const paths=new Set(['manifest.json']);let total=0;
  const read=async(e:Entry,pattern:RegExp)=>{
    if(!e||typeof e.path!=='string'||!pattern.test(e.path)||paths.has(e.path)||!Number.isSafeInteger(e.bytes)||e.bytes<1||e.bytes>ENTRY_LIMIT||!/^[a-f0-9]{64}$/.test(e.sha256))throw new Error('工程资源清单无效');
    paths.add(e.path);total+=e.bytes;if(total>MAX_PROJECT_BYTES)throw new Error('工程资源过大');const file=zip.file(e.path);if(!file)throw new Error(`缺少工程资源：${e.path}`);
    const data=await readEntry(file,e.bytes);if(data.byteLength!==e.bytes||await sha256(data)!==e.sha256)throw new Error(`工程资源校验失败：${e.path}`);return data;
  };
  const text=new TextDecoder().decode(await read(m.project,/^project\.json$/)),rig=documentRig(text),doc=JSON.parse(text) as PoseDocument;
  if(rig.id!==m.rig||rig.version!==m.rigVersion)throw new Error('工程骨架版本不兼容');
  let character:CharacterAsset|undefined;
  if(m.appearance){
    const ref=m.appearance.ref;if(!validAppearance(ref,rig)||ref.id!==doc.appearance?.id||(ref.format??'glb')!==(doc.appearance.format??'glb')||m.appearance.file?.path!==`character.${ref.format??'glb'}`)throw new Error('工程角色引用不一致');
    const bytes=await read(m.appearance.file,/^character\.(glb|fbx)$/);if(bytes.byteLength>MAX_CHARACTER_BYTES||await sha256(bytes)!==ref.id)throw new Error('工程角色内容不一致');character={ref,bytes,key:characterKey(ref)};
  }
  if(doc.appearance&&!rig.appearances?.some(a=>a.id===doc.appearance!.id)&&!character)throw new Error('完整工程包缺少自定义外观');
  const motions:MotionAsset[]=[];for(const entry of m.motions)motions.push(JSON.parse(new TextDecoder().decode(await read(entry,/^motions\/\d+\.json$/))));
  if(Object.keys(zip.files).some(p=>!paths.has(p)))throw new Error('工程包包含清单之外的资源');
  if(m.bookmark){const b=m.bookmark;if((typeof b.id==='string')===(typeof b.builtinName==='string')||(b.id!==undefined&&b.id.length>200)||(b.builtinName!==undefined&&b.builtinName.length>80)||!Number.isFinite(b.time)||b.time<0||b.time>120||![.25,.5,1,2].includes(b.speed)||typeof b.loop!=='boolean'||typeof b.inPlace!=='boolean')throw new Error('工程动画书签无效');}
  return {text,rig,character,motions,bookmark:m.bookmark};
}
/** Must run against the candidate rig before any library mutation or runtime replacement. */
export function validateBundle(bundle:ProjectBundle,rest:PoseDocument){
  const document=parseDocument(bundle.text,rest,bundle.rig),ids=new Set<string>();
  if(bundle.motions.length&&!bundle.rig.motionImport)throw new Error('当前骨架不支持包内外部动画');
  const clips=bundle.motions.flatMap(a=>unpackMotionAsset(a,bundle.rig,rest));if(clips.length>24||clips.reduce((sum,c)=>sum+Math.max(...c.tracks.map(t=>t.times.length)),0)>12_000)throw new Error('工程动画总量超过限制');for(const clip of clips){if(ids.has(clip.uuid))throw new Error('工程动画重复');ids.add(clip.uuid);}
  if(bundle.bookmark?.id&&!ids.has(bundle.bookmark.id))throw new Error('工程书签引用了未携带的动画');return {document,clips};
}
/** Both resource kinds commit or abort together; importing never replaces unrelated local clips. */
export async function storeBundle(bundle:ProjectBundle,signal?:AbortSignal){
  if(!bundle.character&&!bundle.motions.length)return;
  await assetTransaction<void>(['characters','motions'],'readwrite',tx=>{
    if(bundle.character){const a=bundle.character,s=tx.objectStore('characters'),q=s.get(characterKey(a.ref));q.onsuccess=()=>{if(!q.result)s.put({...a,key:characterKey(a.ref)});};}
    const grouped=new Map<string,MotionAsset>();for(const a of bundle.motions){const previous=grouped.get(a.key);grouped.set(a.key,{...a,clips:[...(previous?.clips??[]),...a.clips]});}
    for(const a of grouped.values()){const s=tx.objectStore('motions'),q=s.get(a.key);q.onsuccess=()=>{const old=q.result as MotionAsset|undefined;if(!old)s.put(a);else s.put({...old,clips:[...old.clips,...a.clips.filter(c=>!old.clips.some(o=>o.uuid===c.uuid))]});};}
  },signal);assetsChanged();
}
