import {describe,it,expect,vi} from 'vitest';
import {Group,Object3D,Quaternion,Texture,MeshStandardMaterial,Mesh,BoxGeometry} from 'three';
import {PoseEngine} from './PoseEngine';
import {buildProceduralRig,disposeObject} from './rigGeometry';
import {BASIC_HUMAN_RIG,XBOT_RIG,rigStorageKey,readRigStorage,type RigDefinition} from './rigs';
import {RigSwitchCoordinator,actorHistory,sceneState,withScene} from './rigWorkspace';
import {DEFAULT_VIEWS} from './types';
import {parseDocument,documentRig} from './files';
import {defaultSymmetry} from './symmetry';
import {handLibraryKey,handLibraryDocument,parseHandLibrary,HAND_GESTURES} from './handGestures';
import {newSceneProp} from './sceneProps';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// A nonhuman topology with no humanoid names, limbs, hands or COCO mapping.
const chainRig:RigDefinition={...BASIC_HUMAN_RIG,id:'test-articulated-chain',name:'测试关节链',root:'base',initialSelection:'tip',
  asset:{kind:'procedural',joints:[{name:'base',parent:null,position:[0,.2,0],label:'基座',labelEn:'Base'},{name:'link',parent:'base',position:[0,.3,0],label:'连接',labelEn:'Link'},{name:'tip',parent:'link',position:[.2,.2,0],label:'末端',labelEn:'Tip'}]},editableJoints:['base','link','tip']};
function fixture(rig:RigDefinition=BASIC_HUMAN_RIG){
  const {group,bones}=buildProceduralRig(rig),model=new Group();model.add(group);model.updateMatrixWorld(true);
  const engine=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(engine,{rigDefinition:rig,model,bones,selected:rig.initialSelection,gizmo:new Object3D(),mode:'rotate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'独立草稿',ground:false,fullBody:false,symmetry:defaultSymmetry(),warning:'',handDetail:null,vertexCount:0,transform:{setMode(){},attach(){}},onInfo(){},onCommit(){}});
  engine.rest=engine.snapshot();return engine;
}
const deferred=()=>{let resolve!:()=>void,reject!:(reason:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

describe('可变拓扑与工程隔离',()=>{
  for(const rig of [BASIC_HUMAN_RIG,chainRig])it(`${rig.id}旋转、平移、限位、保存和重开不依赖人体骨名`,()=>{
    const e=fixture(rig),last=rig.editableJoints.at(-1)!;e.select(last);e.setSelectedRotation(2,25);
    expect(e.bones[last].quaternion.angleTo(new Quaternion())).toBeGreaterThan(.01);
    const lengths=Object.fromEntries(Object.entries(e.bones).map(([n,b])=>[n,b.position.length()]));
    e.select(rig.root);e.setSelectedPosition(0,.3);expect(e.world(rig.root).x).toBeCloseTo(.3);
    for(const [name,bone]of Object.entries(e.bones))if(name!==rig.root)expect(bone.position.length()).toBeCloseTo(lengths[name],10);
    const doc=e.snapshot(),other=fixture(rig);other.apply(parseDocument(JSON.stringify(doc),other.rest,rig));
    expect(other.snapshot()).toEqual(doc);expect(e.genericSkeletonData().joints).toHaveLength(rig.editableJoints.length);
    expect(()=>e.openPose({} as never,512,512)).toThrow('没有人体 OpenPose');
    expect(()=>e.applyHandGesture('Left',HAND_GESTURES[0].values)).toThrow('不支持手势');
    e.setFeetPin(true);e.setFullBody(true);expect(e.pins).toEqual({});expect(e.fullBody).toBe(false);
    disposeObject(e.model);disposeObject(other.model);
  });
  it('基础人形膝盖不可反折，非根骨不能改变骨长',()=>{
    const e=fixture();e.select('l_knee');e.setSelectedRotation(0,-90);expect(e.info().rotation[0]).toBeCloseTo(0);
    e.setSelectedRotation(0,180);expect(e.info().rotation[0]).toBeCloseTo(150);
    const before=e.snapshot();e.setSelectedPosition(1,.7);expect(e.snapshot()).toEqual(before);
    const changed=structuredClone(before);changed.joints.l_elbow.position[0]+=.1;expect(()=>parseDocument(JSON.stringify(changed),e.rest)).toThrow('骨段长度');
    disposeObject(e.model);
  });
  it('单轴肘关节超过 90° 后仍可继续弯曲，导入与重复切换不累积旋转误差',()=>{
    const e=fixture();e.select('l_elbow');e.setSelectedRotation(1,-140);expect(e.info().rotation[1]).toBeCloseTo(-140);
    const saved=e.snapshot();for(let i=0;i<20;i++)e.apply(saved);expect(e.snapshot().joints).toEqual(saved.joints);
    e.setSelectedRotation(2,60);expect(e.snapshot().joints).toEqual(saved.joints);disposeObject(e.model);
  });
  it('普通骨架中类似人体的关节名不会自动启用人体控制',()=>{
    if(chainRig.asset.kind!=='procedural')throw new Error('fixture');
    const rig:RigDefinition={...chainRig,initialSelection:'LeftIndex1',editableJoints:['base','link','LeftIndex1'],asset:{kind:'procedural',joints:chainRig.asset.joints.map(j=>j.name==='tip'?{...j,name:'LeftIndex1'}:j)}};
    const e=fixture(rig);e.select('LeftIndex1');e.setSelectedRotation(0,15);expect(e.handDetail).toBeNull();expect(e.hands.Left).toBe('张手');expect(e.info().rotation[0]).toBeCloseTo(15);disposeObject(e.model);
  });
  it('拒绝跨骨架、未知骨架、未来版本与未知关节，旧 X Bot 缺省版本仍兼容',()=>{
    const e=fixture(),doc=e.snapshot();
    expect(documentRig(JSON.stringify(doc))).toBe(BASIC_HUMAN_RIG);
    expect(()=>documentRig(JSON.stringify({...doc,rig:'unknown'}))).toThrow('未安装骨架');
    expect(()=>documentRig(JSON.stringify({...doc,rigVersion:2}))).toThrow('版本不兼容');
    const legacy={...doc,rig:XBOT_RIG.id};delete legacy.rigVersion;expect(documentRig(JSON.stringify(legacy))).toBe(XBOT_RIG);
    expect(()=>e.apply(legacy)).toThrow('不兼容');
    expect(()=>parseDocument(JSON.stringify({...doc,selection:'LeftHand'}),e.rest)).toThrow('选中关节');
    expect(()=>parseDocument(JSON.stringify({...doc,pins:{LeftHand:{}}}),e.rest)).toThrow('固定部位');
    expect(()=>parseDocument(JSON.stringify({...doc,targets:{LeftHand:[0,0,0]}}),e.rest)).toThrow('IK');
    disposeObject(e.model);
  });
  it('草稿、收藏和手势按 id 与版本隔离，只对 X Bot 读取旧键',()=>{
    for(const kind of ['draft','library'] as const){
      expect(rigStorageKey(kind,XBOT_RIG)).not.toBe(rigStorageKey(kind,BASIC_HUMAN_RIG));
      expect(rigStorageKey(kind,XBOT_RIG)).not.toBe(rigStorageKey(kind,{...XBOT_RIG,version:2}));
      const oldKey=`momo-pose-forge:${kind}:${XBOT_RIG.id}`,storage={getItem:(key:string)=>key===oldKey?'legacy':null};
      expect(readRigStorage(storage,kind,XBOT_RIG)).toBe('legacy');expect(readRigStorage(storage,kind,BASIC_HUMAN_RIG)).toBeNull();
    }
    expect(()=>handLibraryKey(BASIC_HUMAN_RIG)).toThrow('不支持手势');
    const gestures=JSON.stringify(handLibraryDocument([HAND_GESTURES[0]]));expect(()=>parseHandLibrary(gestures,BASIC_HUMAN_RIG)).toThrow('骨架版本');
    const legacy=JSON.parse(gestures);delete legacy.rigVersion;expect(parseHandLibrary(JSON.stringify(legacy))).toHaveLength(1);
  });
  it('切回角色时恢复姿态和选择，恢复旧历史时保留当前场景',()=>{
    const a=fixture(),b=fixture(chainRig);a.select('l_elbow');a.setSelectedRotation(1,-65);const aBefore=a.snapshot(),history=actorHistory(aBefore);
    b.select('link');b.setSelectedRotation(2,40);const bBefore=b.snapshot();
    const scene=sceneState({...bBefore,props:[newSceneProp('box','shared-box')]});
    a.apply(withScene(aBefore,scene));expect(a.selected).toBe('l_elbow');expect(a.snapshot().joints).toEqual(aBefore.joints);expect(a.props[0].id).toBe('shared-box');
    b.apply(withScene(bBefore,sceneState(a.snapshot())));expect(b.snapshot().joints).toEqual(bBefore.joints);
    expect(history.camera).toBeUndefined();expect(history.props).toBeUndefined();expect(withScene(history,scene).props).toEqual(scene.props);
    disposeObject(a.model);disposeObject(b.model);
  });
});

describe('骨架切换事务与资源生命周期',()=>{
  it('模型成功但定义网络失败时也释放已加载的 GPU 资源',async()=>{
    const geometry=new BoxGeometry(),group=new Group();group.add(new Mesh(geometry,new MeshStandardMaterial()));const disposed=vi.spyOn(geometry,'dispose');
    const loader=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockResolvedValue({scene:group} as never);vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('profile offline')));
    const e=fixture();Object.assign(e,{rigDefinition:XBOT_RIG});
    try{await expect(e.load()).rejects.toThrow('profile offline');expect(disposed).toHaveBeenCalledOnce();expect(e.model.children).toHaveLength(1);}finally{loader.mockRestore();vi.unstubAllGlobals();disposeObject(e.model);}
  });
  it('加载失败和验证失败均保留上一个运行时，销毁失败候选',async()=>{
    const pending=deferred(),runtimes:{id:string;dispose:ReturnType<typeof vi.fn>}[]=[],active={id:'old'};
    const coordinator=new RigSwitchCoordinator(rig=>{const r={id:rig.id,dispose:vi.fn()};runtimes.push(r);return r;},()=>pending.promise);
    const activate=vi.fn(),request=coordinator.request(BASIC_HUMAN_RIG,activate);expect(active.id).toBe('old');pending.reject(new Error('load failed'));
    await expect(request).rejects.toThrow('load failed');expect(activate).not.toHaveBeenCalled();expect(runtimes[0].dispose).toHaveBeenCalledOnce();
    const validation=new RigSwitchCoordinator(()=>({dispose:vi.fn()}),async()=>{});await expect(validation.request(BASIC_HUMAN_RIG,()=>{throw new Error('invalid draft');})).rejects.toThrow('invalid draft');
  });
  it('连续 A→B→C 忽略过期结果并各释放一次；取消载入不替换当前角色',async()=>{
    const gates=[deferred(),deferred()],runtimes:{id:string;dispose:ReturnType<typeof vi.fn>}[]=[];
    const coordinator=new RigSwitchCoordinator(rig=>{const r={id:rig.id,dispose:vi.fn()};runtimes.push(r);return r;},r=>gates[runtimes.indexOf(r)].promise),activate=vi.fn();
    const first=coordinator.request(BASIC_HUMAN_RIG,activate),second=coordinator.request(chainRig,activate);expect(runtimes[0].dispose).toHaveBeenCalledOnce();
    gates[1].resolve();expect(await second).toBe(true);gates[0].resolve();expect(await first).toBe(false);expect(activate).toHaveBeenCalledOnce();expect(activate).toHaveBeenCalledWith(runtimes[1]);expect(runtimes[1].dispose).not.toHaveBeenCalled();
    const cancelGate=deferred(),runtime={dispose:vi.fn()},cancel=new RigSwitchCoordinator(()=>runtime,()=>cancelGate.promise);const request=cancel.request(chainRig,activate);cancel.cancel();cancelGate.resolve();expect(await request).toBe(false);expect(runtime.dispose).toHaveBeenCalledOnce();expect(activate).toHaveBeenCalledOnce();
  });
  it('共享几何、材质和纹理仅销毁一次',()=>{
    const group=new Group(),geometry=new BoxGeometry(),texture=new Texture(),material=new MeshStandardMaterial({map:texture});group.add(new Mesh(geometry,material),new Mesh(geometry,material));
    const g=vi.spyOn(geometry,'dispose'),m=vi.spyOn(material,'dispose'),t=vi.spyOn(texture,'dispose');disposeObject(group);expect(g).toHaveBeenCalledOnce();expect(m).toHaveBeenCalledOnce();expect(t).toHaveBeenCalledOnce();
  });
});
