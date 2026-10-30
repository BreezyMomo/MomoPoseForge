import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {Bone,Group,Object3D,Vector3,PerspectiveCamera,OrthographicCamera,Quaternion,Scene} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PoseEngine} from './PoseEngine';
import {captureCamera,restoreCamera,defaultCameraSettings,validateCameraSettings} from './cameraState';
import {parseDocument} from './files';
import {PRESETS} from './presets';
import {inPresetScope} from './presetScopes';
import {END_EFFECTORS,DEFAULT_VIEWS} from './types';
import {generationSize,controlnetRecipe} from './controlnetWorkflow';
import profile from '../public/models/xbot-profile.json';
import type {ReferenceImage} from './referenceImage';
const referenceFixture=():ReferenceImage=>({version:1,id:'reference-fixture',name:'参考.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',width:1,height:1,opacity:.4,scale:1,offsetX:0,offsetY:0,locked:true,visible:true});

const bytes=fs.readFileSync(new URL('../public/models/xbot.glb',import.meta.url));
async function fixture(){
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const e=Object.create(PoseEngine.prototype) as PoseEngine,model=new Group(),bones:Record<string,Bone>={};model.add(scene);model.traverse(b=>{if(b instanceof Bone)bones[b.name]=b;});model.updateMatrixWorld(true);
  const camera=new PerspectiveCamera(35,900/700,.01,100),target=new Vector3(0,.85,0);camera.position.set(1.25,1.4,2.8);camera.lookAt(target);camera.updateMatrixWorld(true);
  const orbit={object:camera,target,enabled:true,update:()=>{e.camera.lookAt(orbit.target);e.camera.updateMatrixWorld(true);}};
  Object.assign(e,{model,bones,camera,orbit,host:{clientWidth:900,clientHeight:700},renderer:{setSize:vi.fn()},transform:{dragging:false,camera,setMode(){},attach(){}},fly:{stop(){}},gizmo:new Object3D(),ready:false,profile,center:new Vector3(0,.85,0),span:1.98,views:structuredClone(DEFAULT_VIEWS),cameraState:defaultCameraSettings(),selected:'LeftHand',mode:'translate',view:'free',display:'surface',handles:[],pins:{},targets:{},poles:{},ground:true,fullBody:true,hands:{Left:'张手',Right:'张手'},name:'相机验收',onInfo:vi.fn(),onCommit:vi.fn()});
  for(const end of END_EFFECTORS){e.targets[end]=e.world(end).toArray();e.poles[end]=e.world(end).add(new Vector3(0,0,.8)).toArray();}
  e.rest=e.snapshot();e.ready=true;e.applyPreset(PRESETS[0],false);e.focus();return e;
}
const matrix=(e:PoseEngine)=>e.camera.matrixWorld.toArray();
describe('斜角与垂直上下视图',()=>{
  it('顶视/底视在各方位角精确沿 Y 轴观察，画面朝上方向稳定且矩阵无奇异值',async()=>{
    const e=await fixture();
    for(const elevation of [90,-90])for(const azimuth of [0,45,90,180,-90]){
      const camera=e.viewCamera({id:'high',name:'垂直',azimuth,elevation},1),sign=Math.sign(elevation),a=azimuth*Math.PI/180;
      expect(camera.getWorldDirection(new Vector3()).distanceTo(new Vector3(0,-sign,0))).toBeLessThan(1e-12);
      expect(camera.position.x).toBe(e.center.x);expect(camera.position.z).toBe(e.center.z);
      expect(camera.matrixWorld.elements.every(Number.isFinite)).toBe(true);expect(camera.matrixWorld.determinant()).toBeCloseTo(1,12);
      const center=e.center.clone().project(camera),up=e.center.clone().add(new Vector3(-Math.sin(a),0,-sign*Math.cos(a))).project(camera);
      expect(Math.abs(center.x)+Math.abs(center.y)).toBeLessThan(1e-12);expect(up.y).toBeGreaterThan(center.y);
    }
  });
  it('真实 OrbitControls 初始化不偏移垂直镜头，书签/工程恢复仍为精确顶视',async()=>{
    const e=await fixture();e.orbit=new OrbitControls(e.camera);e.orbit.enableDamping=false;
    e.setViewDirection('high','top');e.setView('high');const before=matrix(e),pose=e.snapshot().joints;
    expect(e.camera.getWorldDirection(new Vector3()).distanceTo(new Vector3(0,-1,0))).toBeLessThan(1e-12);expect(e.views[3].name).toBe('顶视');
    e.saveCameraBookmark('垂直');const bookmark=e.cameraState.bookmarks[0];e.setView('side');e.loadCameraBookmark(bookmark.id);expect(matrix(e)).toEqual(before);
    expect(e.snapshot().joints).toEqual(pose);const doc=e.snapshot();e.apply(parseDocument(JSON.stringify(doc),e.rest));expect(matrix(e)).toEqual(before);
    for(const [name,joint] of Object.entries(pose)){expect(e.bones[name].position.distanceTo(new Vector3().fromArray(joint.position))).toBeLessThan(1e-12);expect(e.bones[name].quaternion.angleTo(new Quaternion().fromArray(joint.quaternion))).toBeLessThan(1e-7);}
    e.setView('high');e.resetViews();expect(e.views[3]).toEqual(DEFAULT_VIEWS[3]);expect(e.camera.getWorldDirection(new Vector3()).y).toBeCloseTo(-Math.SQRT1_2,12);
  });
  it('支持 ±90° 工程，旧默认名称更新但自定义名称/角度保留；观察锁独立于槽位配置',async()=>{
    const e=await fixture();e.setFramingLock(true);const frame=e.getCameraSettings().framing;e.setCameraLock(true);const camera=matrix(e);
    e.setViewDirection('high','top');e.renameView('low','我的底稿');e.setViewDirection('low','bottom');expect(matrix(e)).toEqual(camera);expect(e.getCameraSettings().framing).toEqual(frame);expect(e.views[4].name).toBe('我的底稿');
    const doc=e.snapshot(),parsed=parseDocument(JSON.stringify(doc),e.rest);expect(parsed.views).toEqual(doc.views);
    const invalid=structuredClone(doc);invalid.views[3].elevation=90.01;expect(()=>parseDocument(JSON.stringify(invalid),e.rest)).toThrow('五视图');
    const old=structuredClone(doc);old.views[3]={id:'high',name:'俯视',azimuth:0,elevation:45};old.views[4]={id:'low',name:'仰视',azimuth:0,elevation:-30};const updated=parseDocument(JSON.stringify(old),e.rest);expect(updated.views[3].name).toBe('斜俯视');expect(updated.views[4].name).toBe('斜仰视');expect(old.views[3].name).toBe('俯视');
    old.views[3].elevation=60;expect(parseDocument(JSON.stringify(old),e.rest).views[3]).toEqual(old.views[3]);
  });
  it('从垂直观察复制到另一个槽位保留方位和画面朝向，更新默认名且保留用户命名',async()=>{
    const e=await fixture(),source={id:'high',name:'顶视',azimuth:120,elevation:90};e.camera=e.viewCamera(source);e.orbit.object=e.camera;e.orbit.target.copy(e.center);
    e.captureView('oblique');expect(e.views[1].azimuth).toBeCloseTo(120,10);expect(e.views[1].elevation).toBe(90);expect(e.views[1].name).toBe('顶视');expect(e.viewCamera(e.views[1]).quaternion.angleTo(e.camera.quaternion)).toBeLessThan(1e-7);
    e.renameView('low','我的镜头');e.captureView('low');expect(e.views[4].name).toBe('我的镜头');
  });
});
describe('道具场景与接触辅助',()=>{
  it('道具上限与非法修改在产生历史前拦截，不改变人体、镜头或已有场景',async()=>{
    const e=await fixture(),body=e.snapshot().joints,camera=e.getCameraSettings().active;
    for(let i=0;i<12;i++)e.addProp('box');const before=e.snapshot();vi.mocked(e.onCommit).mockClear();
    expect(()=>e.addProp('chair')).toThrow('最多');expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    expect(e.snapshot().joints).toEqual(body);expect(e.getCameraSettings().active).toEqual(camera);
  });
  it('添加、编辑、隐藏、移除、撤销和工程恢复均同步真实场景，旧工程会清空道具',async()=>{
    const e=await fixture();e.scene=new Scene();const old=e.snapshot(),id=e.addProp('chair');
    e.changeProp(id,{position:[.4,0,-.2],yaw:35,size:[.6,.5,.5]});const saved=e.snapshot();
    expect(e.propLayer?.children).toHaveLength(1);expect(e.propLayer!.children[0].position.toArray()).toEqual([.4,0,-.2]);
    e.changeProp(id,{visible:false});expect(e.propLayer?.children).toHaveLength(0);expect(e.snapshot().props?.[0].visible).toBe(false);
    e.removeProp(id);expect(e.snapshot().props).toBeUndefined();
    e.apply(saved,true,false);expect(e.propLayer?.children).toHaveLength(1);expect(e.snapshot().props).toEqual(saved.props);
    e.apply(parseDocument(JSON.stringify(saved),e.rest));expect(e.snapshot().props).toEqual(saved.props);
    e.apply(old);expect(e.propLayer?.children).toHaveLength(0);expect(e.snapshot().props).toBeUndefined();
  });
  it('全身和局部预设保留道具；场景构图和深度范围包含可见道具',async()=>{
    const e=await fixture();e.scene=new Scene();const before=e.depthRange([e.camera]),id=e.addProp('table');
    e.changeProp(id,{position:[0,0,-3]});const props=e.snapshot().props;
    e.applyPreset(PRESETS[6]);e.applyPreset(PRESETS[15],true,'upper');expect(e.snapshot().props).toEqual(props);expect(e.propLayer?.children).toHaveLength(1);
    expect(e.depthRange([e.camera]).far).toBeGreaterThan(before.far+1);
    expect(e.sceneBounds().min.z).toBeLessThan(-3);
    e.changeProp(id,{visible:false});expect(e.sceneBounds().min.z).toBeGreaterThan(-1);
  });
  it('手腕定位只改变对应手臂，保留手型和其他固定点，并记录一次历史',async()=>{
    const e=await fixture();e.setHand('Left','V 手势');e.setFeetPin(true);const id=e.addProp('table'),point=e.world('LeftHand').add(new Vector3(.03,0,.04));
    e.changeProp(id,{position:[point.x,0,point.z],size:[.5,point.y,.4]});const before=e.snapshot();vi.mocked(e.onCommit).mockClear();
    e.placeOnProp(id,'center','LeftHand');const after=e.snapshot();
    expect(e.world('LeftHand').distanceTo(point)).toBeLessThan(.01);expect(e.pins.LeftHand?.position).toEqual(e.world('LeftHand').toArray());
    expect(after.hands).toEqual(before.hands);expect(after.pins.LeftFoot).toEqual(before.pins.LeftFoot);expect(after.pins.RightFoot).toEqual(before.pins.RightFoot);
    for(const name of ['Hips','Spine','Head','RightArm','RightForeArm','LeftLeg','RightLeg','LeftIndex1'])expect(after.joints[name]).toEqual(before.joints[name]);
    expect(e.onCommit).toHaveBeenCalledOnce();expect(e.selected).toBe('LeftHand');
    e.apply(before,true,false);expect(e.pins.LeftHand).toBeUndefined();
  });
  it('脚底踩点考虑脚踝到地面的偏移，放平脚掌并固定朝向',async()=>{
    const e=await fixture(),id=e.addProp('box'),foot=e.world('LeftFoot');e.changeProp(id,{position:[foot.x,0,foot.z],size:[.3,.1,.3]});
    e.placeOnProp(id,'center','LeftFoot');expect(e.world('LeftFoot').y).toBeCloseTo(e.rest.targets.LeftFoot[1]+.1,2);
    expect(e.bones.LeftFoot.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion())).toBeLessThan(1e-7);expect(e.pins.LeftFoot?.orientation).toBe(true);
  });
  it('不可达、隐藏、缺失和已固定的定位请求不会破坏当前姿态或产生历史',async()=>{
    const e=await fixture(),id=e.addProp('table');e.changeProp(id,{position:[4,0,4]});const before=e.snapshot();vi.mocked(e.onCommit).mockClear();
    expect(()=>e.placeOnProp(id,'center','LeftHand')).toThrow('可达');expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    expect(()=>e.placeOnProp(id,'unknown','LeftHand')).toThrow('接触点');
    e.changeProp(id,{visible:false});expect(()=>e.placeOnProp(id,'center','LeftHand')).toThrow('可见');
    e.changeProp(id,{visible:true});e.setPin(true);expect(()=>e.placeOnProp(id,'center','LeftHand')).toThrow('解除');
    const saved=e.snapshot();expect(()=>e.changeProp(id,{size:[-1,1,1]})).toThrow('尺寸');expect(e.snapshot()).toEqual(saved);
  });
});
describe('局部姿势套用',()=>{
  for(const scope of ['upper','lower','head'] as const)it(`${scope}仅替换指定关节，保留工程、镜头、手型和其他部位`,async()=>{
    const e=await fixture(),source=await fixture();
    e.applyPreset(PRESETS.find(p=>p.id==='sit')!);
    e.setHand('Left','握拳');e.setHand('Right','V 手势');e.setSelectedRotation(1,20);
    e.name='坐着挥手';e.model.position.set(.3,.1,-.4);e.model.quaternion.setFromAxisAngle(new Vector3(0,1,0),.6);
    e.setReferenceImage(referenceFixture());e.saveCameraBookmark('观察');e.setFramingLock(true);e.setCameraLock(true);
    const before=e.snapshot();
    for(const preset of PRESETS){
      e.apply(before);const baseline=e.snapshot();source.applyPreset(preset);const expected=source.snapshot();
      vi.mocked(e.onCommit).mockClear();e.applyPreset(preset,true,scope);const after=e.snapshot();
      for(const [name,joint] of Object.entries(baseline.joints))expect(after.joints[name],`${preset.id}:${name}`).toEqual(inPresetScope(name,scope)?expected.joints[name]:joint);
      expect(after.root).toEqual(before.root);expect(after.name).toBe(before.name);expect(after.hands).toEqual(before.hands);
      expect(after.camera).toEqual(before.camera);expect(after.referenceImage).toEqual(before.referenceImage);expect(after.fullBody).toBe(before.fullBody);
      expect(after.ground).toBe(scope==='lower'?expected.ground:before.ground);
      expect(e.onCommit).toHaveBeenCalledTimes(1);expect(vi.mocked(e.onCommit).mock.calls[0][0]).toEqual(after);
      for(const end of END_EFFECTORS){
        if(scope==='lower'||scope==='upper'&&end.endsWith('Hand'))expect(after.targets[end]).toEqual(e.world(end).toArray());
        else {expect(after.targets[end]).toEqual(before.targets[end]);expect(after.poles[end]).toEqual(before.poles[end]);}
      }
    }
  });
  it('坐姿套用挥手保留双脚世界位置和骨盆高度，之后撤销、重做、工程往返可恢复',async()=>{
    const e=await fixture();e.applyPreset(PRESETS.find(p=>p.id==='sit')!);e.setFeetPin(true);
    const before=e.snapshot(),feet=END_EFFECTORS.filter(end=>end.endsWith('Foot')).map(end=>e.world(end)),hand=e.world('LeftHand');
    e.applyPreset(PRESETS.find(p=>p.id==='wave')!,true,'upper');const after=e.snapshot();
    expect(after.pins).toEqual(before.pins);expect(after.joints.Hips).toEqual(before.joints.Hips);
    for(const [i,end] of ['LeftFoot','RightFoot'].entries())expect(e.world(end).distanceTo(feet[i])).toBeLessThan(1e-12);
    expect(e.world('LeftHand').distanceTo(hand)).toBeGreaterThan(.3);
    for(const document of [before,after,parseDocument(JSON.stringify(after),e.rest)]){
      e.apply(document,true,false);for(const [name,joint] of Object.entries(document.joints))expect(e.bones[name].quaternion.angleTo(new Quaternion().fromArray(joint.quaternion))).toBeLessThan(1e-7);
      expect(e.snapshot().pins).toEqual(document.pins);
    }
  });
  it('下半身套用正坐会降低骨盆并弯腿；头部套用回头不替换已有躯干',async()=>{
    const e=await fixture();e.applyPreset(PRESETS.find(p=>p.id==='wave')!);const before=e.snapshot();
    e.applyPreset(PRESETS.find(p=>p.id==='sit')!,true,'lower');const seated=e.snapshot();
    expect(seated.joints.Hips.position[1]).toBeCloseTo(before.joints.Hips.position[1]-.44);
    expect(seated.joints.LeftLeg.quaternion).not.toEqual(before.joints.LeftLeg.quaternion);
    for(const name of ['Spine','Spine1','Chest','LeftArm','LeftForeArm','RightArm','Head'])expect(seated.joints[name]).toEqual(before.joints[name]);
    e.applyPreset(PRESETS.find(p=>p.id==='turn')!,true,'head');const turned=e.snapshot();
    expect(turned.joints.Head.quaternion).not.toEqual(seated.joints.Head.quaternion);
    for(const name of ['Hips','Spine','Spine1','Chest','LeftArm','LeftLeg','RightLeg'])expect(turned.joints[name]).toEqual(seated.joints[name]);
  });
  for(const [scope,pin] of [['upper','LeftHand'],['lower','LeftHand'],['lower','RightFoot']] as const)it(`${scope}与${pin}固定冲突时不改变姿势、不产生历史`,async()=>{
    const e=await fixture();e.select(pin);e.setPin(true,true);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();
    expect(()=>e.applyPreset(PRESETS[15],true,scope)).toThrow('解除');expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
  });
  it('头部套用保留所有手脚固定；全身套用仍替换手型并释放固定',async()=>{
    const e=await fixture();for(const end of END_EFFECTORS){e.select(end);e.setPin(true,true);}const before=e.snapshot();
    e.applyPreset(PRESETS.find(p=>p.id==='turn')!,true,'head');expect(e.snapshot().pins).toEqual(before.pins);
    e.applyPreset(PRESETS.find(p=>p.id==='run')!);expect(e.name).toBe('跑步定格');expect(e.hands).toEqual({Left:'握拳',Right:'握拳'});expect(e.pins).toEqual({});
  });
});
describe('相机、工程与五视图构图',()=>{
  for(const side of ['Left','Right'] as const)it(`${side}手部精调后聚焦人体恢复全身控制、镜头并保留姿势`,async()=>{
    const e=await fixture(),before=e.snapshot().joints;
    e.setHandDetail(side);e.focusHand(side);
    const distance=e.camera.position.distanceTo(e.orbit.target);
    expect(e.handDetail).toBe(side);expect(distance).toBeCloseTo(.52);
    e.focus();
    expect(e.handDetail).toBeNull();expect(e.selected).toBe(`${side}Hand`);expect(e.mode).toBe('translate');
    expect(e.camera.position.distanceTo(e.orbit.target)).toBeGreaterThan(distance*3);
    expect(e.snapshot().joints).toEqual(before);
  });
  it('手部近景中锁定相机后仍可退出精调，同时保留镜头锁定',async()=>{
    const e=await fixture();e.setHandDetail('Left');e.focusHand('Left');e.setCameraLock(true);const camera=e.getCameraSettings();
    e.focus();expect(e.handDetail).toBeNull();expect(e.selected).toBe('LeftHand');expect(e.getCameraSettings()).toEqual(camera);
  });
  it('参考图片只写入工程元数据，不加入场景，也不改变骨骼、相机或构图',async()=>{
    const e=await fixture(),before=e.snapshot(),children=[...e.model.children];e.setReferenceImage(referenceFixture());e.setReferenceSettings({opacity:.3,scale:1.5,offsetX:.2,offsetY:-.1});
    const after=e.snapshot();expect(after.joints).toEqual(before.joints);expect(after.camera).toEqual(before.camera);expect(e.model.children).toEqual(children);expect(after.referenceImage?.scale).toBe(1.5);expect(vi.mocked(e.onCommit).mock.calls.at(-1)?.[1]).toBe(false);
  });
  it('内嵌图片与位置可随工程恢复，旧工程不会遗留上一个工程的参考图',async()=>{
    const e=await fixture();e.setReferenceImage(referenceFixture());e.setReferenceSettings({offsetX:-.2,scale:2,visible:false});const doc=e.snapshot(),copy=await fixture();copy.apply(parseDocument(JSON.stringify(doc),copy.rest));expect(copy.referenceImage).toEqual(doc.referenceImage);
    delete doc.referenceImage;copy.apply(parseDocument(JSON.stringify(doc),copy.rest));expect(copy.referenceImage).toBeUndefined();expect(copy.orbit.enabled).toBe(true);
  });
  it('套用预设和姿态撤销保留当前参考图，实时预览不会增加姿态历史',async()=>{
    const e=await fixture(),pose=e.snapshot();e.setReferenceImage(referenceFixture());const calls=vi.mocked(e.onCommit).mock.calls.length;e.setReferenceSettings({offsetX:.3},false);expect(vi.mocked(e.onCommit).mock.calls).toHaveLength(calls);e.commitReference();expect(vi.mocked(e.onCommit).mock.calls.at(-1)?.[1]).toBe(false);
    e.applyPreset(PRESETS.find(p=>p.id==='squat')!);expect(e.referenceImage?.offsetX).toBe(.3);e.apply(pose,true,false);expect(e.referenceImage?.offsetX).toBe(.3);
  });
  it('参考图编辑与观察锁共同控制导航，隐藏或移除图片不会解除观察锁',async()=>{
    const e=await fixture();e.setReferenceImage(referenceFixture());e.setReferenceSettings({locked:false});expect(e.orbit.enabled).toBe(false);e.setReferenceSettings({visible:false});expect(e.orbit.enabled).toBe(true);e.setCameraLock(true);e.setReferenceSettings({visible:true,locked:true});expect(e.orbit.enabled).toBe(false);e.setReferenceImage();expect(e.orbit.enabled).toBe(false);e.setCameraLock(false);expect(e.orbit.enabled).toBe(true);
  });
  it('锁定构图后连续套用全部预设，五个相机矩阵和尺度不漂移',async()=>{
    const e=await fixture();e.setFramingLock(true);const before=e.views.map(v=>e.viewCamera(v,1).projectionMatrix.toArray().concat(e.viewCamera(v,1).matrixWorld.toArray())),frame=e.getCameraSettings().framing;
    for(const p of PRESETS){e.applyPreset(p);expect(e.getCameraSettings().framing).toEqual(frame);expect(e.views.map(v=>e.viewCamera(v,1).projectionMatrix.toArray().concat(e.viewCamera(v,1).matrixWorld.toArray()))).toEqual(before);}
  });
  it('出框提示不偷偷改变构图；显式重新适配后仍保持锁定',async()=>{
    const e=await fixture();e.setFramingLock(true);const center=e.center.clone(),span=e.span;e.model.position.x+=3;e.commit();expect(e.center.equals(center)).toBe(true);expect(e.span).toBe(span);expect(e.framingWarning()).toContain('可能超出画幅');
    e.reframe();expect(e.cameraState.framing.locked).toBe(true);expect(e.center.x-center.x).toBeCloseTo(3,8);expect(e.framingWarning()).toBe('');
  });
  it('观察锁阻止切视角、聚焦、手部聚焦、FOV 和投影切换，但仍可改姿态',async()=>{
    const e=await fixture();e.setCameraLock(true);const before=matrix(e),pose=e.snapshot().joints;e.setView('side');e.focus();e.focusHand('Left');e.setFov(80);e.setProjection('orthographic');e.applyPreset(PRESETS.find(p=>p.id==='squat')!);
    expect(matrix(e)).toEqual(before);expect(e.cameraState.fov).toBe(35);expect(e.snapshot().joints).not.toEqual(pose);expect(e.orbit.enabled).toBe(false);e.setCameraLock(false);expect(e.orbit.enabled).toBe(true);
  });
  it('透视书签恢复位置、朝向、目标与 FOV，改名/重存不生成重复项',async()=>{
    const e=await fixture();e.setFov(57);e.camera.position.set(-1,1.6,2);e.camera.lookAt(e.orbit.target);e.camera.updateMatrixWorld(true);e.saveCameraBookmark('主构图');const saved=e.getCameraSettings().bookmarks[0];
    e.setView('side');e.loadCameraBookmark(saved.id);expect(matrix(e)).toEqual(restoreCamera(saved.camera,900/700).matrixWorld.toArray());expect(e.orbit.target.toArray()).toEqual(saved.camera.target);expect(e.cameraState.fov).toBe(57);
    expect(e.renameCameraBookmark(saved.id,'近景')).toBe(true);e.saveCameraBookmark('近景');expect(e.cameraState.bookmarks).toHaveLength(1);expect(e.cameraState.bookmarks[0].id).toBe(saved.id);expect(vi.mocked(e.onCommit).mock.calls.at(-1)?.[1]).toBe(false);
  });
  it('正交书签的独立尺度和缩放不被窗口 resize 替换成五视图尺度',async()=>{
    const e=await fixture();e.setView('front');const c=e.camera as OrthographicCamera;c.top=.4;c.bottom=-.4;c.zoom=1.8;c.updateProjectionMatrix();e.saveCameraBookmark('细节');const saved=e.cameraState.bookmarks[0];e.setView('free');e.loadCameraBookmark(saved.id);
    Object.assign(e.host,{clientWidth:390,clientHeight:844});e.resize();const actual=e.camera as OrthographicCamera;expect(actual.top-actual.bottom).toBeCloseTo(.8,12);expect(actual.zoom).toBe(1.8);expect((actual.right-actual.left)/.8).toBeCloseTo(390/844,12);expect(validateCameraSettings(e.getCameraSettings())).toBe(true);
  });
  it('工程往返恢复自由镜头、书签、名称、画幅和锁定状态；姿态撤销不撤销观察',async()=>{
    const e=await fixture();e.setFov(49);e.setOutputSize(1000,777);e.renameView('front','正面定稿');e.setFramingLock(true);e.saveCameraBookmark('定稿');e.setCameraLock(true);const doc=e.snapshot(),copy=await fixture();copy.apply(parseDocument(JSON.stringify(doc),copy.rest));
    expect(copy.getCameraSettings()).toEqual(doc.camera);expect(copy.views[0].name).toBe('正面定稿');expect(copy.orbit.enabled).toBe(false);for(const [name,joint] of Object.entries(doc.joints)){expect(copy.bones[name].position.distanceTo(new Vector3().fromArray(joint.position))).toBeLessThan(1e-12);expect(copy.bones[name].quaternion.angleTo(new Quaternion().fromArray(joint.quaternion))).toBeLessThan(1e-7);}
    copy.setCameraLock(false);copy.setFov(65);const camera=copy.getCameraSettings();copy.apply(doc,true,false);expect(copy.getCameraSettings()).toEqual(camera);
  });
  it('旧 v1 工程缺少相机字段时，恢复为未锁定和竖幅自动适配',async()=>{
    const e=await fixture(),old=e.snapshot();delete old.camera;e.setCameraLock(true);e.setFramingLock(true);e.apply(parseDocument(JSON.stringify(old),e.rest));const camera=e.getCameraSettings();expect(camera.locked||camera.framing.locked).toBe(false);expect(camera.output).toEqual({width:768,height:1024});expect(validateCameraSettings(camera)).toBe(true);
  });
  it('画幅变化保持锁定的世界构图，并按实际宽高生成投影',async()=>{
    const e=await fixture();e.setFramingLock(true);const frame=e.getCameraSettings().framing;expect(e.setOutputSize(256,2048)).toBe(true);expect(e.getCameraSettings().framing).toEqual(frame);const c=e.viewCamera(e.views[0],256/2048);expect((c.right-c.left)/(c.top-c.bottom)).toBe(.125);expect(e.setOutputSize(2049,512)).toBe(false);expect(e.setOutputSize(512.2,512)).toBe(false);
  });
  it('拒绝损坏相机、零缩放、重复书签和非法画幅，且不修改原工程',async()=>{
    const e=await fixture(),original=e.snapshot();e.saveCameraBookmark('A');const doc=e.snapshot();
    for(const mutate of [(d:typeof doc)=>{d.camera!.active.quaternion=[0,0,0,0];},(d:typeof doc)=>{d.camera!.active.zoom=0;},(d:typeof doc)=>{d.camera!.active.target=d.camera!.active.position;},(d:typeof doc)=>{d.camera!.bookmarks.push(d.camera!.bookmarks[0]);},(d:typeof doc)=>{d.camera!.output.width=2049;},(d:typeof doc)=>{d.camera!.framing.verticalSpan=-1;}]){const bad=structuredClone(doc);mutate(bad);expect(()=>parseDocument(JSON.stringify(bad),e.rest)).toThrow('相机');}
    expect(e.snapshot().joints).toEqual(original.joints);
  });
  it('不同宽高的工作流使用最长边 512、8 像素对齐尺寸，保留旧竖幅参数',()=>{
    for(const [source,expected] of [[[768,1024],[384,512]],[[1024,1024],[512,512]],[[1024,768],[512,384]],[[1536,864],[512,288]],[[256,2048],[64,512]]])expect(generationSize(...source as [number,number])).toEqual({width:expected[0],height:expected[1]});
    const recipe=controlnetRecipe(['front'],{skeleton:true,depth:true,normal:true},undefined,{width:1024,height:768});expect(recipe.generation.width).toBe(512);expect(recipe.generation.height).toBe(384);expect(recipe.generation.resize).toContain('no stretching');
  });
  it('底层相机重建在不同画幅下保留朝向与中心光线',()=>{
    const c=new PerspectiveCamera(72,1,.02,150),target=new Vector3(.3,1,.2);c.position.set(2,1.8,3);c.lookAt(target);c.updateMatrixWorld(true);const pose=captureCamera(c,target,72);
    for(const aspect of [.125,1,8]){const restored=restoreCamera(pose,aspect);expect(restored.getWorldDirection(new Vector3()).distanceTo(c.getWorldDirection(new Vector3()))).toBeLessThan(1e-12);const p=target.clone().project(restored);expect(Math.abs(p.x)+Math.abs(p.y)).toBeLessThan(1e-12);expect(new Quaternion().fromArray(pose.quaternion).length()).toBeCloseTo(1,12);}
  });
});
