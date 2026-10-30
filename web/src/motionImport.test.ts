import {beforeAll,describe,it,expect,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AnimationClip,AnimationMixer,Bone,Group,LoopOnce,Matrix4,Object3D,Quaternion,QuaternionKeyframeTrack,Vector3,VectorKeyframeTrack} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {XBOT_RIG} from './rigs';
import {FOX_RIG} from './foxRig';
import {PoseEngine} from './PoseEngine';
import {DEFAULT_VIEWS,type PoseDocument} from './types';
import {MotionPreview} from './motionPreview';
import {parseMotionSource,type MotionSource} from './motionImport';
import {retargetMixamoMotion,importedMotion} from './mixamoMotion';
import {packMotionAsset,unpackMotionAsset} from './motionLibrary';
import {parseDocument} from './files';

const bytes=(path:string)=>Uint8Array.from(readFileSync(new URL(path,import.meta.url))).buffer;
const fbx=bytes('./fixtures/mixamo-motion.fbx'),assetId=createHash('sha256').update(new Uint8Array(fbx)).digest('hex');
let human:GLTF;
beforeAll(async()=>{human=await new GLTFLoader().parseAsync(bytes('../public/models/xbot.glb'),'');});
function fixture(){
  const model=new Group(),bones:Record<string,Bone>={};model.add(clone(human.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{rigDefinition:XBOT_RIG,model,bones,gizmo:new Object3D(),helpers:new Group(),selected:'LeftHand',mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'Before import',ground:false,fullBody:true,warning:'',handDetail:null,profile:{},appearanceGroups:new Map(),originalMeshes:[],transform:{setMode(){},attach(){},detach(){},enabled:true},onInfo:vi.fn(),onCommit:vi.fn(),fit(){},update(){},syncGizmo(){},disposed:false});
  for(const end of XBOT_RIG.contacts){e.targets[end]=e.world(end).toArray();e.poles[end]=e.targets[end];}
  e.rest=e.snapshot();e.motion=new MotionPreview(model,[]);e.ready=true;return e;
}
async function converted(e=fixture()){const s=await parseMotionSource(fbx,'owned-fixture.fbx');try{return await retargetMixamoMotion(s,XBOT_RIG,e.rest,e.bones,assetId,'owned-fixture.fbx');}finally{s.dispose();}}
const sample=(scene:Object3D,clip:AnimationClip,time:number)=>{const mixer=new AnimationMixer(scene),action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);scene.updateMatrixWorld(true);return()=>{mixer.stopAllAction();mixer.uncacheRoot(scene);};};

describe('外部动画解析与人体映射',()=>{
  it('真实解析自制无蒙皮 FBX，得到正确片段和骨架，不需要纹理或网络',async()=>{
    const source=await parseMotionSource(fbx,'arm.FBX');let count=0;source.scene.traverse(o=>{if(o instanceof Bone)count++;});expect(count).toBe(20);expect(source.clips).toHaveLength(1);expect(source.clips[0].duration).toBe(1);source.dispose();
  });
  it('保留现有角色与姿势；厘米动画适配后抬臂角度正确，非根骨长度不变',async()=>{
    const e=fixture(),before=e.snapshot(),clips=await converted(e);expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(15);
    expect(e.bones.LeftArm.quaternion.clone().normalize().angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/4))).toBeLessThan(1e-6);
    expect(e.bones.LeftForeArm.quaternion.clone().normalize().angleTo(new Quaternion())).toBeLessThan(1e-6);
    expect(e.bones.UpperChest.quaternion.clone().normalize().angleTo(new Quaternion())).toBeLessThan(1e-6);
    for(const[name,b]of Object.entries(e.bones))if(name!=='Hips')expect(b.position.toArray()).toEqual(before.joints[name].position);
    expect(e.snapshot()).toEqual(before);e.cancelMotion();expect(e.snapshot()).toEqual(before);
  });
  it('原地模式保留垂直动作，关闭后水平位移按骨架比例归一化',async()=>{
    const e=fixture(),height=e.world('Head').y-e.world('LeftFoot').y,clips=await converted(e);e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(30);
    expect(e.bones.Hips.position.x).toBe(0);const y=e.bones.Hips.position.y;e.setMotionInPlace(false);
    expect(e.bones.Hips.position.x).toBeCloseTo(height/167*100,5);expect(e.bones.Hips.position.y).toBe(y);
    e.setMotionInPlace(true);expect(e.bones.Hips.position.x).toBe(0);e.cancelMotion();
  });
  it('原地模式不会抹掉起跳高度；非根骨位置沿用当前骨架并报告舍弃的平移',async()=>{
    const source=await parseMotionSource(fbx,'owned.fbx'),e=fixture(),hip=source.scene.getObjectByName('mixamorigHips')!;
    source.clips[0].tracks.push(new VectorKeyframeTrack('mixamorigHips.position',[0,1],[0,100,0,100,130,0]),new VectorKeyframeTrack('mixamorigLeftHand.position',[0,1],[24,0,0,30,0,0]));
    // Replace the authored root track, rather than binding the same property twice.
    source.clips[0].tracks=source.clips[0].tracks.filter((t,i,a)=>t.name!=='mixamorigHips.position'||i===a.map(x=>x.name).lastIndexOf(t.name));
    try{const clips=await retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'jump.fbx');expect(importedMotion(clips[0])!.ignoredTranslations).toBe(1);e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(30);expect(e.bones.Hips.position.y).toBeGreaterThan(e.rest.joints.Hips.position[1]+.2);expect(e.bones.Hips.position.x).toBe(0);expect(e.bones.LeftHand.position.toArray()).toEqual(e.rest.joints.LeftHand.position);}
    finally{source.dispose();}
  });
  it('Float32 时长恰好落在采样点附近时，末帧不会重复',async()=>{
    const source=await parseMotionSource(fbx,'owned.fbx'),e=fixture();source.clips[0].duration=Math.fround(1.2);
    try{const clips=await retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'rounding.fbx');expect(()=>unpackMotionAsset(packMotionAsset(clips),XBOT_RIG,e.rest)).not.toThrow();const times=Array.from(clips[0].tracks[0].times);expect(times.every((t,i)=>i===0||t>times[i-1])).toBe(true);expect(times.at(-1)).toBe(source.clips[0].duration);}finally{source.dispose();}
  });
  it('取姿仅产生一次历史，手势标记自定义，固定点解除，可继续 IK 与工程往返',async()=>{
    const e=fixture(),before=e.snapshot();e.setFeetPin(true);vi.mocked(e.onCommit).mockClear();const clips=await converted(e);e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(12);e.captureMotion();
    expect(e.onCommit).toHaveBeenCalledOnce();expect(e.snapshot().pins).toEqual({});expect(e.hands).toEqual({Left:'自定义',Right:'自定义'});expect(parseDocument(JSON.stringify(e.snapshot()),e.rest).joints).toEqual(e.snapshot().joints);
    e.select('LeftHand');const position=e.world('LeftHand').y;e.setSelectedPosition(1,position+.03);expect(e.world('LeftHand').y).toBeGreaterThan(position+.005);
    e.apply(before,true,false);for(const[name,j]of Object.entries(e.snapshot().joints)){expect(j.position).toEqual(before.joints[name].position);expect(new Quaternion().fromArray(j.quaternion).angleTo(new Quaternion().fromArray(before.joints[name].quaternion))).toBeLessThan(1e-6);}
  });
  it('取姿从实际肘膝重建弯曲方向，第一次微调不会沿用旧极点翻转',async()=>{
    const e=fixture(),clips=await converted(e),qUpper=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.7),qElbow=new Quaternion().setFromAxisAngle(new Vector3(0,-1,0),1.1);
    for(const track of clips[0].tracks)if(track.name==='LeftArm.quaternion'||track.name==='LeftForeArm.quaternion'){const q=track.name==='LeftArm.quaternion'?qUpper:qElbow;for(let i=0;i<track.values.length;i+=4)q.toArray(track.values,i);}
    e.fullBody=false;e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(10);e.captureMotion();
    const a=e.world('LeftArm'),b=e.world('LeftForeArm'),c=e.world('LeftHand'),axis=c.clone().sub(a).normalize(),bend=b.clone().sub(a).addScaledVector(axis,-b.clone().sub(a).dot(axis)),pole=new Vector3().fromArray(e.poles.LeftHand).sub(a);pole.addScaledVector(axis,-pole.dot(axis));
    expect(bend.normalize().dot(pole.normalize())).toBeGreaterThan(.9999);
    e.select('LeftHand');const before=e.world('LeftForeArm');e.setSelectedPosition(1,c.y+.001);expect(e.world('LeftForeArm').distanceTo(before)).toBeLessThan(.01);
  });
  it('无网格的 GLB 节点动画也按骨架层级识别，忽略空动画 Take',async()=>{
    const source=await parseMotionSource(fbx,'owned.fbx');
    class Reader{result:unknown;onloadend?:()=>void;onerror?:(e:unknown)=>void;readAsArrayBuffer(blob:Blob){blob.arrayBuffer().then(x=>{this.result=x;this.onloadend?.();}).catch(e=>this.onerror?.(e));}}
    vi.stubGlobal('FileReader',Reader);
    try{
      const data=await new GLTFExporter().parseAsync(source.scene,{binary:true,animations:source.clips}) as ArrayBuffer;
      const glb=await parseMotionSource(data,'owned.glb'),e=fixture();try{const clips=await retargetMixamoMotion(glb,XBOT_RIG,e.rest,e.bones,assetId,'owned.glb');expect(clips).toHaveLength(1);e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(30);expect(e.bones.LeftArm.quaternion.clone().normalize().angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2))).toBeLessThan(1e-6);}finally{glb.dispose();}
    }finally{source.dispose();vi.unstubAllGlobals();}
  });
  it('带三次样条的 GLB 根位移按源插值采样，不把切线误判成缩放或无效关键帧',async()=>{
    const source=await parseMotionSource(fbx,'owned.fbx');
    class Reader{result:unknown;onloadend?:()=>void;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(x=>{this.result=x;this.onloadend?.();});}}
    vi.stubGlobal('FileReader',Reader);
    try{
      const raw=await new GLTFExporter().parseAsync(source.scene,{binary:true,animations:source.clips}) as ArrayBuffer,view=new DataView(raw),size=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(raw,20,size))),oldBin=new Uint8Array(raw,28+size),binary=new Uint8Array(oldBin.length+72);binary.set(oldBin);
      const values=new Float32Array([0,0,0,0,100,0,0,0,0,0,0,0,100,100,0,0,0,0]);binary.set(new Uint8Array(values.buffer),oldBin.length);
      const bv=json.bufferViews.length,accessor=json.accessors.length;json.bufferViews.push({buffer:0,byteOffset:oldBin.length,byteLength:72});json.accessors.push({bufferView:bv,componentType:5126,count:6,type:'VEC3'});json.buffers[0].byteLength=binary.length;
      const channel=json.animations[0].channels.find((c:any)=>c.target.path==='translation'),sampler=json.animations[0].samplers[channel.sampler];sampler.output=accessor;sampler.interpolation='CUBICSPLINE';
      const encoded=new TextEncoder().encode(JSON.stringify(json)),padded=(encoded.length+3)&~3,out=new ArrayBuffer(28+padded+binary.length),header=new DataView(out);header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,out.byteLength,true);header.setUint32(12,padded,true);header.setUint32(16,0x4e4f534a,true);new Uint8Array(out,20,padded).fill(32);new Uint8Array(out,20).set(encoded);header.setUint32(20+padded,binary.length,true);header.setUint32(24+padded,0x004e4942,true);new Uint8Array(out,28+padded).set(binary);
      const parsed=await parseMotionSource(out,'cubic.glb'),e=fixture(),height=e.world('Head').y-e.world('LeftFoot').y;
      try{const clips=await retargetMixamoMotion(parsed,XBOT_RIG,e.rest,e.bones,assetId,'cubic.glb');e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.setMotionInPlace(false);e.seekMotion(12);expect(e.bones.Hips.position.x).toBeCloseTo((3*.4**2-2*.4**3)*height/167*100,5);}finally{parsed.dispose();}
    }finally{source.dispose();vi.unstubAllGlobals();}
  });
  it('局部绑定轴和上层 Armature 缩放不相同时，使用世界绑定差而非复制旋转',async()=>{
    const e=fixture(),scene=new Group(),bones:Record<string,Bone>={},binds=new Map<string,Matrix4>();scene.scale.setScalar(.01);
    e.model.updateMatrixWorld(true);
    for(const[name,b]of Object.entries(e.bones)){const source=new Bone();source.name=name;bones[name]=source;const parent=b.parent instanceof Bone?b.parent.name:null;(parent?bones[parent]:scene).add(source);}
    for(const[name,b]of Object.entries(e.bones)){const desired=new Matrix4().compose(b.getWorldPosition(new Vector3()),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.6),new Vector3(.01,.01,.01));binds.set(name,desired);}
    for(const[name,b]of Object.entries(bones)){const parent=b.parent instanceof Bone?binds.get(b.parent.name)!:scene.matrixWorld;scene.updateMatrixWorld(true);const parentWorld=b.parent instanceof Bone?binds.get(b.parent.name)!:scene.matrixWorld;parentWorld.clone().invert().multiply(binds.get(name)!).decompose(b.position,b.quaternion,b.scale);}
    scene.updateMatrixWorld(true);const arm=bones.LeftArm,bindLocal=arm.quaternion.clone(),parentWorld=arm.parent!.getWorldQuaternion(new Quaternion()),desiredWorld=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.8).multiply(arm.getWorldQuaternion(new Quaternion())),end=parentWorld.invert().multiply(desiredWorld);
    const clip=new AnimationClip('axes',1,[new QuaternionKeyframeTrack('LeftArm.quaternion',[0,1],[...bindLocal.toArray(),...end.toArray()])]),source:MotionSource={scene,clips:[clip],format:'glb',dispose(){}};
    const clips=await retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'axes.glb');e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(30);
    expect(e.bones.LeftArm.quaternion.clone().normalize().angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.8))).toBeLessThan(1e-6);
  });
  it.skipIf(!existsSync(new URL('../assets-source/Xbot.glb',import.meta.url)))('实际原始 Mixamo GLB 的七段动画可全部适配',async()=>{
    const source=await parseMotionSource(bytes('../assets-source/Xbot.glb'),'Xbot.glb'),e=fixture();try{const clips=await retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'Xbot.glb');expect(clips).toHaveLength(7);expect(importedMotion(clips[0])!.reference).toBe('skin-bind');for(const clip of clips)expect(()=>unpackMotionAsset(packMotionAsset([clip]),XBOT_RIG,e.rest)).not.toThrow();}finally{source.dispose();}
  });
  it.skipIf(!existsSync(new URL('../assets-source/Xbot.glb',import.meta.url)))('真实 GLB 行走关键帧的世界旋转与原绑定差逐关节吻合',async()=>{
    const source=await parseMotionSource(bytes('../assets-source/Xbot.glb'),'Xbot.glb'),e=fixture();
    try{
      const clips=await retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'Xbot.glb'),index=source.clips.findIndex(c=>c.name==='walk'),bind=new Map<string,Quaternion>();
      source.scene.traverse(o=>{if(o instanceof Bone)bind.set(o.name,o.getWorldQuaternion(new Quaternion()).invert());});
      const stop=sample(source.scene,source.clips[index],10/30);e.installImportedMotions(clips);e.previewMotion(clips[index].uuid);e.seekMotion(10);
      for(const name of ['Hips','Spine1','LeftArm','LeftForeArm','RightUpLeg','RightFoot']){const s=source.scene.getObjectByName(`mixamorig${name}`)!;const expected=s.getWorldQuaternion(new Quaternion()).multiply(bind.get(s.name)!).normalize(),actual=e.bones[name].getWorldQuaternion(new Quaternion()).normalize();expect(actual.angleTo(expected),name).toBeLessThan(1e-5);}stop();
    }finally{source.dispose();}
  });
  it.skipIf(!existsSync(new URL('../assets-source/Samba Dancing.fbx',import.meta.url)))('实际 Mixamo FBX 的 119 骨骼、绑定姿态及空 Take 可正确处理',async()=>{
    const source=await parseMotionSource(bytes('../assets-source/Samba Dancing.fbx'),'Samba Dancing.fbx'),e=fixture();try{expect(source.clips).toHaveLength(1);const clips=await retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'Samba Dancing.fbx');expect(clips).toHaveLength(1);expect(importedMotion(clips[0])!.reference).toBe('skin-bind');e.installImportedMotions(clips);e.previewMotion(clips[0].uuid);e.seekMotion(240);e.captureMotion();expect(()=>parseDocument(JSON.stringify(e.snapshot()),e.rest)).not.toThrow();}finally{source.dispose();}
  });
});

describe('导入失败、取消、隔离与本地保存',()=>{
  it('跨物种和缺少人体关节的源拒绝，当前动作与姿势保持不变',async()=>{
    const e=fixture(),before=e.snapshot(),s=await parseMotionSource(fbx,'owned.fbx');try{await expect(retargetMixamoMotion(s,FOX_RIG,e.rest,e.bones,assetId,'owned.fbx')).rejects.toThrow('当前骨架');s.scene.getObjectByName('mixamorigLeftForeArm')!.name='missing';await expect(retargetMixamoMotion(s,XBOT_RIG,e.rest,e.bones,assetId,'owned.fbx')).rejects.toThrow('LeftForeArm');expect(e.snapshot()).toEqual(before);}finally{s.dispose();}
  });
  it('损坏文件、无动画、错误格式和超大文件明确拒绝',async()=>{
    await expect(parseMotionSource(new ArrayBuffer(40),'bad.vrm')).rejects.toThrow('FBX');await expect(parseMotionSource(bytes('../public/models/xbot.glb'),'no-animation.glb')).rejects.toThrow('没有动画');await expect(parseMotionSource(new ArrayBuffer(40),'bad.glb')).rejects.toThrow('结构无效');
    const e=fixture();await expect(e.prepareMotionImport({name:'large.fbx',size:33*1024*1024,arrayBuffer:vi.fn()})).rejects.toThrow('32 MB');
  });
  it('临时 GLB 资源销毁幂等，不把源网格带入编辑场景',async()=>{
    const loader=new GLTFLoader(),original=await loader.parseAsync(bytes('../public/models/xbot.glb'),''),scene=original.scene,clip=new AnimationClip('unused',1,[new VectorKeyframeTrack('Hips.position',[0,1],[0,1,0,0,1,0])]);
    original.animations=[clip];const parse=vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValue(original),geometries:ReturnType<typeof vi.spyOn>[]=[];
    scene.traverse(o=>{if('geometry'in o)geometries.push(vi.spyOn((o as any).geometry,'dispose'));});
    try{const source=await parseMotionSource(bytes('../public/models/xbot.glb'),'temporary.glb');source.dispose();source.dispose();for(const g of geometries)expect(g).toHaveBeenCalledOnce();}finally{parse.mockRestore();}
  });
  it('取消采样不改变目标姿势，源控制权释放',async()=>{
    const source=await parseMotionSource(fbx,'owned.fbx'),e=fixture(),before=e.snapshot(),controller=new AbortController();source.clips[0].duration=3;
    const pending=retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'owned.fbx',controller.signal);controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(e.snapshot()).toEqual(before);source.dispose();
  });
  it('源层级错误、变长骨段、缩放动作和超长片段不静默接受',async()=>{
    const source=await parseMotionSource(fbx,'owned.fbx'),e=fixture(),original=source.clips[0];
    try{source.clips=[new AnimationClip('stretch',1,[new VectorKeyframeTrack('mixamorigLeftHand.position',[0,1],[0,0,0,1,0,0])])];await expect(retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'stretch.fbx')).rejects.toThrow('人体关节动作');
      source.clips=[new AnimationClip('scale',1,[new VectorKeyframeTrack('mixamorigHips.scale',[0,1],[1,1,1,2,2,2])])];await expect(retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'scale.fbx')).rejects.toThrow('缩放');source.clips=[original.clone()];source.clips[0].duration=121;await expect(retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'long.fbx')).rejects.toThrow('120 秒');
      source.clips=[original];source.scene.getObjectByName('mixamorigHips')!.add(source.scene.getObjectByName('mixamorigHead')!);await expect(retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'hierarchy.fbx')).rejects.toThrow('层级');
    }finally{source.dispose();}
  });
  it('多个 FBX 网格共享骨骼的同 ID 辅助副本可忽略，独立重复骨架仍拒绝',async()=>{
    const source=await parseMotionSource(fbx,'owned.fbx'),e=fixture(),driver=source.scene.getObjectByName('mixamorigHips')!;
    const first=driver.clone(false),second=driver.clone(false);first.userData={};second.userData={};Object.assign(first,{ID:(driver as any).ID});Object.assign(second,{ID:(driver as any).ID});driver.add(first);first.add(second);
    try{expect((await retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'copies.fbx'))).toHaveLength(1);source.scene.add(driver.clone(false));await expect(retargetMixamoMotion(source,XBOT_RIG,e.rest,e.bones,assetId,'duplicates.fbx')).rejects.toThrow('重复骨架');}finally{source.dispose();}
  });
  it('保存、重新载入和重复导入保留轨道与身份，人体动画不会进入狐狸',async()=>{
    const e=fixture(),clips=await converted(e),asset=packMotionAsset(clips),roundtrip=unpackMotionAsset(JSON.parse(JSON.stringify(asset)),XBOT_RIG,e.rest);expect(roundtrip[0].tracks[0].values).toEqual(clips[0].tracks[0].values);
    e.installImportedMotions(roundtrip);e.installImportedMotions(clips);expect(e.motion!.state().clips).toHaveLength(1);expect(()=>unpackMotionAsset(asset,FOX_RIG,e.rest)).toThrow('不兼容');expect(()=>unpackMotionAsset({...asset,rigVersion:999},XBOT_RIG,e.rest)).toThrow('不兼容');
  });
  it('本地异常轨道、无效四元数和错误适配信息不会绑定到骨架',async()=>{
    const e=fixture(),asset=packMotionAsset(await converted(e));
    const track=structuredClone(asset);track.clips[0].tracks[0].name='unknown.quaternion';expect(()=>unpackMotionAsset(track,XBOT_RIG,e.rest)).toThrow('轨道');
    const bad=structuredClone(asset);bad.clips[0].tracks[0].values[0]=0;bad.clips[0].tracks[0].values[3]=0;expect(()=>unpackMotionAsset(bad,XBOT_RIG,e.rest)).toThrow('旋转');
    const meta=structuredClone(asset);Object.assign(meta.clips[0],{userData:'{}'});expect(()=>unpackMotionAsset(meta,XBOT_RIG,e.rest)).toThrow('适配信息');
  });
});
