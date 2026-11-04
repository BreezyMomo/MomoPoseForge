import {beforeAll,afterAll,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AnimationMixer,Bone,BoxGeometry,Group,Mesh,MeshStandardMaterial,SkinnedMesh,Vector3,type Object3D} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {snapshotModelExport,encodeModelGlb,type ModelExportActor,type ModelExportOptions} from './modelExport';
import {XBOT_RIG,YBOT_RIG,BASIC_HUMAN_RIG,type RigDefinition} from './rigs';
import {FOX_RIG} from './foxRig';
import {BODYCHAN_RIG,BODYKUN_RIG} from './bodyFigureRigs';
import {buildAppearance} from './characterAppearance';
import {buildProceduralRig,ensureRigNormals} from './rigGeometry';

// GLTFExporter uses the browser FileReader solely to serialize Blob buffers.
class BufferReader{
  result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;
  readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();});}
}
const assets=new Map<string,GLTF>();
const {validateBytes}=createRequire(import.meta.url)('gltf-validator') as {validateBytes:(bytes:Uint8Array,options?:object)=>Promise<{issues:{numErrors:number;messages:{severity:number;code:string;message:string}[]}}>};
const loader=()=>{const l=new GLTFLoader();l.register(()=>({name:'NO_TEST_TEXTURES',loadTexture:async()=>null as any}));return l;};
beforeAll(async()=>{
  vi.stubGlobal('FileReader',BufferReader);
  await Promise.all([XBOT_RIG,YBOT_RIG,FOX_RIG,BODYCHAN_RIG,BODYKUN_RIG].map(async rig=>{if(rig.asset.kind!=='gltf')return;const b=readFileSync(new URL(`../public${rig.asset.url}`,import.meta.url));assets.set(rig.id,await loader().parseAsync(Uint8Array.from(b).buffer,''));}));
});
afterAll(()=>vi.unstubAllGlobals());
function actor(rig:RigDefinition,id='first'):ModelExportActor{
  const model=new Group();model.add(rig.asset.kind==='procedural'?buildProceduralRig(rig).group:clone(assets.get(rig.id)!.scene));ensureRigNormals(model);model.updateMatrixWorld(true);
  return {id,name:id,rig,model};
}
function meshes(root:Object3D){const result:Mesh[]=[];root.traverseVisible(o=>{if(o instanceof Mesh)result.push(o);});return result;}
function samples(root:Object3D){root.updateMatrixWorld(true);return meshes(root).map(mesh=>({name:mesh.name,points:[0,Math.floor(mesh.geometry.attributes.position.count/2),mesh.geometry.attributes.position.count-1].map(i=>mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld))}));}
function compare(actual:Object3D,expected:ReturnType<typeof samples>){const points=samples(actual);expect(points).toHaveLength(expected.length);for(let j=0;j<points.length;j++)for(let k=0;k<3;k++)expect(points[j].points[k].distanceTo(expected[j].points[k]),`${j}/${k}`).toBeLessThan(.00003);}
function glbJSON(bytes:ArrayBuffer){const length=new DataView(bytes).getUint32(12,true);return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));}

describe('GLB 模型导出',()=>{
  for(const rig of [XBOT_RIG,YBOT_RIG,FOX_RIG,BODYCHAN_RIG,BODYKUN_RIG,BASIC_HUMAN_RIG])for(const mode of ['static','rigged'] as const)it(`${rig.id} ${mode} 重载后保持当前蒙皮外形与位置`,async()=>{
    const a=actor(rig),joint=a.model.getObjectByName(rig.initialSelection)!;joint.rotateX(.35);joint.rotateZ(-.25);a.model.position.set(1.2,.15,-.8);a.model.rotation.y=.65;
    const expected=samples(a.model),before=a.model.toJSON(),snapshot=snapshotModelExport({name:'Posed scene',actors:[a]},{mode,scope:'scene'});
    const bytes=await encodeModelGlb(snapshot),json=glbJSON(bytes),gltf=await loader().parseAsync(bytes,''),validation=await validateBytes(new Uint8Array(bytes));expect(validation.issues.messages.filter(m=>m.severity===0)).toEqual([]);compare(gltf.scene,expected);
    expect(a.model.toJSON()).toEqual(before);expect(json.nodes.find((n:any)=>n.extras?.actorId==='first').extras.rig).toBe(rig.id);
    if(mode==='static'){expect(json.skins).toBeUndefined();expect(json.animations).toBeUndefined();expect(json.nodes.some((n:any)=>n.name===rig.root)).toBe(false);}
    else{
      expect(gltf.animations[0].name).toBe('PoseForge_CurrentPose');expect(json.animations[0].channels.length).toBeGreaterThan(0);
      const mixer=new AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play();mixer.update(.01);compare(gltf.scene,expected);
      if(rig.asset.kind!=='procedural')expect(json.skins.length).toBeGreaterThan(0);
    }
  });
  it('同名骨骼的多个实例与狐狸互不串姿，姿态片段能正确绑定各实例',async()=>{
    const actors=[actor(XBOT_RIG,'human1'),actor(XBOT_RIG,'human2'),actor(FOX_RIG,'fox1'),actor(FOX_RIG,'fox2'),actor(YBOT_RIG,'ybot'),actor(BODYCHAN_RIG,'bodychan'),actor(BODYKUN_RIG,'bodykun'),actor(XBOT_RIG,'human3')];
    actors.forEach((a,i)=>{if(i<2)a.name='Same character name';a.model.position.x=(i%4)*1.5;a.model.position.z=Math.floor(i/4);a.model.getObjectByName(a.rig.initialSelection)!.rotateZ((i+1)*.1);});
    const expected=actors.map(a=>samples(a.model)),snapshot=snapshotModelExport({name:'Mixed',actors},{mode:'rigged',scope:'scene'});
    const bytes=await encodeModelGlb(snapshot),gltf=await loader().parseAsync(bytes,''),validation=await validateBytes(new Uint8Array(bytes)),mixer=new AnimationMixer(gltf.scene);expect(validation.issues.numErrors).toBe(0);mixer.clipAction(gltf.animations[0]).play();mixer.update(.01);
    for(let i=0;i<actors.length;i++){const root=gltf.scene.children.find(o=>o.userData.actorId===actors[i].id)!;expect(root).toBeDefined();compare(root,expected[i]);}
    const humanRoots=gltf.scene.children.filter(o=>o.userData.rig===XBOT_RIG.id);expect(humanRoots[0].getObjectByName('Hips')).not.toBe(humanRoots[1].getObjectByName('Hips'));
  });
  for(const rig of [XBOT_RIG,FOX_RIG])it(`${rig.id} 当前外观使用隐藏原网格中的骨架；不导出缓存外观或隐藏表面`,async()=>{
    const a=actor(rig),bones:Record<string,Bone>={};a.model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});
    const joints=Object.fromEntries(Object.entries(bones).map(([n,b])=>[n,{position:b.position.toArray(),quaternion:b.quaternion.toArray()}]));
    const outfit=buildAppearance(clone(assets.get(rig.id)!.scene),rig,{joints} as any,bones);
    meshes(a.model).forEach(m=>m.visible=false);a.model.add(outfit);const cached=outfit.clone();cached.visible=false;a.model.add(cached);
    bones[rig.initialSelection].rotateZ(.8);const expected=samples(a.model);
    for(const mode of ['static','rigged'] as const){const bytes=await encodeModelGlb(snapshotModelExport({name:'Outfit',actors:[a]},{mode,scope:'selected'})),gltf=await loader().parseAsync(bytes,'');compare(gltf.scene,expected);expect(meshes(gltf.scene)).toHaveLength(expected.length);}
  });
  it('骨架显示模式不令实体导出变空；复制与编码不改变活动场景资源',async()=>{
    const a=actor(FOX_RIG),before=samples(a.model),geometry=meshes(a.model)[0].geometry,dispose=vi.spyOn(geometry,'dispose');a.model.visible=false;
    const snapshot=snapshotModelExport({name:'Fox',actors:[a]},{mode:'static',scope:'selected'});expect(meshes(snapshot.scene).length).toBeGreaterThan(0);
    a.model.position.x=5;const bytes=await encodeModelGlb(snapshot);compare((await loader().parseAsync(bytes,'')).scene,before);expect(a.model.visible).toBe(false);expect(dispose).not.toHaveBeenCalled();
  });
  it('道具与角色位置分开保留，静态副本没有骨骼或蒙皮属性',async()=>{
    const props=new Group(),prop=new Mesh(new BoxGeometry(),new MeshStandardMaterial());prop.position.set(-2,.5,1);props.add(prop);
    const snapshot=snapshotModelExport({name:'Props',actors:[actor(FOX_RIG)],props},{mode:'static',scope:'scene'}),bytes=await encodeModelGlb(snapshot),json=glbJSON(bytes),gltf=await loader().parseAsync(bytes,'');
    expect(json.meshes.every((m:any)=>m.primitives.every((p:any)=>p.attributes.JOINTS_0===undefined&&p.attributes.WEIGHTS_0===undefined))).toBe(true);compare(gltf.scene.children.find(o=>o.userData.kind==='props')!,samples(props));
  });
  it('取消或编码失败均释放快照，保留编辑资源；空范围明确报错',async()=>{
    const source={name:'Cancelled',actors:[actor(XBOT_RIG)]},snapshot=snapshotModelExport(source,{mode:'rigged',scope:'selected'}),geometry=meshes(snapshot.scene)[0].geometry,dispose=vi.spyOn(geometry,'dispose'),abort=new AbortController();abort.abort();
    await expect(encodeModelGlb(snapshot,abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(dispose).toHaveBeenCalledOnce();expect(snapshot.scene.children).toHaveLength(0);
    expect(()=>snapshotModelExport({name:'Empty',actors:[]},{mode:'static',scope:'scene'})).toThrow('pose.modelExportEmpty');
  });
  it('编码器异常时释放临时网格，不释放角色原始网格，并允许重新导出',async()=>{
    const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js'),source={name:'Retry',actors:[actor(FOX_RIG)]},snapshot=snapshotModelExport(source,{mode:'static',scope:'scene'}),owned=vi.spyOn(meshes(snapshot.scene)[0].geometry,'dispose'),original=vi.spyOn(meshes(source.actors[0].model)[0].geometry,'dispose');
    const encode=vi.spyOn(GLTFExporter.prototype,'parseAsync').mockRejectedValueOnce(new Error('Encoder failure'));try{await expect(encodeModelGlb(snapshot)).rejects.toThrow('Encoder failure');expect(owned).toHaveBeenCalledOnce();expect(original).not.toHaveBeenCalled();}finally{encode.mockRestore();}
    await expect(encodeModelGlb(snapshotModelExport(source,{mode:'static',scope:'scene'}))).resolves.toBeInstanceOf(ArrayBuffer);
  });
  it('编码进行中取消，等待编码退出后释放副本并拒绝交付文件',async()=>{
    const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js'),snapshot=snapshotModelExport({name:'Cancel pending',actors:[actor(FOX_RIG)]},{mode:'rigged',scope:'scene'}),abort=new AbortController();let finish!:(b:ArrayBuffer)=>void,started!:()=>void;
    const pending=new Promise<void>(resolve=>{started=resolve;}),encode=vi.spyOn(GLTFExporter.prototype,'parseAsync').mockImplementationOnce(()=>{started();return new Promise(resolve=>{finish=resolve;});});
    try{const result=encodeModelGlb(snapshot,abort.signal);await pending;abort.abort();expect(snapshot.scene.children.length).toBeGreaterThan(0);finish(new ArrayBuffer(16));await expect(result).rejects.toMatchObject({name:'AbortError'});expect(snapshot.scene.children).toHaveLength(0);}finally{encode.mockRestore();}
  });
});
