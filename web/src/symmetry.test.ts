import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {Bone,Group,Object3D,Vector3,Quaternion,PerspectiveCamera,Euler} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PoseEngine} from './PoseEngine';
import {defaultSymmetry,validSymmetry,symmetricLimb,limbParts,mirroredRotation,type SymmetryGroup} from './symmetry';
import {DIGITS,END_EFFECTORS,DEFAULT_VIEWS,type Effector,type Side} from './types';
import {PRESETS} from './presets';
import {parseDocument} from './files';
import {defaultCameraSettings} from './cameraState';
import profile from '../public/models/xbot-profile.json';
import {newSceneProp} from './sceneProps';

const bytes=fs.readFileSync(new URL('../public/models/xbot.glb',import.meta.url));
async function fixture(){
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const e=Object.create(PoseEngine.prototype) as PoseEngine,model=new Group(),bones:Record<string,Bone>={};model.add(scene);model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const camera=new PerspectiveCamera(35,1,.01,100),target=new Vector3(0,.85,0);camera.position.set(0,1,3);camera.lookAt(target);camera.updateMatrixWorld(true);
  Object.assign(e,{model,bones,camera,orbit:{target,enabled:true,update(){e.camera.lookAt(target);e.camera.updateMatrixWorld(true);}},host:{clientWidth:900,clientHeight:900},transform:{dragging:false,setMode(){},attach(){},reset:vi.fn()},fly:{stop(){}},gizmo:new Object3D(),ready:false,profile,center:new Vector3(0,.85,0),span:1.98,views:structuredClone(DEFAULT_VIEWS),cameraState:defaultCameraSettings(),symmetry:defaultSymmetry(),selected:'LeftHand',mode:'translate',view:'free',handles:[],pins:{},targets:{},poles:{},ground:true,fullBody:true,hands:{Left:'张手',Right:'张手'},name:'实时对称验收',onInfo:vi.fn(),onCommit:vi.fn()});
  for(const end of END_EFFECTORS){e.targets[end]=e.world(end).toArray();e.poles[end]=e.world(end).add(new Vector3(0,0,.8)).toArray();}e.rest=e.snapshot();e.ready=true;e.applyPreset(PRESETS[0],false);e.setFramingLock(true);vi.mocked(e.onCommit).mockClear();return e;
}
const internal=(e:PoseEngine)=>e as unknown as {beginPoseDrag():void;finishPoseDrag():void;interruptPoseDrag():void;manipulate():boolean};
const reflected=(e:PoseEngine,point:Vector3,parent:string)=>{const m=e.bones[parent].matrixWorld,p=point.clone().applyMatrix4(m.clone().invert());p.x*=-1;return p.applyMatrix4(m);};
function expectMirrored(e:PoseEngine,group:SymmetryGroup,side:Side){
  const other=side==='Left'?'Right':'Left',end=group==='arms'?'Hand':'Foot',parent=group==='arms'?'UpperChest':'Hips';
  expect(e.world(`${other}${end}`).distanceTo(reflected(e,e.world(`${side}${end}`),parent))).toBeLessThan(.0003);
  for(const part of limbParts(group))expect(e.bones[`${other}${part}`].quaternion.angleTo(mirroredRotation(e.bones[`${side}${part}`].quaternion))).toBeLessThan(.0002);
}

describe('实时对称四肢编辑',()=>{
  it('识别真实四肢，排除中线、指骨、末端和非法设置',()=>{
    for(const n of ['Hips','Chest','Head','LeftIndex1','RightThumb3','LeftToe_End','Unknown'])expect(symmetricLimb(n)).toBeNull();expect(symmetricLimb('RightForeArm')).toMatchObject({side:'Right',other:'Left',group:'arms'});expect(validSymmetry(defaultSymmetry())).toBe(true);for(const v of [null,[],{},true,{arms:1,legs:false},{arms:true,legs:false,extra:true}])expect(validSymmetry(v)).toBe(false);
  });
  it('开关默认关闭，开启不改变人体、固定点、道具、相机或历史',async()=>{
    const e=await fixture();e.props=[newSceneProp('chair','chair-test')];e.setFeetPin(true);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();e.setSymmetry('arms',true);const after=e.snapshot();
    for(const key of ['joints','root','targets','poles','pins','camera','props','hands'] as const)expect(after[key]).toEqual(before[key]);expect(after.symmetry).toEqual({arms:true,legs:false});expect(e.onCommit).toHaveBeenCalledOnce();expect(vi.mocked(e.onCommit).mock.calls[0][1]).toBe(false);
  });
  for(const group of ['arms','legs'] as const)for(const side of ['Left','Right'] as const)it(`${group}:${side}位置输入成对镜像，保留身体、手型和另一组状态`,async()=>{
    const e=await fixture(),end=`${side}${group==='arms'?'Hand':'Foot'}`;e.setHand('Left','V 手势');e.setHand('Right','握拳');e.setSymmetry(group,true);e.select(end);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();e.setSelectedPosition(1,e.world(end).y+.12);const after=e.snapshot();expectMirrored(e,group,side);
    const changed=new Set((['Left','Right'] as const).flatMap(s=>limbParts(group).map(p=>`${s}${p}`)));for(const name of Object.keys(before.joints))if(!changed.has(name))expect(after.joints[name]).toEqual(before.joints[name]);
    expect(after.root).toEqual(before.root);expect(after.hands).toEqual(before.hands);expect(after.camera).toEqual(before.camera);expect(e.onCommit).toHaveBeenCalledOnce();for(const other of END_EFFECTORS.filter(n=>n.endsWith(group==='arms'?'Foot':'Hand'))){expect(after.targets[other]).toEqual(before.targets[other]);expect(after.poles[other]).toEqual(before.poles[other]);}
  });
  for(const side of ['Left','Right'] as const)it(`${side}肩、手腕旋转、前臂翻转和重置使用同一组镜像规则`,async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.select(`${side}Shoulder`);e.setSelectedRotation(2,10);expectMirrored(e,'arms',side);e.select(`${side}Hand`);e.setSelectedRotation(1,25);expectMirrored(e,'arms',side);e.setForearmTwist(side,60);expectMirrored(e,'arms',side);const hands=e.snapshot().hands;e.resetSelected();expectMirrored(e,'arms',side);expect(e.snapshot().hands).toEqual(hands);
  });
  it('局部中线跟随躯干和根变换，平移/转身/侧弯后仍在人体坐标中对称',async()=>{
    const e=await fixture();e.model.position.set(.4,.2,-.35);e.model.quaternion.setFromAxisAngle(new Vector3(0,1,0),.8);e.bones.Spine.quaternion.setFromEuler(new Euler(.08,.15,.1));e.model.updateMatrixWorld(true);e.setSymmetry('arms',true);e.select('LeftArm');const before=e.snapshot();e.setSelectedRotation(0,15);expectMirrored(e,'arms','Left');expect(e.snapshot().root).toEqual(before.root);expect(e.snapshot().joints.Spine).toEqual(before.joints.Spine);
  });
  for(const pinned of END_EFFECTORS)it(`固定 ${pinned} 时拒绝该组任意一侧编辑，完整快照不变且不产生历史`,async()=>{
    const e=await fixture(),group=pinned.endsWith('Hand')?'arms':'legs',part=group==='arms'?'Hand':'Foot';e.setSymmetry(group,true);e.pins[pinned]={position:e.world(pinned).toArray(),quaternion:e.bones[pinned].getWorldQuaternion(new Quaternion()).toArray(),orientation:true};
    for(const side of ['Left','Right']){e.select(`${side}${part}`);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();e.setSelectedPosition(1,e.world(`${side}${part}`).y+.1);expect(e.snapshot()).toEqual(before);expect(e.warning).toContain('固定冲突');expect(e.onCommit).not.toHaveBeenCalled();e.setSelectedRotation(0,30);expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();}
  });
  it('双脚固定时仍可对称调双臂，脚的位置、方向和固定信息保持不变',async()=>{
    const e=await fixture();e.setFeetPin(true);e.setSymmetry('arms',true);e.select('RightHand');const before=e.snapshot(),feet=['LeftFoot','RightFoot'].map(n=>({p:e.world(n),q:e.bones[n].getWorldQuaternion(new Quaternion())}));e.setSelectedPosition(1,e.world('RightHand').y+.2);expectMirrored(e,'arms','Right');expect(e.pins).toEqual(before.pins);
    for(const [i,n]of ['LeftFoot','RightFoot'].entries()){expect(e.world(n).distanceTo(feet[i].p)).toBeLessThan(1e-12);expect(e.bones[n].getWorldQuaternion(new Quaternion()).angleTo(feet[i].q)).toBeLessThan(1e-7);}
  });
  it('骨盆下沉且屈膝时伸直膝盖会穿地，整体回退；关闭地面约束后允许自由调整',async()=>{
    const e=await fixture();e.bones.Hips.position.y-=.2;e.setGround(false);e.setSymmetry('legs',true);e.select('LeftLeg');e.setSelectedRotation(0,90);e.setGround(true);expect(e.world('LeftFoot').y).toBeGreaterThan(e.rest.targets.LeftFoot[1]);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();e.setSelectedRotation(0,0);expect(e.warning).toContain('低于地面');expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();e.setGround(false);e.setSelectedRotation(0,0);expect(e.snapshot().joints.LeftLeg).not.toEqual(before.joints.LeftLeg);expectMirrored(e,'legs','Left');
  });
  it('前掌旋转镜像、关节限位与骨长均保持有效',async()=>{
    const e=await fixture();e.setGround(false);e.setSymmetry('legs',true);e.setToeBend('Right',180);expect(e.info().toes.Right).toBeCloseTo(65,7);expectMirrored(e,'legs','Right');e.select('LeftFoot');e.setSelectedPosition(0,9);expectMirrored(e,'legs','Left');for(const [name,joint]of Object.entries(e.snapshot().joints)){expect(joint.position.every(Number.isFinite)&&joint.quaternion.every(Number.isFinite)).toBe(true);expect(joint.position).toEqual(e.rest.joints[name].position);}
  });
  it('指骨精调、手势库和动作预设不被四肢开关自动镜像',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.setSymmetry('legs',true);const before=e.snapshot();e.setHand('Left','V 手势');e.setFinger('Left','Thumb',1,20,'curl');for(const d of DIGITS)for(let j=1;j<=3;j++)expect(e.snapshot().joints[`Right${d}${j}`]).toEqual(before.joints[`Right${d}${j}`]);e.applyPreset(PRESETS.find(p=>p.id==='wave')!);expect(e.symmetry).toEqual({arms:true,legs:true});expect(e.world('RightHand').y).toBeLessThan(e.world('LeftHand').y-.3);
  });
  it('固定点冲突不阻止显式手势编辑，关闭对称后恢复单侧控制',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.select('RightHand');e.setPin(true);e.select('LeftHand');e.setSelectedPosition(1,1.1);expect(e.warning).toContain('固定冲突');e.setHand('Left','握拳');expect(e.hands.Left).toBe('握拳');e.setSymmetry('arms',false);const right=e.snapshot().joints.RightArm;e.setSelectedPosition(1,1.1);expect(e.snapshot().joints.RightArm.position).toEqual(right.position);expect(e.bones.RightArm.quaternion.angleTo(new Quaternion().fromArray(right.quaternion))).toBeLessThan(1e-7);expect(e.world('LeftHand').y).toBeGreaterThan(1);
  });
  it('连续拖动从按下时快照求解，绕行回同一目标不漂移，一次拖动只提交一次',async()=>{
    const e=await fixture(),direct=await fixture();for(const engine of [e,direct]){engine.setSymmetry('arms',true);engine.setFeetPin(true);engine.select('LeftHand');internal(engine).beginPoseDrag();vi.mocked(engine.onCommit).mockClear();}
    const origin=e.world('LeftHand');for(let i=0;i<80;i++){e.gizmo.position.copy(origin).add(new Vector3(.07*Math.sin(i),.1+.06*Math.cos(i),.08));internal(e).manipulate();expectMirrored(e,'arms','Left');}
    const target=origin.add(new Vector3(.03,.15,.09));for(const engine of [e,direct]){engine.gizmo.position.copy(target);internal(engine).manipulate();expect(engine.onCommit).not.toHaveBeenCalled();internal(engine).finishPoseDrag();expect(engine.onCommit).toHaveBeenCalledOnce();}
    for(const name of Object.keys(e.bones))expect(e.bones[name].quaternion.angleTo(direct.bones[name].quaternion)).toBeLessThan(1e-7);expect(e.snapshot().poles).toEqual(direct.snapshot().poles);
  });
  it('Esc 取消和被固定点拒绝的拖动均不产生历史，之后仍能正常输入',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.select('LeftHand');const before=e.snapshot();internal(e).beginPoseDrag();vi.mocked(e.onCommit).mockClear();e.gizmo.position.y+=.2;internal(e).manipulate();e.cancelDrag();internal(e).finishPoseDrag();expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();e.setSelectedPosition(1,1.1);expect(e.onCommit).toHaveBeenCalledOnce();
    e.select('RightHand');e.setPin(true);e.select('LeftHand');const pinned=e.snapshot();internal(e).beginPoseDrag();vi.mocked(e.onCommit).mockClear();e.gizmo.position.y+=.1;internal(e).manipulate();internal(e).finishPoseDrag();expect(e.snapshot()).toEqual(pinned);expect(e.onCommit).not.toHaveBeenCalled();
  });
  it('从另一侧继续操作时镜像肘膝方向目标，避免使用旧的非对称极向点',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.select('LeftForeArm');e.setSelectedPosition(2,e.world('LeftForeArm').z-.1);const expected=reflected(e,new Vector3().fromArray(e.poles.LeftHand),'UpperChest');expect(new Vector3().fromArray(e.poles.RightHand).distanceTo(expected)).toBeLessThan(1e-12);e.select('RightHand');e.setSelectedPosition(1,e.world('RightHand').y+.04);expectMirrored(e,'arms','Right');
  });
  it('拖动中切换开关先取消姿态预览，仅保存新工具设置',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.select('LeftHand');const before=e.snapshot();internal(e).beginPoseDrag();e.gizmo.position.y+=.15;internal(e).manipulate();vi.mocked(e.onCommit).mockClear();e.setSymmetry('arms',false);internal(e).finishPoseDrag();expect(e.snapshot().joints).toEqual(before.joints);expect(e.symmetry.arms).toBe(false);expect(e.onCommit).toHaveBeenCalledOnce();expect(vi.mocked(e.onCommit).mock.calls[0][1]).toBe(false);
  });
  it('前臂和前掌滑杆预览成对更新，松开提交一次',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.setSymmetry('legs',true);vi.mocked(e.onCommit).mockClear();for(let i=0;i<30;i++){e.setForearmTwist('Left',i*2,false);expectMirrored(e,'arms','Left');}expect(e.onCommit).not.toHaveBeenCalled();e.commit();expect(e.onCommit).toHaveBeenCalledOnce();vi.mocked(e.onCommit).mockClear();for(let i=0;i<20;i++)e.setToeBend('Right',i*2,false);expect(e.onCommit).not.toHaveBeenCalled();expectMirrored(e,'legs','Right');e.commit();expect(e.onCommit).toHaveBeenCalledOnce();
  });
  it('对称开关不改变显式的单侧道具定位，之后固定点会拦截实时调整',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);const id=e.addProp('table'),point=e.world('LeftHand').add(new Vector3(.03,0,.04));e.changeProp(id,{position:[point.x,0,point.z],size:[.5,point.y,.4]});const before=e.snapshot();e.placeOnProp(id,'center','LeftHand');expect(e.snapshot().joints.RightArm).toEqual(before.joints.RightArm);expect(e.pins.LeftHand).toBeDefined();const pinned=e.snapshot();e.setSelectedPosition(1,e.world('LeftHand').y+.1);expect(e.snapshot()).toEqual(pinned);expect(e.warning).toContain('固定冲突');
  });
  it('失焦或捕获中断的处理恢复双方姿态并结束拖动，正常松开后不会误取消',async()=>{
    const e=await fixture();Object.assign(e.transform,{pointerUp(){internal(e).finishPoseDrag();}});e.setSymmetry('arms',true);e.select('LeftHand');const before=e.snapshot();internal(e).beginPoseDrag();vi.mocked(e.onCommit).mockClear();e.gizmo.position.y+=.1;internal(e).manipulate();internal(e).interruptPoseDrag();expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    internal(e).beginPoseDrag();e.gizmo.position.y+=.15;internal(e).manipulate();internal(e).finishPoseDrag();const committed=e.snapshot();internal(e).interruptPoseDrag();expect(e.snapshot()).toEqual(committed);expect(e.onCommit).toHaveBeenCalledOnce();
  });
  it('窗口改尺寸时取消双方未提交的拖动，保持观察镜头与开关',async()=>{
    const e=await fixture();Object.assign(e,{renderer:{setSize(){}}});Object.assign(e.transform,{pointerUp(){internal(e).finishPoseDrag();}});e.setSymmetry('legs',true);e.select('LeftFoot');const before=e.snapshot();internal(e).beginPoseDrag();vi.mocked(e.onCommit).mockClear();e.gizmo.position.y+=.1;internal(e).manipulate();e.resize();expect(e.snapshot().joints).toEqual(before.joints);expect(e.symmetry).toEqual(before.symmetry);expect(e.onCommit).not.toHaveBeenCalled();
  });
});

describe('对称设置与工程、历史、输出',()=>{
  it('工程往返与刷新数据保存开关，旧工程默认关闭，无效设置拒绝导入',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.setSymmetry('legs',true);const doc=e.snapshot(),copy=await fixture();copy.apply(parseDocument(JSON.stringify(doc),copy.rest));expect(copy.symmetry).toEqual({arms:true,legs:true});const old={...doc};delete old.symmetry;copy.apply(parseDocument(JSON.stringify(old),copy.rest));expect(copy.symmetry).toEqual(defaultSymmetry());for(const symmetry of [null,{arms:true},{arms:'yes',legs:false},{arms:true,legs:false,unknown:true}])expect(()=>parseDocument(JSON.stringify({...doc,symmetry}),e.rest)).toThrow('对称');
  });
  it('姿态撤销/重做保留当前开关和镜头，收藏恢复可显式保留编辑工具',async()=>{
    const e=await fixture();e.setSymmetry('arms',true);e.select('LeftHand');const before=e.snapshot();e.setSelectedPosition(1,1.1);const after=e.snapshot();e.setSymmetry('legs',true);const camera=e.getCameraSettings();for(const doc of [before,after]){e.apply(doc,true,false);expect(e.symmetry).toEqual({arms:true,legs:true});expect(e.getCameraSettings()).toEqual(camera);}e.apply(before,true,true,false,false);expect(e.symmetry).toEqual({arms:true,legs:true});
  });
  it('两侧更新进入三维和 OpenPose 导出，身体与指骨局部角度仍保留',async()=>{
    const e=await fixture(),before=e.worldPose();e.setSymmetry('arms',true);e.select('LeftHand');e.setSelectedPosition(1,1.13);const after=e.worldPose();expect(after.body[4]).not.toEqual(before.body[4]);expect(after.body[7]).not.toEqual(before.body[7]);expect(after.body[0]).toEqual(before.body[0]);const frame=e.openPose(e.camera,1024,1024,false);expect(frame.people).toHaveLength(1);expect(frame.people[0].hand_left_keypoints_2d).toHaveLength(63);expect(frame.people[0].hand_right_keypoints_2d).toHaveLength(63);
  });
});
