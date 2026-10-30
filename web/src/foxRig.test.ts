import {beforeAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Bone,Box3,Group,Mesh,Texture,Vector3,Quaternion,Object3D,SkinnedMesh} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {FOX_RIG} from './foxRig';
import {RIGS,rigOptions,BASIC_HUMAN_RIG,XBOT_RIG} from './rigs';
import {PoseEngine} from './PoseEngine';
import {DEFAULT_VIEWS,type PoseDocument} from './types';
import {parseDocument,documentRig} from './files';
import {fkAngles,fkRotation,constrainFk} from './fkControls';
import {ensureRigNormals} from './rigGeometry';
import profile from '../public/models/fox/fox-profile.json';
import source from '../public/models/fox/source.json';
import prepared from '../public/models/fox/prepared.json';
import xbotProfile from '../public/models/xbot-profile.json';

const bytes=(name:string)=>readFileSync(new URL(name,import.meta.url));
const preparedBytes=bytes('../public/models/fox/fox.glb'),originalBytes=bytes('../../assets/source/fox/Fox.glb');
const glbJson=(data:Buffer)=>JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
const loader=new GLTFLoader();
// Node has no image decoder; geometry, hierarchy, binding and animation parsing are real.
// Actual texture decoding and rendered maps are verified separately in the browser.
loader.register(()=>({name:'TEST_TEXTURE_PLACEHOLDER',loadTexture:async()=>new Texture()}));
let fox:GLTF;
beforeAll(async()=>{fox=await loader.parseAsync(Uint8Array.from(preparedBytes).buffer,'');});
function fixture(){
  const model=new Group(),bones:Record<string,Bone>={};model.add(clone(fox.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{rigDefinition:FOX_RIG,model,bones,gizmo:new Object3D(),selected:FOX_RIG.initialSelection,mode:'rotate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'狐狸验证',ground:false,fullBody:false,warning:'',handDetail:null,transform:{setMode(){},attach(){}},onInfo(){},onCommit(){}});
  for(const end of FOX_RIG.contacts)e.targets[end]=e.world(end).toArray();e.rest=e.snapshot();return e;
}
function expectPoseClose(a:PoseDocument,b:PoseDocument){
  expect(Object.keys(a.joints)).toEqual(Object.keys(b.joints));
  for(const[name,j]of Object.entries(a.joints)){expect(new Quaternion().fromArray(j.quaternion).angleTo(new Quaternion().fromArray(b.joints[name].quaternion)),name).toBeLessThan(1e-7);j.position.forEach((v,i)=>expect(v,name).toBeCloseTo(b.joints[name].position[i],12));}
}

describe('Fox 资产与单位适配',()=>{
  it('固定来源与哈希，保留原许可和来源，而不是动态依赖外部 CDN',()=>{
    const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');expect(hash(originalBytes)).toBe(source.sha256);expect(hash(preparedBytes)).toBe(prepared.preparedSha256);expect(prepared.sourceCommit).toBe(source.sourceCommit);
    expect(FOX_RIG.attribution?.authors).toContain('tomkranis');expect(FOX_RIG.attribution?.authors).toContain('PixelMannen');expect(FOX_RIG.attribution?.licenseUrl).toContain('by/4.0');
    expect(readFileSync(new URL('../public/models/fox/SOURCE-LICENSE.md',import.meta.url),'utf8')).toContain('CC-BY-4.0');
  });
  it('原始坐标按 0.01 归一化，保留非零静止旋转、24 个蒙皮关节和 3 组原动画',()=>{
    const a=glbJson(originalBytes),b=glbJson(preparedBytes);expect(b.skins[0].joints).toHaveLength(24);expect(b.animations.map((x:{name:string})=>x.name)).toEqual(['Survey','Walk','Run']);
    a.nodes.forEach((node:{translation?:number[];rotation?:number[]},i:number)=>{expect(b.nodes[i].rotation).toEqual(node.rotation);if(node.translation)node.translation.forEach((v,k)=>expect(b.nodes[i].translation[k]).toBeCloseTo(v*.01,12));});
    const e=fixture();expect(Object.keys(e.bones)).toHaveLength(24);expect(FOX_RIG.editableJoints).toHaveLength(22);
    for(const [name,joint]of Object.entries(profile.bones)){expect(e.bones[name].position.toArray()).toEqual(joint.position);expect(e.bones[name].quaternion.toArray()).toEqual(joint.quaternion);}
    const box=new Box3().setFromObject(e.model,true),size=box.getSize(new Vector3());expect(size.y).toBeGreaterThan(.6);expect(size.y).toBeLessThan(1);expect(size.z).toBeGreaterThan(1.3);expect(size.z).toBeLessThan(1.8);
    expect(e.world('b_Head_05').z).toBeGreaterThan(e.world(FOX_RIG.root).z);expect(e.world('b_Tail03_014').z).toBeLessThan(e.world(FOX_RIG.root).z);
  });
  it('换算后的逆绑定矩阵保持蒙皮静止形状，所有骨段保持米制长度',()=>{
    const e=fixture();let count=0,maxError=0;
    e.model.traverse(o=>{if(o instanceof SkinnedMesh){o.skeleton.update();const attribute=o.geometry.attributes.position;for(let i=0;i<attribute.count;i++){const position=new Vector3().fromBufferAttribute(attribute,i);maxError=Math.max(maxError,o.applyBoneTransform(i,position.clone()).distanceTo(position));count++;}}});
    expect(count).toBe(1728);expect(maxError).toBeLessThan(2e-7);expect(Math.max(...Object.values(e.bones).map(b=>b.position.length()))).toBeLessThan(1);
  });
  it('补齐原文件缺失的顶点法线，数据图材质可以取得有效单位法线',()=>{
    expect(glbJson(preparedBytes).meshes[0].primitives[0].attributes.NORMAL).toBeUndefined();
    const root=clone(fox.scene);root.traverse(o=>{if(o instanceof Mesh){o.geometry=o.geometry.clone();o.geometry.deleteAttribute('normal');}});ensureRigNormals(root);
    let valid=0;root.traverse(o=>{if(o instanceof Mesh){const normals=o.geometry.getAttribute('normal');expect(normals.count).toBe(o.geometry.getAttribute('position').count);for(let i=0;i<normals.count;i++){expect(new Vector3().fromBufferAttribute(normals,i).length()).toBeCloseTo(1,5);valid++;}}});expect(valid).toBe(1728);
  });
  it('归一化了动画平移和逆绑定矩阵的平移，旋转与纹理字节不变',()=>{
    const a=glbJson(originalBytes),b=glbJson(preparedBytes);
    const bin=(data:Buffer)=>data.subarray(20+data.readUInt32LE(12)+8),rawBin=bin(originalBytes),metreBin=bin(preparedBytes);
    const access=(g:typeof a,index:number)=>{const item=g.accessors[index],view=g.bufferViews[item.bufferView];return {item,start:(view.byteOffset??0)+(item.byteOffset??0),stride:view.byteStride};};
    for(const animation of b.animations)for(const channel of animation.channels){const i=animation.samplers[channel.sampler].output,{item,start,stride}=access(b,i),components=channel.target.path==='rotation'?4:3;for(let k=0;k<item.count;k++)for(let c=0;c<components;c++){const offset=start+k*(stride??components*4)+c*4,original=rawBin.readFloatLE(offset),actual=metreBin.readFloatLE(offset);expect(actual).toBeCloseTo(channel.target.path==='translation'?original*.01:original,6);}}
    const {item,start,stride}=access(b,b.skins[0].inverseBindMatrices);for(let k=0;k<item.count;k++)for(let c=0;c<16;c++){const offset=start+k*(stride??64)+c*4;expect(metreBin.readFloatLE(offset)).toBeCloseTo(rawBin.readFloatLE(offset)*(c>=12&&c<=14?.01:1),6);}
    expect(b.images).toEqual(a.images);for(const image of b.images){const view=b.bufferViews[image.bufferView],offset=view.byteOffset??0;expect(metreBin.subarray(offset,offset+view.byteLength)).toEqual(rawBin.subarray(offset,offset+view.byteLength));}
  });
});

describe('非零静止旋转的 FK 编辑',()=>{
  it('头部与尾巴中立角为零，旋转相对于绑定基准，未编辑关节保持原旋转',()=>{
    const e=fixture(),before=e.snapshot();e.select('b_Head_05');expect(e.info().rotation.every(v=>Math.abs(v)<1e-9)).toBe(true);e.setSelectedRotation(1,20);expect(e.info().rotation[1]).toBeCloseTo(20);
    const expected=fkRotation([0,20,0],new Quaternion().fromArray(before.joints.b_Head_05.quaternion));expect(e.bones.b_Head_05.quaternion.angleTo(expected)).toBeLessThan(1e-7);
    for(const name of Object.keys(e.bones))if(name!=='b_Head_05')expect(e.bones[name].quaternion.toArray()).toEqual(before.joints[name].quaternion);
    const tailBefore=e.world('b_Tail03_014');e.select('b_Tail01_012');e.setSelectedRotation(1,35);expect(e.info().rotation[1]).toBeCloseTo(35);expect(e.world('b_Tail03_014').distanceTo(tailBefore)).toBeGreaterThan(.1);
    expect(e.bones.b_Head_05.quaternion.angleTo(expected)).toBeLessThan(1e-7);
  });
  it('四足肘膝的单轴限位使用静止基准，不拉直或反向翻转原始肢体',()=>{
    const e=fixture();for(const name of ['b_LeftForeArm_010','b_RightLeg02_020']){
      e.select(name);const control=FOX_RIG.jointControls!.find(j=>j.name===name)!,rest=new Quaternion().fromArray(e.rest.joints[name].quaternion);
      expect(e.info().rotation.every(v=>Math.abs(v)<1e-9)).toBe(true);e.setSelectedRotation(2,170);expect(e.info().rotation[2]).toBeCloseTo(control.limits![1][2]);
      e.setSelectedRotation(2,-170);expect(e.info().rotation[2]).toBeCloseTo(control.limits![0][2]);
      expect(Math.abs(fkAngles(e.bones[name].quaternion,rest,control)[0])).toBeLessThan(1e-7);expect(e.canRotateAxis(0)).toBe(false);
      e.resetSelected();expect(e.bones[name].quaternion.toArray()).toEqual(e.rest.joints[name].quaternion);
    }
  });
  it('世界旋转操纵器从拖动起点计算，连续事件不会累积扭转',()=>{
    const e=fixture();e.select('b_Tail02_013');e.mode='rotate';
    const before=e.snapshot(),bone=e.bones[e.selected],local=fkRotation([0,25,10],new Quaternion().fromArray(before.joints[e.selected].quaternion));
    const desiredWorld=bone.parent!.getWorldQuaternion(new Quaternion()).multiply(local);e.gizmo.quaternion.copy(desiredWorld);
    const drag=e as unknown as {dragBefore:PoseDocument;manipulate():void};drag.dragBefore=before;
    for(let i=0;i<30;i++)drag.manipulate();expect(e.info().rotation[1]).toBeCloseTo(25);expect(e.info().rotation[2]).toBeCloseTo(10);
    for(const name of Object.keys(e.bones))if(name!==e.selected)expect(e.bones[name].quaternion.toArray()).toEqual(before.joints[name].quaternion);
  });
  it('反复恢复与导入不累积误差；根部平移正确，其他骨段长度不变',()=>{
    const e=fixture();e.select('b_Tail02_013');e.setSelectedRotation(2,30);e.select(FOX_RIG.root);e.setSelectedPosition(0,.25);expect(e.world(FOX_RIG.root).x).toBeCloseTo(.25);
    const before=e.snapshot();for(let i=0;i<20;i++)e.apply(before);expectPoseClose(e.snapshot(),before);
    const other=fixture();other.apply(parseDocument(JSON.stringify(before),other.rest));expectPoseClose(other.snapshot(),before);
    for(const[name,j]of Object.entries(before.joints))if(name!==FOX_RIG.root)expect(j.position).toEqual(e.rest.joints[name].position);
    e.select('b_Head_05');const stable=e.snapshot();e.setSelectedPosition(1,1);expect(e.snapshot()).toEqual(stable);
  });
  it('局部坐标操纵器也使用同一限位策略，静止四元数保持有效',()=>{
    const control=FOX_RIG.jointControls!.find(c=>c.name==='b_Tail01_012')!,rest=new Quaternion().fromArray(profile.bones.b_Tail01_012.quaternion);
    for(let i=0;i<80;i++){const input=fkRotation([Math.sin(i)*130,Math.cos(i)*140,Math.sin(i*.5)*100],rest,control),limited=constrainFk(input,rest,control),angles=fkAngles(limited,rest,control);angles.forEach((v,k)=>{expect(v).toBeGreaterThanOrEqual(control.limits![0][k]-1e-6);expect(v).toBeLessThanOrEqual(control.limits![1][k]+1e-6);});expect(limited.length()).toBeCloseTo(1,7);expect(limited.angleTo(constrainFk(limited,rest,control))).toBeLessThan(1e-7);}
  });
  it('只输出真实通用骨架，选择器替换测试人形且旧工程入口继续可用',()=>{
    const e=fixture(),data=e.genericSkeletonData();expect(data.joints).toHaveLength(24);expect(data.joints.find(j=>j.name==='b_Tail03_014')?.parent).toBe('b_Tail02_013');expect(()=>e.openPose({} as never,512,512)).toThrow('OpenPose');
    expect(documentRig(JSON.stringify(e.snapshot()))).toBe(FOX_RIG);expect(RIGS.map(r=>r.id)).toEqual([XBOT_RIG.id,FOX_RIG.id]);expect(rigOptions(BASIC_HUMAN_RIG)).toContain(BASIC_HUMAN_RIG);
  });
  it('旧 X Bot 资产格式 version=2 不被当作骨架修订版本拒绝',async()=>{
    const gltf=await loader.parseAsync(Uint8Array.from(bytes('../public/models/xbot.glb')).buffer,'');const e=fixture();
    Object.assign(e,{rigDefinition:XBOT_RIG,model:new Group(),bones:{},helpers:new Group(),handles:[],vertexCount:0,selected:'LeftHand',update(){},select(){}});
    const load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockResolvedValue(gltf);vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>xbotProfile}));
    try{await e.load();expect(Object.keys(e.bones)).toHaveLength(68);expect(e.rest.rig).toBe(XBOT_RIG.id);}finally{load.mockRestore();vi.unstubAllGlobals();}
  });
});
