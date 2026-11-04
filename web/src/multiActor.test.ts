import {beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {IDBFactory} from 'fake-indexeddb';
import {AnimationClip,Bone,Group,Mesh,Object3D,OrthographicCamera,Quaternion,QuaternionKeyframeTrack,Scene,Texture,Vector3,VectorKeyframeTrack,Euler,SphereGeometry,MeshBasicMaterial} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {PoseEngine} from './PoseEngine';
import {XBOT_RIG,YBOT_RIG,DRAWING_FEMALE_RIG,BASIC_HUMAN_RIG,type RigDefinition} from './rigs';
import {CONTROL_POINT_COLORS,createControlPoint} from './controlPoints';
import {FOX_RIG} from './foxRig';
import {BODYCHAN_RIG,BODYKUN_RIG} from './bodyFigureRigs';
import {DEFAULT_VIEWS,type PoseDocument} from './types';
import {MotionPreview} from './motionPreview';
import {readSceneDocument,sceneFromPose,relocatePose,MAX_ACTORS} from './sceneDocument';
import {defaultCameraSettings} from './cameraState';
import {parseDocument} from './files';
import {HAND_GESTURES} from './handGestures';
import {buildProceduralRig,disposeObject} from './rigGeometry';

const bytes=(path:string)=>Uint8Array.from(readFileSync(new URL(path,import.meta.url))).buffer;
let human:GLTF,fox:GLTF,bodychan:GLTF,bodykun:GLTF,ybot:GLTF,drawing:GLTF;
beforeAll(async()=>{const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURE',loadTexture:async()=>new Texture()}));[human,fox,bodychan,bodykun,ybot,drawing]=await Promise.all(['../public/models/xbot.glb','../public/models/fox/fox.glb','../public/models/body-figures/bodychan.glb','../public/models/body-figures/bodykun.glb','../public/models/ybot.glb','../public/models/drawing-mannequin/drawing-female.glb'].map(path=>loader.parseAsync(bytes(path),'')));});
function fixture(rig:RigDefinition=XBOT_RIG,initialize=true){
  const gltf=rig.id===DRAWING_FEMALE_RIG.id?drawing:rig.id===YBOT_RIG.id?ybot:rig.id===FOX_RIG.id?fox:rig.id===BODYCHAN_RIG.id?bodychan:rig.id===BODYKUN_RIG.id?bodykun:human,model=new Group(),bones:Record<string,Bone>={};model.add(rig.asset.kind==='procedural'?buildProceduralRig(rig).group:clone(gltf.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{rigDefinition:rig,scene:new Scene(),model,bones,gizmo:new Object3D(),helpers:new Group(),boneDisplay:new Group(),handles:[],selected:rig.initialSelection,mode:'translate',display:'surface',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),cameraState:defaultCameraSettings(),name:'Scene',ground:false,fullBody:false,symmetry:{arms:false,legs:false},warning:'',handDetail:null,profile:rig===YBOT_RIG?JSON.parse(readFileSync(new URL('../public/models/ybot-profile.json',import.meta.url),'utf8')):{},appearanceGroups:new Map(),originalMeshes:[],transform:{setMode(){},attach(){},detach(){},enabled:true,showX:true,showY:true,showZ:true},onInfo:vi.fn(),onCommit:vi.fn(),fit(){},update(){},syncGizmo(){},disposed:false,center:new Vector3(0,.8,0),span:2,props:[],actorTransform:false,activeActorId:'',borrowingActor:0});
  e.scene.add(model);for(const end of Object.keys(rig.chains)){e.targets[end]=e.world(end).toArray();if(rig.strategy==='xbot-humanoid')e.poles[end]=[...e.targets[end]];}
  e.rest=e.snapshot();e.motion=new MotionPreview(model,gltf.animations.map(c=>Object.assign(c.clone(),{uuid:c.uuid})));model.traverse(o=>{if(o instanceof Mesh)(e as any).originalMeshes.push(o);});e.ready=true;
  if(initialize)(e as any).initializeActors();e.loadActorRuntime=vi.fn(async target=>fixture(target,false).captureActorRuntime());return e;
}
const actor=(e:PoseEngine,id=e.info().activeActor)=>e.sceneSnapshot().actors.find(a=>a.id===id)!;
const camera=()=>{const c=new OrthographicCamera(-3,3,3,-1,.01,50);c.position.set(0,1,6);c.lookAt(0,1,0);c.updateMatrixWorld();return c;};
function withRealHandles(e:PoseEngine){
  e.handles=e.activeRig.editableJoints.filter(name=>e.bones[name]).map(name=>{const handle=createControlPoint(name,.01);e.helpers.add(handle);return handle;});
  (e as any).update=(PoseEngine.prototype as any).update;(e as any).update(false);return e;
}
function expectHandlesAligned(e:PoseEngine){expect(e.handles.length).toBeGreaterThan(0);for(const h of e.handles)expect(h.getWorldPosition(new Vector3()).distanceTo(e.world(h.userData.part)),h.userData.part).toBeLessThan(1e-9);}
function importedClip(e:PoseEngine){const root=e.rest.joints.Hips.position,id='c'.repeat(64),clip=new AnimationClip('Owned clip',1,[...Object.entries(e.rest.joints).map(([n,j])=>new QuaternionKeyframeTrack(`${n}.quaternion`,[0,1],[...j.quaternion,...j.quaternion])),new VectorKeyframeTrack('Hips.position',[0,1],[...root,...root])]);Object.assign(clip,{uuid:`${XBOT_RIG.id}@1:${id}:0:v1`});clip.userData={momoMotion:{assetId:id,fileName:'owned.fbx',format:'fbx',rig:XBOT_RIG.id,rigVersion:1,adapterVersion:1,sampleRate:30,root:'Hips',rootOrigin:root,mappedBones:20,ignoredTranslations:0,reference:'skin-bind'}};return clip;}

describe('场景 GLB 导出范围与隔离',()=>{
  it('八个同骨架与混合实例在保存恢复后独立导出；隐藏角色不参与，锁定角色保留',async()=>{
    const e=fixture();await e.duplicateActor();await e.addActor(FOX_RIG);await e.addActor(FOX_RIG);await e.addActor(YBOT_RIG);await e.addActor(BODYCHAN_RIG);await e.addActor(BODYKUN_RIG);await e.addActor(XBOT_RIG);
    const ids=e.actorList().map(a=>a.id);e.changeActor(ids[0],{visible:false});e.changeActor(ids[1],{locked:true});const prop=e.addProp('box'),hidden=e.addProp('chair');e.changeProp(hidden,{visible:false});
    const saved=e.sceneSnapshot();await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);const before=e.sceneSnapshot();
    for(const mode of ['static','rigged'] as const){const snapshot=e.snapshotModelExport({mode,scope:'scene'}),actors=snapshot.scene.children.filter(o=>o.userData.actorId);expect(actors).toHaveLength(7);expect(actors.map(o=>o.userData.actorId)).toEqual(ids.slice(1));const props=snapshot.scene.children.find(o=>o.userData.kind==='props')!;expect(props.children.map(o=>o.name)).toEqual([`prop:${prop}`]);snapshot.dispose();}
    expect(e.sceneSnapshot()).toEqual(before);
  });
  it('只导出选中实例时不带其他角色、道具、控制手柄、相机或灯光，骨架显示仍有实体',async()=>{
    const e=fixture();await e.addActor(FOX_RIG);e.addProp('box');e.setDisplay('skeleton');const before=e.sceneSnapshot(),id=e.info().activeActor;
    const snapshot=e.snapshotModelExport({mode:'rigged',scope:'selected'});expect(snapshot.scene.children).toHaveLength(1);expect(snapshot.scene.children[0].userData.actorId).toBe(id);let surfaces=0;snapshot.scene.traverse(o=>{if(o instanceof Mesh)surfaces++;expect((o as any).isCamera).not.toBe(true);expect((o as any).isLight).not.toBe(true);});expect(surfaces).toBeGreaterThan(0);snapshot.dispose();expect(e.sceneSnapshot()).toEqual(before);
    e.changeActor(id!,{visible:false});expect(()=>e.snapshotModelExport({mode:'static',scope:'selected'})).toThrow('pose.modelExportEmpty');
  });
  it('人体与狐狸之间切换骨架后使用各自模型；动画预览须先取姿',async()=>{
    const e=fixture(),original=e.sceneSnapshot();await e.replaceActorRig(FOX_RIG);e.previewMotion(e.motion!.state().clips[0].id);expect(()=>e.snapshotModelExport({mode:'rigged',scope:'scene'})).toThrow('pose.previewNotice');e.cancelMotion();const snapshot=e.snapshotModelExport({mode:'static',scope:'selected'});expect(snapshot.scene.children[0].userData.rig).toBe(FOX_RIG.id);snapshot.dispose();await e.replaceActorRig(XBOT_RIG);expect(e.sceneSnapshot().actors[0].pose.joints).toEqual(original.actors[0].pose.joints);
  });
});

describe('独立场景角色与原控制器',()=>{
  for(const rig of [XBOT_RIG,YBOT_RIG,FOX_RIG,BODYCHAN_RIG,BODYKUN_RIG,BASIC_HUMAN_RIG])it(`${rig.id}控制点按实际移动能力着色，选中保留类型颜色并显示独立外圈`,()=>{
    const e=withRealHandles(fixture(rig)),before=e.sceneSnapshot();
    for(const handle of e.handles){const name=handle.userData.part,kind=e.canTranslate(name)?'move':'rotate';expect(e.controlPointKind(name)).toBe(kind);expect((handle.material as MeshBasicMaterial).color.getHexString()).toBe(CONTROL_POINT_COLORS[kind].slice(1));expect(handle.getObjectByName('selection-halo')!.visible).toBe(name===e.selected);}
    const rotate=e.handles.find(h=>!e.canTranslate(h.userData.part))!;e.select(rotate.userData.part);expect(e.info().controlKind).toBe('rotate');expect((rotate.material as MeshBasicMaterial).color.getHexString()).toBe(CONTROL_POINT_COLORS.rotate.slice(1));expect(rotate.getObjectByName('selection-halo')!.visible).toBe(true);expect(rotate.scale.x).toBe(1.4);
    e.select(rig.root);expect(e.info().controlKind).toBe('move');const root=e.handles.find(h=>h.userData.part===rig.root)!;expect((root.material as MeshBasicMaterial).color.getHexString()).toBe(CONTROL_POINT_COLORS.move.slice(1));expect(rotate.getObjectByName('selection-halo')!.visible).toBe(false);
    expect(e.sceneSnapshot().actors.map(a=>a.pose.joints)).toEqual(before.actors.map(a=>a.pose.joints));
  });
  it('同骨架和狐狸混合实例的固定颜色独立，解除固定及工程恢复重新读取实际能力',async()=>{
    const e=withRealHandles(fixture()),first=e.info().activeActor!;e.loadActorRuntime=vi.fn(async rig=>withRealHandles(fixture(rig,false)).captureActorRuntime());
    e.select('LeftHand');e.setPin(true);expect(e.info().controlKind).toBe('fixed');let hand=e.handles.find(h=>h.userData.part==='LeftHand')!;expect((hand.material as MeshBasicMaterial).color.getHexString()).toBe(CONTROL_POINT_COLORS.fixed.slice(1));
    await e.duplicateActor();e.setPin(false);expect(e.info().controlKind).toBe('move');e.selectActor(first);expect(e.controlPointKind('LeftHand')).toBe('fixed');
    await e.addActor(FOX_RIG);e.select('b_LeftHand_011');expect(e.info().controlKind).toBe('move');e.setPin(true);expect(e.info().controlKind).toBe('fixed');const saved=e.sceneSnapshot();
    await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);expect(e.sceneSnapshot()).toEqual(saved);expect(e.info().controlKind).toBe('fixed');e.selectActor(first);hand=e.handles.find(h=>h.userData.part==='LeftHand')!;expect((hand.material as MeshBasicMaterial).color.getHexString()).toBe(CONTROL_POINT_COLORS.fixed.slice(1));
    e.select('LeftHand');e.setPin(false);expect(e.info().controlKind).toBe('move');expect((hand.material as MeshBasicMaterial).color.getHexString()).toBe(CONTROL_POINT_COLORS.move.slice(1));
  });
  it('八角色混合场景共用独立投影的五视图，换骨架与工程恢复保留相机和其他角色',async()=>{
    const e=fixture();e.view='free';await e.duplicateActor();for(const rig of [FOX_RIG,FOX_RIG,YBOT_RIG,BODYCHAN_RIG,BODYKUN_RIG,XBOT_RIG])await e.addActor(rig);
    e.setViewProjection('oblique','perspective');e.setViewFov('oblique',48);e.setViewZoom('side',1.2);e.setFramingLock(true);
    const saved=e.sceneSnapshot(),poses=saved.actors.map(a=>a.pose),views=structuredClone(e.views);
    const selected=e.info().activeActor!;await e.replaceActorRig(FOX_RIG);expect(e.views).toEqual(views);expect(e.sceneSnapshot().actors.filter(a=>a.id!==selected).map(a=>a.pose)).toEqual(saved.actors.filter(a=>a.id!==selected).map(a=>a.pose));
    await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);expect(e.sceneSnapshot()).toEqual(saved);expect(e.sceneSnapshot().actors.map(a=>a.pose)).toEqual(poses);
    for(const slot of e.views){const camera=e.viewCamera(slot,.75),joints=e.sceneJoints(camera,768,1024);expect(joints.actors).toHaveLength(8);expect(e.openPose(camera,768,1024,false).people).toHaveLength(4);expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);}
    expect(e.sceneSnapshot()).toEqual(saved);
  });
  it('原创绘画素体左右手势可读回，改良头顶标记可恢复早期原型姿态',()=>{
    const e=fixture(DRAWING_FEMALE_RIG);for(const side of ['Left','Right'] as const)for(const g of HAND_GESTURES){const wrist=e.world(side+'Hand');e.applyHandGesture(side,g.values,g.name);expect(e.world(side+'Hand').distanceTo(wrist)).toBeLessThan(1e-9);const values=e.captureHand(side);for(const digit of Object.keys(g.values) as (keyof typeof g.values)[])for(let j=0;j<3;j++)expect(values[digit].curl[j]).toBeCloseTo(g.values[digit].curl[j],3);}
    const legacy=e.snapshot();delete legacy.rigCalibrationVersion;legacy.joints.HeadTop_End.position=[0,.24,0];const saved=structuredClone(legacy);e.apply(parseDocument(JSON.stringify(legacy),e.rest));expect(e.bones.HeadTop_End.position.toArray()).toEqual(e.rest.joints.HeadTop_End.position);expect(e.snapshot().rigCalibrationVersion).toBe(2);legacy.rigCalibrationVersion=1;expect(()=>parseDocument(JSON.stringify(legacy),e.rest)).not.toThrow();legacy.rigCalibrationVersion=99;expect(()=>parseDocument(JSON.stringify(legacy),e.rest)).toThrow();for(const n of Object.keys(e.bones))if(n!=='HeadTop_End'){const actual=e.snapshot().joints[n];expect(actual.position).toEqual(saved.joints[n].position);actual.quaternion.forEach((q,i)=>expect(q).toBeCloseTo(saved.joints[n].quaternion[i],12));}
  });
  it('原创绘画素体支持人体编辑、独立同骨架实例、八角色混合、骨架切回、场景恢复和多人导出',async()=>{
    const e=withRealHandles(fixture(DRAWING_FEMALE_RIG));expect(e.humanoid).toBe(true);expect(Object.keys(e.bones)).toHaveLength(66);expect(e.footContactInfo()).toEqual({});
    const first=e.info().activeActor!;e.applyPreset(DRAWING_FEMALE_RIG.presets.find(p=>p.id==='wave')!);e.applyHandGesture('Left',HAND_GESTURES.find(g=>g.id==='fist')!.values);e.setFeetPin(true);e.select('Hips');const anchors=['LeftFoot','RightFoot'].map(n=>e.world(n));e.setSelectedPosition(1,e.world('Hips').y-.05);for(let i=0;i<2;i++)expect(e.world(['LeftFoot','RightFoot'][i]).distanceTo(anchors[i])).toBeLessThan(.003);expectHandlesAligned(e);
    const original=actor(e);await e.duplicateActor();const second=e.info().activeActor!;e.setFeetPin(false);e.applyPreset(DRAWING_FEMALE_RIG.presets.find(p=>p.id==='sit')!);expect(actor(e,first)).toEqual({...original,pose:{...original.pose,name:e.name}});
    const pose=e.snapshot();await e.replaceActorRig(FOX_RIG);await e.replaceActorRig(DRAWING_FEMALE_RIG);expect(e.snapshot().joints).toEqual(pose.joints);
    await e.addActor(XBOT_RIG);await e.addActor(YBOT_RIG);await e.addActor(FOX_RIG);await e.addActor(BODYCHAN_RIG);await e.addActor(BODYKUN_RIG);await e.addActor(XBOT_RIG);const saved=e.sceneSnapshot();expect(saved.actors).toHaveLength(8);await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);expect(e.sceneSnapshot()).toEqual(saved);expect(e.sceneJoints(camera(),512,512).actors).toHaveLength(8);expect(e.openPose(camera(),512,512,false).people).toHaveLength(5);e.selectActor(second);expect(e.snapshot().joints).toEqual(pose.joints);
  });
  it('旧膝轴的男女同骨架多实例在八角色混合场景中独立校准、保存恢复及多人关节导出',async()=>{
    const e=fixture(BODYCHAN_RIG);e.applyPreset(BODYCHAN_RIG.presets.find(p=>p.id==='run')!);await e.duplicateActor();e.applyPreset(BODYCHAN_RIG.presets.find(p=>p.id==='sit')!);
    await e.addActor(BODYKUN_RIG);e.applyPreset(BODYKUN_RIG.presets.find(p=>p.id==='squat')!);await e.duplicateActor();e.applyPreset(BODYKUN_RIG.presets.find(p=>p.id==='lunge')!);
    await e.addActor(XBOT_RIG);await e.duplicateActor();await e.addActor(YBOT_RIG);await e.addActor(FOX_RIG);
    const legacy=e.sceneSnapshot(),feet=new Map<string,Record<string,Vector3>>();
    for(const actor of legacy.actors){const rig=actor.pose.rig===BODYCHAN_RIG.id?BODYCHAN_RIG:actor.pose.rig===BODYKUN_RIG.id?BODYKUN_RIG:undefined;if(!rig)continue;
      delete actor.pose.rigCalibrationVersion;for(const[n,p]of Object.entries(rig.calibration!.legacyPositions))actor.pose.joints[n].position=[...p];
      const original=fixture(rig,false);(original as any).restorePose(actor.pose);original.model.updateMatrixWorld(true);
      feet.set(actor.id,Object.fromEntries(rig.supportContacts!.map(end=>[end,original.world(end)])));
      for(const end of rig.contacts)actor.pose.targets[end]=original.world(end).toArray();
      for(const end of rig.supportContacts!)actor.pose.pins[end]={position:original.world(end).toArray(),quaternion:original.bones[end].getWorldQuaternion(new Quaternion()).toArray(),orientation:true};
    }
    const before=JSON.stringify(legacy);await e.restoreScene(readSceneDocument(before),{},false);expect(JSON.stringify(legacy)).toBe(before);const saved=e.sceneSnapshot();expect(saved.actors).toHaveLength(8);
    for(const a of saved.actors){const old=legacy.actors.find(b=>b.id===a.id)!;if(!feet.has(a.id)){expect(a).toEqual(old);continue;}e.selectActor(a.id);expect(a.pose.rigCalibrationVersion).toBe(1);expect(a.pose.pins).toEqual(old.pose.pins);for(const[end,goal]of Object.entries(feet.get(a.id)!))expect(e.world(end).distanceTo(goal)).toBeLessThan(1e-6);}
    e.selectActor(saved.activeActor);expect(e.sceneJoints(camera(),512,512).actors).toHaveLength(8);expect(e.openPose(camera(),512,512,false).people).toHaveLength(3);
    await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);expect(e.sceneSnapshot()).toEqual(saved);
  });
  for(const rig of [BODYCHAN_RIG,BODYKUN_RIG])it(`${rig.id}动作、手势、肘膝和结构线在同骨架实例及混合场景中独立恢复`,async()=>{
    const e=withRealHandles(fixture(rig)),first=e.info().activeActor!;e.applyPreset(rig.presets.find(p=>p.id==='wave')!);e.applyHandGesture('Right',HAND_GESTURES[1].values,'握拳');e.select('left_hand');e.setPin(true,true);
    const direction=e.bendDirection('left_hand')!;expect(e.setBendDirection('left_hand',direction.angle*180/Math.PI+20)).toBe(true);const firstPose=actor(e).pose;
    await e.duplicateActor();const second=e.info().activeActor!;e.applyPreset(rig.presets.find(p=>p.id==='sit')!);e.applyHandGesture('Left',HAND_GESTURES[4].values,'V 手势');expect(actor(e,first).pose).toEqual({...firstPose,name:e.name});
    const others=e.sceneSnapshot().actors.filter(a=>a.id!==second);await e.replaceActorRig(FOX_RIG);expect(e.activeRig.capabilities.hands).toBe(false);expect(e.activeRig.bendControls).toBeUndefined();await e.replaceActorRig(rig);expect(e.hands.Left).toBe('V 手势');expect(e.sceneSnapshot().actors.filter(a=>a.id!==second)).toEqual(others);
    await e.addActor(rig===BODYCHAN_RIG?BODYKUN_RIG:BODYCHAN_RIG);await e.addActor(FOX_RIG);await e.addActor(XBOT_RIG);e.camera=camera();e.setConstructionGuides(true);e.setLineWidth(2);const saved=JSON.parse(JSON.stringify(e.sceneSnapshot()));expect(saved.camera.lineArt).toEqual({constructionGuides:true,lineWidth:2});
    await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);expect(JSON.parse(JSON.stringify(e.sceneSnapshot()))).toEqual(saved);expect(e.sceneJoints(camera(),512,512).actors).toHaveLength(5);expect(e.openPose(camera(),512,512,false).people).toHaveLength(1);
    e.selectActor(first);expect(e.snapshot().pins).toEqual(firstPose.pins);expect(e.hands.Right).toBe('握拳');e.selectActor(second);expect(e.hands.Left).toBe('V 手势');expect(e.hasDrawingGuideActors()).toBe(true);
  });
  for(const rig of [XBOT_RIG,YBOT_RIG])it(`${rig.id}新增肘膝滑条保留固定末端及其他肢体，超限拒绝不滑动`,()=>{
    const e=fixture(rig);e.applyPreset(rig.presets[0]);let changed=0;
    for(const end of rig.contacts){
      e.select(end);e.setSelectedPosition(1,e.world(end).y+.08);e.setPin(true,true);const point=e.world(end),orientation=e.bones[end].getWorldQuaternion(new Quaternion()),frame=e.bendDirection(end)!;
      for(const offset of [5,-5,150]){const before=e.snapshot(),ok=e.setBendDirection(end,frame.angle*180/Math.PI+offset);if(ok)changed++;else expect(e.snapshot()).toEqual(before);expect(e.world(end).distanceTo(point)).toBeLessThan(.0005);expect(e.bones[end].getWorldQuaternion(new Quaternion()).angleTo(orientation)).toBeLessThan(.001);}
      e.setPin(false);
    }
    expect(changed).toBeGreaterThan(0);
    e.applyPreset(rig.presets[0]);e.setSymmetry('arms',true);const hands=['LeftHand','RightHand'];
    for(const end of hands){e.select(end);e.setPin(true,true);}const anchors=hands.map(end=>e.world(end)),angle=e.bendDirection('LeftHand')!.angle*180/Math.PI;
    const symmetric=e.setBendDirection('LeftHand',angle+1)||e.setBendDirection('LeftHand',angle-1);expect(symmetric).toBe(true);for(let i=0;i<hands.length;i++)expect(e.world(hands[i]).distanceTo(anchors[i])).toBeLessThan(.0005);
  });
  it('Y Bot 独立比例下的手部 IK、手势、固定、预设与多人恢复/切换',async()=>{
    const e=withRealHandles(fixture(YBOT_RIG));e.setFullBody(true);expect(e.humanoid).toBe(true);expect(Object.keys(e.bones)).toHaveLength(66);expect(e.footContactInfo()).toEqual({});
    const finger=e.world('LeftIndex4'),right=e.world('RightIndex4');e.applyHandGesture('Left',HAND_GESTURES.find(g=>g.id==='fist')!.values);expect(e.world('LeftIndex4').distanceTo(finger)).toBeGreaterThan(.015);expect(e.world('RightIndex4').distanceTo(right)).toBeLessThan(1e-7);
    e.select('LeftHand');const hand=e.world('LeftHand');e.setSelectedPosition(1,hand.y+.06);expect(e.world('LeftHand').y-hand.y).toBeGreaterThan(.04);expectHandlesAligned(e);
    e.setFeetPin(true);e.select('Hips');const feet=['LeftFoot','RightFoot'].map(n=>e.world(n));e.setSelectedPosition(1,e.world('Hips').y-.05);for(let i=0;i<2;i++)expect(e.world(['LeftFoot','RightFoot'][i]).distanceTo(feet[i])).toBeLessThan(.01);
    e.applyPreset(YBOT_RIG.presets.find(p=>p.id==='neutral')!);expect(Object.values(e.snapshot().joints).every(j=>j.quaternion.every(Number.isFinite))).toBe(true);const first=e.info().activeActor!,pose=JSON.parse(JSON.stringify(e.snapshot()));
    await e.duplicateActor();e.select('Head');e.setSelectedRotation(1,20);expect(actor(e,first).pose.joints).toEqual(pose.joints);await e.addActor(XBOT_RIG);await e.addActor(FOX_RIG);await e.addActor(BODYCHAN_RIG);
    expect(e.openPose(camera(),512,512,false).people).toHaveLength(3);expect(e.sceneJoints(camera(),512,512).actors).toHaveLength(5);
    const doc=JSON.parse(JSON.stringify(e.sceneSnapshot()));await e.restoreScene(readSceneDocument(JSON.stringify(doc)),{},false);expect(JSON.parse(JSON.stringify(e.sceneSnapshot()))).toEqual(doc);
    e.selectActor(first);const other=e.sceneSnapshot().actors.filter(a=>a.id!==first);await e.replaceActorRig(FOX_RIG);await e.replaceActorRig(YBOT_RIG);expect(e.snapshot().joints).toEqual(pose.joints);expect(e.sceneSnapshot().actors.filter(a=>a.id!==first)).toEqual(other);
  });

  for(const rig of [BODYCHAN_RIG,BODYKUN_RIG])it(`${rig.id}真实网格 IK/FK、固定、多实例、四种骨架混合、保存恢复与关节导出独立`,async()=>{
    const e=withRealHandles(fixture(rig)),first=e.info().activeActor!,lengths=Object.fromEntries(Object.entries(e.bones).map(([n,b])=>[n,b.position.length()]));
    expect(Object.keys(e.bones)).toHaveLength(53);expectHandlesAligned(e);const hand=e.world('left_hand');
    e.select('left_forearm');e.setSelectedRotation(0,60);expect(e.world('left_hand').distanceTo(hand)).toBeGreaterThan(.03);expect(e.canTranslate()).toBe(false);
    for(const [n,b]of Object.entries(e.bones))expect(b.position.length()).toBeCloseTo(lengths[n],10);
    e.select('left_hand');const y=e.world('left_hand').y;e.setSelectedPosition(1,y+.08);expect(e.world('left_hand').y-y).toBeGreaterThan(.07);
    e.setFeetPin(true);e.select('pelvis');e.setSelectedPosition(1,e.world('pelvis').y-.04);for(const [n,p]of Object.entries(e.pins))expect(e.world(n).distanceTo(new Vector3().fromArray(p!.position))).toBeLessThan(.0015);expectHandlesAligned(e);
    const pose=e.snapshot();expect(parseDocument(JSON.stringify(pose),e.rest,rig).joints).toEqual(JSON.parse(JSON.stringify(pose.joints)));
    const original=actor(e);await e.duplicateActor();const duplicate=e.info().activeActor!;e.select('left_forearm');e.setSelectedRotation(0,20);expect(actor(e,first)).toEqual(original);expect(e.bones.left_forearm).not.toBe((e as any).actors.get(first).state.bones.left_forearm);
    await e.addActor(rig===BODYCHAN_RIG?BODYKUN_RIG:BODYCHAN_RIG);await e.addActor(FOX_RIG);await e.addActor(XBOT_RIG);
    expect(e.openPose(camera(),512,512,false).people).toHaveLength(1);expect(e.sceneJoints(camera(),512,512).actors).toHaveLength(5);
    const saved=JSON.parse(JSON.stringify(e.sceneSnapshot()));await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);expect(JSON.parse(JSON.stringify(e.sceneSnapshot()))).toEqual(saved);
    e.selectActor(duplicate);const others=e.sceneSnapshot().actors.filter(a=>a.id!==duplicate),before=e.snapshot();await e.replaceActorRig(FOX_RIG);await e.replaceActorRig(rig);expect(e.snapshot().joints).toEqual(before.joints);expect(e.sceneSnapshot().actors.filter(a=>a.id!==duplicate)).toEqual(others);
  });

  it('线稿显示切换不改动同骨架多实例或混合角色，线宽属于共享场景并可恢复',async()=>{
    const e=fixture();await e.duplicateActor();await e.addActor(FOX_RIG);e.camera=camera();const actors=e.sceneSnapshot().actors;
    for(const mode of ['lineart','skeleton','surface','lineart'] as const){e.setDisplay(mode);expect(e.sceneSnapshot().actors).toEqual(actors);for(const a of (e as any).actors.values())expect(a.state.model.visible).toBe(mode!=='skeleton');}
    e.setLineWidth(2);const saved=e.sceneSnapshot();expect(saved.camera?.lineArt?.lineWidth).toBe(2);
    await e.restoreScene(readSceneDocument(JSON.stringify(saved)),{},false);expect(e.sceneSnapshot()).toEqual(saved);expect(e.display).toBe('lineart');
    e.openPose(camera(),512,512,false);e.sceneJoints(camera(),512,512);expect(e.sceneSnapshot()).toEqual(saved);
    const first=e.info().actors![0].id;e.selectActor(first);const others=e.sceneSnapshot().actors.filter(a=>a.id!==first);await e.replaceActorRig(FOX_RIG);await e.replaceActorRig(XBOT_RIG);expect(e.sceneSnapshot().actors.filter(a=>a.id!==first)).toEqual(others);expect(e.getCameraSettings().lineArt?.lineWidth).toBe(2);
  });

  it('同种多实例与人体狐狸混合场景共用顶视/底视，保存恢复及多人导出保持姿势独立',async()=>{
    const e=fixture();await e.duplicateActor();await e.addActor(FOX_RIG);const bodies=e.sceneSnapshot().actors;
    e.setViewDirection('high','top');e.setViewDirection('low','bottom');const before=e.sceneSnapshot();expect(before.actors).toEqual(bodies);
    await e.restoreScene(readSceneDocument(JSON.stringify(before)),{},false);expect(e.sceneSnapshot()).toEqual(before);
    for(const slot of [e.views[3],e.views[4]]){const camera=e.viewCamera(slot,1);expect(Math.abs(camera.getWorldDirection(new Vector3()).y)).toBeCloseTo(1,12);expect(e.openPose(camera,512,512,false).people).toHaveLength(2);expect(e.sceneJoints(camera,512,512).actors).toHaveLength(3);}
    expect(e.sceneSnapshot()).toEqual(before);
  });
  for(const rig of [XBOT_RIG,FOX_RIG,BODYCHAN_RIG,BODYKUN_RIG])it(`${rig.id}固定末端禁止拖动和数值移动；方向固定禁止旋转，解除后恢复且无空历史`,async()=>{
    const e=withRealHandles(fixture(rig)),end=(rig.supportContacts??rig.contacts)[0];(e as any).syncGizmo=(PoseEngine.prototype as any).syncGizmo;
    e.transform.attach=vi.fn();e.transform.detach=vi.fn();e.setFeetPin(true);e.select(end);if(!e.pins[end]!.orientation)e.setPin(true,true);
    const before=e.snapshot();vi.mocked(e.onCommit).mockClear();expect(e.canTranslate()).toBe(false);expect(e.canRotateAxis(0)).toBe(false);expect(e.transform.enabled).toBe(false);
    for(const mode of ['translate','rotate'] as const){e.mode=mode;(e as any).beginPoseDrag();e.gizmo.position.y+=.07;e.gizmo.quaternion.setFromAxisAngle(new Vector3(1,0,0),.3);expect((e as any).manipulate()).toBe(false);(e as any).finishPoseDrag();expect(e.snapshot()).toEqual(before);}
    e.setSelectedPosition(1,e.world(end).y+.07);e.setSelectedRotation(0,30);e.resetSelected();expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    e.setPin(false);expect(e.canTranslate()).toBe(true);expect(e.info().fixedContacts).toBe((rig.supportContacts??rig.contacts).length-1);e.setMode('translate');expect(e.transform.enabled).toBe(true);vi.mocked(e.onCommit).mockClear();
    const y=e.world(end).y;e.setSelectedPosition(1,y+.04);expect(e.world(end).y-y).toBeGreaterThan(.035);expect(e.onCommit).toHaveBeenCalledOnce();
    const first=e.info().activeActor!,firstPose=actor(e).pose;await e.duplicateActor();e.setFeetPin(false);expect(actor(e,first).pose).toEqual(firstPose);
    await e.addActor(rig===XBOT_RIG?FOX_RIG:XBOT_RIG);e.setFeetPin(true);const scene=e.sceneSnapshot();await e.restoreScene(readSceneDocument(JSON.stringify(scene)),{},false);expect(e.sceneSnapshot()).toEqual(scene);
    e.selectActor(first);e.select((rig.supportContacts??rig.contacts)[1]);expect(e.canTranslate()).toBe(false);const saved=e.sceneSnapshot();e.setSelectedPosition(1,e.world(e.selected).y+.1);expect(e.sceneSnapshot()).toEqual(saved);e.openPose(camera(),512,512,false);e.sceneJoints(camera(),512,512);expect(e.sceneSnapshot()).toEqual(saved);
  });
  it('平脚、前掌和自由模式接入真实骨骼；改变骨盆仍保持两处脚底支撑',()=>{
    const e=withRealHandles(fixture());e.applyPreset(XBOT_RIG.presets.find(p=>p.id==='neutral')??XBOT_RIG.presets[0]);
    e.setFootContact('LeftFoot','flat');e.setFootContact('RightFoot','ball',35);
    let contacts=e.footContactInfo();expect(contacts.LeftFoot.mode).toBe('flat');expect(contacts.RightFoot.mode).toBe('ball');
    expect(Math.abs(contacts.LeftFoot.heel[1])).toBeLessThan(.002);expect(Math.abs(contacts.LeftFoot.ball[1])).toBeLessThan(.002);
    expect(contacts.RightFoot.heel[1]).toBeGreaterThan(.06);expect(Math.abs(contacts.RightFoot.ball[1])).toBeLessThan(.002);
    const boneLengths=Object.fromEntries(Object.entries(e.bones).filter(([n])=>n!=='Hips').map(([n,b])=>[n,b.position.toArray()])),root=e.snapshot().root,pins=structuredClone(e.pins);
    e.select('Hips');e.setSelectedPosition(1,e.world('Hips').y-.12);contacts=e.footContactInfo();
    expect(contacts.LeftFoot.error).toBeLessThan(.002);expect(contacts.RightFoot.error).toBeLessThan(.002);expect(e.pins).toEqual(pins);expect(e.snapshot().root).toEqual(root);
    for(const[n,p]of Object.entries(boneLengths))expect(e.bones[n].position.toArray()).toEqual(p);
    for(const end of ['LeftFoot','RightFoot'])expect(e.bones[XBOT_RIG.soles![end].toe].getWorldQuaternion(new Quaternion()).angleTo(new Quaternion())).toBeLessThan(.001);
    const before=e.snapshot();e.select('RightFoot');e.setSelectedPosition(0,.7);e.setSelectedRotation(0,15);e.setToeBend('Right',20);expect(e.snapshot().joints).toEqual(before.joints);expect(e.warning).toContain('自由');
    e.setFootContact('RightFoot','free');expect(e.pins.RightFoot).toBeUndefined();expect(e.footContactInfo().LeftFoot.mode).toBe('flat');
  });
  it('抬跟角度绕前掌连续变化且不可达落地保留原姿势',()=>{
    const e=fixture();e.setFootContact('LeftFoot','ball',15);const anchor=e.footContactInfo().LeftFoot.ball;
    for(const angle of [25,35,45,20]){e.setFootContact('LeftFoot','ball',angle);const s=e.footContactInfo().LeftFoot;expect(s.mode).toBe('ball');expect(s.error).toBeLessThan(.002);expect(new Vector3().fromArray(s.ball).distanceTo(new Vector3().fromArray(anchor))).toBeLessThan(.002);}
    e.setFootContact('LeftFoot','flat');expect(e.footContactInfo().LeftFoot.error).toBeLessThan(.002);
    e.setFootContact('LeftFoot','free');e.moveActor([0,2,0],0);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();e.setFootContact('LeftFoot','flat');expect(e.snapshot()).toEqual(before);expect(e.warning).toContain('无法到达');expect(e.onCommit).not.toHaveBeenCalled();
  });
  for(const name of ['深蹲','弓步','单膝跪'])it(`${name}按可达范围保持脚底接触或明确拒绝，不改变骨长`,()=>{
    const e=fixture(),preset=XBOT_RIG.presets.find(p=>p.name===name)!;e.applyPreset(preset);e.setFootContact('LeftFoot','flat');
    expect(e.footContactInfo().LeftFoot.mode).toBe('flat');e.select('Hips');e.setSelectedPosition(0,e.world('Hips').x+.02);expect(e.footContactInfo().LeftFoot.error).toBeLessThan(.002);
    const before=e.snapshot();e.setSelectedPosition(1,2.5);expect(e.footContactInfo().LeftFoot.error).toBeLessThan(.002);for(const[n,b]of Object.entries(before.joints))if(n!=='Hips')expect(e.snapshot().joints[n].position).toEqual(b.position);
  });
  it('接触模式按实例及骨架独立，场景往返/切回/导出不丢失；旧工程仍兼容',async()=>{
    const e=withRealHandles(fixture()),first=e.info().activeActor!;e.setFootContact('LeftFoot','flat');const firstPose=e.snapshot();
    e.loadActorRuntime=vi.fn(async rig=>withRealHandles(fixture(rig,false)).captureActorRuntime());
    await e.duplicateActor();const second=e.info().activeActor!;e.setFootContact('LeftFoot','ball',30);expect(actor(e,first).pose.pins).toEqual(firstPose.pins);
    await e.addActor(FOX_RIG);const foxBefore=e.snapshot();e.setFootContact('LeftFoot','flat');expect(e.snapshot()).toEqual(foxBefore);expect(e.footContactInfo()).toEqual({});
    const before=e.sceneSnapshot();await e.restoreScene(readSceneDocument(JSON.stringify(before)),{},false);expect(e.sceneSnapshot()).toEqual(before);
    e.selectActor(first);expect(e.footContactInfo().LeftFoot.mode).toBe('flat');e.selectActor(second);expect(e.footContactInfo().LeftFoot.mode).toBe('ball');
    const exported=e.sceneSnapshot();e.openPose(camera(),512,512,false);e.sceneJoints(camera(),512,512);expect(e.sceneSnapshot()).toEqual(exported);expectHandlesAligned(e);
    const saved=e.snapshot();expect(parseDocument(JSON.stringify(saved),e.rest).pins).toEqual(saved.pins);
    const others=e.sceneSnapshot().actors.filter(a=>a.id!==second);await e.replaceActorRig(FOX_RIG);expect(e.footContactInfo()).toEqual({});await e.replaceActorRig(XBOT_RIG);expect(e.snapshot().pins).toEqual(saved.pins);expect(e.sceneSnapshot().actors.filter(a=>a.id!==second)).toEqual(others);
    const bad=structuredClone(saved);bad.pins.LeftFoot!.sole!.angle=70;expect(()=>parseDocument(JSON.stringify(bad),e.rest)).toThrow('脚底接触');
    delete saved.pins.LeftFoot!.sole;expect(()=>parseDocument(JSON.stringify(saved),e.rest)).not.toThrow();
  });
  it('真实蒙皮脚底在平脚/踮脚下不穿地，全身联动和连续返回不积累接触漂移',()=>{
    const e=fixture();e.ground=true;e.fullBody=true;
    const samples:{mesh:Mesh;indices:number[]}[]=[];
    e.model.traverse(o=>{if(!(o instanceof Mesh)||!('skeleton' in o))return;const mesh=o as import('three').SkinnedMesh;mesh.skeleton.update();const indices:number[]=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++){const p=mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);if(p.y<.008)indices.push(i);}if(indices.length)samples.push({mesh,indices});});
    expect(samples.flatMap(s=>s.indices).length).toBeGreaterThan(100);
    e.setFootContact('LeftFoot','flat');e.setFootContact('RightFoot','ball',35);
    e.select('Hips');const baseline=e.snapshot(),origin=e.world('Hips').clone();
    for(const delta of [[.03,-.08,0],[-.03,-.13,.03],[0,0,0]]){(e as any).dragBefore=baseline;e.gizmo.position.copy(origin).add(new Vector3().fromArray(delta));(e as any).manipulate();expect(e.footContactInfo().LeftFoot.error).toBeLessThan(.002);expect(e.footContactInfo().RightFoot.error).toBeLessThan(.002);}
    (e as any).dragBefore=null;
    for(const angle of [0,15,30,45,35]){e.setFootContact('RightFoot','ball',angle);expect(e.footContactInfo().RightFoot.angle).toBe(angle);for(const s of samples){const mesh=s.mesh as import('three').SkinnedMesh;mesh.skeleton.update();const min=Math.min(...s.indices.map(i=>mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld).y));expect(min,`angle ${angle}`).toBeGreaterThan(-.003);}}
  });
  for(const rig of [XBOT_RIG,FOX_RIG])it(`${rig.id}采集预设缩略图及失败恢复后，真实控制点仍与关节世界位置一致`,()=>{
    const e=withRealHandles(fixture(rig));e.moveActor([1,.25,-.5],35);e.applyPreset(rig.presets[rig.presets.length-1]);const before=e.sceneSnapshot();expectHandlesAligned(e);
    e.renderImage=vi.fn(()=>({toDataURL:()=> 'preview'} as unknown as HTMLCanvasElement));e.presetThumbnails();expect(e.sceneSnapshot()).toEqual(before);expectHandlesAligned(e);
    e.renderImage=vi.fn(()=>{throw new Error('preview failed');});expect(()=>e.presetThumbnails()).toThrow('preview failed');expect(e.sceneSnapshot()).toEqual(before);expectHandlesAligned(e);
  });
  it('多人恢复、切换、扶正与骨架/通用数据导出均保持当前角色控制点对齐',async()=>{
    const e=withRealHandles(fixture()),first=e.info().activeActor!;
    e.loadActorRuntime=vi.fn(async rig=>withRealHandles(fixture(rig,false)).captureActorRuntime());
    await e.duplicateActor();await e.addActor(FOX_RIG);const doc=e.sceneSnapshot();
    for(const a of doc.actors){e.selectActor(a.id);e.moveActor([.6,.1,-.2],30);expectHandlesAligned(e);}
    e.selectActor(first);const before=e.sceneSnapshot();await e.restoreScene(before,{},false);expectHandlesAligned(e);
    e.openPose(camera(),512,512,false);e.sceneJoints(camera(),512,512);expectHandlesAligned(e);expect(e.sceneSnapshot()).toEqual(before);
  });
  for(const rig of [XBOT_RIG,FOX_RIG,BASIC_HUMAN_RIG])it(`${rig.id}扶正只清除选中实例整体倾斜，保留关节、朝向和世界固定关系`,async()=>{
    const e=fixture(rig),selected=e.info().activeActor!,contact=rig.contacts[0];e.select(contact);e.setPin(true,true);
    const tilted=relocatePose(e.snapshot(),{position:[1.5,.3,-.8],quaternion:new Quaternion().setFromEuler(new Euler(.2,.4,-.55,'YXZ')).toArray()});(e as any).restorePose(tilted);
    await e.duplicateActor();await e.addActor(rig===FOX_RIG?XBOT_RIG:FOX_RIG);e.selectActor(selected);
    const before=e.sceneSnapshot(),summary=e.actorList().find(a=>a.id===selected)!;expect(Math.abs(summary.rotation[2])).toBeGreaterThan(20);vi.mocked(e.onCommit).mockClear();
    e.moveActor(summary.position,summary.rotation[1]);const after=e.sceneSnapshot(),upright=e.actorList().find(a=>a.id===selected)!;
    expect(upright.rotation[0]).toBeCloseTo(0);expect(upright.rotation[2]).toBeCloseTo(0);expect(upright.rotation[1]).toBeCloseTo(summary.rotation[1]);expect(upright.position).toEqual(summary.position);
    expect(e.snapshot().joints).toEqual(tilted.joints);expect(e.snapshot().pins).toEqual(relocatePose(tilted,e.snapshot().root).pins);expect(e.onCommit).toHaveBeenCalledOnce();
    for(const a of before.actors)if(a.id!==selected)expect(after.actors.find(b=>b.id===a.id)).toEqual(a);
    await e.restoreScene(before,{},false);expect(e.sceneSnapshot()).toEqual(before);await e.restoreScene(readSceneDocument(JSON.stringify(after)),{},false);expect(e.sceneSnapshot()).toEqual(after);
  });
  for(const rig of [XBOT_RIG,FOX_RIG])it(`${rig.id}预设缩略图使用独立标准摆放，结束后完整恢复多人和共享场景`,async()=>{
    const e=fixture(rig),selected=e.info().activeActor!;(e as any).restorePose(relocatePose(e.snapshot(),{position:[2,.4,-1],quaternion:new Quaternion().setFromEuler(new Euler(.2,.6,-.55)).toArray()}));
    await e.duplicateActor();await e.addActor(rig===FOX_RIG?XBOT_RIG:FOX_RIG);e.selectActor(selected);e.addProp('table');e.cameraState.framing.locked=true;
    const before=e.sceneSnapshot();vi.mocked(e.onCommit).mockClear();
    const roots:PoseDocument['root'][]=[];e.renderImage=vi.fn(()=>{roots.push(e.snapshot().root);expect(e.props).toEqual([]);expect(e.cameraState.framing.locked).toBe(false);return {toDataURL:()=> 'preview'} as unknown as HTMLCanvasElement;});
    const images=e.presetThumbnails();expect(Object.keys(images)).toHaveLength(rig.presets.length);expect(roots.length).toBeGreaterThan(0);for(const root of roots)expect(root).toEqual(e.rest.root);
    expect(e.sceneSnapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    e.renderImage=vi.fn(()=>{throw new Error('render failure');});expect(()=>e.presetThumbnails()).toThrow('render failure');expect(e.sceneSnapshot()).toEqual(before);
  });
  it('人体与狐狸同时存在，切换选择不替换其他角色，骨骼各自独立',async()=>{const e=fixture(),id=e.info().activeActor!,humanBefore=actor(e);await e.addActor(FOX_RIG);const foxId=e.info().activeActor!;expect(e.actorList()).toHaveLength(2);expect(e.activeRig.id).toBe(FOX_RIG.id);expect(actor(e,id)).toEqual(humanBefore);const foxBefore=actor(e);e.select('b_Head_05');e.setSelectedRotation(1,15);expect(actor(e).pose.joints).not.toEqual(foxBefore.pose.joints);e.selectActor(id);expect(e.activeRig.id).toBe(XBOT_RIG.id);expect(actor(e,id)).toEqual(humanBefore);expect(actor(e,foxId).pose.joints).not.toEqual(foxBefore.pose.joints);});
  it('同种人体可复制，编辑关节不联动，复制件整体错开',async()=>{const e=fixture(),first=e.info().activeActor!,before=actor(e);await e.duplicateActor();const second=e.info().activeActor!;expect(second).not.toBe(first);expect(actor(e).pose.root.position[0]).toBeCloseTo(.8);expect(e.bones.Hips).not.toBe((e as any).actors.get(first).state.bones.Hips);e.select('Head');e.setSelectedRotation(1,20);expect(actor(e,first)).toEqual(before);e.selectActor(first);expect(e.bones.Head.quaternion.toArray()).toEqual(before.pose.joints.Head.quaternion);});
  it('整体移动与朝向同步固定点，局部骨骼姿势和其他角色不变',async()=>{const e=fixture();await e.addActor(FOX_RIG);const foxId=e.info().activeActor!,foxBefore=actor(e);e.selectActor(e.actorList()[0].id);e.setFeetPin(true);const pose=e.snapshot();e.moveActor([2,0,1],90);expect(e.snapshot().joints).toEqual(pose.joints);const expected=relocatePose(pose,e.snapshot().root);expect(e.snapshot().pins).toEqual(expected.pins);expect(e.snapshot().targets).toEqual(expected.targets);expect(actor(e,foxId)).toEqual(foxBefore);});
  it('整体位置下应用预设保留摆放坐标和朝向，IK 后续可继续微调',()=>{const e=fixture(),reference=fixture(),preset=XBOT_RIG.presets.find(p=>p.id==='wave')!;e.moveActor([1.5,0,-.5],70);const root=e.snapshot().root;e.applyPreset(preset);reference.applyPreset(preset);expect(e.snapshot().root).toEqual(root);expect(e.snapshot().joints).toEqual(reference.snapshot().joints);e.select('LeftHand');const y=e.world('LeftHand').y;e.setSelectedPosition(1,y+.01);expect(e.world('LeftHand').y).toBeGreaterThan(y+.004);});
  it('隐藏不导出，锁定保留图像和数据但禁止关节选择、整角色移动',async()=>{const e=fixture(),id=e.info().activeActor!;await e.addActor(FOX_RIG);e.selectActor(id);const before=e.snapshot();e.changeActor(id,{locked:true});expect(e.info().actorEditable).toBe(false);e.select('Head');e.moveActor([3,0,0],0);expect(e.snapshot().joints).toEqual(before.joints);expect(e.snapshot().root).toEqual(before.root);expect(e.sceneJoints().actors).toHaveLength(2);e.changeActor(id,{visible:false});expect(e.sceneJoints().actors).toHaveLength(1);expect(e.hasHumanActors()).toBe(false);e.changeActor(id,{visible:true,locked:false});expect(e.info().actorEditable).toBe(true);});
  it('给选中角色换骨架不影响其他实例，切回恢复本角色的旧姿势',async()=>{const e=fixture();e.select('Head');e.setSelectedRotation(1,22);const first=e.info().activeActor!,before=actor(e);await e.addActor(FOX_RIG);const second=e.info().activeActor!,other=actor(e);e.selectActor(first);await e.replaceActorRig(FOX_RIG);expect(e.actorList().map(a=>a.rig)).toEqual([FOX_RIG.id,FOX_RIG.id]);expect(actor(e,second)).toEqual(other);await e.replaceActorRig(XBOT_RIG);expect(actor(e).pose.joints).toEqual(before.pose.joints);expect(actor(e,second)).toEqual(other);});
  it('删除角色可用完整场景历史恢复，其他角色不丢失',async()=>{const e=fixture();await e.addActor(FOX_RIG);const before=e.sceneSnapshot(),removed=e.info().activeActor!;await e.removeActor(removed);expect(e.actorList()).toHaveLength(1);await e.restoreScene(before,{},false);expect(e.sceneSnapshot()).toEqual(before);});
  it('最后一个角色不能删除，限制角色总数',async()=>{const e=fixture();await expect(e.removeActor(e.info().activeActor!)).rejects.toThrow(/至少/);const doc=e.sceneSnapshot();while(doc.actors.length<MAX_ACTORS){const a=structuredClone(doc.actors[0]);a.id=`copy-${doc.actors.length}`;doc.actors.push(a);}await e.restoreScene(doc);await expect(e.addActor(FOX_RIG)).rejects.toThrow(/最多/);});
  it('狐狸整体转向后四爪 IK 仍沿世界目标移动，人体保持原位',async()=>{const e=fixture(),before=actor(e);await e.addActor(FOX_RIG);e.moveActor([1,0,.5],60);e.select('b_LeftHand_011');const point=e.world(e.selected);e.setSelectedPosition(1,point.y+.02);expect(e.world(e.selected).y).toBeGreaterThan(point.y+.01);expect(actor(e,e.actorList()[0].id)).toEqual(before);});
  it('忙碌时阻止鼠标选择和拖动，但外观加载不取消正在看的动画',()=>{const e=fixture(FOX_RIG),clip=e.motion!.state().clips[0];e.previewMotion(clip.id);e.seekMotion(5);const time=e.motion!.time;e.setInteractionBlocked(true);expect(e.motion!.active).toBe(true);expect(e.motion!.time).toBe(time);e.setInteractionBlocked(false);expect(e.motion!.time).toBe(time);});
});
describe('场景事务、历史和通用导出数据',()=>{
  it('旧姿势升级成一个角色，新场景结构可往返',()=>{const e=fixture(),old=e.snapshot(),scene=readSceneDocument(JSON.stringify(old));expect(scene.actors).toHaveLength(1);expect(scene.actors[0].pose.joints).toEqual(old.joints);expect(readSceneDocument(JSON.stringify(scene))).toEqual(scene);expect(scene.actors[0].pose.camera).toBeUndefined();});
  it('失败回滚：坏关节、未知骨架和缺失外观都保留完整原场景',async()=>{const e=fixture();await e.addActor(FOX_RIG);const before=e.sceneSnapshot();for(const edit of [(d:typeof before)=>{d.actors[0].pose.joints.Hips.position=[99,0,0];},(d:typeof before)=>{d.actors[0].pose.rig='unknown';},(d:typeof before)=>{d.actors[0].pose.appearance={id:'a'.repeat(64),rig:XBOT_RIG.id,rigVersion:1,name:'missing'};}]){const bad=structuredClone(before);edit(bad);await expect(e.restoreScene(bad)).rejects.toThrow();expect(e.sceneSnapshot()).toEqual(before);}});
  it('本地草稿缺少外观时可恢复原姿势，其他实例不变；文件导入仍拒绝缺资源',async()=>{const e=fixture();e.select('Head');e.setSelectedRotation(1,25);await e.addActor(FOX_RIG);const before=e.sceneSnapshot(),draft=structuredClone(before),missing={id:'a'.repeat(64),rig:XBOT_RIG.id,rigVersion:1,name:'missing'};draft.actors[0].pose.appearance=missing;const recover=vi.fn(()=>true);await e.restoreScene(draft,{recoverAppearance:recover},false);expect(recover).toHaveBeenCalledWith(draft.actors[0].id,missing,expect.any(Error));expect(e.sceneSnapshot()).toEqual(before);await expect(e.restoreScene(draft)).rejects.toThrow();expect(e.sceneSnapshot()).toEqual(before);});
  it('候选渲染失败前不写资源，恢复原角色和所有姿势',async()=>{const e=fixture(),before=e.sceneSnapshot(),next=structuredClone(before);next.actors[0].pose.joints.Head.quaternion=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.2).toArray();Object.assign(e,{renderer:{},getThumbnails:()=>{throw new Error('GPU failed');}});const save=vi.fn();await expect(e.restoreScene(next,{beforeCommit:save})).rejects.toThrow('GPU failed');expect(save).not.toHaveBeenCalled();expect(e.sceneSnapshot()).toEqual(before);});
  it('存储失败保留全部原始状态，已验证的候选不会提前出现在场景',async()=>{const e=fixture(),before=e.sceneSnapshot(),next=structuredClone(before);next.name='Next';next.actors[0].pose.joints.Head.quaternion=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.2).toArray();await expect(e.restoreScene(next,{beforeCommit:async()=>{expect(e.sceneSnapshot()).toEqual(before);throw new Error('quota');}})).rejects.toThrow('quota');expect(e.sceneSnapshot()).toEqual(before);});
  it('连续加载只激活最新场景，迟到候选释放',async()=>{const e=fixture(),latest=e.sceneSnapshot(),old=sceneFromPose(fixture(FOX_RIG).snapshot());old.activeActor=old.actors[0].id='late';let resolve!:(r:ReturnType<PoseEngine['captureActorRuntime']>)=>void;const pending=new Promise<ReturnType<PoseEngine['captureActorRuntime']>>(r=>{resolve=r;});e.loadActorRuntime=vi.fn(()=>pending);const first=e.restoreScene(old).catch(e=>e);latest.name='Latest';await e.restoreScene(latest);resolve(fixture(FOX_RIG,false).captureActorRuntime());expect((await first).name).toBe('AbortError');expect(e.sceneSnapshot().name).toBe('Latest');expect(e.actorList()).toHaveLength(1);});
  it('预加载途中切回当前骨架会取消旧请求，不被迟到模型替换',async()=>{const e=fixture(),before=e.sceneSnapshot();let resolve!:(r:ReturnType<PoseEngine['captureActorRuntime']>)=>void;e.loadActorRuntime=vi.fn(()=>new Promise<ReturnType<PoseEngine['captureActorRuntime']>>(r=>{resolve=r;}));const first=e.replaceActorRig(FOX_RIG).catch(e=>e);await e.replaceActorRig(XBOT_RIG);resolve(fixture(FOX_RIG,false).captureActorRuntime());expect((await first).name).toBe('AbortError');expect(e.sceneSnapshot()).toEqual(before);});
  it('换骨架预加载期间保留最新共享场景名称和道具',async()=>{const e=fixture();let resolve!:(r:ReturnType<PoseEngine['captureActorRuntime']>)=>void;e.loadActorRuntime=vi.fn(()=>new Promise<ReturnType<PoseEngine['captureActorRuntime']>>(r=>{resolve=r;}));const pending=e.replaceActorRig(FOX_RIG);e.name='Latest scene';e.addProp('box');resolve(fixture(FOX_RIG,false).captureActorRuntime());await pending;expect(e.sceneSnapshot().name).toBe('Latest scene');expect(e.sceneSnapshot().props).toHaveLength(1);});
  it('混合场景人体单独进入 OpenPose，狐狸只进通用数据，不破坏当前选择',async()=>{const e=fixture();await e.addActor(FOX_RIG);const before=e.sceneSnapshot(),data=e.openPose(camera(),512,512,false);expect(data.people).toHaveLength(1);expect(data.people[0].pose_keypoints_2d).toHaveLength(54);expect(e.sceneJoints(camera(),512,512).actors.map(a=>a.joints.length)).toEqual([68,24]);expect(e.activeRig.id).toBe(FOX_RIG.id);expect(e.sceneSnapshot()).toEqual(before);});
  it('两个人体正确输出 people[]，隐藏一人后只保留另一人',async()=>{const e=fixture();await e.duplicateActor();expect(e.openPose(camera(),512,512,false).people).toHaveLength(2);const id=e.info().activeActor!;e.changeActor(id,{visible:false});expect(e.openPose(camera(),512,512,false).people).toHaveLength(1);});
  it('全场景边界包含狐狸和道具，隐藏角色后重新计算',async()=>{const e=fixture(),initial=e.sceneBounds().max.x;await e.addActor(FOX_RIG);e.moveActor([3,0,0],0);expect(e.sceneBounds().max.x).toBeGreaterThan(3);e.changeActor(e.info().activeActor!,{visible:false});expect(e.sceneBounds().max.x).toBeCloseTo(initial,6);});
  it('场景拒绝重复 ID、非法活动角色和空角色列表',()=>{const e=fixture();for(const change of [(d:ReturnType<PoseEngine['sceneSnapshot']>)=>d.actors.push(d.actors[0]),(d:ReturnType<PoseEngine['sceneSnapshot']>)=>{d.activeActor='missing';},(d:ReturnType<PoseEngine['sceneSnapshot']>)=>{d.actors=[];}]){const doc=e.sceneSnapshot();change(doc);expect(()=>readSceneDocument(JSON.stringify(doc))).toThrow();}});
  it('旧基础人形工程升级后可以与狐狸共存，仍使用自身 16 骨拓扑',async()=>{const old=fixture(BASIC_HUMAN_RIG),e=fixture();await e.restoreScene(readSceneDocument(JSON.stringify(old.snapshot())));expect(e.activeRig.id).toBe(BASIC_HUMAN_RIG.id);await e.addActor(FOX_RIG);expect(e.sceneJoints().actors.map(a=>a.joints.length)).toEqual([16,24]);expect(e.hasHumanActors()).toBe(false);});
  it('资源库动画重命名、删除和恢复同步所有同骨架实例',async()=>{const {packMotionAsset}=await import('./motionLibrary'),e=fixture(),clip=importedClip(e),first=e.info().activeActor!;e.installImportedMotions([clip]);await e.duplicateActor();e.installImportedMotions([clip]);e.renameMotion(clip.uuid,'Shared rename');expect(e.actorMotions().map(a=>a.clips[0].name)).toEqual(['Shared rename','Shared rename']);e.removeMotion(clip.uuid);expect(e.actorMotions().map(a=>a.clips.length)).toEqual([0,0]);e.restoreMotionAsset(packMotionAsset([clip]));expect(e.actorMotions().map(a=>a.clips.length)).toEqual([1,1]);e.selectActor(first);expect(e.motion!.state().clips).toHaveLength(1);});
});

describe('多角色完整工程包',()=>{
  beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());});
  it('不同骨架、显隐锁定、道具与相机随场景保存，内置围巾不重复打包',async()=>{const {createSceneBundle,readSceneBundle}=await import('./sceneBundle'),e=fixture();await e.addActor(FOX_RIG);const doc=e.sceneSnapshot(),ref=FOX_RIG.appearances![0];doc.actors[1].pose.appearance={id:ref.id,name:ref.name,rig:FOX_RIG.id,rigVersion:1};doc.actors[0].locked=true;const data=await (await createSceneBundle(doc,e.actorMotions(),[])).arrayBuffer(),packet=await readSceneBundle(data);expect(packet.scene).toEqual(doc);expect(packet.characters).toEqual([]);expect(packet.motions).toEqual([]);});
  it('两个人体共享自定义外观只存一份，换设备空库能为每个实例准备同一源文件',async()=>{const {createSceneBundle,readSceneBundle,scenePackageOptions}=await import('./sceneBundle'),{sha256}=await import('./projectBundle'),{characterLibrary}=await import('./characterLibrary'),e=fixture();await e.duplicateActor();const source=bytes('../public/models/xbot.glb'),ref={id:await sha256(source),name:'Shared',rig:XBOT_RIG.id,rigVersion:1};await characterLibrary.put({ref,bytes:source});const doc=e.sceneSnapshot();doc.actors.forEach(a=>{a.pose.appearance=ref;});const packet=await readSceneBundle(await (await createSceneBundle(doc,[],[])).arrayBuffer());expect(packet.characters).toHaveLength(1);const destination=fixture();await destination.restoreScene(packet.scene,scenePackageOptions(packet));expect(destination.sceneSnapshot()).toEqual(doc);expect(destination.actorList()).toHaveLength(2);expect(destination.bones.Hips).not.toBe((destination as any).actors.get(doc.actors[0].id).state.bones.Hips);});
  it('同一动画只打包一次，每个角色仍保留自己的选段与时间书签',async()=>{const {createSceneBundle,readSceneBundle,scenePackageOptions,sceneClipKey}=await import('./sceneBundle'),e=fixture(),first=e.info().activeActor!,clip=importedClip(e);e.installImportedMotions([clip]);e.motion!.remember(clip.uuid,.3);await e.duplicateActor();const second=e.info().activeActor!;e.installImportedMotions([clip]);e.motion!.remember(clip.uuid,.7);const doc=e.sceneSnapshot(),packet=await readSceneBundle(await (await createSceneBundle(doc,e.actorMotions(),[sceneClipKey(first,clip.uuid),sceneClipKey(second,clip.uuid)])).arrayBuffer());expect(packet.motions).toHaveLength(1);const destination=fixture();await destination.restoreScene(packet.scene,scenePackageOptions(packet));const motions=destination.actorMotions();expect(motions.map(a=>a.state!.time)).toEqual([.3,.7]);expect(motions.map(a=>a.clips.length)).toEqual([1,1]);expect(motions.every(a=>!a.state!.active&&!a.state!.playing)).toBe(true);expect(destination.sceneSnapshot()).toEqual(doc);});
  it('未勾选外部片段不进包；旧单角色包仍可打开',async()=>{const {createSceneBundle,readSceneBundle}=await import('./sceneBundle'),{createProjectBundle}=await import('./projectBundle'),e=fixture(),clip=importedClip(e);e.installImportedMotions([clip]);e.motion!.remember(clip.uuid,.5);const packet=await readSceneBundle(await (await createSceneBundle(e.sceneSnapshot(),e.actorMotions(),[])).arrayBuffer());expect(packet.motions).toEqual([]);expect(packet.actors[0].bookmark).toBeUndefined();const old=await readSceneBundle(await (await createProjectBundle(e.snapshot(),XBOT_RIG,[clip],e.motion!.state())).arrayBuffer());expect(old.scene.actors).toHaveLength(1);expect(old.motions).toHaveLength(1);expect(old.actors[0].bookmark?.time).toBe(.5);});
  it('将人体动画错误关联到狐狸时拒绝，资源写入和原场景均不改变',async()=>{const {createSceneBundle,readSceneBundle,scenePackageOptions,sceneClipKey}=await import('./sceneBundle'),e=fixture(),clip=importedClip(e),humanId=e.info().activeActor!;e.installImportedMotions([clip]);await e.addActor(FOX_RIG);const packet=await readSceneBundle(await (await createSceneBundle(e.sceneSnapshot(),e.actorMotions(),[sceneClipKey(humanId,clip.uuid)])).arrayBuffer());packet.actors.find(a=>a.actorId===packet.scene.activeActor)!.clips=[clip.uuid];const destination=fixture(),before=destination.sceneSnapshot();await expect(destination.restoreScene(packet.scene,scenePackageOptions(packet))).rejects.toThrow(/骨架/);expect(destination.sceneSnapshot()).toEqual(before);});
});
