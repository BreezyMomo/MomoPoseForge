import {beforeAll,describe,it,expect,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {Bone,BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,Object3D,Quaternion,SkinnedMesh,Texture,Vector3} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {FOX_RIG} from './foxRig';
import {XBOT_RIG} from './rigs';
import {DEFAULT_VIEWS,type PoseDocument} from './types';
import {PoseEngine} from './PoseEngine';
import {MotionPreview} from './motionPreview';
import {appearanceBoneName,buildAppearance,validAppearance,validateCharacterGlb,type AppearanceRef} from './characterAppearance';
import {disposeObject,visibleSurfaceBounds} from './rigGeometry';
import {parseDocument} from './files';
import {RigSwitchCoordinator} from './rigWorkspace';

let fox:GLTF,human:GLTF;
const bytes=(name:string)=>Uint8Array.from(readFileSync(new URL(name,import.meta.url))).buffer;
beforeAll(async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURE',loadTexture:async()=>new Texture()}));
  [fox,human]=await Promise.all([loader.parseAsync(bytes('../public/models/fox/fox.glb'),''),loader.parseAsync(bytes('../public/models/xbot.glb'),'')]);
});
function fixture(gltf=fox,rig=FOX_RIG){
  const model=new Group(),bones:Record<string,Bone>={};model.add(clone(gltf.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{rigDefinition:rig,model,bones,gizmo:new Object3D(),helpers:new Group(),selected:rig.initialSelection,mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'Original',ground:false,fullBody:false,warning:'',handDetail:null,profile:{},appearanceGroups:new Map(),originalMeshes:[],transform:{setMode(){},attach(){},detach(){},enabled:true},onInfo:vi.fn(),onCommit:vi.fn(),fit(){},update(){},syncGizmo(){},disposed:false});
  for(const end of Object.keys(rig.chains)){e.targets[end]=e.world(end).toArray();if(rig===XBOT_RIG)e.poles[end]=e.targets[end];}
  e.rest=e.snapshot();e.motion=new MotionPreview(model,gltf.animations);model.traverse(o=>{if(o instanceof Mesh)(e as any).originalMeshes.push(o);});e.ready=true;return e;
}
const ref=(rig=FOX_RIG):AppearanceRef=>({id:'a'.repeat(64),name:'Test character',rig:rig.id,rigVersion:rig.version});
function skinnedPoints(root:Object3D){const points:Vector3[]=[];root.updateMatrixWorld(true);root.traverse(o=>{if(o instanceof SkinnedMesh){o.skeleton.update();for(let i=0;i<o.geometry.attributes.position.count;i++)points.push(o.getVertexPosition(i,new Vector3()).applyMatrix4(o.matrixWorld));}});return points;}

describe('原生动画预览与取姿',()=>{
  it('读取真实关键帧，暂停后时间不变，逐帧可到首尾',()=>{
    const e=fixture(),m=e.motion!,clip=m.state().clips.find(c=>c.name==='Walk')!;
    expect(clip.frames).toBe(18);m.select(clip.id);m.seekFrame(7);const paused=m.time;m.tick(.1);expect(m.time).toBe(paused);
    m.seekFrame(999);expect(m.state().frame).toBe(17);expect(m.time).toBeCloseTo(clip.duration,6);
    m.seekFrame(-1);expect(m.time).toBe(0);m.loop=false;m.play(true);for(let i=0;i<12;i++)m.tick(.1);expect(m.playing).toBe(false);expect(m.time).toBe(clip.duration);
    m.play(true);expect(m.time).toBe(0);m.dispose();
  });
  it('预览不写草稿、不增加历史；取消恢复骨骼与固定点，且后续帧不再覆盖',()=>{
    const e=fixture();e.select('b_Head_05');e.setSelectedRotation(1,18);e.setPin(false);e.setFeetPin(true);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();
    e.previewMotion(e.motion!.state().clips[1].id);e.seekMotion(8);e.playMotion(true);e.motion!.tick(.1);
    expect(e.snapshot().joints).toEqual(before.joints);expect(e.snapshot().pins).toEqual(before.pins);expect(e.onCommit).not.toHaveBeenCalled();
    e.cancelMotion();expect(e.snapshot()).toEqual(before);e.motion!.tick(.1);expect(e.snapshot()).toEqual(before);expect(e.transform.enabled).toBe(true);
  });
  it('取姿只提交一次、解除旧固定点，满足工程校验，捕获后仍可用 IK 编辑',()=>{
    const e=fixture(),before=e.snapshot();e.setFeetPin(true);vi.mocked(e.onCommit).mockClear();
    e.previewMotion(e.motion!.state().clips[2].id);e.seekMotion(12);e.captureMotion();
    const captured=e.snapshot();expect(e.onCommit).toHaveBeenCalledOnce();expect(captured.joints).not.toEqual(before.joints);expect(captured.pins).toEqual({});expect(e.motion!.active).toBe(false);
    expect(parseDocument(JSON.stringify(captured),e.rest).joints).toEqual(captured.joints);
    e.select('b_LeftHand_011');const y=e.info().position[1];e.setSelectedPosition(1,y+.03);expect(e.info().position[1]).toBeGreaterThan(y+.01);
    e.apply(before,true,false);expect(e.snapshot().joints).toEqual(before.joints);
  });
  it('换外观不中断动画，取消和取姿都保留新外观',()=>{
    const e=fixture(),r=ref();(e as any).appearanceGroups.set(r.id,new Group());
    e.previewMotion(e.motion!.state().clips[0].id);e.playMotion(true);e.motion!.tick(.1);const time=e.motion!.time;
    e.setAppearance(r);expect(e.motion!.time).toBe(time);expect(e.motion!.playing).toBe(true);expect(e.snapshot().appearance).toEqual(r);
    e.cancelMotion();expect(e.snapshot().appearance).toEqual(r);
    e.previewMotion(e.motion!.state().clips[1].id);e.captureMotion();expect(e.snapshot().appearance).toEqual(r);
  });
  it('未知片段与跨骨架内容不能改变当前姿势；切换前结束预览',()=>{
    const e=fixture(),before=e.snapshot();expect(()=>e.previewMotion('unknown')).toThrow('不属于');expect(e.snapshot()).toEqual(before);
    e.previewMotion(e.motion!.state().clips[0].id);e.seekMotion(20);e.prepareSwitch();expect(e.snapshot()).toEqual(before);expect(e.motion!.active).toBe(false);
    const h=fixture(human,XBOT_RIG);expect(h.motion!.state().clips).toHaveLength(0);expect(()=>h.previewMotion(e.motion!.state().clips[0].id)).toThrow('不属于');
  });
});

describe('同骨架完整外观重绑定',()=>{
  it.skipIf(!existsSync(new URL('../assets-source/Xbot.glb',import.meta.url)))('实际原始 Mixamo GLB 的厘米与 Armature 变换正确适配至米制骨架',async()=>{
    const loader=new GLTFLoader(),raw=await loader.parseAsync(bytes('../assets-source/Xbot.glb'),''),e=fixture(human,XBOT_RIG),group=buildAppearance(raw.scene,XBOT_RIG,e.rest,e.bones);e.model.add(group);
    const points=skinnedPoints(group),original=skinnedPoints(e.model.children[0]);
    expect(Math.max(...points.map(p=>Math.abs(p.y)))).toBeLessThan(2);
    expect(Math.max(...original.map((p,i)=>p.distanceTo(points[i])))).toBeLessThan(1e-4);
  });
  it('完整角色的厘米场景与不同绑定轴不会重复缩放或扭坏网格',()=>{
    const e=fixture(human,XBOT_RIG),source=clone(human.scene),original=skinnedPoints(e.model),bones:Bone[]=[];source.traverse(o=>{if(o instanceof Bone)bones.push(o);});
    const worlds=new Map(bones.map((b,i)=>[b.name,new Matrix4().compose(b.getWorldPosition(new Vector3()),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),(i%5)*.2),new Vector3(1,1,1))]));
    for(const b of bones){const parent=b.parent instanceof Bone?worlds.get(b.parent.name)!:new Matrix4();parent.clone().invert().multiply(worlds.get(b.name)!).decompose(b.position,b.quaternion,b.scale);}
    source.updateMatrixWorld(true);source.traverse(o=>{if(o instanceof SkinnedMesh)o.skeleton.calculateInverses();});source.scale.setScalar(100);source.updateMatrixWorld(true);
    const group=buildAppearance(source,XBOT_RIG,e.rest,e.bones);e.model.add(group);const points=skinnedPoints(group);
    expect(Math.max(...original.map((p,i)=>p.distanceTo(points[i])))).toBeLessThan(4e-6);disposeObject(group);
  });
  for(const kind of ['fox','human'] as const)it(`${kind} 外观静止几何保持一致，姿势不变，转动骨骼后新网格跟随`,()=>{
    const gltf=kind==='fox'?fox:human,rig=kind==='fox'?FOX_RIG:XBOT_RIG,e=fixture(gltf,rig),source=clone(gltf.scene);
    const original=skinnedPoints(e.model),before=e.snapshot();e.model.position.set(.3,.2,-.1);e.select(rig.initialSelection);e.setSelectedRotation(0,10);const posed=e.snapshot();
    const group=buildAppearance(source,rig,e.rest,e.bones);expect(e.snapshot()).toEqual(posed);
    // Return to rest to compare corresponding rendered vertices, not just bind transforms.
    e.apply(before,true,false);e.model.add(group);const rebuilt=skinnedPoints(group);expect(rebuilt.length).toBe(original.length);
    expect(Math.max(...original.map((p,i)=>p.distanceTo(rebuilt[i])))).toBeLessThan(3e-6);
    const bound=e.bones[rig.initialSelection];bound.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.4));
    e.model.updateMatrixWorld(true);const moved=skinnedPoints(group);expect(Math.max(...moved.map((p,i)=>p.distanceTo(rebuilt[i])))).toBeGreaterThan(.01);disposeObject(group);
  });
  it('围巾示例增加真实服装几何，使用同一骨架，原始狐狸几何保持一致',async()=>{
    const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURE',loadTexture:async()=>new Texture()}));
    const gltf=await loader.parseAsync(bytes('../public/models/fox/fox-scarf.glb'),''),e=fixture(),group=buildAppearance(gltf.scene,FOX_RIG,e.rest,e.bones);
    const original=skinnedPoints(e.model),points=skinnedPoints(group);expect(points).toHaveLength(original.length+30);
    expect(Math.max(...original.map((p,i)=>p.distanceTo(points[i])))).toBeLessThan(3e-6);
    const cloth=(group.children.at(-1) as SkinnedMesh);expect(cloth.skeleton.bones).toContain(e.bones.b_Neck_04);
    e.model.add(group);e.bones.b_Neck_04.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.3));e.model.updateMatrixWorld(true);
    const moved=skinnedPoints(group);expect(Math.max(...moved.slice(original.length).map((p,i)=>p.distanceTo(points[original.length+i])))).toBeGreaterThan(.02);
    disposeObject(group);
  });
  it('Mixamo 名称适配明确包含脊柱与手指；缺骨、错误层级、其他物种拒绝',()=>{
    expect(appearanceBoneName('mixamorig:Spine2',XBOT_RIG)).toBe('Chest');expect(appearanceBoneName('mixamorigLeftHandPinky3',XBOT_RIG)).toBe('LeftLittle3');
    const e=fixture();expect(()=>buildAppearance(clone(human.scene),FOX_RIG,e.rest,e.bones)).toThrow('缺少');
    const wrong=clone(fox.scene),bones:Record<string,Bone>={};wrong.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});bones.b_Hip_01.add(bones.b_Head_05);
    expect(()=>buildAppearance(wrong,FOX_RIG,e.rest,e.bones)).toThrow('连接不兼容');expect(validAppearance(ref(XBOT_RIG),FOX_RIG)).toBe(false);
  });
  it('外观随工程引用保存、旧工程默认原角色，错误外观不破坏当前姿势',()=>{
    const e=fixture(),r=ref(),before=e.snapshot();expect(parseDocument(JSON.stringify(before),e.rest).appearance).toBeUndefined();
    expect(()=>e.apply({...before,appearance:r})).toThrow('尚未载入');expect(e.snapshot()).toEqual(before);
    (e as any).appearanceGroups.set(r.id,new Group());e.setAppearance(r);expect(parseDocument(JSON.stringify(e.snapshot()),e.rest).appearance).toEqual(r);
    expect(()=>parseDocument(JSON.stringify({...before,appearance:ref(XBOT_RIG)}),e.rest)).toThrow('外观');
    e.applyPreset(FOX_RIG.presets[0]);expect(e.snapshot().appearance).toEqual(r);e.apply(before);expect(e.appearance).toBeUndefined();
  });
  it('边界计算排除缓存外观，骨架模式仍按活动外观计算',()=>{
    const root=new Group(),a=new Mesh(new BoxGeometry(),new MeshStandardMaterial()),cached=new Group();cached.add(new Mesh(new BoxGeometry(100,100,100),new MeshStandardMaterial()));cached.visible=false;root.add(a,cached);root.visible=false;
    expect(visibleSurfaceBounds(root).getSize(new Vector3()).toArray()).toEqual([1,1,1]);disposeObject(root);
  });
  it('GLB 必须完整内嵌；损坏文件不能发起附带资源请求',()=>{
    expect(()=>validateCharacterGlb(bytes('../public/models/fox/fox.glb'))).not.toThrow();expect(()=>validateCharacterGlb(new ArrayBuffer(50))).toThrow('结构无效');
    const json=new TextEncoder().encode(JSON.stringify({buffers:[{uri:'https://example.com/mesh.bin'}]}).padEnd(80,' ')),b=new ArrayBuffer(100),v=new DataView(b);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,100,true);v.setUint32(12,80,true);v.setUint32(16,0x4e4f534a,true);new Uint8Array(b,20).set(json);
    expect(()=>validateCharacterGlb(b)).toThrow('内嵌');
  });
  it('外观准备失败或被新请求取代时不激活候选角色',async()=>{
    const created:{dispose:ReturnType<typeof vi.fn>}[]=[],activate=vi.fn();let resolve!:()=>void;
    const c=new RigSwitchCoordinator(()=>{const runtime={dispose:vi.fn()};created.push(runtime);return runtime;},async()=>{});
    await expect(c.request(FOX_RIG,activate,async()=>{throw new Error('missing skin');})).rejects.toThrow('missing skin');expect(created[0].dispose).toHaveBeenCalledOnce();expect(activate).not.toHaveBeenCalled();
    const a=c.request(FOX_RIG,activate,()=>new Promise<void>(r=>{resolve=r;}));await Promise.resolve();await Promise.resolve();
    await c.request(XBOT_RIG,activate);resolve();expect(await a).toBe(false);expect(activate).toHaveBeenCalledOnce();
  });
});
