import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {Bone,Group,Object3D,Vector3,Quaternion,Matrix4,PerspectiveCamera} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PoseEngine} from './PoseEngine';
import {HAND_GESTURES,MAX_SAVED_HANDS,validHandValues,parseHandLibrary,handLibraryDocument,writeHandValues} from './handGestures';
import {cloneHandRig} from './HandPreview';
import {parseDocument} from './files';
import {DIGITS,END_EFFECTORS,DEFAULT_VIEWS,type Side} from './types';
import {PRESETS} from './presets';
import {defaultCameraSettings} from './cameraState';
import profile from '../public/models/xbot-profile.json';

const bytes=fs.readFileSync(new URL('../public/models/xbot.glb',import.meta.url));
async function fixture(){
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const e=Object.create(PoseEngine.prototype) as PoseEngine,model=new Group(),bones:Record<string,Bone>={};model.add(scene);model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const camera=new PerspectiveCamera(35,1,.01,100),target=new Vector3(0,.85,0);camera.position.set(0,1,3);camera.lookAt(target);camera.updateMatrixWorld(true);
  Object.assign(e,{model,bones,camera,orbit:{target,enabled:true,update(){e.camera.lookAt(target);e.camera.updateMatrixWorld(true);}},host:{clientWidth:900,clientHeight:900},transform:{dragging:false,setMode(){},attach(){}},fly:{stop(){}},gizmo:new Object3D(),ready:false,profile,center:new Vector3(0,.85,0),span:1.98,views:structuredClone(DEFAULT_VIEWS),cameraState:defaultCameraSettings(),selected:'LeftHand',mode:'translate',view:'free',handles:[],pins:{},targets:{},poles:{},ground:true,fullBody:true,hands:{Left:'张手',Right:'张手'},name:'手势验收',onInfo:vi.fn(),onCommit:vi.fn()});
  for(const end of END_EFFECTORS){e.targets[end]=e.world(end).toArray();e.poles[end]=e.world(end).add(new Vector3(0,0,.8)).toArray();}e.rest=e.snapshot();e.ready=true;return e;
}

describe('独立手势库及真实 X Bot 隔离',()=>{
  it('提供 12 个不同手型，左右共用且全部符合本模型指骨范围',()=>{
    expect(HAND_GESTURES).toHaveLength(12);expect(new Set(HAND_GESTURES.map(g=>g.id)).size).toBe(12);expect(new Set(HAND_GESTURES.map(g=>JSON.stringify(g.values))).size).toBe(12);for(const g of HAND_GESTURES)expect(validHandValues(g.values)).toBe(true);
  });
  for(const side of ['Left','Right'] as const)it(`${side}校准后的 V 手势分开双指，OK 与捏合的拇食指末端接近`,async()=>{
    const e=await fixture();e.setHand(side,'张手');const open=e.world(`${side}Index4`).distanceTo(e.world(`${side}Middle4`));e.setHand(side,'V 手势');expect(e.world(`${side}Index4`).distanceTo(e.world(`${side}Middle4`))).toBeGreaterThan(open*1.8);
    for(const name of ['OK 手势','捏合']){e.setHand(side,name);const gap=e.world(`${side}Index4`).distanceTo(e.world(`${side}Thumb4`));expect(gap).toBeGreaterThan(.008);expect(gap).toBeLessThan(.014);}
  });
  for(const side of ['Left','Right'] as const)for(const g of HAND_GESTURES)it(`${side}应用${g.name}只改 15 节指骨，固定腕和其他状态不变，提交一次`,async()=>{
    const e=await fixture();e.applyPreset(PRESETS[15],false);e.pins[`${side}Hand`]={position:e.world(`${side}Hand`).toArray(),quaternion:e.bones[`${side}Hand`].getWorldQuaternion(new Quaternion()).toArray(),orientation:true};e.setFramingLock(true);const before=e.snapshot(),calls=vi.mocked(e.onCommit).mock.calls.length;
    e.setHand(side,g.name);const after=e.snapshot();for(const name of Object.keys(before.joints))if(!DIGITS.some(d=>[1,2,3].some(j=>name===`${side}${d}${j}`)))expect(after.joints[name]).toEqual(before.joints[name]);
    for(const key of ['root','targets','poles','pins','camera','referenceImage'] as const)expect(after[key]).toEqual(before[key]);expect(after.hands[side]).toBe(g.name);expect(vi.mocked(e.onCommit).mock.calls).toHaveLength(calls+1);expect(e.captureHand(side)).toEqual(g.values);
  });
  for(const source of ['Left','Right'] as const)it(`${source}手部复制只改目标指骨，回拷恢复且局部旋转符合镜像`,async()=>{
    const e=await fixture(),target:Side=source==='Left'?'Right':'Left',g=HAND_GESTURES[4];e.setHand(source,g.name);const before=e.snapshot();e.copyHand(source);const after=e.snapshot(),reflection=new Matrix4().makeScale(-1,1,1);
    for(const name of Object.keys(before.joints))if(!DIGITS.some(d=>[1,2,3].some(j=>name===`${target}${d}${j}`)))expect(after.joints[name]).toEqual(before.joints[name]);
    for(const d of DIGITS)for(let j=1;j<=3;j++){const q=e.bones[`${source}${d}${j}`].quaternion,m=new Matrix4().makeRotationFromQuaternion(q).premultiply(reflection).multiply(reflection);expect(e.bones[`${target}${d}${j}`].quaternion.angleTo(new Quaternion().setFromRotationMatrix(m))).toBeLessThan(Math.PI/180*.01);}
    e.copyHand(target);expect(e.captureHand(source)).toEqual(g.values);
  });
  it('自定义收藏可应用到另一侧，工程往返和姿态撤销恢复手型',async()=>{
    const e=await fixture(),before=e.snapshot();e.setFinger('Left','Thumb',1,32,'curl');e.setFinger('Left','Index',2,77,'curl');e.setFinger('Left','Little',1,13,'spread');const values=e.captureHand('Left');
    const saved=parseHandLibrary(JSON.stringify(handLibraryDocument([{id:'custom-grip',name:'轻握杯柄',values}])));e.applyHandGesture('Right',saved[0].values);expect(e.captureHand('Right')).toEqual(values);expect(e.hands.Right).toBe('自定义');const doc=e.snapshot();e.apply(parseDocument(JSON.stringify(doc),e.rest));expect(e.captureHand('Right')).toEqual(values);e.apply(before,true,false);expect(e.captureHand('Right')).toEqual(HAND_GESTURES[0].values);
  });
  it('新手势改变相应手的 2D/3D 数据而保持身体、手腕与另一侧投影',async()=>{
    const e=await fixture(),before=e.worldPose(),frame=e.openPose(e.camera,768,1024,false);e.setHand('Left','V 手势');const after=e.worldPose(),next=e.openPose(e.camera,768,1024,false);
    expect(after.body).toEqual(before.body);expect(after.Right).toEqual(before.Right);expect(after.Left[0]).toEqual(before.Left[0]);expect(after.Left[16]).not.toEqual(before.Left[16]);expect(next.people[0].pose_keypoints_2d).toEqual(frame.people[0].pose_keypoints_2d);expect(next.people[0].hand_right_keypoints_2d).toEqual(frame.people[0].hand_right_keypoints_2d);expect(next.people[0].hand_left_keypoints_2d).not.toEqual(frame.people[0].hand_left_keypoints_2d);
  });
  it('缩略图独立克隆的蒙皮和指骨不会改变主模型或相机状态',async()=>{
    const e=await fixture();e.applyPreset(PRESETS[15],false);const before=e.snapshot(),preview=cloneHandRig(e);expect(preview.bones.LeftHand).not.toBe(e.bones.LeftHand);for(const g of HAND_GESTURES){writeHandValues(preview.bones,e.rest.joints,'Left',g.values);preview.model.updateMatrixWorld(true);}expect(e.snapshot()).toEqual(before);expect(preview.bones.LeftIndex2.quaternion).not.toEqual(e.bones.LeftIndex2.quaternion);
  });
});

describe('手势库文件与旧工程兼容',()=>{
  const document=()=>handLibraryDocument([{...HAND_GESTURES[0],id:'local-hand',name:'杯柄预备'}]);
  it('导出/导入不包含完整人体、相机、图片或另一只手，并返回独立数据',()=>{const source=document(),copy=parseHandLibrary(JSON.stringify(source));expect(copy).toEqual(source.gestures);copy[0].values.Index.curl[0]=40;expect(source.gestures[0].values.Index.curl[0]).toBe(0);expect(Object.keys(source)).toEqual(['format','version','rig','rigVersion','gestures']);});
  it('拒绝错误版本、rig、超大文件、超量和重复编号，不接受非有限/越界角度',()=>{
    const invalid=[{...document(),version:2},{...document(),rig:'other-rig'},{...document(),gestures:Array(MAX_SAVED_HANDS+1).fill(document().gestures[0])},{...document(),gestures:[document().gestures[0],document().gestures[0]]},{...document(),gestures:[{...document().gestures[0],name:''}]}];for(const value of invalid)expect(()=>parseHandLibrary(JSON.stringify(value))).toThrow();expect(()=>parseHandLibrary('x'.repeat(150001))).toThrow('150 KB');
    for(const value of [NaN,Infinity,106,-11]){const v=structuredClone(HAND_GESTURES[0].values);v.Index.curl[1]=value;expect(validHandValues(v)).toBe(false);}const v=structuredClone(HAND_GESTURES[0].values);v.Thumb.spread=41;expect(validHandValues(v)).toBe(false);
  });
  it('旧张手/握拳/指向工程仍可打开，所有新手型标签均可往返，拒绝未知标签',async()=>{const e=await fixture();for(const g of HAND_GESTURES){const doc=e.snapshot();doc.hands.Left=g.name;expect(parseDocument(JSON.stringify(doc),e.rest).hands.Left).toBe(g.name);}const doc=e.snapshot();doc.hands.Left='未校准的手型';expect(()=>parseDocument(JSON.stringify(doc),e.rest)).toThrow('手型');});
});
