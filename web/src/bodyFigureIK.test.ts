import {beforeAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Bone,Group,Object3D,Quaternion,SkinnedMesh,Vector3,Vector4,Matrix4,PerspectiveCamera,WebGLRenderTarget,type WebGLRenderer} from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {BODYCHAN_RIG,BODYKUN_RIG} from './bodyFigureRigs';
import {PoseEngine} from './PoseEngine';
import {DEFAULT_VIEWS} from './types';
import type {RigDefinition} from './rigs';
import {solveRigChain,type ArticulatedRig} from './articulatedIK';
import {twistAngle} from './articulation';
import {parseDocument} from './files';
import {HAND_GESTURES,handLibraryDocument,parseHandLibrary} from './handGestures';
import {fingerBone,handBone} from './handRig';
import {ConstructionGuides,guideGeometries} from './ConstructionGuides';
import chanProfile from '../public/models/body-figures/bodychan-profile.json';
import kunProfile from '../public/models/body-figures/bodykun-profile.json';

const loaded=new Map<string,GLTF>();
beforeAll(async()=>{for(const rig of [BODYCHAN_RIG,BODYKUN_RIG]){const bytes=readFileSync(new URL(`../public${rig.asset.kind==='gltf'?rig.asset.url:''}`,import.meta.url));loaded.set(rig.id,await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));}});
function fixture(rig:RigDefinition){
  const model=new Group(),bones:Record<string,Bone>={};model.add(clone(loaded.get(rig.id)!.scene));model.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;});model.updateMatrixWorld(true);
  const e=Object.create(PoseEngine.prototype) as PoseEngine;
  Object.assign(e,{rigDefinition:rig,model,bones,gizmo:new Object3D(),helpers:new Group(),boneDisplay:new Group(),handles:[],selected:rig.initialSelection,mode:'translate',ready:false,targets:{},poles:{},pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),name:'素体 IK',ground:false,fullBody:false,warning:'',handDetail:null,profile:{},transform:{setMode(){},attach(){},detach(){},reset(){},enabled:true},onInfo(){},onCommit:vi.fn(),fit(){}});
  for(const end of rig.contacts)e.targets[end]=e.world(end).toArray();e.rest=e.snapshot();
  return {e,state:{rig,model,bones,rest:e.rest} satisfies ArticulatedRig};
}
function assertPose(state:ArticulatedRig){
  for(const [name,b]of Object.entries(state.bones)){
    if(name!==state.rig.root)expect(b.position.toArray(),name).toEqual(state.rest.joints[name].position);
    expect(b.quaternion.toArray().every(Number.isFinite),name).toBe(true);
  }
  for(const joint of state.rig.jointControls??[])if(joint.ikHinge){const h=joint.ikHinge,angle=twistAngle(new Quaternion().fromArray(state.rest.joints[joint.name].quaternion).invert().multiply(state.bones[joint.name].quaternion),new Vector3().fromArray(h.axis).normalize())*180/Math.PI;expect(angle,joint.name).toBeGreaterThanOrEqual(h.min-1e-4);expect(angle,joint.name).toBeLessThanOrEqual(h.max+1e-4);}
}
function pinError(e:PoseEngine){return Math.max(0,...Object.entries(e.pins).map(([n,p])=>p?e.world(n).distanceTo(new Vector3().fromArray(p.position)):0));}

// Fit the rendered vertices themselves; checking a handle against its bone would
// miss an anatomical pivot/skin error like the original 3 cm knee offset.
function fitSphere(points:Vector3[]){
  const matrix=Array.from({length:4},()=>[0,0,0,0]),rhs=[0,0,0,0];
  for(const p of points){const row=[2*p.x,2*p.y,2*p.z,1],square=p.lengthSq();for(let i=0;i<4;i++){rhs[i]+=row[i]*square;for(let j=0;j<4;j++)matrix[i][j]+=row[i]*row[j];}}
  const fitted=new Vector4().fromArray(rhs).applyMatrix4(new Matrix4().fromArray(matrix.flat()).invert());
  const center=new Vector3(fitted.x,fitted.y,fitted.z);return {center,radius:Math.sqrt(fitted.w+center.lengthSq())};
}
function meshIslands(mesh:SkinnedMesh){
  const positions=mesh.geometry.getAttribute('position'),vertices=new Map<string,number>(),parent=Array.from({length:positions.count},(_,i)=>i);
  const root=(i:number):number=>parent[i]===i?i:parent[i]=root(parent[i]);
  const join=(a:number,b:number)=>{parent[root(a)]=root(b);};
  for(let i=0;i<positions.count;i++){const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(v=>v.toFixed(6)).join('/'),other=vertices.get(key);if(other!==undefined)join(i,other);else vertices.set(key,i);}
  const index=mesh.geometry.index;for(let i=0;i<(index?.count??positions.count);i+=3){const a=index?.getX(i)??i;join(a,index?.getX(i+1)??i+1);join(a,index?.getX(i+2)??i+2);}
  const groups=new Map<number,number[]>();for(let i=0;i<positions.count;i++){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r)!.push(i);}return [...groups.values()];
}

for(const rig of [BODYCHAN_RIG,BODYKUN_RIG])describe(`${rig.name} 四肢 IK`,()=>{
  it('左右膝盖真实球体在中立、90°弯曲、深蹲和膝方向调整后始终以骨骼点为中心',()=>{
    const {e,state}=fixture(rig),profile=rig===BODYCHAN_RIG?chanProfile:kunProfile;
    const caps=Object.entries(profile.kneeCaps).map(([name,cap])=>{
      const mesh=e.model.getObjectByName(cap.mesh) as SkinnedMesh;expect(mesh).toBeInstanceOf(SkinnedMesh);mesh.skeleton.update();
      const positions=mesh.geometry.getAttribute('position'),weights=mesh.geometry.getAttribute('skinWeight'),joints=mesh.geometry.getAttribute('skinIndex');
      const center=new Vector3().fromArray(cap.center),thigh=mesh.skeleton.bones.findIndex(b=>b.name===cap.weightJoint);
      const indices=meshIslands(mesh).find(part=>part.length>100&&part.every(i=>Math.abs(new Vector3().fromBufferAttribute(positions,i).distanceTo(center)-cap.radius)<.0001))!;
      expect(indices).toBeDefined();for(const i of indices){expect(weights.getX(i)).toBeCloseTo(1,6);expect(joints.getX(i)).toBe(thigh);}
      expect(indices.length).toBeGreaterThan(100);expect(cap.sourcePivotErrorMetres).toBeGreaterThan(.025);return {name,cap,mesh,indices};
    });
    const check=()=>{e.model.updateMatrixWorld(true);for(const {name,cap,mesh,indices} of caps){mesh.skeleton.update();const points=indices.map(i=>mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld)),sphere=fitSphere(points);expect(sphere.center.distanceTo(e.world(name)),name).toBeLessThan(1e-5);expect(sphere.radius).toBeCloseTo(cap.radius,5);for(const p of points)expect(Math.abs(p.distanceTo(sphere.center)-sphere.radius)).toBeLessThan(.0001);}};
    check();for(const c of caps){const h=rig.jointControls!.find(j=>j.name===c.name)!.ikHinge!;e.bones[c.name].quaternion.fromArray(e.rest.joints[c.name].quaternion).multiply(new Quaternion().setFromAxisAngle(new Vector3().fromArray(h.axis),(90+(h.straight??0))*Math.PI/180));}check();
    for(const preset of ['squat','run','sit']){e.applyPreset(rig.presets.find(p=>p.id===preset)!);check();for(const end of rig.supportContacts!){e.setBendDirection(end,65);check();}}
    assertPose(state);
  });
  for(const posed of [false,true])it(`原校准${posed?'弯曲并固定双脚':'中立'}工程迁移保留脚位/朝向、身体/手指和角色位置，新工程重复打开不变`,()=>{
    const {e}=fixture(rig);if(posed)e.applyPreset(rig.presets.find(p=>p.id==='run')!);e.moveActor([1,.2,-.5],35);
    const legacy=e.snapshot();delete legacy.rigCalibrationVersion;
    for(const [name,position]of Object.entries(rig.calibration!.legacyPositions)){legacy.joints[name].position=[...position];e.bones[name].position.fromArray(position);}
    e.model.updateMatrixWorld(true);
    const goals=Object.fromEntries(rig.supportContacts!.map(end=>[end,{position:e.world(end),orientation:e.bones[end].getWorldQuaternion(new Quaternion())}]));
    for(const end of rig.contacts)legacy.targets[end]=e.world(end).toArray();if(posed)for(const end of rig.supportContacts!)legacy.pins[end]={position:goals[end].position.toArray(),quaternion:goals[end].orientation.toArray(),orientation:true};
    const source=JSON.stringify(legacy),other=fixture(rig).e;other.apply(parseDocument(source,other.rest));
    expect(JSON.stringify(legacy)).toBe(source);expect(other.snapshot().rigCalibrationVersion).toBe(1);expect(other.snapshot().root).toEqual(legacy.root);expect(other.pins).toEqual(legacy.pins);expect(other.hands).toEqual(legacy.hands);
    const changed=new Set(rig.supportContacts!.flatMap(end=>rig.chains[end]));for(const n of rig.editableJoints)if(!changed.has(n))expect(other.bones[n].quaternion.toArray(),n).toEqual(legacy.joints[n].quaternion);
    for(const end of rig.supportContacts!){expect(other.world(end).distanceTo(goals[end].position),end).toBeLessThan(1e-6);expect(other.bones[end].getWorldQuaternion(new Quaternion()).normalize().angleTo(goals[end].orientation.normalize())).toBeLessThan(1e-5);}
    const saved=other.snapshot(),again=fixture(rig).e;again.apply(parseDocument(JSON.stringify(saved),again.rest));expect(again.snapshot()).toEqual(saved);
    const hybrid=structuredClone(legacy);hybrid.joints.left_foot.position=other.rest.joints.left_foot.position;expect(()=>parseDocument(JSON.stringify(hybrid),other.rest)).toThrow('骨段长度');
    expect(()=>parseDocument(JSON.stringify({...legacy,rigCalibrationVersion:1}),other.rest)).toThrow('骨段长度');expect(()=>parseDocument(JSON.stringify({...saved,rigCalibrationVersion:2}),other.rest)).toThrow('校准版本');
  });
  it('旧骨段的最大伸直目标按新可达长度恢复，不拉伸骨骼或改写固定目标，残差明确提示',()=>{
    const {e}=fixture(rig),end='left_foot',chain=rig.chains[end];for(const[n,p]of Object.entries(rig.calibration!.legacyPositions))e.bones[n].position.fromArray(p);e.model.updateMatrixWorld(true);
    const lower=e.bones[chain[1]],upper=e.world(chain[1]).sub(e.world(chain[0])).normalize(),direction=e.world(end).sub(e.world(chain[1])).normalize();
    const rotation=new Quaternion().setFromUnitVectors(direction,upper).multiply(lower.getWorldQuaternion(new Quaternion()));lower.quaternion.copy(lower.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));e.model.updateMatrixWorld(true);
    const legacy=e.snapshot();delete legacy.rigCalibrationVersion;const goal=e.world(end);legacy.pins[end]={position:goal.toArray(),quaternion:e.bones[end].getWorldQuaternion(new Quaternion()).toArray(),orientation:true};
    const other=fixture(rig).e,max=other.world(chain[0]).distanceTo(other.world(chain[1]))+other.world(chain[1]).distanceTo(other.world(end)),expected=Math.max(0,e.world(chain[0]).distanceTo(goal)-max);
    other.apply(parseDocument(JSON.stringify(legacy),other.rest));expect(other.world(end).distanceTo(goal)).toBeCloseTo(expected,6);expect(other.pins).toEqual(legacy.pins);for(const n of Object.keys(rig.calibration!.legacyPositions))expect(other.bones[n].position.toArray()).toEqual(other.rest.joints[n].position);if(expected>.0001)expect(other.warning).toContain('原固定目标保留');
  });
  for(const side of ['Left','Right'] as const)it(`${side}十二种手势按真实静止骨轴弯曲，可读回、收藏和复制，身体/手腕/另一手不变`,()=>{
    const {e}=fixture(rig),before=e.snapshot(),wrist=e.world(handBone(rig,side)),own=new Set(Object.values(rig.handSkeleton![side].digits).flat());
    for(const g of HAND_GESTURES){
      e.applyHandGesture(side,g.values,g.name);expect(e.world(handBone(rig,side)).distanceTo(wrist)).toBeLessThan(1e-9);
      for(const [n,b]of Object.entries(e.bones))if(!own.has(n))expect(b.quaternion.toArray(),n).toEqual(before.joints[n].quaternion);
      const captured=e.captureHand(side);for(const d of Object.keys(g.values) as (keyof typeof g.values)[]){for(let j=0;j<3;j++)expect(captured[d].curl[j],`${g.id}/${d}/${j}`).toBeCloseTo(g.values[d].curl[j],3);expect(captured[d].spread,`${g.id}/${d}`).toBeCloseTo(g.values[d].spread,3);}
      expect(parseHandLibrary(JSON.stringify(handLibraryDocument([{...g,values:captured}],rig)),rig)[0].values).toEqual(captured);
    }
    e.applyHandGesture(side,HAND_GESTURES[1].values);e.copyHand(side);expect(e.captureHand(side==='Left'?'Right':'Left')).toEqual(e.captureHand(side));
    e.applyHandGesture(side,HAND_GESTURES[0].values);for(const n of own)expect(e.bones[n].quaternion.clone().normalize().angleTo(new Quaternion().fromArray(before.joints[n].quaternion).normalize())).toBeLessThan(1e-7);
    e.setHandDetail(side);expect(e.selected).toBe(fingerBone(rig,side,'Index',1));e.setFinger(side,'Index',2,50,'curl');expect(e.hands[side]).toBe('自定义');expect(e.captureHand(side).Index.curl[1]).toBeCloseTo(50,4);e.setHandDetail(null);expect(e.selected).toBe(handBone(rig,side));
  });
  for(const preset of rig.presets)it(`预设 ${preset.id} 有独立姿态、保持骨长及弯曲限位，移动角色后结果一致`,()=>{
    const {e,state}=fixture(rig);e.applyPreset(preset);assertPose(state);expect(e.pins).toEqual({});
    if(preset.id!=='neutral')expect(e.snapshot().joints).not.toEqual(e.rest.joints);
    if(preset.id==='sit')expect(e.world('pelvis').y).toBeLessThan(.6);
    if(preset.id==='wave')expect(e.world('left_hand').y).toBeGreaterThan(e.world('head').y);
    if(preset.id==='run')for(const end of rig.supportContacts!)expect(e.world(end).y).toBeGreaterThan(.2);
    const pose=e.snapshot(),other=fixture(rig).e;other.moveActor([1,.2,-.5],35);other.applyPreset(preset);const restored=fixture(rig).e;restored.apply(parseDocument(JSON.stringify(other.snapshot()),restored.rest));
    for(const n of rig.editableJoints)expect(restored.bones[n].quaternion.clone().normalize().angleTo(other.bones[n].quaternion.clone().normalize()),n).toBeLessThan(1e-7);
    expect(pose.root.position).toEqual([0,0,0]);
  });
  for(const end of rig.contacts)it(`${end}固定后仍能调整肘膝方向，末端位置/朝向不变，目标及工程可恢复`,()=>{
    const {e,state}=fixture(rig);e.select(end);e.setSelectedPosition(1,e.world(end).y+.12);e.setPin(true,true);const anchor=e.world(end),q=e.bones[end].getWorldQuaternion(new Quaternion()),chain=rig.chains[end],lower=e.bones[chain[1]].quaternion.clone();
    for(const angle of [-150,-60,0,60,150,0]){expect(e.setBendDirection(end,angle)).toBe(true);expect(e.bendDirection(end)!.angle*180/Math.PI).toBeCloseTo(angle,3);expect(e.world(end).distanceTo(anchor)).toBeLessThan(1e-6);expect(e.bones[end].getWorldQuaternion(new Quaternion()).normalize().angleTo(q.clone().normalize())).toBeLessThan(1e-5);expect(e.bones[chain[1]].quaternion.clone().normalize().angleTo(lower.clone().normalize())).toBeLessThan(1e-7);assertPose(state);}
    const saved=e.snapshot(),other=fixture(rig).e;other.apply(parseDocument(JSON.stringify(saved),other.rest));expect(other.snapshot()).toEqual(saved);
  });
  it('结构线使用静止表面的独立几何，当前姿态及原网格不变，真实蒙皮完全对齐',()=>{
    const {e,state}=fixture(rig);e.applyPreset(rig.presets.find(p=>p.id==='run')!);const before=e.snapshot(),guides=guideGeometries(state);let head=0,body=0;
    for(const {source,geometry}of guides){
      expect(source.geometry.getAttribute('guideHead')).toBeUndefined();for(const name of ['guideHead','guideBody'])expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true);
      const a=geometry.getAttribute('guideHead'),b=geometry.getAttribute('guideBody');for(let i=0;i<a.count;i++){if(a.getW(i)>.8)head++;if(b.getW(i)>.8)body++;}
      if(source instanceof SkinnedMesh){const proxy=new SkinnedMesh(geometry,source.material);proxy.skeleton=source.skeleton;proxy.bindMatrix.copy(source.bindMatrix);proxy.bindMatrixInverse.copy(source.bindMatrixInverse);source.skeleton.update();for(let i=0;i<a.count;i+=37)expect(proxy.getVertexPosition(i,new Vector3()).distanceTo(source.getVertexPosition(i,new Vector3()))).toBeLessThan(1e-10);}
      geometry.dispose();
    }
    expect(head).toBeGreaterThan(100);expect(body).toBeGreaterThan(100);expect(e.snapshot()).toEqual(before);
  });
  it('结构线绘制失败恢复渲染状态，移除角色释放代理而不释放原资产',()=>{
    const {e,state}=fixture(rig),pass=new ConstructionGuides(),target=new WebGLRenderTarget(4,4),previous=new WebGLRenderTarget(8,8),saved=e.snapshot();let current=previous,proxies:SkinnedMesh[]=[];
    const renderer={autoClear:true,getRenderTarget:()=>current,setRenderTarget:(value:WebGLRenderTarget)=>{current=value;},render:vi.fn((scene:Group)=>{proxies=scene.children as SkinnedMesh[];throw new Error('GPU failed');})};
    expect(()=>pass.render(renderer as unknown as WebGLRenderer,[state],new PerspectiveCamera(),target,1.5)).toThrow('GPU failed');expect(current).toBe(previous);expect(renderer.autoClear).toBe(true);expect(e.snapshot()).toEqual(saved);expect(proxies.length).toBeGreaterThan(8);
    const owned=proxies.map(p=>vi.spyOn(p.geometry,'dispose')),original:ReturnType<typeof vi.spyOn>[]=[];e.model.traverse(o=>{if(o instanceof SkinnedMesh)original.push(vi.spyOn(o.geometry,'dispose'));});pass.forget(e.model);for(const spy of owned)expect(spy).toHaveBeenCalledOnce();for(const spy of original){expect(spy).not.toHaveBeenCalled();spy.mockRestore();}pass.dispose();target.dispose();previous.dispose();
  });
  for(const end of rig.contacts)it(`${end}可抬起和前伸，其他肢体及手指不动、骨长与弯曲方向保持`,()=>{
    const {e,state}=fixture(rig),before=e.snapshot(),target=e.world(end).add(new Vector3(.015,.12,.06));
    e.select(end);expect(e.mode).toBe('translate');e.setSelectedPosition(1,target.y);e.setSelectedPosition(2,target.z);
    expect(e.world(end).distanceTo(new Vector3(e.world(end).x,target.y,target.z))).toBeLessThan(.003);assertPose(state);
    const chain=rig.chains[end];for(const[n,b]of Object.entries(e.bones))if(!chain.includes(n))expect(b.quaternion.toArray(),n).toEqual(before.joints[n].quaternion);
  });
  it('双脚固定只固定两脚，骨盆下沉且脚位/朝向保持；超出范围时不滑脚',()=>{
    const {e,state}=fixture(rig);e.setFeetPin(true);expect(Object.keys(e.pins)).toEqual(['left_foot','right_foot']);const pins=structuredClone(e.pins),y=e.world(rig.root).y;
    e.select(rig.root);e.setSelectedPosition(1,y-.07);expect(y-e.world(rig.root).y).toBeGreaterThan(.06);expect(pinError(e)).toBeLessThan(.0015);
    for(const end of rig.supportContacts!)expect(e.bones[end].getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().fromArray(pins[end]!.quaternion))).toBeLessThan(.009);
    e.setSelectedPosition(1,y+1);expect(pinError(e)).toBeLessThan(.001501);expect(e.world(rig.root).y).toBeLessThan(y+.05);expect(e.warning).toContain('固定手脚');assertPose(state);
  });
  it('手脚可分别固定，位置/方向锁阻止直接编辑，解除后恢复；整角色平移连同锚点搬动',()=>{
    const {e}=fixture(rig);e.select('left_hand');e.setPin(true,true);const before=e.snapshot();vi.mocked(e.onCommit).mockClear();
    e.setSelectedPosition(1,e.world('left_hand').y+.1);e.setSelectedRotation(0,30);expect(e.snapshot()).toEqual(before);expect(e.onCommit).not.toHaveBeenCalled();
    e.select('head');e.setSelectedRotation(1,20);expect(pinError(e)).toBeLessThan(.0015);e.moveActor([1,.2,-.5],40);expect(pinError(e)).toBeLessThan(.0015);
    e.select('left_hand');e.setPin(false);const y=e.world('left_hand').y;e.setSelectedPosition(1,y+.06);expect(e.world('left_hand').y-y).toBeGreaterThan(.05);
  });
  it('从完全伸直重新折回、连续目标与不可达目标均有限且不反折',()=>{
    for(const end of rig.contacts){const {e,state}=fixture(rig),chain=rig.chains[end],origin=e.world(chain[0]),initial=e.world(end),length=origin.distanceTo(e.world(chain[1]))+e.world(chain[1]).distanceTo(initial),direction=initial.clone().sub(origin).normalize();
      solveRigChain(state,end,origin.clone().addScaledVector(direction,length+.03));assertPose(state);
      const target=origin.clone().addScaledVector(direction,length*.8).add(new Vector3(0,0,.02));expect(solveRigChain(state,end,target).error).toBeLessThan(.003);assertPose(state);
      for(let i=0;i<12;i++){solveRigChain(state,end,target.clone().add(new Vector3(.02*Math.sin(i),.02*Math.cos(i),.02*Math.sin(i*.4))));assertPose(state);}
    }
  });
  it('旧 FK 工程原样恢复，IK 目标从真实姿势派生；新工程校验控制点',()=>{
    const {e}=fixture(rig);e.select('left_forearm');e.setSelectedRotation(0,60);const legacy=e.snapshot();delete legacy.ikVersion;legacy.targets={};legacy.poles={};legacy.pins={};
    const other=fixture(rig).e;other.apply(parseDocument(JSON.stringify(legacy),other.rest));expect(JSON.stringify(other.snapshot().joints)).toEqual(JSON.stringify(legacy.joints));expect(other.snapshot().ikVersion).toBe(1);
    for(const end of rig.contacts)expect(other.targets[end]).toEqual(other.world(end).toArray());const doc=other.snapshot();expect(()=>parseDocument(JSON.stringify({...doc,targets:{}}),other.rest)).toThrow('IK');
  });
  it('拖动结果不随事件次数累积，取消恢复姿态、锚点与目标；真实表面随 IK 变形',()=>{
    const {e,state}=fixture(rig);e.select('left_hand');const before=e.snapshot(),target=e.world('left_hand').add(new Vector3(0,.15,.04));
    const vertices=()=>{e.model.updateMatrixWorld(true);const out:Vector3[]=[];e.model.traverse(o=>{if(o instanceof SkinnedMesh){o.skeleton.update();for(let i=0;i<o.geometry.getAttribute('position').count;i+=3)out.push(o.getVertexPosition(i,new Vector3()).applyMatrix4(o.matrixWorld));}});return out;};
    const points=vertices(),drag=e as unknown as {dragBefore:typeof before;manipulate():void};drag.dragBefore=before;e.gizmo.position.copy(target);drag.manipulate();expect(e.world('left_hand').distanceTo(target)).toBeLessThan(.003);
    const once=e.snapshot();for(let i=0;i<8;i++)drag.manipulate();expect(e.snapshot()).toEqual(once);expect(vertices().filter((p,i)=>p.distanceTo(points[i])>.003).length).toBeGreaterThan(50);assertPose(state);
    e.cancelDrag();expect(e.snapshot()).toEqual(before);
  });
});
