import {beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {readFileSync,existsSync} from 'node:fs';
import JSZip from 'jszip';
import {AnimationClip,Bone,Box3,Group,Object3D,QuaternionKeyframeTrack,SkinnedMesh,Texture,TextureLoader,Vector3,VectorKeyframeTrack} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {XBOT_RIG} from './rigs';
import {FOX_RIG} from './foxRig';
import {DEFAULT_VIEWS} from './types';
import {PoseEngine} from './PoseEngine';
import {MotionPreview} from './motionPreview';
import {parseCharacter} from './characterImport';
import {buildAppearance,validAppearance} from './characterAppearance';
import {disposeObject} from './rigGeometry';

const bytes=(path:string)=>Uint8Array.from(readFileSync(new URL(path,import.meta.url))).buffer;
let human:GLTF,fox:GLTF;
beforeAll(async()=>{const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURE',loadTexture:async()=>new Texture()}));[human,fox]=await Promise.all([loader.parseAsync(bytes('../public/models/xbot.glb'),''),loader.parseAsync(bytes('../public/models/fox/fox.glb'),'')]);});
beforeEach(()=>{vi.resetModules();vi.stubGlobal('indexedDB',new IDBFactory());});
function fixture(animal=false){
  const rig=animal?FOX_RIG:XBOT_RIG,gltf=animal?fox:human,model=new Group(),bones:Record<string,Bone>={};model.add(clone(gltf.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{rigDefinition:rig,model,bones,gizmo:new Object3D(),helpers:new Group(),selected:rig.initialSelection,mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'Portable pose',ground:false,fullBody:false,warning:'',handDetail:null,profile:{},appearanceGroups:new Map(),originalMeshes:[],transform:{setMode(){},attach(){},detach(){},enabled:true},onInfo:vi.fn(),onCommit:vi.fn(),fit(){},update(){},syncGizmo(){},disposed:false});
  for(const end of Object.keys(rig.chains)){e.targets[end]=e.world(end).toArray();if(!animal)e.poles[end]=e.targets[end];}e.rest=e.snapshot();e.motion=new MotionPreview(model,gltf.animations);e.ready=true;return e;
}
function motion(e=fixture(),assetId='b'.repeat(64),index=0){
  const tracks=Object.entries(e.rest.joints).map(([n,j])=>new QuaternionKeyframeTrack(`${n}.quaternion`,[0,1],[...j.quaternion,...j.quaternion]));
  const root=e.rest.joints[e.activeRig.root].position;
  const clip=new AnimationClip(`Clip ${index}`,1,[...tracks,new VectorKeyframeTrack(`${e.activeRig.root}.position`,[0,1],[...root,...root])]);
  Object.assign(clip,{uuid:`${e.activeRig.id}@1:${assetId}:${index}:v1`});
  clip.userData={momoMotion:{assetId,fileName:'owned.fbx',format:'fbx',rig:e.activeRig.id,rigVersion:1,adapterVersion:1,sampleRate:30,root:e.activeRig.root,rootOrigin:root,mappedBones:20,ignoredTranslations:0,reference:'skin-bind'}};return clip;
}
async function character(){const {sha256}=await import('./projectBundle'),data=bytes('../public/models/xbot.glb');return {ref:{id:await sha256(data),name:'Custom human',rig:XBOT_RIG.id,rigVersion:1,format:'glb' as const},bytes:data};}
const zipBytes=async(zip:JSZip)=>zip.generateAsync({type:'arraybuffer'});
async function mutateBundle(data:ArrayBuffer,mutate:(zip:JSZip,m:any)=>void){const zip=await JSZip.loadAsync(data),m=JSON.parse(await zip.file('manifest.json')!.async('string'));mutate(zip,m);zip.file('manifest.json',JSON.stringify(m));return zipBytes(zip);}

describe('跨库资源事务、迁移和管理',()=>{
  it('无损迁移两个旧数据库，重命名保持内容与标识',async()=>{
    const a=await character(),{packMotionAsset}=await import('./motionLibrary'),m=packMotionAsset([motion()]);
    for(const[name,store,row]of [['momo-pose-forge:characters','characters',{...a,key:`${a.ref.rig}@1:${a.ref.id}`}],['momo-pose-forge:motions','motions',m]] as const)await new Promise<void>((resolve,reject)=>{const q=indexedDB.open(name,1);q.onupgradeneeded=()=>q.result.createObjectStore(store,{keyPath:'key'});q.onsuccess=()=>{const db=q.result,tx=db.transaction(store,'readwrite');tx.objectStore(store).put(row);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
    const {characterLibrary}=await import('./characterLibrary'),{motionLibrary}=await import('./motionLibrary');
    expect(await characterLibrary.list(XBOT_RIG.id,1)).toHaveLength(1);expect(await motionLibrary.list(XBOT_RIG)).toHaveLength(1);
    await characterLibrary.edit(a.ref,{name:'New name'});expect((await characterLibrary.get(a.ref))?.bytes).toEqual(a.bytes);expect((await characterLibrary.get(a.ref))?.ref.id).toBe(a.ref.id);
  });
  it('外观删除可恢复且旧工程仍能按原 ID 读取；按骨架隔离',async()=>{
    const {characterLibrary}=await import('./characterLibrary'),a=await character();await characterLibrary.put(a);await characterLibrary.edit(a.ref,{deleted:true});
    expect(await characterLibrary.list(XBOT_RIG.id,1)).toEqual([]);expect((await characterLibrary.get(a.ref))?.bytes).toEqual(a.bytes);expect(await characterLibrary.list(FOX_RIG.id,1)).toEqual([]);
    await characterLibrary.edit(a.ref,{deleted:false});expect(await characterLibrary.list(XBOT_RIG.id,1)).toHaveLength(1);await expect(characterLibrary.edit(a.ref,{name:' '})).rejects.toThrow();
  });
  it('动画按片段重命名和删除，不影响同源其他片段',async()=>{
    const {motionLibrary,packMotionAsset,unpackMotionAsset}=await import('./motionLibrary'),e=fixture(),clips=[motion(e),motion(e,'b'.repeat(64),1)],a=packMotionAsset(clips);await motionLibrary.put(a);
    await motionLibrary.edit(a.key,clips[0].uuid,{name:'Renamed'});await motionLibrary.edit(a.key,clips[1].uuid,{deleted:true});const listed=await motionLibrary.list(XBOT_RIG);expect(listed[0].clips).toHaveLength(1);expect(unpackMotionAsset(listed[0],XBOT_RIG,e.rest)[0].name).toBe('Renamed');expect(await motionLibrary.list(FOX_RIG)).toEqual([]);
    await motionLibrary.edit(a.key,clips[1].uuid,{deleted:false});expect((await motionLibrary.list(XBOT_RIG))[0].clips).toHaveLength(2);
  });
  it('任一资源写入失败时角色和动画一起回滚',async()=>{
    const {assetTransaction,assetRequest}=await import('./assetDatabase');await expect(assetTransaction(['characters','motions'],'readwrite',tx=>{tx.objectStore('characters').put({key:'should-rollback'});tx.objectStore('motions').put({invalid:'missing-key'});})).rejects.toBeDefined();
    expect(await assetRequest('characters','readonly',s=>s.getAll())).toEqual([]);
  });
  it('取消的导入不会写入资源',async()=>{const {storeBundle}=await import('./projectBundle'),controller=new AbortController();controller.abort();await expect(storeBundle({text:'',rig:XBOT_RIG,character:await character(),motions:[]},controller.signal)).rejects.toHaveProperty('name','AbortError');});
  it('重新导入相同外观保留用户别名并恢复可用状态',async()=>{const {characterLibrary}=await import('./characterLibrary'),a=await character();await characterLibrary.put(a);await characterLibrary.edit(a.ref,{name:'My skin',deleted:true});expect((await characterLibrary.put(a)).name).toBe('My skin');expect((await characterLibrary.list(XBOT_RIG.id,1))[0].name).toBe('My skin');});
  it('保存过程中取消也会回滚已经排队的写入',async()=>{const {assetTransaction,assetRequest}=await import('./assetDatabase'),controller=new AbortController();await expect(assetTransaction(['characters','motions'],'readwrite',tx=>{tx.objectStore('characters').put({key:'pending'});controller.abort();},controller.signal)).rejects.toHaveProperty('name','AbortError');expect(await assetRequest('characters','readonly',s=>s.getAll())).toEqual([]);});
});
describe('完整工程包',()=>{
  it('携带外观和指定片段，在全新资源库中恢复静态姿势及书签',async()=>{
    const {characterLibrary}=await import('./characterLibrary'),{createProjectBundle,readProjectBundle,validateBundle,storeBundle}=await import('./projectBundle'),{motionLibrary}=await import('./motionLibrary');
    const e=fixture(),a=await character(),clip=motion(e);await characterLibrary.put(a);const doc={...e.snapshot(),appearance:a.ref};e.motion!.append([clip]);e.motion!.remember(clip.uuid,.4);
    const data=await (await createProjectBundle(doc,XBOT_RIG,[clip],e.motion!.state())).arrayBuffer();
    // A fresh factory models another device with none of the browser's cached files.
    vi.stubGlobal('indexedDB',new IDBFactory());const packet=await readProjectBundle(data),validated=validateBundle(packet,e.rest);expect(validated.document).toEqual(doc);expect(validated.clips[0].uuid).toBe(clip.uuid);expect(packet.bookmark?.time).toBe(.4);expect(await characterLibrary.all()).toHaveLength(0);
    await storeBundle(packet);expect((await characterLibrary.get(a.ref))?.bytes).toEqual(a.bytes);expect((await motionLibrary.list(XBOT_RIG))[0].clips[0].uuid).toBe(clip.uuid);
  });
  it('未勾选的动画不进包，Fox 内置动画按名字保留书签',async()=>{
    const {createProjectBundle,readProjectBundle,validateBundle}=await import('./projectBundle'),e=fixture(true),m=e.motion!;m.remember(m.state().clips[1].id,.2);
    const packet=await readProjectBundle(await (await createProjectBundle(e.snapshot(),FOX_RIG,[],m.state())).arrayBuffer());expect(packet.motions).toEqual([]);expect(packet.bookmark?.builtinName).toBe(m.state().clips[1].name);expect(validateBundle(packet,e.rest).document.rig).toBe(FOX_RIG.id);
  });
  it('自定义外观必须随包提供；错误哈希、缺失文件和版本均拒绝',async()=>{
    const {characterLibrary}=await import('./characterLibrary'),{createProjectBundle,readProjectBundle}=await import('./projectBundle'),a=await character(),e=fixture();await characterLibrary.put(a);const data=await (await createProjectBundle({...e.snapshot(),appearance:a.ref},XBOT_RIG,[])).arrayBuffer();
    for(const change of [(z:JSZip)=>z.file('character.glb',new Uint8Array([1,2])),(z:JSZip)=>z.remove('character.glb'),(_z:JSZip,m:any)=>{m.rigVersion=99;},(_z:JSZip,m:any)=>{delete m.appearance;}])await expect(readProjectBundle(await mutateBundle(data,change))).rejects.toThrow();
  });
  it('拒绝未知路径、清单外文件和解压过量，不污染现有库',async()=>{
    const {createProjectBundle,readProjectBundle}=await import('./projectBundle'),e=fixture(),data=await (await createProjectBundle(e.snapshot(),XBOT_RIG,[])).arrayBuffer();
    await expect(readProjectBundle(await mutateBundle(data,z=>z.file('../evil.json','{}')))).rejects.toThrow();
    const modified=new Uint8Array(data.slice(0)),d=new DataView(modified.buffer);for(let p=0;p<modified.length-46;p++)if(d.getUint32(p,true)===0x02014b50){d.setUint32(p+24,33*1024*1024,true);break;}
    await expect(readProjectBundle(modified.buffer)).rejects.toThrow(/解压/);
  });
  it('合并同源动画时不覆盖本地别名、回收站或其他片段',async()=>{
    const {motionLibrary,packMotionAsset}=await import('./motionLibrary'),{storeBundle}=await import('./projectBundle'),e=fixture(),c=motion(e),other=motion(e,'b'.repeat(64),1),a=packMotionAsset([c]);await motionLibrary.put(a);await motionLibrary.edit(a.key,c.uuid,{name:'Local name',deleted:true});await storeBundle({text:'',rig:XBOT_RIG,motions:[packMotionAsset([c]),packMotionAsset([other])]});const all=await motionLibrary.all();expect(all[0].clips).toHaveLength(2);expect(all[0].clips[0].name).toBe('Local name');expect(all[0].deletedClips?.[c.uuid]).toBeTruthy();
  });
  it('包内外部动画不能绕过骨架和轨道校验',async()=>{
    const {validateBundle}=await import('./projectBundle'),{packMotionAsset}=await import('./motionLibrary'),e=fixture(),a=packMotionAsset([motion(e)]);a.clips[0].tracks[0].name='alien.quaternion';expect(()=>validateBundle({text:JSON.stringify(e.snapshot()),rig:XBOT_RIG,motions:[a]},e.rest)).toThrow();const f=fixture(true);expect(()=>validateBundle({text:JSON.stringify(f.snapshot()),rig:FOX_RIG,motions:[a]},f.rest)).toThrow();
  });
});
describe('FBX 外观与管理后预览',()=>{
  it('离线自制蒙皮 FBX 服装适配到原人体骨架，跟随骨盆且能释放',async()=>{
    const e=fixture(),before=e.snapshot(),s=await parseCharacter(bytes('./fixtures/skinned-character.fbx'),'fbx');
    try{const surface=buildAppearance(s.scene,XBOT_RIG,e.rest,e.bones);e.model.add(surface);let mesh:SkinnedMesh|undefined;surface.traverse(o=>{if(o instanceof SkinnedMesh)mesh=o;});expect(mesh).toBeDefined();expect(mesh!.skeleton.bones).toHaveLength(68);e.model.updateMatrixWorld(true);mesh!.skeleton.update();const first=mesh!.getVertexPosition(0,new Vector3());e.bones.Hips.position.y+=.1;e.model.updateMatrixWorld(true);mesh!.skeleton.update();expect(mesh!.getVertexPosition(0,new Vector3()).y-first.y).toBeCloseTo(.1,5);expect(e.rest).toEqual(before);disposeObject(surface);}finally{s.dispose();}
  });
  const texturedFbx=(embedded:boolean)=>new TextEncoder().encode(new TextDecoder().decode(bytes('./fixtures/mixamo-motion.fbx')).replace('Objects: {',`Objects: {\n\tVideo: 400, "Video::Test", "Clip" {\n\t\tFilename: "https://example.invalid/texture.png"\n\t\tRelativeFilename: "texture.png"\n${embedded?'\t\tContent: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII="\n':''}\t}\n\tTexture: 401, "Texture::Test", "" {\n\t\tFileName: "texture.png"\n\t}\n`).replace('Connections: {','Connections: {\n\tC: "OO",400,401')).buffer;
  it('FBX 外部贴图在网络加载前拒绝',async()=>{const load=vi.spyOn(TextureLoader.prototype,'load');try{await expect(parseCharacter(texturedFbx(false),'fbx')).rejects.toThrow(/内嵌/);expect(load).not.toHaveBeenCalled();}finally{load.mockRestore();}});
  it('等待 FBX 内嵌贴图完成，随后释放临时纹理',async()=>{
    const texture=new Texture(),dispose=vi.spyOn(texture,'dispose'),urls:string[]=[];
    const load=vi.spyOn(TextureLoader.prototype,'load').mockImplementation((url,onLoad)=>{urls.push(url);queueMicrotask(()=>onLoad?.(texture));return texture;});
    try{const source=await parseCharacter(texturedFbx(true),'fbx');expect(urls[0]).toMatch(/^data:image\/png;base64,/);expect(texture.name).toBe('Test');source.dispose();expect(dispose).toHaveBeenCalled();}finally{load.mockRestore();}
  });
  it('贴图解码失败能结束导入，保留旧角色',async()=>{const load=vi.spyOn(TextureLoader.prototype,'load').mockImplementation((_url,_onLoad,_progress,onError)=>{queueMicrotask(()=>onError?.(new Error('bad image')));return new Texture();});try{await expect(parseCharacter(texturedFbx(true),'fbx')).rejects.toThrow(/解码失败/);}finally{load.mockRestore();}});
  it('无蒙皮 FBX 拒绝，当前角色、姿态和动画进度不变',async()=>{const e=fixture(),before=e.snapshot(),s=await parseCharacter(bytes('./fixtures/mixamo-motion.fbx'),'fbx');try{expect(()=>buildAppearance(s.scene,XBOT_RIG,e.rest,e.bones)).toThrow(/蒙皮/);expect(e.snapshot()).toEqual(before);}finally{s.dispose();}});
  it.skipIf(!existsSync(new URL('../assets-source/Samba Dancing.fbx',import.meta.url)))('真实 Mixamo FBX 多网格辅助骨正确适配；68 骨控制和 IK 继续可用',async()=>{
    const e=fixture(),before=e.snapshot(),s=await parseCharacter(bytes('../assets-source/Samba Dancing.fbx'),'fbx');try{const surface=buildAppearance(s.scene,XBOT_RIG,e.rest,e.bones),box=new Box3();e.model.add(surface);e.model.updateMatrixWorld(true);surface.traverse(o=>{if(o instanceof SkinnedMesh){expect(o.skeleton.bones).toHaveLength(68);box.union(new Box3().setFromObject(o,true));}});expect(box.getSize(new Vector3()).y).toBeGreaterThan(1.4);expect(box.getSize(new Vector3()).y).toBeLessThan(2);expect(e.snapshot()).toEqual(before);e.select('LeftHand');e.setSelectedPosition(1,e.info().position[1]+.02);expect(e.info().position[1]).toBeGreaterThan(before.targets.LeftHand[1]+.01);disposeObject(surface);}finally{s.dispose();}
  });
  it('格式引用兼容旧 GLB 并拒绝未知格式；删除活动动画先恢复原姿势',()=>{const e=fixture(),r={id:'a'.repeat(64),name:'FBX',rig:XBOT_RIG.id,rigVersion:1};expect(validAppearance(r,XBOT_RIG)).toBe(true);expect(validAppearance({...r,format:'fbx'},XBOT_RIG)).toBe(true);expect(validAppearance({...r,format:'vrm'},XBOT_RIG)).toBe(false);const c=motion(e),before=e.snapshot();e.installImportedMotions([c]);e.previewMotion(c.uuid);e.removeMotion(c.uuid);expect(e.motion!.active).toBe(false);expect(e.motion!.state().clips).toHaveLength(0);expect(e.snapshot()).toEqual(before);});
  it('导出片段副本保持 UUID，恢复书签不修改骨骼或播放',()=>{const e=fixture(),c=motion(e);e.motion!.append([c]);const before=e.snapshot();e.motion!.remember(c.uuid,.7);expect(e.motion!.importedClips()[0].uuid).toBe(c.uuid);expect(e.snapshot()).toEqual(before);expect(e.motion!.active).toBe(false);expect(e.motion!.playing).toBe(false);});
});
