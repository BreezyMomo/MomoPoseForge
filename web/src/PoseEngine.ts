import * as THREE from 'three';
import {inPresetScope,type PresetScope} from './presetScopes';
import {MAX_PROPS,newSceneProp,validSceneProps,propAnchors,buildSceneProp,disposePropGroup,type SceneProp,type PropKind} from './sceneProps';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { solveTwoBone, solveLimbRotations, projectPoint } from './math';
import { DEFAULT_VIEWS, END_EFFECTORS, PART_NAMES, FINGER_PART_NAMES, DIGITS, type Digit, type Side, type HandValues, type Effector, type EngineInfo, type PoseDocument, type Preset, type Vec3, type ViewSlot } from './types';
import {XBOT_RIG,type RigDefinition} from './rigs';
import {buildProceduralRig,disposeObject,ensureRigNormals,visibleSurfaceBounds} from './rigGeometry';
import {fkAngles,fkRotation,constrainFk} from './fkControls';
import {solveRigChain,solveRigContacts,type ArticulatedRig} from './articulatedIK';
import {JOINT_LIMITS,constrainJointRotation,decomposeJointRotation,solveSpineTarget} from './poseControls';
import {FlyCameraControls,perspectiveForNavigation,cloneExportCamera} from './FlyCameraControls';
import {emptyHandValues,fingerPart,fingerAxes,fingerAngles,fingerRotation,forearmAngles,forearmRotation,twistAngle} from './articulation';
import {LIMB_LIMITS,constrainLimb,limbAxes} from './limbLimits';
import {LOCAL_AXES,solveConstrainedIK,captureJoints,restoreJoints,interpolateJoints,goalError,type PositionGoal,type SolverJoint} from './fullBodyIK';
import {COCO_LINKS,COCO_COLORS,HAND_LINKS,handBones,projectPose,paintSkeleton,worldSkeleton,depthVisibility,type OpenPoseFrame} from './poseOutput';
import {depthRangeFor,dataMaterial,type DepthRange,type RenderKind,type DataKind} from './renderPasses';
import {defaultCameraSettings,captureCamera,restoreCamera,validOutputSize,type CameraSettings} from './cameraState';
import {validateReferenceImage,referenceWithSettings,type ReferenceImage,type ReferenceSettings} from './referenceImage';
import {HAND_GESTURES,validHandValues,normalizedHandValues,writeHandValues,handShapeValid} from './handGestures';
import {defaultSymmetry,symmetricLimb,limbParts,mirroredRotation,type SymmetryGroup} from './symmetry';
import {MotionPreview} from './motionPreview';
import {buildAppearance,validAppearance,type AppearanceRef} from './characterAppearance';
import {parseCharacter} from './characterImport';
import {characterLibrary} from './characterLibrary';
import {parseMotionSource,checkMotionAbort,MAX_MOTION_BYTES} from './motionImport';
import {retargetMixamoMotion} from './mixamoMotion';
import {motionLibrary,packMotionAsset,unpackMotionAsset} from './motionLibrary';

const V = THREE.Vector3, Q = THREE.Quaternion;
// These routines are the X Bot humanoid strategy. Generic FK rigs never enter them.
const CHAINS = XBOT_RIG.chains;
const asVec = (v: THREE.Vector3): Vec3 => v.toArray() as Vec3;

export class PoseEngine {
  // Prototype is also used by the headless X Bot regression fixtures.
  get activeRig():RigDefinition{return this.rigDefinition??XBOT_RIG;}
  private rigDefinition?:RigDefinition;
  get humanoid(){return this.activeRig.strategy==='xbot-humanoid';}
  get effectors(){return Object.keys(this.activeRig.chains);}
  private rigJoint(name=this.selected){const asset=this.activeRig.asset;return this.activeRig.jointControls?.find(j=>j.name===name)??(asset.kind==='procedural'?asset.joints.find(j=>j.name===name):undefined);}
  private restRotation(name=this.selected){return new Q().fromArray(this.rest?.joints[name]?.quaternion??[0,0,0,1]);}
  canRotateAxis(axis:number){const hinge=this.rigJoint()?.hinge;return hinge===undefined||hinge===axis;}
  private articulatedState():ArticulatedRig{return {rig:this.activeRig,bones:this.bones,rest:this.rest,model:this.model};}
  scene = new THREE.Scene();
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  orbit: OrbitControls;
  transform: TransformControls;
  fly: FlyCameraControls;
  model = new THREE.Group();
  bones: Record<string, THREE.Bone> = {};
  helpers = new THREE.Group();
  groundMesh: THREE.Mesh;
  grid: THREE.GridHelper;
  boneDisplay = new THREE.Group();
  gizmo = new THREE.Object3D();
  handles: THREE.Mesh[] = [];
  rest!: PoseDocument;
  targets: Record<string, Vec3> = {};
  poles: Record<string, Vec3> = {};
  pins: PoseDocument['pins'] = {};
  hands = { Left: '张手', Right: '张手' };
  views = structuredClone(DEFAULT_VIEWS);
  name = '未命名姿势';
  ground = true;
  fullBody = true;
  symmetry=defaultSymmetry();
  lastSolveStats={iterations:0,error:0,fixedError:0,milliseconds:0};
  selected = 'LeftHand';
  mode: 'translate' | 'rotate' = 'translate';
  display: 'surface' | 'skeleton' = 'surface';
  view = 'free';
  warning = '';
  ready = false;
  moreControls = true;
  handDetail:Side|null=null;
  center = new V(0,.85,0);
  span = 1.98;
  cameraState=defaultCameraSettings();
  referenceImage?:ReferenceImage;
  props:SceneProp[]=[];
  propLayer?:THREE.Group;
  private propSignature='';
  vertexCount = 0;
  motion?:MotionPreview;
  private motionBefore?:PoseDocument;
  private motionNotify=0;
  appearance?:AppearanceRef;
  private appearanceGroups=new Map<string,THREE.Group>();
  private originalMeshes:THREE.Mesh[]=[];
  disposed = false;
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private lastFrame = 0;
  private navigationDistance = 1;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragBefore: PoseDocument | null = null;
  private suppress = false;
  private cancelPending = false;
  private profile: { id?:string; headAnchors?: Record<string, number[]>; hingeAxes?:Record<string,number[]>; handCurlNormalSign?:number } = {};
  onInfo: (info: EngineInfo) => void;
  onCommit: (document: PoseDocument,history?:boolean) => void;

  constructor(public host: HTMLDivElement, onInfo: (info: EngineInfo) => void, onCommit: (document: PoseDocument,history?:boolean) => void,rig:RigDefinition=XBOT_RIG) {
    this.rigDefinition=rig;this.selected=rig.initialSelection;this.fullBody=rig.capabilities.fullBodyIK;this.ground=rig.capabilities.floor;
    this.onInfo = onInfo; this.onCommit = onCommit;
    this.scene.background = new THREE.Color('#202121');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '可交互的三维姿势视口');
    this.renderer.domElement.tabIndex=0;
    this.host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
    this.camera.position.set(2.6,1.65,4.5);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.copy(this.center);
    this.orbit.enableDamping = false;
    this.orbit.minDistance = .5; this.orbit.maxDistance = 12;
    this.orbit.minZoom=.1;this.orbit.maxZoom=20;
    this.orbit.mouseButtons = { LEFT: undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: undefined };
    this.orbit.addEventListener('start', () => { this.view = 'free'; if(this.ready)this.onInfo(this.info()); });
    this.orbit.addEventListener('end',()=>this.commitCamera());
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#757575', 2));
    const key = new THREE.DirectionalLight('#fff9ef', 3.4);
    key.position.set(2.5,4,4); key.castShadow = true;
    key.shadow.mapSize.set(2048,2048); key.shadow.bias = -.0002;
    key.shadow.normalBias = .015;
    Object.assign(key.shadow.camera, { left:-2, right:2, top:3, bottom:-2, near:.1, far:12 });
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#dce8ff', 1.5); fill.position.set(-3,2,-2); this.scene.add(fill);
    this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(20,20), new THREE.ShadowMaterial({ color:'#000000', opacity:.24 }));
    this.groundMesh.rotation.x = -Math.PI/2; this.groundMesh.position.y = -.006; this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
    this.grid = new THREE.GridHelper(8, 32, '#494d47', '#31352f'); this.grid.position.y = -.003; this.scene.add(this.grid);
    this.scene.add(this.model, this.helpers, this.gizmo, this.boneDisplay);
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(.75); this.transform.setMode('translate');
    this.transform.setSpace('world');
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value&&this.canNavigateCamera();
      if(event.value)this.beginPoseDrag();else this.finishPoseDrag();
    });
    this.transform.addEventListener('objectChange', () => { if (!this.suppress && this.ready) this.manipulate(); });
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.interruptPoseDrag=this.interruptPoseDrag.bind(this);
    this.renderer.domElement.addEventListener('pointercancel',this.interruptPoseDrag);
    this.renderer.domElement.addEventListener('lostpointercapture',this.poseCaptureLost);
    window.addEventListener('blur',this.interruptPoseDrag);
    this.renderer.domElement.ownerDocument.addEventListener('visibilitychange',this.poseVisibility);
    this.fly=new FlyCameraControls(this.renderer.domElement,()=>this.camera,()=>this.syncNavigationTarget(),active=>{
      if(active){
        if(this.transform.dragging||!this.canNavigateCamera())return false;
        if(this.camera instanceof THREE.OrthographicCamera){this.camera=perspectiveForNavigation(this.camera,this.orbit.target,this.cameraState.fov);this.orbit.object=this.camera;this.transform.camera=this.camera;}
        this.navigationDistance=this.camera.position.distanceTo(this.orbit.target);
        this.orbit.enabled=false;this.transform.enabled=false;this.view='free';
      }else{this.syncNavigationTarget();this.transform.enabled=!this.motion?.active;this.orbit.enabled=!this.transform.dragging&&this.canNavigateCamera();this.commitCamera();}
      if(this.ready)this.onInfo(this.info());
    });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.host);
    this.resize(); this.animate();
  }

  private syncNavigationTarget(){this.orbit.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new V()),this.navigationDistance);}
  private canNavigateCamera(){return !this.cameraState?.locked&&(!this.referenceImage?.visible||this.referenceImage.locked);}
  setReferenceImage(image?:ReferenceImage){
    if(image&&!validateReferenceImage(image))throw new Error('参考图片数据无效');
    this.referenceImage=image?structuredClone(image):undefined;if(!this.canNavigateCamera())this.fly?.stop();this.orbit&&(this.orbit.enabled=!this.transform.dragging&&this.canNavigateCamera());this.commitReference();
  }
  setReferenceSettings(patch:Partial<ReferenceSettings>,commit=true){
    if(!this.referenceImage)return;this.referenceImage=referenceWithSettings(this.referenceImage,patch);
    if(!this.canNavigateCamera())this.fly?.stop();if(this.orbit)this.orbit.enabled=!this.transform.dragging&&this.canNavigateCamera();
    if(commit)this.commitReference();else if(this.ready)this.onInfo(this.info());
  }
  commitReference(){if(!this.ready)return;this.onInfo(this.info());this.onCommit(this.snapshot(),false);}

  private syncPropScene(){
    if(!this.scene)return;
    const signature=JSON.stringify(this.props??[]);if(signature===this.propSignature)return;
    this.propSignature=signature;
    if(!this.propLayer){this.propLayer=new THREE.Group();this.scene.add(this.propLayer);}
    disposePropGroup(this.propLayer);
    for(const prop of this.props??[])if(prop.visible)this.propLayer.add(buildSceneProp(prop));
  }
  addProp(kind:PropKind){
    if((this.props?.length??0)>=MAX_PROPS)throw new Error(`最多添加 ${MAX_PROPS} 个道具`);
    const prop=newSceneProp(kind,crypto.randomUUID());this.props=[...(this.props??[]),prop];this.syncPropScene();this.update(true);this.commit();return prop.id;
  }
  changeProp(id:string,patch:Partial<Pick<SceneProp,'position'|'size'|'yaw'|'visible'>>){
    if(!this.props?.some(p=>p.id===id))return;
    const next=this.props.map(p=>p.id===id?{...p,...structuredClone(patch)}:p);
    if(!validSceneProps(next))throw new Error('位置范围为 ±5 米，尺寸为 0.02–3 米，旋转为 ±180°');
    this.props=next;this.syncPropScene();this.update(true);this.commit();
  }
  removeProp(id:string){this.props=(this.props??[]).filter(p=>p.id!==id);this.syncPropScene();this.update(true);this.commit();}
  placeOnProp(id:string,anchorId:string,end:Effector){
    if(!this.humanoid||!this.activeRig.capabilities.pins)throw new Error('此骨架暂不支持道具接触定位');
    if(!END_EFFECTORS.includes(end))throw new Error('请选择手腕或脚底');
    const prop=this.props?.find(p=>p.id===id&&p.visible),anchor=prop&&propAnchors(prop).find(a=>a.id===anchorId);
    if(!anchor)throw new Error('请先选择可见道具和接触点');
    if(prop.kind==='bar'&&end.endsWith('Foot'))throw new Error('握杆仅支持手腕定位');
    if(this.pins[end])throw new Error('请先解除该部位固定，再重新定位');
    const before=this.snapshot(),target=new V().fromArray(anchor.point),foot=end.endsWith('Foot');
    if(foot){target.y+=this.rest.targets[end][1];this.setWorldQuaternion(this.bones[end],new Q());}
    this.solve(end,target);
    if(this.world(end).distanceTo(target)>.01){
      for(const [name,joint] of Object.entries(before.joints)){this.bones[name].position.fromArray(joint.position);this.bones[name].quaternion.fromArray(joint.quaternion);}
      this.model.updateMatrixWorld(true);this.warning='';this.syncGizmo();this.update(false);
      throw new Error('接触点超出当前肢体可达范围；请把道具移近或先调整身体');
    }
    this.pins[end]={position:asVec(this.world(end)),quaternion:this.bones[end].getWorldQuaternion(new Q()).toArray(),orientation:foot};
    this.warning='';this.handDetail=null;this.selected=end;this.setMode('translate');this.transform.attach(this.gizmo);
    this.syncTargets();this.syncGizmo();this.update(true);this.commit();
  }
  sceneBounds(){
    const box=visibleSurfaceBounds(this.model);
    if(this.propLayer?.children.length)box.union(new THREE.Box3().setFromObject(this.propLayer,true));
    return box;
  }

  async load() {
    const asset=this.activeRig.asset;
    if(asset.kind==='procedural'){
      const {group}=buildProceduralRig(this.activeRig);if(this.disposed){disposeObject(group);return;}this.model.add(group);
    }else{
    const [modelResult, profileResult] = await Promise.allSettled([
      new GLTFLoader().loadAsync(asset.url),
      fetch(asset.profileUrl).then(r => { if (!r.ok) throw new Error('骨架定义载入失败'); return r.json(); }),
    ]);
    if(modelResult.status==='rejected'||profileResult.status==='rejected'){
      if(modelResult.status==='fulfilled')disposeObject(modelResult.value.scene);
      throw modelResult.status==='rejected'?modelResult.reason:(profileResult as PromiseRejectedResult).reason;
    }
    const gltf=modelResult.value,profile=profileResult.value;
    if (this.disposed) {disposeObject(gltf.scene);return;}
    this.profile = profile;
    this.model.add(gltf.scene);
    this.motion=new MotionPreview(this.model,gltf.animations);
    if(profile.id!==this.activeRig.id||(profile.rigVersion!==undefined&&profile.rigVersion!==this.activeRig.version))throw new Error('模型与骨骼定义版本不匹配');
    }
    ensureRigNormals(this.model);
    this.model.traverse(obj => {
      if (obj instanceof THREE.Bone) this.bones[obj.name] = obj;
      if (obj instanceof THREE.SkinnedMesh) {
        obj.castShadow = true; obj.frustumCulled = false;
        // Preserve X Bot's original red shell and dark joint materials.
        this.vertexCount += obj.geometry.attributes.position.count;
      }
    });
    const required=[this.activeRig.root,...this.activeRig.editableJoints,...Object.values(this.activeRig.chains).flat(),...(this.activeRig.capabilities.hands?[...handBones('Left'),...handBones('Right')]:[])];
    for (const name of required) if (!this.bones[name]) throw new Error(`模型缺少骨骼 ${name}`);
    for(const[end,chain]of Object.entries(this.activeRig.chains))if(chain.length<3||chain.at(-1)!==end)throw new Error(`IK 链定义无效：${end}`);
    this.model.updateMatrixWorld(true);
    for (const end of this.effectors) {
      this.targets[end] = asVec(this.world(end));
      const b = this.world(this.activeRig.chains[end][1]);
      if(this.humanoid)this.poles[end] = asVec(b.add(new V(0,0,end.endsWith('Hand')?-.5:.5)));
    }
    this.rest = this.snapshot();
    this.originalMeshes=[];this.model.traverse(o=>{if(o instanceof THREE.Mesh)this.originalMeshes.push(o);});
    for (const name of this.activeRig.editableJoints) {
      if(!this.bones[name])continue;
      const radius=this.activeRig.capabilities.hands&&fingerPart(name) ? .0065 : this.effectors.includes(name) ? .022 : .016;
      const handle = new THREE.Mesh(new THREE.SphereGeometry(radius,12,8), new THREE.MeshBasicMaterial({ color:'#b1b6b6', depthTest:false, transparent:true, opacity:.9 }));
      handle.userData.part = name; handle.renderOrder = 100; this.helpers.add(handle); this.handles.push(handle);
    }
    this.ready = true;
    this.update(true); this.select(this.activeRig.initialSelection);
  }

  world(name: string) { return this.bones[name].getWorldPosition(new V()); }
  private setWorldQuaternion(bone: THREE.Bone, quaternion: THREE.Quaternion) {
    const parent = bone.parent?.getWorldQuaternion(new Q()) ?? new Q();
    bone.quaternion.copy(parent.invert().multiply(quaternion)); bone.updateWorldMatrix(false,true);
  }
  private hingeAxis(mid:string){return new V().fromArray(this.profile.hingeAxes?.[mid]??(mid.endsWith('Leg')?[1,0,0]:[0,mid.startsWith('Left')?-1:1,0])).normalize();}

  private limitHinge(name:string){
    const entry=Object.values(CHAINS).find(c=>c[1]===name);if(!entry)return;
    const bone=this.bones[name],upper=new V().fromArray(this.rest.joints[name].position).normalize(),lower=new V().fromArray(this.rest.joints[entry[2]].position).normalize();
    const axis=this.hingeAxis(name);
    const restBend=Math.atan2(axis.dot(new V().crossVectors(upper,lower)),THREE.MathUtils.clamp(upper.dot(lower),-1,1)),q=bone.quaternion;
    const arm=name.endsWith('ForeArm'),articulation=arm?forearmAngles(q,axis,lower):null;
    let angle=articulation?.bend??2*Math.atan2(new V(q.x,q.y,q.z).dot(axis),q.w);
    if(angle>Math.PI)angle-=2*Math.PI;if(angle< -Math.PI)angle+=2*Math.PI;
    angle=THREE.MathUtils.clamp(angle,-restBend,THREE.MathUtils.degToRad(name.endsWith('Leg')?150:155)-restBend);
    if(arm)bone.quaternion.copy(forearmRotation(angle,articulation!.twist,axis,lower));else bone.quaternion.setFromAxisAngle(axis,angle);
    bone.updateWorldMatrix(false,true);
  }

  private limitJoint(name:string,report=true){
    if(!this.humanoid){
      const bone=this.bones[name];if(!bone)return;
      bone.quaternion.copy(constrainFk(bone.quaternion,this.restRotation(name),this.rigJoint(name)));bone.updateWorldMatrix(false,true);return;
    }
    this.limitHinge(name);
    const digit=fingerPart(name);
    if(digit&&this.rest){
      const axes=fingerAxes(this.rest.joints,digit[1] as Side,digit[2] as Digit,Number(digit[3]),this.profile.handCurlNormalSign);
      const bone=this.bones[name],angles=fingerAngles(bone.quaternion,axes),limited=fingerRotation(digit[2] as Digit,Number(digit[3]),angles.curl,angles.spread,axes);
      if(report&&bone.quaternion.angleTo(limited)>1e-5)this.warning=`${PART_NAMES[name]}已到角度范围边界`;
      bone.quaternion.copy(limited);bone.updateWorldMatrix(false,true);
    }
    if(name.endsWith('ToeBase')){
      const bone=this.bones[name],angle=THREE.MathUtils.clamp(twistAngle(bone.quaternion,new V(1,0,0)),THREE.MathUtils.degToRad(-45),THREE.MathUtils.degToRad(65));
      bone.quaternion.setFromAxisAngle(new V(1,0,0),angle);bone.updateWorldMatrix(false,true);
    }
    if(LIMB_LIMITS[name]&&this.rest){
      const child=name.endsWith('Shoulder')?name.replace('Shoulder','Arm'):name.endsWith('UpLeg')?name.replace('UpLeg','Leg'):name.replace('Arm','ForeArm');
      const bone=this.bones[name],limited=constrainLimb(name,bone.quaternion,limbAxes(name,new V().fromArray(this.rest.joints[child].position)),new Q().fromArray(this.rest.joints[name].quaternion));
      if(report&&bone.quaternion.angleTo(limited)>1e-5)this.warning=`${PART_NAMES[name]}已到角度范围边界`;
      bone.quaternion.copy(limited);bone.updateWorldMatrix(false,true);
    }
    if(!JOINT_LIMITS[name]||!this.rest)return;
    const bone=this.bones[name],limited=constrainJointRotation(name,bone.quaternion,new Q().fromArray(this.rest.joints[name].quaternion));
    if(report&&bone.quaternion.angleTo(limited)>1e-5)this.warning=`${PART_NAMES[name]}已到角度范围边界`;
    bone.quaternion.copy(limited);bone.updateWorldMatrix(false,true);
  }

  solve(end: string, target: THREE.Vector3, pole?: THREE.Vector3, preserveEndOrientation=true) {
    if(this.activeRig.ik){const result=solveRigChain(this.articulatedState(),end,target);if(result.error>.003)this.warning='爪子目标已到关节可达范围，剩余 '+(result.error*100).toFixed(1)+' 厘米';return {...result,end:result.position};}
    const chain = CHAINS[end]; if (!chain) return;
    const [a,b,c] = chain;
    const start = this.world(a), mid = this.world(b), last = this.world(c),endOrientation=this.bones[c].getWorldQuaternion(new Q());
    const joints:SolverJoint[]=[{bone:this.bones[a],axes:LOCAL_AXES,mobility:1},{bone:this.bones[b],axes:[this.hingeAxis(b)],mobility:1}];
    const before=captureJoints(joints);
    const roll=b.endsWith('ForeArm')?forearmAngles(this.bones[b].quaternion,this.hingeAxis(b),new V().fromArray(this.rest.joints[c].position)).twist:0;
    const result = solveTwoBone(start,target,pole ?? new V().fromArray(this.poles[end]),start.distanceTo(mid),mid.distanceTo(last),end.endsWith('Foot') ? 150:155);
    const rotations=solveLimbRotations(new V().fromArray(this.rest.joints[b].position),new V().fromArray(this.rest.joints[c].position),this.hingeAxis(b),result.elbow.clone().sub(start),result.end.clone().sub(result.elbow),end.endsWith('Foot')?150:155);
    this.setWorldQuaternion(this.bones[a],rotations.upperWorld);
    this.bones[b].quaternion.copy(rotations.lowerLocal);
    if(b.endsWith('ForeArm'))this.bones[b].quaternion.multiply(new Q().setFromAxisAngle(new V().fromArray(this.rest.joints[c].position).normalize(),roll));
    this.bones[b].updateWorldMatrix(false,true);
    this.limitJoint(a,false);
    const goals:PositionGoal[]=[{name:end,target,weight:1}];
    if(this.ground&&end.endsWith('Foot'))goals.push({name:end,target:new V(0,this.rest.targets[end][1],0),weight:10,floor:true});
    const cost=()=>goals.reduce((sum,g)=>sum+goalError(g,this.world(end))**2*g.weight**2,0);
    const candidateCost=cost(),candidate=captureJoints(joints);restoreJoints(joints,before);
    if(candidateCost<cost()||pole)restoreJoints(joints,candidate);
    if(this.world(end).distanceTo(target)>.0001||goals.some(g=>goalError(g,this.world(end))>.001))solveConstrainedIK(this.bones,joints,goals,n=>this.limitJoint(n,false),12);
    if(preserveEndOrientation)this.setWorldQuaternion(this.bones[c],endOrientation);
    const error=this.world(end).distanceTo(target);
    if(error>.009)this.warning=`${PART_NAMES[end]}目标超出关节范围，剩余 ${(error*100).toFixed(1)} 厘米`;
    return {...result,elbow:this.world(b),end:this.world(c),error};
  }

  private bodyJoints():SolverJoint[]{
    const joints:SolverJoint[]=[{bone:this.bones.Hips,axes:LOCAL_AXES,mobility:.25,translation:true}];
    for(const name of ['Spine','Spine1','Chest','UpperChest',...Object.keys(LIMB_LIMITS)])joints.push({bone:this.bones[name],axes:LOCAL_AXES,mobility:name.includes('Shoulder')?.5:name in JOINT_LIMITS?.35:1});
    for(const name of ['LeftForeArm','RightForeArm','LeftLeg','RightLeg'])joints.push({bone:this.bones[name],axes:[this.hingeAxis(name)],mobility:1});
    return joints;
  }

  private fixedGoals(active?:string,support=false){
    const goals:PositionGoal[]=[];
    for(const end of END_EFFECTORS){
      if(end!==active&&this.pins[end])goals.push({name:end,target:new V().fromArray(this.pins[end]!.position),weight:10});
      else if(support&&end!==active&&this.ground&&end.endsWith('Foot')&&this.world(end).y<=this.rest.targets[end][1]+.012)goals.push({name:end,target:this.world(end),weight:10});
      if(this.ground&&end.endsWith('Foot'))goals.push({name:end,target:new V(0,this.rest.targets[end][1],0),weight:10,floor:true});
    }return goals;
  }

  private polishContacts(goals:PositionGoal[]){for(const goal of goals)if(!goal.floor)this.solve(goal.name,goal.target);}
  private contactError(goals:PositionGoal[]){return goals.reduce((max,g)=>Math.max(max,goalError(g,this.world(g.name))),0);}

  private seedBodyPosition(active:string,target:THREE.Vector3,contacts:PositionGoal[]){
    const hips=this.bones.Hips,parent=hips.parent!,setWorld=(p:THREE.Vector3)=>{hips.position.copy(parent.worldToLocal(p));hips.updateWorldMatrix(false,true);};
    const assistance=THREE.MathUtils.clamp(this.world(active).distanceTo(target)/.08,0,1);
    if(active==='Hips')setWorld(target.clone());
    else{
      const residual=target.clone().sub(this.world(active)).multiplyScalar(active==='Chest'?1:.55).clampLength(0,active==='Chest'?.3:.18);
      setWorld(this.world('Hips').add(residual));
    }
    // A vertical Jacobian at an exactly straight knee cannot discover flexion.
    // Project pelvis position into the support legs' reach first, then seed each
    // leg with the analytic hinge solution before the multi-goal iterations.
    for(let pass=0;pass<6;pass++)for(const goal of contacts){
      if(goal.floor||!goal.name.endsWith('Foot'))continue;
      const [upper,mid,end]=CHAINS[goal.name],a=this.world(upper),delta=a.clone().sub(goal.target),distance=delta.length();
      const u=this.bones[mid].position.length(),l=this.bones[end].position.length(),max=u+l-1e-5,min=Math.sqrt(u*u+l*l+2*u*l*Math.cos(THREE.MathUtils.degToRad(150)));
      if(distance>max)setWorld(this.world('Hips').addScaledVector(delta.normalize(),max-distance));
      else if(distance<min)setWorld(this.world('Hips').addScaledVector(distance>1e-8?delta.normalize():new V(0,1,0),min-distance));
    }
    if(active!=='Hips'&&contacts.some(g=>!g.floor&&g.name.endsWith('Foot')&&this.world(CHAINS[g.name][0]).distanceTo(g.target)>.98*(this.bones[CHAINS[g.name][1]].position.length()+this.bones[g.name].position.length())))setWorld(this.world('Hips').add(new V(0,-.025*assistance,0)));
    this.polishContacts(contacts);
    if(CHAINS[active])this.solve(active,target);
  }

  /** Keep fixed contacts at the last feasible point along the user's movement.
   * Interpolation is always from pointer-down, so a detour cannot accumulate drift. */
  private keepContacts(joints:SolverJoint[],baseline:ReturnType<typeof captureJoints>,goals:PositionGoal[],project:(name:string)=>void){
    if(!goals.length||this.contactError(goals)<=.0015)return false;
    const desired=captureJoints(joints);restoreJoints(joints,baseline);this.polishContacts(goals);
    let best=captureJoints(joints),low=0,high=1;
    const tolerance=Math.max(.0015,this.contactError(goals)+.00005);
    for(let i=0;i<8;i++){
      const t=(low+high)/2;interpolateJoints(joints,baseline,desired,t);for(const joint of joints)project(joint.bone.name);
      this.bones.Hips.updateWorldMatrix(true,true);this.polishContacts(goals);
      if(this.contactError(goals)<=tolerance){low=t;best=captureJoints(joints);}else high=t;
    }
    restoreJoints(joints,best);return true;
  }

  private solveBodyTarget(active:string,target:THREE.Vector3,baseline:PoseDocument){
    const started=performance.now();let iterations=0;
    this.apply(baseline,false);this.warning='';
    const contacts=this.fixedGoals(active,true),goals:PositionGoal[]=[...contacts,{name:active,target,weight:1}],joints=this.bodyJoints();
    const before=captureJoints(joints),origin=this.bones.Hips.position.clone();
    const orientations=Object.fromEntries(END_EFFECTORS.map(end=>[end,this.bones[end].getWorldQuaternion(new Q())]));
    const twists=Object.fromEntries(['Spine','Spine1','Chest','UpperChest'].map(n=>[n,decomposeJointRotation(this.bones[n].quaternion,new Q().fromArray(this.rest.joints[n].quaternion)).twist]));
    const project=(name:string)=>{
      if(name==='Hips'){
        if(active!=='Hips'){const delta=this.bones.Hips.position.clone().sub(origin).clampLength(0,.35);this.bones.Hips.position.copy(origin).add(delta);}return;
      }
      if(name in twists)this.bones[name].quaternion.copy(constrainJointRotation(name,this.bones[name].quaternion,new Q().fromArray(this.rest.joints[name].quaternion),twists[name]));
      else this.limitJoint(name,false);
    };
    if(CHAINS[active])this.solve(active,target);
    else if(active==='Chest')solveSpineTarget(this.bones,target,this.rest.joints);
    if(this.world(active).distanceTo(target)>.004)this.seedBodyPosition(active,target,contacts);
    if(active==='Hips')joints[0].mobility=1;
    if(this.world(active).distanceTo(target)>.001||this.contactError(contacts)>.001)iterations=solveConstrainedIK(this.bones,joints,goals,project,28).iterations;
    this.polishContacts(contacts);
    const limited=this.keepContacts(joints,before,contacts,project);
    for(const end of END_EFFECTORS)this.setWorldQuaternion(this.bones[end],this.pins[end]?.orientation?new Q().fromArray(this.pins[end]!.quaternion):orientations[end]);
    if(this.pins[active as Effector])this.pins[active as Effector]!.position=asVec(this.world(active));
    const error=this.world(active).distanceTo(target),fixedError=this.contactError(contacts);
    this.lastSolveStats={iterations,error,fixedError,milliseconds:performance.now()-started};
    this.warning=fixedError>.002?`固定点仍有 ${(fixedError*100).toFixed(1)} 厘米误差，请缩小调整幅度`:error>.01||limited?`${PART_NAMES[active]}已到联动范围边界，剩余 ${(error*100).toFixed(1)} 厘米`:'';
  }

  private keepArticulatedPins(baseline:PoseDocument){
    if(!this.activeRig.ik||!this.activeRig.contacts.some(end=>this.pins[end]))return;
    const desired=this.snapshot(),pins=structuredClone(this.pins),state=this.articulatedState();
    const feasible=(result:ReturnType<typeof solveRigContacts>)=>result.positionError<=.0015&&result.orientationError<=THREE.MathUtils.degToRad(.5);
    if(feasible(solveRigContacts(state,pins)))return;
    this.restorePose(baseline);this.pins=structuredClone(pins);
    // A fixed paw takes priority over an unreachable body/FK edit. Search along
    // the user's movement from pointer-down, never from the previous solve.
    let best=this.snapshot(),low=0,high=1;
    const initial=solveRigContacts(state,pins);best=this.snapshot();
    const tolerance={position:Math.max(.0015,initial.positionError+1e-7),orientation:Math.max(THREE.MathUtils.degToRad(.5),initial.orientationError+1e-7)};
    for(let i=0;i<8;i++){
      const t=(low+high)/2;this.restorePose(baseline);this.pins=structuredClone(pins);
      this.model.position.fromArray(baseline.root.position).lerp(new V().fromArray(desired.root.position),t);
      this.model.quaternion.fromArray(baseline.root.quaternion).slerp(new Q().fromArray(desired.root.quaternion),t);
      for(const[name,bone]of Object.entries(this.bones)){
        bone.position.fromArray(baseline.joints[name].position).lerp(new V().fromArray(desired.joints[name].position),t);
        bone.quaternion.fromArray(baseline.joints[name].quaternion).slerp(new Q().fromArray(desired.joints[name].quaternion),t);this.limitJoint(name,false);
      }
      this.model.updateMatrixWorld(true);const result=solveRigContacts(state,pins);
      if(result.positionError<=tolerance.position&&result.orientationError<=tolerance.orientation){low=t;best=this.snapshot();}else high=t;
    }
    this.restorePose(best);this.warning='已到固定爪子允许的关节范围，请缩小移动幅度或解除固定';
  }

  private keepPinnedPose(baseline:PoseDocument){
    if(this.activeRig.ik){this.keepArticulatedPins(baseline);return;}
    if(!this.activeRig.capabilities.pins)return;
    const goals=this.fixedGoals();if(!goals.length||this.contactError(goals)<=.0015)return;
    const joints=this.bodyJoints(),desired=captureJoints(joints),pins=structuredClone(this.pins);this.apply(baseline,false);this.pins=pins;const before=captureJoints(joints);restoreJoints(joints,desired);
    if(this.keepContacts(joints,before,goals,n=>this.limitJoint(n,false)))this.warning='已到固定点允许的关节范围边界';
    for(const end of END_EFFECTORS)if(this.pins[end]?.orientation)this.setWorldQuaternion(this.bones[end],new Q().fromArray(this.pins[end]!.quaternion));
  }

  private solvePins() {
    if(this.activeRig.ik){solveRigContacts(this.articulatedState(),this.pins);return;}
    if(!this.activeRig.capabilities.pins)return;
    for (const end of END_EFFECTORS) {
      const pin = this.pins[end]; if (!pin) continue;
      this.solve(end,new V().fromArray(pin.position));
      if (pin.orientation) this.setWorldQuaternion(this.bones[end],new Q().fromArray(pin.quaternion));
    }
  }

  setSymmetry(group:SymmetryGroup,enabled:boolean){
    if(!this.activeRig.capabilities.mirror)return;
    if(this.dragBefore)this.cancelDrag();this.symmetry={...(this.symmetry??defaultSymmetry()),[group]:enabled};this.warning='';
    if(this.ready){this.onInfo(this.info());this.onCommit(this.snapshot(),false);}
  }
  private activeSymmetry(name:string){if(!this.activeRig.capabilities.mirror)return null;const pair=symmetricLimb(name);return pair&&this.symmetry?.[pair.group]?pair:null;}
  private beginPoseDrag(){this.dragBefore=this.snapshot();this.cancelPending=false;}
  private finishPoseDrag(){
    if(!this.dragBefore)return;if(this.cancelPending)this.restorePose(this.dragBefore);
    const changed=!this.cancelPending&&(!this.activeSymmetry(this.selected)||this.poseChanged(this.dragBefore));this.dragBefore=null;
    if(changed&&!this.activeSymmetry(this.selected))this.syncTargets();this.syncGizmo();this.update(false);if(!this.cancelPending&&changed)this.commit();
  }
  private interruptPoseDrag(){if(!this.dragBefore||this.disposed)return;this.cancelDrag();this.transform.pointerUp(null);}
  private poseCaptureLost=()=>{queueMicrotask(()=>this.interruptPoseDrag());};
  private poseVisibility=()=>{if(this.renderer.domElement.ownerDocument.hidden)this.interruptPoseDrag();};
  private restorePose(doc:PoseDocument){
    this.model.position.fromArray(doc.root.position);this.model.quaternion.fromArray(doc.root.quaternion);
    for(const[name,joint]of Object.entries(doc.joints)){this.bones[name].position.fromArray(joint.position);this.bones[name].quaternion.fromArray(joint.quaternion);}
    this.targets=structuredClone(doc.targets);this.poles=structuredClone(doc.poles);this.pins=structuredClone(doc.pins);this.hands={...doc.hands};this.model.updateMatrixWorld(true);
  }
  private poseChanged(doc:PoseDocument){
    return Object.entries(doc.joints).some(([name,joint])=>this.bones[name].position.toArray().some((v,i)=>Math.abs(v-joint.position[i])>1e-10)||this.bones[name].quaternion.toArray().some((v,i)=>Math.abs(v-joint.quaternion[i])>1e-10))||(['poles','targets'] as const).some(key=>END_EFFECTORS.some(end=>this[key][end].some((v,i)=>Math.abs(v-doc[key][end][i])>1e-8)));
  }
  private pairedEdit(name:string,edit:()=>void,baseline?:PoseDocument):boolean|null{
    const pair=this.activeSymmetry(name);if(!pair)return null;
    const before=baseline??this.snapshot(),end=pair.group==='arms'?'Hand':'Foot';this.restorePose(before);this.warning='';
    const fixed=(['Left','Right'] as const).map(side=>`${side}${end}` as Effector).filter(e=>this.pins[e]);
    if(fixed.length){this.warning=`${pair.group==='arms'?'双臂':'双腿'}对称与${fixed.map(e=>PART_NAMES[e]).join('、')}固定冲突，请先解除该组固定`;this.syncGizmo();this.update(false);return false;}
    edit();this.model.updateMatrixWorld(true);
    for(const part of limbParts(pair.group)){const bone=this.bones[`${pair.other}${part}`];bone.quaternion.copy(mirroredRotation(this.bones[`${pair.side}${part}`].quaternion));this.limitJoint(bone.name,false);}
    this.model.updateMatrixWorld(true);
    if(pair.group==='legs'&&this.ground&&(['LeftFoot','RightFoot'] as const).some(e=>this.world(e).y<this.rest.targets[e][1]-.001)){
      this.restorePose(before);this.warning='双腿对称调整会低于地面，请缩小幅度、调整骨盆或关闭地面约束';this.syncGizmo();this.update(false);return false;
    }
    const parent=this.bones[`${pair.side}${limbParts(pair.group)[0]}`].parent!,plane=parent.matrixWorld,inverse=plane.clone().invert();
    const pole=new V().fromArray(this.poles[`${pair.side}${end}`]).applyMatrix4(inverse);pole.x*=-1;
    this.poles[`${pair.other}${end}`]=asVec(pole.applyMatrix4(plane));
    for(const side of [pair.side,pair.other])this.targets[`${side}${end}`]=asVec(this.world(`${side}${end}`));
    this.update(false);return this.poseChanged(before);
  }

  private manipulate() {
    if(this.cancelPending&&this.dragBefore)return false;
    if(!this.humanoid){
      if(this.dragBefore)this.restorePose(this.dragBefore);
      const bone=this.bones[this.selected];if(!bone)return false;
      const baseline=this.snapshot();this.warning='';
      if(this.mode==='rotate'){this.setWorldQuaternion(bone,this.gizmo.quaternion);this.limitJoint(this.selected);}
      else if(this.activeRig.ik&&this.activeRig.chains[this.selected])this.solve(this.selected,this.gizmo.position.clone());
      else if(this.selected===this.activeRig.root){bone.position.copy(bone.parent!.worldToLocal(this.gizmo.position.clone()));bone.updateWorldMatrix(false,true);}
      else return false;
      const pin=this.pins[this.selected];if(pin){if(this.mode==='translate')pin.position=asVec(this.world(this.selected));else if(pin.orientation)pin.quaternion=bone.getWorldQuaternion(new Q()).toArray();}
      this.keepArticulatedPins(baseline);
      this.syncTargets();this.update(false);return true;
    }
    const paired=this.pairedEdit(this.selected,()=>{
      const bone=this.bones[this.selected];
      if(this.mode==='rotate'){this.setWorldQuaternion(bone,this.gizmo.quaternion);this.limitJoint(this.selected);}
      else if(CHAINS[this.selected]){const target=this.gizmo.position.clone();if(this.ground&&this.selected.endsWith('Foot'))target.y=Math.max(this.rest.targets[this.selected][1],target.y);this.solve(this.selected,target);}
      else {const end=Object.keys(CHAINS).find(e=>CHAINS[e][1]===this.selected);if(end){this.poles[end]=asVec(this.gizmo.position);this.solve(end,new V().fromArray(this.targets[end]),this.gizmo.position);}}
    },this.dragBefore??undefined);
    if(paired!==null)return paired;
    this.warning = '';
    // TransformControls already computes from pointer-down. Match that baseline
    // for the skeleton too, rather than accumulating a different solve per event.
    if(this.dragBefore)this.apply(this.dragBefore,false);
    const bone = this.bones[this.selected]; if (!bone) return false;
    const baseline=this.snapshot();
    if(this.mode==='translate'&&this.fullBody&&(CHAINS[this.selected]||this.selected==='Chest'||this.selected==='Hips')){
      const target=this.gizmo.position.clone();if(this.ground&&this.selected.endsWith('Foot'))target.y=Math.max(this.rest.targets[this.selected][1],target.y);
      this.solveBodyTarget(this.selected,target,baseline);this.syncTargets();this.update(false);return true;
    }
    if (this.mode === 'rotate') {
      this.setWorldQuaternion(bone,this.gizmo.quaternion);
      this.limitJoint(this.selected);
      this.markCustomHand(this.selected);
      if (this.pins[this.selected as Effector]) {
        this.pins[this.selected as Effector]!.quaternion = this.gizmo.quaternion.toArray();
      }
    } else if (CHAINS[this.selected]) {
      const target = this.gizmo.position.clone();
      if (this.ground && this.selected.endsWith('Foot')) target.y = Math.max(this.rest.targets[this.selected][1], target.y);
      this.targets[this.selected] = asVec(target);
      if (this.pins[this.selected as Effector]) this.pins[this.selected as Effector]!.position = asVec(target);
      this.solve(this.selected,target);
    } else if (this.selected === 'Hips') {
      bone.position.copy(bone.parent!.worldToLocal(this.gizmo.position.clone()));
      bone.updateWorldMatrix(false,true);
    } else if (this.selected === 'Chest') {
      const error=solveSpineTarget(this.bones,this.gizmo.position,this.rest.joints);
      if(error>.01)this.warning='胸腔目标已到可达范围边界';
    } else {
      const end = Object.keys(CHAINS).find(k => CHAINS[k][1] === this.selected);
      if (end) { this.poles[end] = asVec(this.gizmo.position); this.solve(end,new V().fromArray(this.targets[end]),this.gizmo.position); }
    }
    this.solvePins();
    this.keepPinnedPose(baseline);
    this.syncTargets();
    this.update(false);
    return true;
  }

  private pointerDown = (event: PointerEvent) => {
    if (!this.ready || this.motion?.active || event.button!==0 || this.transform.axis) return;
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.intersectObjects(this.handles.filter(h=>h.visible))[0];
    if(hit) this.select(hit.object.userData.part);
  };

  select(name: string) {
    if(this.motion?.active)return;
    if(!this.bones[name])return;
    this.selected=name;this.warning='';
    const digit=this.activeRig.capabilities.hands?fingerPart(name):null;if(digit)this.handDetail=digit[1] as Side;else if(this.handDetail){this.handDetail=null;if(this.ready)this.focus();}
    this.setMode(this.canTranslate(name)?'translate':'rotate');
    this.syncGizmo(); this.transform.attach(this.gizmo); this.update(false);
  }
  canTranslate(name=this.selected){return this.humanoid?(!!CHAINS[name]||name===this.activeRig.root||name==='Chest'||Object.values(CHAINS).some(c=>c[1]===name)):name===this.activeRig.root||!!this.activeRig.ik&&!!this.activeRig.chains[name];}
  setMode(mode: 'translate'|'rotate') { this.mode=mode==='translate'&&!this.canTranslate()?'rotate':mode; this.transform.setMode(this.mode); this.syncGizmo();if(this.ready)this.onInfo(this.info()); }
  setSpace(space:'world'|'local') { this.transform.setSpace(space); }
  private syncGizmo() {
    if(!this.ready)return;
    this.suppress=true;
    this.gizmo.position.copy(this.world(this.selected));
    this.gizmo.quaternion.copy(this.bones[this.selected].getWorldQuaternion(new Q()));
    this.suppress=false;
  }
  setMore(value:boolean){this.moreControls=value;this.update(false);}
  setHandDetail(side:Side|null){if(!this.activeRig.capabilities.hands)return;const previous=this.handDetail;this.handDetail=side;if(side)this.select(`${side}Index1`);else if(fingerPart(this.selected)&&previous)this.select(`${previous}Hand`);this.update(false);}
  focusHand(side:Side){
    if(!this.activeRig.capabilities.hands||!this.bones[`${side}Hand`]||this.cameraState?.locked)return;
    this.fly?.stop();const center=this.world(`${side}Hand`);for(const digit of DIGITS)center.add(this.world(`${side}${digit}2`));center.divideScalar(6);
    const direction=this.camera.position.clone().sub(this.orbit.target).normalize();this.view='free';
    this.camera=new THREE.PerspectiveCamera(this.cameraState.fov,this.host.clientWidth/Math.max(1,this.host.clientHeight),.01,100);
    this.camera.position.copy(center).addScaledVector(direction,.52);this.camera.lookAt(center);this.orbit.object=this.camera;this.orbit.target.copy(center);this.transform.camera=this.camera;this.orbit.update();this.commitCamera();
  }
  setDisplay(mode:'surface'|'skeleton'){this.display=mode;this.model.visible=mode==='surface';this.boneDisplay.visible=mode==='skeleton';this.update(false);}
  setGrid(value:boolean){this.grid.visible=value;}
  setGround(value:boolean){if(!this.activeRig.capabilities.floor)return;this.ground=value;this.commit();}
  setFullBody(value:boolean){if(!this.activeRig.capabilities.fullBodyIK)return;this.fullBody=value;this.update(false);this.commit();}
  setFeetPin(enabled:boolean){
    if(!this.rest||!this.activeRig.capabilities.pins)return;this.warning='';
    for(const end of this.activeRig.supportContacts??this.activeRig.contacts){if(enabled)this.pins[end]={position:asVec(this.world(end)),quaternion:this.bones[end].getWorldQuaternion(new Q()).toArray(),orientation:this.activeRig.supportOrientation??false};else delete this.pins[end];}
    this.update(false);this.commit();
  }
  setPin(enabled:boolean,orientation=false){
    if(!this.activeRig.capabilities.pins)return;
    if(!this.activeRig.contacts.includes(this.selected))return;this.warning='';
    if(enabled)this.pins[this.selected as Effector]={position:asVec(this.world(this.selected)),quaternion:this.bones[this.selected].getWorldQuaternion(new Q()).toArray(),orientation};
    else delete this.pins[this.selected as Effector];
    this.update(false);this.commit();
  }
  cancelDrag(){if(this.dragBefore){this.cancelPending=true;this.restorePose(this.dragBefore);this.transform.reset();this.syncGizmo();this.update(false);}}
  prepareSwitch(){this.cancelMotion();this.interruptPoseDrag();this.fly?.stop();}

  setSelectedPosition(axis:number,value:number){
    if(!this.canTranslate()||!Number.isFinite(value)||Math.abs(value)>10)return;
    this.gizmo.position.copy(this.world(this.selected));this.gizmo.position.setComponent(axis,value);
    this.mode='translate';this.transform.setMode('translate');if(!this.manipulate())return;this.update(true);this.syncGizmo();this.commit();
  }
  setSelectedRotation(axis:number,value:number){
    if(!Number.isFinite(value)||!this.bones[this.selected]||!this.canRotateAxis(axis))return;
    if(!this.humanoid){
      const baseline=this.snapshot();
      const bone=this.bones[this.selected],rest=this.restRotation(),angles=fkAngles(bone.quaternion,rest,this.rigJoint());angles[axis]=THREE.MathUtils.clamp(value,-180,180);
      bone.quaternion.copy(fkRotation(angles,rest,this.rigJoint()));this.limitJoint(this.selected);const pin=this.pins[this.selected];if(pin?.orientation)pin.quaternion=bone.getWorldQuaternion(new Q()).toArray();this.keepArticulatedPins(baseline);this.syncTargets();this.update(false);this.syncGizmo();this.commit();return;
    }
    const paired=this.pairedEdit(this.selected,()=>{const bone=this.bones[this.selected],e=new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ'),a=[e.x,e.y,e.z];a[axis]=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(value,-180,180));bone.quaternion.setFromEuler(new THREE.Euler(a[0],a[1],a[2],'XYZ'));this.limitJoint(this.selected);});
    if(paired!==null){if(paired){this.syncGizmo();this.commit();}return;}
    const baseline=this.snapshot();
    const bone=this.bones[this.selected],e=new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');
    const a=e.toArray() as [number,number,number,THREE.EulerOrder];a[axis]=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(value,-180,180));
    this.warning='';bone.quaternion.setFromEuler(new THREE.Euler(a[0],a[1],a[2],'XYZ'));bone.updateWorldMatrix(false,true);this.limitJoint(this.selected);
    this.markCustomHand(this.selected);
    if(this.pins[this.selected as Effector])this.pins[this.selected as Effector]!.quaternion=bone.getWorldQuaternion(new Q()).toArray();
    this.solvePins();this.keepPinnedPose(baseline);this.syncTargets();this.update(false);this.syncGizmo();this.commit();
  }
  private applyHandShape(side:'Left'|'Right',shape:string){
    const gesture=HAND_GESTURES.find(g=>g.name===shape);if(!gesture)return;
    this.hands[side]=shape;writeHandValues(this.bones,this.rest.joints,side,gesture.values,this.profile.handCurlNormalSign);
  }
  private markCustomHand(name:string){if(!this.activeRig.capabilities.hands)return;const digit=fingerPart(name);if(digit)this.hands[digit[1] as Side]='自定义';}
  setFinger(side:Side,digit:Digit,joint:number,value:number,kind:'curl'|'spread',commit=true){
    if(!this.activeRig.capabilities.hands||!this.rest||!Number.isFinite(value)||!DIGITS.includes(digit)||![1,2,3].includes(joint))return;
    const name=`${side}${digit}${joint}`,bone=this.bones[name],axes=fingerAxes(this.rest.joints,side,digit,joint,this.profile.handCurlNormalSign),angles=fingerAngles(bone.quaternion,axes);
    bone.quaternion.copy(fingerRotation(digit,joint,kind==='curl'?THREE.MathUtils.degToRad(value):angles.curl,kind==='spread'?THREE.MathUtils.degToRad(value):angles.spread,axes));bone.updateWorldMatrix(false,true);
    this.markCustomHand(name);this.update(false);this.syncGizmo();if(commit)this.commit();
  }
  setForearmTwist(side:Side,value:number,commit=true){
    if(!this.activeRig.capabilities.hands||!this.rest||!Number.isFinite(value))return;
    const paired=this.pairedEdit(`${side}ForeArm`,()=>{const name=`${side}ForeArm`,bone=this.bones[name],axis=this.hingeAxis(name),lower=new V().fromArray(this.rest.joints[`${side}Hand`].position),a=forearmAngles(bone.quaternion,axis,lower);bone.quaternion.copy(forearmRotation(a.bend,THREE.MathUtils.degToRad(value),axis,lower));});
    if(paired!==null){if(paired){this.syncGizmo();if(commit)this.commit();}return;}
    const name=`${side}ForeArm`,bone=this.bones[name],axis=this.hingeAxis(name),lower=new V().fromArray(this.rest.joints[`${side}Hand`].position);
    const angles=forearmAngles(bone.quaternion,axis,lower);bone.quaternion.copy(forearmRotation(angles.bend,THREE.MathUtils.degToRad(value),axis,lower));bone.updateWorldMatrix(false,true);
    this.solvePins();this.syncTargets();this.update(false);this.syncGizmo();if(commit)this.commit();
  }
  setToeBend(side:Side,value:number,commit=true){
    if(!this.bones[`${side}ToeBase`]||!Number.isFinite(value))return;const name=`${side}ToeBase`;
    const paired=this.pairedEdit(name,()=>{this.bones[name].quaternion.setFromAxisAngle(new V(1,0,0),THREE.MathUtils.degToRad(value));this.limitJoint(name);});
    if(paired!==null){if(paired){this.syncGizmo();if(commit)this.commit();}return;}
    this.bones[name].quaternion.setFromAxisAngle(new V(1,0,0),THREE.MathUtils.degToRad(value));this.limitJoint(name);this.update(false);this.syncGizmo();if(commit)this.commit();
  }
  private readHand(side:Side){
    const values=emptyHandValues();if(!this.activeRig.capabilities.hands||!this.rest)return values;
    for(const digit of DIGITS)for(let i=1;i<=3;i++){
      const angles=fingerAngles(this.bones[`${side}${digit}${i}`].quaternion,fingerAxes(this.rest.joints,side,digit,i,this.profile.handCurlNormalSign));
      values[digit].curl[i-1]=THREE.MathUtils.radToDeg(angles.curl);if(i===1)values[digit].spread=THREE.MathUtils.radToDeg(angles.spread);
    }return values;
  }
  private readForearm(side:Side){if(!this.activeRig.capabilities.hands||!this.rest)return 0;const name=`${side}ForeArm`;return THREE.MathUtils.radToDeg(forearmAngles(this.bones[name].quaternion,this.hingeAxis(name),new V().fromArray(this.rest.joints[`${side}Hand`].position)).twist);}
  setHand(side:'Left'|'Right',shape:string){
    const gesture=HAND_GESTURES.find(g=>g.name===shape);if(gesture)this.applyHandGesture(side,gesture.values,gesture.name);
  }
  captureHand(side:Side){const values=this.readHand(side);if(side==='Right')for(const d of DIGITS)values[d].spread*=-1;return normalizedHandValues(values);}
  applyHandGesture(side:Side,values:HandValues,label='自定义'){
    if(!this.activeRig.capabilities.hands)throw new Error('此骨架不支持手势');
    if(!this.rest||!validHandValues(values))throw new Error('手势指骨角度无效');
    writeHandValues(this.bones,this.rest.joints,side,values,this.profile.handCurlNormalSign);this.hands[side]=handShapeValid(label)?label:'自定义';
    this.update(false);this.syncGizmo();this.commit();
  }
  copyHand(source:Side){const target=source==='Left'?'Right':'Left';this.applyHandGesture(target,this.captureHand(source),this.hands[source]);}
  resetSelected(){const rest=this.rest.joints[this.selected];if(!rest)return;const paired=this.pairedEdit(this.selected,()=>{this.bones[this.selected].quaternion.fromArray(rest.quaternion);});if(paired!==null){if(paired){this.syncGizmo();this.commit();}return;}const baseline=this.snapshot();this.bones[this.selected].quaternion.fromArray(rest.quaternion);this.bones[this.selected].position.fromArray(rest.position);this.markCustomHand(this.selected);delete this.pins[this.selected as Effector];this.bones[this.selected].updateWorldMatrix(false,true);this.solvePins();this.keepPinnedPose(baseline);this.syncTargets();this.update(true);this.syncGizmo();this.commit();}

  applyPreset(preset:Preset,commit=true,scope:PresetScope='all'){
    if(!this.activeRig.presets.some(p=>p.id===preset.id))throw new Error('此预设不适用于当前骨架');
    if(!this.humanoid){
      const before=this.snapshot();this.apply({...this.rest,appearance:before.appearance,name:before.name,selection:before.selection,views:before.views,camera:before.camera,props:before.props,referenceImage:before.referenceImage},true,false,false,false);if(commit)this.commit();return;
    }
    // Refuse conflicting contacts before changing anything. Untouched pins stay fixed.
    if(scope!=='all'&&Object.keys(this.pins).some(end=>scope==='lower'||scope==='upper'&&end.endsWith('Hand')))
      throw new Error(scope==='lower'?'下半身包含骨盆，会带动全身；请先解除固定的手脚':'请先解除手部固定，再套用上半身姿势');
    const before=scope==='all'?null:this.snapshot();
    const views=this.views,name=this.name,fullBody=this.fullBody,props=this.props??[],appearance=this.appearance;
    this.apply({...this.rest,appearance},false,false);this.props=props;this.syncPropScene();this.views=views;this.fullBody=fullBody;this.name=commit?preset.name:name;
    this.pins={};this.ground=preset.ground??true;this.warning='';
    this.bones.Hips.position.y-=preset.drop??0;
    this.bones.Spine.quaternion.setFromEuler(new THREE.Euler(preset.lean??0,preset.twist??0,0));
    this.bones.Head.quaternion.setFromEuler(new THREE.Euler(0,preset.head??0,0));
    // Spread a preset's body turn across the spine instead of exceeding one joint.
    if(preset.twist){for(const name of ['Spine','Spine1','Chest'])this.bones[name].quaternion.setFromEuler(new THREE.Euler(name==='Spine'?preset.lean??0:0,preset.twist/3,0));}
    for(const name of Object.keys(JOINT_LIMITS))this.limitJoint(name);
    this.model.updateMatrixWorld(true);
    const defaults:Record<Effector,Vec3>={LeftHand:[.235,.93,.02],RightHand:[-.235,.93,.02],LeftFoot:[.14,this.rest.targets.LeftFoot[1],0],RightFoot:[-.14,this.rest.targets.RightFoot[1],0]};
    for(const end of END_EFFECTORS){
      const target:Vec3=[...(preset.hands?.[end]??preset.feet?.[end]??defaults[end])];
      if(end.endsWith('Foot')&&preset.feet?.[end])target[1]=this.rest.targets[end][1]+target[1]-.10;
      if(end.endsWith('Foot')&&this.ground)target[1]=Math.max(this.rest.targets[end][1],target[1]);
      this.targets[end]=[...target];
      const elbow=this.world(CHAINS[end][1]);
      this.poles[end]=preset.poles?.[end]??(end.endsWith('Foot')?[end.startsWith('Left')?.35:-.35,.4,.8]:asVec(elbow.add(new V(0,0,-.65))));
      this.solve(end,new V().fromArray(target),undefined,false);
      if(end.endsWith('Foot'))this.setWorldQuaternion(this.bones[end],new Q());
    }
    this.applyHandShape('Left',preset.handShape??'张手');this.applyHandShape('Right',preset.handShape??'张手');
    if(before){
      // Transfer local joint transforms so a standing arm preset also works seated.
      // Restore directly to leave every excluded joint bit-for-bit unchanged.
      for(const [name,joint] of Object.entries(before.joints))if(!inPresetScope(name,scope)){
        this.bones[name].position.fromArray(joint.position);this.bones[name].quaternion.fromArray(joint.quaternion);
      }
      this.model.position.fromArray(before.root.position);this.model.quaternion.fromArray(before.root.quaternion);
      this.name=before.name;this.hands={...before.hands};this.pins=structuredClone(before.pins);
      if(scope!=='lower')this.ground=before.ground;
      this.targets=structuredClone(before.targets);this.poles=structuredClone(before.poles);
      this.model.updateMatrixWorld(true);
      for(const end of END_EFFECTORS)if(scope==='lower'||scope==='upper'&&end.endsWith('Hand')){
        this.targets[end]=asVec(this.world(end));
        this.poles[end]=asVec(this.world(CHAINS[end][1]));
      }
      this.warning='';
    }
    this.update(true);this.syncGizmo();if(commit)this.commit();
  }

  mirror(side?:'Left'|'Right'){
    if(!this.activeRig.capabilities.mirror)return;
    const before=this.snapshot(),reflect=new THREE.Matrix4().makeScale(-1,1,1);
    for(const [name,bone] of Object.entries(this.bones)){
      if(side&& !name.startsWith(side==='Left'?'Right':'Left'))continue;
      const other=name.startsWith('Left')?name.replace('Left','Right'):name.startsWith('Right')?name.replace('Right','Left'):name;
      const data=before.joints[other];if(!data)continue;
      const matrix=new THREE.Matrix4().makeRotationFromQuaternion(new Q().fromArray(data.quaternion));
      matrix.premultiply(reflect).multiply(reflect);bone.quaternion.setFromRotationMatrix(matrix);
      if(name==='Hips'){bone.position.fromArray(data.position);bone.position.x*=-1;}
    }
    const mirrorEnd=(e:string)=>e.startsWith('Left')?e.replace('Left','Right'):e.replace('Right','Left');
    const modelMatrix=this.model.matrixWorld.clone(),inverse=modelMatrix.clone().invert();
    const reflectPosition=(pos:Vec3):Vec3=>{const p=new V().fromArray(pos).applyMatrix4(inverse);p.x=-p.x;return asVec(p.applyMatrix4(modelMatrix));};
    const nextPins:PoseDocument['pins']=side?structuredClone(before.pins):{};
    for(const end of END_EFFECTORS){
      if(side&&end.startsWith(side))continue;
      const other=mirrorEnd(end) as Effector,pin=before.pins[other];
      if(pin){
        const rootQ=this.model.getWorldQuaternion(new Q()),localQ=rootQ.clone().invert().multiply(new Q().fromArray(pin.quaternion));
        const m=new THREE.Matrix4().makeRotationFromQuaternion(localQ).premultiply(reflect).multiply(reflect);
        nextPins[end]={...pin,position:reflectPosition(pin.position),quaternion:rootQ.multiply(new Q().setFromRotationMatrix(m)).toArray()};
      }else delete nextPins[end];
      this.poles[end]=reflectPosition(before.poles[other]);
    }
    this.pins=nextPins;
    this.hands=side?{...this.hands,[side==='Left'?'Right':'Left']:before.hands[side]}:{Left:before.hands.Right,Right:before.hands.Left};
    this.syncTargets();this.update(true);this.syncGizmo();this.commit();
  }

  private syncTargets(){this.model.updateMatrixWorld(true);for(const end of this.effectors)this.targets[end]=asVec(this.world(end));}
  private syncPosePoles(){
    if(!this.humanoid)return;this.model.updateMatrixWorld(true);
    for(const[end,chain]of Object.entries(this.activeRig.chains)){
      const [upper,mid,last]=chain,a=this.world(upper),b=this.world(mid),c=this.world(last),axis=c.clone().sub(a).normalize();
      const projection=a.clone().addScaledVector(axis,b.clone().sub(a).dot(axis));let bend=b.clone().sub(projection);
      if(bend.lengthSq()<1e-10){const hinge=this.hingeAxis(mid).applyQuaternion(this.bones[mid].parent!.getWorldQuaternion(new Q()));bend=axis.clone().cross(hinge);}
      if(bend.lengthSq()>1e-12)this.poles[end]=asVec(b.addScaledVector(bend.normalize(),.5));
    }
  }
  async prepareAppearance(ref:AppearanceRef,bytes?:ArrayBuffer){
    if(!validAppearance(ref,this.activeRig))throw new Error('角色外观与当前骨架不兼容');
    if(this.appearanceGroups.has(ref.id))return;
    if(!bytes){
      const builtin=this.activeRig.appearances?.find(a=>a.id===ref.id);
      if(builtin){const response=await fetch(builtin.url);if(!response.ok)throw new Error('内置角色外观加载失败');bytes=await response.arrayBuffer();}
      else{const saved=await characterLibrary.get(ref);if(!saved)throw new Error(`本机缺少角色外观“${ref.name}”，请先导入对应文件或完整工程包`);bytes=saved.bytes;}
    }
    if(this.disposed)return;
    const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==ref.id)throw new Error('角色文件与工程外观引用不一致');
    const source=await parseCharacter(bytes,ref.format??'glb');
    try{
      if(this.disposed)return;
      const group=buildAppearance(source.scene,this.activeRig,this.rest,this.bones);group.visible=false;
      if(this.appearanceGroups.has(ref.id)){disposeObject(group);return;}
      this.model.add(group);this.appearanceGroups.set(ref.id,group);
    }finally{source.dispose();}
  }
  renameAppearance(id:string,name:string){if(this.appearance?.id===id){this.appearance={...this.appearance,name};if(this.motionBefore)this.motionBefore.appearance={...this.appearance};this.onInfo(this.info());this.onCommit(this.snapshot(),false);}}
  renameMotion(id:string,name:string){this.motion?.rename(id,name);this.onInfo(this.info());}
  removeMotion(id:string){if(this.motion?.state().clip===id)this.cancelMotion();this.motion?.remove(id);this.onInfo(this.info());}
  setAppearance(ref?:AppearanceRef,commit=true){
    if(ref&&(!validAppearance(ref,this.activeRig)||!this.appearanceGroups?.has(ref.id)))throw new Error('请先载入兼容的角色外观');
    for(const mesh of this.originalMeshes??[])mesh.visible=!ref;
    for(const[id,group]of this.appearanceGroups??[])group.visible=id===ref?.id;
    this.appearance=ref?{...ref}:undefined;
    this.vertexCount=0;
    if(ref)this.appearanceGroups.get(ref.id)!.traverse(o=>{if(o instanceof THREE.SkinnedMesh)this.vertexCount+=o.geometry.attributes.position.count;});
    else for(const mesh of this.originalMeshes??[])if(mesh instanceof THREE.SkinnedMesh)this.vertexCount+=mesh.geometry.attributes.position.count;
    if(commit){if(this.motionBefore)this.motionBefore.appearance=this.appearance;this.update(true);if(this.motion?.active)this.onCommit(this.snapshot());else this.commit();}
  }
  async prepareMotionImport(file:Pick<File,'name'|'size'|'arrayBuffer'>,signal?:AbortSignal){
    if(!this.activeRig.motionImport)throw new Error('当前骨架尚未适配外部动画；请切换到人体骨架');
    if(file.size>MAX_MOTION_BYTES)throw new Error('请导入 32 MB 以内的 FBX 或 GLB 动画');
    const bytes=await file.arrayBuffer();checkMotionAbort(signal);
    const digest=await crypto.subtle.digest('SHA-256',bytes),id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const source=await parseMotionSource(bytes,file.name,signal);
    try{return await retargetMixamoMotion(source,this.activeRig,this.rest,this.bones,id,file.name,signal);}finally{source.dispose();}
  }
  installImportedMotions(clips:THREE.AnimationClip[]){
    if(this.disposed)return;
    const validated=unpackMotionAsset(packMotionAsset(clips),this.activeRig,this.rest);
    this.motion??=new MotionPreview(this.model,[]);this.motion.append(validated);if(this.ready)this.onInfo(this.info());
  }
  async restoreMotionLibrary(){
    if(!this.activeRig.motionImport)return 0;
    const assets=await motionLibrary.list(this.activeRig);let failed=0;
    for(const asset of assets){if(this.disposed)return failed;try{const clips=unpackMotionAsset(asset,this.activeRig,this.rest);this.motion??=new MotionPreview(this.model,[]);this.motion.append(clips);}catch{failed++;}}
    return failed;
  }
  setMotionInPlace(value:boolean){this.motion?.setInPlace(value);this.update(false);}
  previewMotion(id:string){
    if(!this.motion||!this.ready)return;
    // Validate before interrupting an existing preview or pose.
    if(!this.motion.state().clips.some(c=>c.id===id))throw new Error('此动画不属于当前骨架');
    this.interruptPoseDrag();const before=this.motionBefore??this.snapshot();this.cancelMotion();
    this.apply({...before,joints:this.rest.joints,targets:this.rest.targets,poles:this.rest.poles,pins:{}},false,false,false,false);
    this.motionBefore=before;this.motion.select(id);this.pins={};
    this.helpers.visible=false;this.transform.enabled=false;this.transform.detach();this.update(false);
  }
  playMotion(value:boolean){this.motion?.play(value);if(this.ready)this.onInfo(this.info());}
  seekMotion(frame:number){this.motion?.seekFrame(frame);this.update(false);}
  configureMotion(speed:number,loop:boolean){if(!this.motion||![.25,.5,1,2].includes(speed))return;this.motion.speed=speed;this.motion.loop=loop;this.onInfo(this.info());}
  cancelMotion(){
    if(!this.motion?.active)return;
    const before=this.motionBefore;this.motionBefore=undefined;this.motion.stop();
    this.helpers.visible=true;this.transform.enabled=true;
    if(before)this.apply(before,true,false,false,false,false);
    this.transform.attach(this.gizmo);
  }
  captureMotion(){
    if(!this.motion?.active||!this.motionBefore)return 0;
    const joints:PoseDocument['joints']={};for(const[name,b]of Object.entries(this.bones))joints[name]={position:b.position.toArray(),quaternion:b.quaternion.toArray()};
    const state=this.motion.state(),name=state.clips.find(c=>c.id===state.clip)!.name;
    this.cancelMotion();let adjusted=0;
    for(const[name,j]of Object.entries(joints)){
      const b=this.bones[name];if(name===this.activeRig.root)b.position.fromArray(j.position);
      b.quaternion.fromArray(j.quaternion);const q=b.quaternion.clone();this.limitJoint(name);if(q.angleTo(b.quaternion)>1e-5)adjusted++;
      if(this.activeRig.capabilities.hands)this.markCustomHand(name);
    }
    let lift=0;
    if(this.ground&&this.activeRig.capabilities.floor){
      this.model.updateMatrixWorld(true);const contacts=this.activeRig.supportContacts??this.activeRig.contacts;
      lift=Math.max(0,...contacts.map(end=>(this.rest.targets[end]?.[1]??0)-this.world(end).y));
      if(lift>1e-5){const root=this.bones[this.activeRig.root],position=this.world(this.activeRig.root).add(new V(0,lift,0));root.position.copy(root.parent?root.parent.worldToLocal(position):position);}
    }
    this.pins={};this.warning=[adjusted?`${adjusted} 个关节已调整至编辑限位，原有固定点已解除`:'',lift>1e-5?'已抬高根部以满足当前地面约束':''].filter(Boolean).join('；');
    this.name=`${name} · ${state.time.toFixed(3)}s`;this.syncTargets();this.syncPosePoles();this.syncGizmo();this.update(true);this.commit();return adjusted;
  }

  snapshot():PoseDocument{
    const joints:PoseDocument['joints']={};for(const[name,b]of Object.entries(this.bones))joints[name]={position:b.position.toArray(),quaternion:b.quaternion.toArray()};
    const baseline=this.motion?.active?this.motionBefore:undefined;
    return structuredClone({format:'momo-pose-forge',version:1,rig:this.activeRig.id,rigVersion:this.activeRig.version,...(this.activeRig.ik?{ikVersion:this.activeRig.ik.version}:{}),selection:this.selected,name:baseline?.name??this.name,root:baseline?.root??{position:this.model.position.toArray(),quaternion:this.model.quaternion.toArray()},joints:baseline?.joints??joints,targets:baseline?.targets??this.targets,poles:baseline?.poles??this.poles,pins:baseline?.pins??this.pins,hands:baseline?.hands??this.hands,views:this.views,ground:this.ground,fullBody:this.fullBody,symmetry:{...(this.symmetry??defaultSymmetry())},...(this.appearance?{appearance:this.appearance}:{}),...(this.camera?{camera:this.getCameraSettings()}: {}),...(this.referenceImage?{referenceImage:this.referenceImage}: {}),...(this.props?.length?{props:this.props}: {})}) as PoseDocument;
  }
  apply(doc:PoseDocument,update=true,restoreView=true,restoreReference=restoreView,restoreSymmetry=restoreView,constrain=true){
    if(doc.rig!==this.activeRig.id||(doc.rigVersion??1)!==this.activeRig.version)throw new Error('工程与当前骨架不兼容');
    if(doc.appearance&&(!validAppearance(doc.appearance,this.activeRig)||!this.appearanceGroups?.has(doc.appearance.id)))throw new Error('工程使用的角色外观尚未载入');
    this.cancelMotion();this.setAppearance(doc.appearance,false);
    this.suppress=true;this.fly?.stop();this.warning='';this.name=doc.name;this.ground=doc.ground;
    if(restoreView){this.views=structuredClone(doc.views);this.cameraState=structuredClone(doc.camera??defaultCameraSettings());}
    if(restoreReference)this.referenceImage=doc.referenceImage?structuredClone(doc.referenceImage):undefined;
    if(restoreSymmetry)this.symmetry={...(doc.symmetry??defaultSymmetry())};
    this.fullBody=this.activeRig.capabilities.fullBodyIK&&(doc.fullBody??true);this.props=structuredClone(doc.props??[]);this.syncPropScene();
    this.model.position.fromArray(doc.root.position);this.model.quaternion.fromArray(doc.root.quaternion);
    for(const[name,j]of Object.entries(doc.joints)){const b=this.bones[name];if(b){b.position.fromArray(j.position);b.quaternion.fromArray(j.quaternion);}}
    if(constrain&&this.rest)for(const name of this.activeRig.editableJoints)this.limitJoint(name);
    if(doc.selection&&this.bones[doc.selection])this.selected=doc.selection;
    this.targets=structuredClone(doc.targets);this.poles=structuredClone(doc.poles);this.pins=structuredClone(doc.pins);this.hands={...doc.hands};
    this.model.updateMatrixWorld(true);if(this.activeRig.ik&&doc.ikVersion===undefined)this.syncTargets();this.suppress=false;
    if(update){this.update(true);this.setMode(this.mode);this.syncGizmo();}
    if(restoreView&&this.camera&&this.orbit){if(doc.camera)this.restoreObservation(doc.camera.active,doc.camera.view);else this.setView('free',false);this.orbit.enabled=this.canNavigateCamera();if(update&&this.ready)this.onInfo(this.info());}
  }
  commit(){if(!this.ready||this.motion?.active)return;this.fit(false);this.onInfo(this.info());this.onCommit(this.snapshot());}

  info():EngineInfo{
    const bone=this.bones[this.selected];const e=bone?new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ'):new THREE.Euler();
    const rotation=this.humanoid?[e.x,e.y,e.z].map(THREE.MathUtils.radToDeg) as Vec3:fkAngles(bone?.quaternion??new Q(),this.restRotation(),this.rigJoint());
    return {motion:this.motion?.state(),appearance:this.appearance,ready:this.ready,view:this.view,navigating:this.fly?.active??false,selected:this.selected,position:bone?asVec(this.world(this.selected)):[0,0,0],rotation,pinned:!!this.pins[this.selected as Effector],orientationPinned:!!this.pins[this.selected as Effector]?.orientation,ground:this.ground,fullBody:this.fullBody??true,fixedFeet:Number(!!this.pins.LeftFoot)+Number(!!this.pins.RightFoot),fixedContacts:(this.activeRig.supportContacts??this.activeRig.contacts).filter(end=>this.pins[end]).length,warning:this.warning,symmetry:{...(this.symmetry??defaultSymmetry())},hands:{...this.hands},handDetail:this.handDetail??null,fingers:{Left:this.readHand('Left'),Right:this.readHand('Right')},forearmTwist:{Left:this.readForearm('Left'),Right:this.readForearm('Right')},toes:{Left:this.bones.LeftToeBase?THREE.MathUtils.radToDeg(twistAngle(this.bones.LeftToeBase.quaternion,new V(1,0,0))):0,Right:this.bones.RightToeBase?THREE.MathUtils.radToDeg(twistAngle(this.bones.RightToeBase.quaternion,new V(1,0,0))):0},boneCount:Object.keys(this.bones).length,vertexCount:this.vertexCount,referenceImage:this.referenceImage,props:structuredClone(this.props??[]),...(this.camera?{camera:this.getCameraSettings(),framingWarning:this.framingWarning()}: {})};
  }

  private update(fit:boolean){
    if(!this.ready)return;this.model.updateMatrixWorld(true);
    if(fit)this.fit(false);
    for(const h of this.handles){const name=h.userData.part as string;h.position.copy(this.world(name));h.visible=!this.humanoid?(this.moreControls||name===this.activeRig.root||name===this.selected||this.effectors.includes(name)):(this.handDetail?!!fingerPart(name)&&name.startsWith(this.handDetail):!fingerPart(name)&&(this.moreControls||this.effectors.includes(name)));const m=h.material as THREE.MeshBasicMaterial;m.color.set(name===this.selected?'#e3b969':this.pins[name as Effector]?'#e6d5af':'#a4abaa');h.scale.setScalar(name===this.selected?1.4:1);}
    if(this.display==='skeleton')this.updateSkeletonDisplay();
    this.onInfo(this.info());
  }
  private updateSkeletonDisplay(){
    this.boneDisplay.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();(o.material as THREE.Material).dispose();}});this.boneDisplay.clear();
    if(!this.activeRig.capabilities.openPose){
      for(const [name,bone]of Object.entries(this.bones)){if(bone.parent instanceof THREE.Bone){const geometry=new THREE.BufferGeometry().setFromPoints([this.world(name),this.world(bone.parent.name)]);this.boneDisplay.add(new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#d8bb77'})));}}return;
    }
    const pts=this.cocoWorld();
    COCO_LINKS.forEach(([a,b],i)=>{const g=new THREE.BufferGeometry().setFromPoints([pts[a],pts[b]]);this.boneDisplay.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:COCO_COLORS[i]})));});
    pts.forEach((p,i)=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.012,8,8),new THREE.MeshBasicMaterial({color:COCO_COLORS[i]}));s.position.copy(p);this.boneDisplay.add(s);});
    for(const side of ['Left','Right'] as const){const points=this.handWorld(side);for(const[a,b]of HAND_LINKS){const geometry=new THREE.BufferGeometry().setFromPoints([points[a],points[b]]);this.boneDisplay.add(new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#d8bb77'})));}}
  }

  getCameraSettings():CameraSettings{
    const state=structuredClone(this.cameraState??defaultCameraSettings());
    if(this.camera&&this.orbit){state.active=captureCamera(this.camera,this.orbit.target,state.fov);state.view=this.view;}
    state.framing.center=this.center?.toArray()??state.framing.center;state.framing.verticalSpan=this.span??state.framing.verticalSpan;
    return state;
  }
  private restoreObservation(pose:CameraSettings['active'],view='free'){
    this.fly?.stop();this.camera=restoreCamera(pose,this.host.clientWidth/Math.max(1,this.host.clientHeight));this.view=view;
    this.orbit.object=this.camera;this.orbit.target.fromArray(pose.target);this.transform.camera=this.camera;this.orbit.update();
  }
  private commitCamera(){
    if(!this.ready||this.suppress)return;this.cameraState=this.getCameraSettings();this.onInfo(this.info());this.onCommit(this.snapshot(),false);
  }
  setCameraLock(locked:boolean){this.fly?.stop();this.cameraState.locked=locked;this.orbit.enabled=this.canNavigateCamera()&&!this.transform.dragging;this.commitCamera();}
  setFramingLock(locked:boolean){if(!locked)this.cameraState.framing.locked=false;this.fit(false);this.cameraState.framing={locked,center:asVec(this.center),verticalSpan:this.span};if(!this.cameraState.locked&&this.view!=='free')this.setView(this.view,false);this.commitCamera();}
  reframe(){this.fit(false,true);this.cameraState.framing.center=asVec(this.center);this.cameraState.framing.verticalSpan=this.span;if(!this.cameraState.locked&&this.view!=='free')this.setView(this.view,false);this.commitCamera();}
  setOutputSize(width:number,height:number){
    if(!validOutputSize(width,height))return false;this.cameraState.output={width,height};this.fit(false);
    if(!this.cameraState.locked&&this.view!=='free')this.setView(this.view,false);this.commitCamera();return true;
  }
  renameView(id:string,name:string){const slot=this.views.find(v=>v.id===id);if(!slot||!name.trim()||name.length>30)return;slot.name=name.trim();this.commitCamera();}
  setFov(fov:number){
    if(this.cameraState.locked||!Number.isFinite(fov))return;this.fly?.stop();this.cameraState.fov=THREE.MathUtils.clamp(fov,15,100);
    if(this.camera instanceof THREE.PerspectiveCamera){this.camera.fov=this.cameraState.fov;this.camera.updateProjectionMatrix();}this.commitCamera();
  }
  setProjection(projection:'perspective'|'orthographic'){
    if(this.cameraState.locked)return;this.fly?.stop();
    if(projection==='perspective'&&this.camera instanceof THREE.OrthographicCamera){this.camera=perspectiveForNavigation(this.camera,this.orbit.target,this.cameraState.fov);this.orbit.object=this.camera;this.transform.camera=this.camera;}
    else if(projection==='orthographic'&&this.camera instanceof THREE.PerspectiveCamera){const pose=captureCamera(this.camera,this.orbit.target,this.cameraState.fov);pose.projection='orthographic';pose.verticalSpan=2*this.camera.position.distanceTo(this.orbit.target)*Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2)/this.camera.zoom;pose.zoom=1;this.restoreObservation(pose);}
    this.view='free';this.commitCamera();
  }
  saveCameraBookmark(name:string){
    if(!name.trim()||name.length>30)return false;const existing=this.cameraState.bookmarks.find(b=>b.name===name.trim());
    if(!existing&&this.cameraState.bookmarks.length>=12)return false;
    const camera=captureCamera(this.camera,this.orbit.target,this.cameraState.fov);
    if(existing)existing.camera=camera;else this.cameraState.bookmarks.push({id:crypto.randomUUID(),name:name.trim(),camera});this.commitCamera();return true;
  }
  loadCameraBookmark(id:string){const bookmark=this.cameraState.bookmarks.find(b=>b.id===id);if(!bookmark||this.cameraState.locked)return;this.cameraState.fov=bookmark.camera.fov;this.restoreObservation(bookmark.camera);this.commitCamera();}
  renameCameraBookmark(id:string,name:string){const bookmark=this.cameraState.bookmarks.find(b=>b.id===id);if(!bookmark||!name.trim()||name.length>30||this.cameraState.bookmarks.some(b=>b.id!==id&&b.name===name.trim()))return false;bookmark.name=name.trim();this.commitCamera();return true;}
  removeCameraBookmark(id:string){this.cameraState.bookmarks=this.cameraState.bookmarks.filter(b=>b.id!==id);this.commitCamera();}
  framingWarning(){
    if(!this.cameraState?.framing.locked)return '';const box=this.sceneBounds(),aspect=this.cameraState.output.width/this.cameraState.output.height;
    const clipped=this.views.filter(slot=>{const camera=this.viewCamera(slot,aspect);for(let i=0;i<8;i++){const point=new V(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).project(camera);if(Math.abs(point.x)>1||Math.abs(point.y)>1||Math.abs(point.z)>1)return true;}return false;});
    return clipped.length?`${clipped.map(v=>v.name).join('、')}可能超出画幅` : '';
  }
  fit(updateCamera=true,force=false){
    this.cameraState??=defaultCameraSettings();
    if(this.cameraState.framing.locked&&!force){this.center.fromArray(this.cameraState.framing.center);this.span=this.cameraState.framing.verticalSpan;return;}
    this.model.updateMatrixWorld(true);
    this.model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
    const box=this.sceneBounds();if(box.isEmpty())return;
    box.getCenter(this.center);
    let maxY=0,maxX=0;
    for(const slot of this.views){const cam=this.viewCamera(slot,1);cam.updateMatrixWorld();const inv=cam.matrixWorldInverse;for(let i=0;i<8;i++){const p=new V(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(inv);maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y));}}
    this.span=Math.max(maxY*2,maxX*2/(this.cameraState.output.width/this.cameraState.output.height))*1.18;
    if(updateCamera&&this.camera instanceof THREE.OrthographicCamera){const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight);this.camera.top=this.span/2;this.camera.bottom=-this.span/2;this.camera.left=-this.span*aspect/2;this.camera.right=this.span*aspect/2;this.camera.updateProjectionMatrix();}
  }
  viewCamera(slot:ViewSlot,aspect=.75){
    const half=this.span/2,cam=new THREE.OrthographicCamera(-half*aspect,half*aspect,half,-half,.01,50);
    const a=THREE.MathUtils.degToRad(slot.azimuth),e=THREE.MathUtils.degToRad(slot.elevation);
    cam.position.set(Math.sin(a)*Math.cos(e)*5,Math.sin(e)*5,Math.cos(a)*Math.cos(e)*5).add(this.center);cam.lookAt(this.center);cam.updateMatrixWorld();return cam;
  }
  setView(id:string,persist=true){
    if(this.cameraState?.locked&&persist)return;
    this.fly?.stop();
    const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight),slot=this.views.find(v=>v.id===id);
    this.view=id;
    if(slot)this.camera=this.viewCamera(slot,aspect);
    else {this.camera=new THREE.PerspectiveCamera(this.cameraState?.fov??35,aspect,.01,100);this.camera.position.copy(this.center).add(new V(1.25,.55,2.8));this.camera.lookAt(this.center);}
    this.orbit.object=this.camera;this.orbit.target.copy(this.center);this.transform.camera=this.camera;this.orbit.update();if(persist)this.commitCamera();
  }
  captureView(id:string){
    const direction=this.camera.position.clone().sub(this.orbit.target).normalize();
    const slot=this.views.find(v=>v.id===id);if(!slot)return;
    slot.azimuth=THREE.MathUtils.radToDeg(Math.atan2(direction.x,direction.z));slot.elevation=THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.asin(direction.y)),-89,89);this.fit(false);this.commitCamera();
  }
  resetViews(){this.views=structuredClone(DEFAULT_VIEWS);this.fit(false);this.commitCamera();}
  focus(){if(this.handDetail)this.setHandDetail(null);if(this.cameraState?.locked)return;this.fit(false);this.setView(this.view);}

  cocoWorld(){
    if(!this.activeRig.capabilities.openPose)throw new Error('此骨架没有人体 OpenPose 映射');
    const head=this.bones.Head;
    const anchor=(name:string,fallback:Vec3)=>head.localToWorld(new V().fromArray(this.profile.headAnchors?.[name]??fallback));
    return [anchor('nose',[0,.065,.085]),this.world('Neck'),this.world('RightArm'),this.world('RightForeArm'),this.world('RightHand'),this.world('LeftArm'),this.world('LeftForeArm'),this.world('LeftHand'),this.world('RightUpLeg'),this.world('RightLeg'),this.world('RightFoot'),this.world('LeftUpLeg'),this.world('LeftLeg'),this.world('LeftFoot'),anchor('rightEye',[-.027,.095,.07]),anchor('leftEye',[.027,.095,.07]),anchor('rightEar',[-.065,.07,.005]),anchor('leftEar',[.065,.07,.005])];
  }
  keypoints(camera:THREE.Camera,width:number,height:number){
    camera.updateMatrixWorld();return this.cocoWorld().flatMap(p=>{const point=projectPoint(p,camera,width,height);return point.valid?[Number(point.x.toFixed(3)),Number(point.y.toFixed(3)),1]:[0,0,0];});
  }

  handWorld(side:Side){return handBones(side).map(name=>this.world(name));}
  worldPose(){this.model.updateWorldMatrix(true,true);return {body:this.cocoWorld(),Left:this.handWorld('Left'),Right:this.handWorld('Right')};}
  skeletonData(){return this.activeRig.capabilities.openPose?worldSkeleton(this.worldPose()):this.genericSkeletonData();}
  genericSkeletonData(camera?:THREE.Camera,width?:number,height?:number){
    this.model.updateMatrixWorld(true);camera?.updateMatrixWorld();
    return {format:'momo-skeleton',version:1,rig:this.activeRig.id,rigVersion:this.activeRig.version,units:'metres',...(camera&&width&&height?{imageSize:{width,height}}:{}),joints:Object.entries(this.bones).map(([name,bone])=>{
      const position=this.world(name),projection=camera&&width&&height?projectPoint(position,camera,width,height):undefined;
      return {name,parent:bone.parent instanceof THREE.Bone?bone.parent.name:null,position:asVec(position),...(projection?{image:[Number.isFinite(projection.x)?projection.x:0,Number.isFinite(projection.y)?projection.y:0],valid:projection.valid}: {})};
    })};
  }
  depthRange(cameras:THREE.Camera[]){this.model.updateWorldMatrix(true,true);return depthRangeFor(this.sceneBounds(),cameras);}
  openPose(camera:THREE.Camera,width:number,height:number,hideOccludedHands=true){
    if(!this.activeRig.capabilities.openPose)throw new Error('此骨架没有人体 OpenPose 映射，请导出通用关节数据');
    camera.updateMatrixWorld();const pose=this.worldPose();if(!hideOccludedHands)return projectPose(pose,camera,width,height);
    const range=this.depthRange([camera]),pixels=this.renderPixels(camera,width,height,'visibility',false,range),visible=depthVisibility(pixels,camera,width,height,range);
    return projectPose(pose,camera,width,height,visible);
  }

  renderImage(slot:ViewSlot,width:number,height:number,kind:RenderKind,transparent=false,viewCamera?:THREE.Camera,options?:{pose?:OpenPoseFrame;depthRange?:DepthRange;hideOccludedHands?:boolean}):HTMLCanvasElement{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
    const camera=viewCamera??this.viewCamera(slot,width/height);
    if(kind==='skeleton'||kind==='body-skeleton'){
      if(!this.activeRig.capabilities.openPose){
        const data=this.genericSkeletonData(camera,width,height),points=new Map(data.joints.map(j=>[j.name,j]));ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#d8bb77';ctx.fillStyle='#d8bb77';ctx.lineWidth=Math.max(2,width/160);
        for(const joint of data.joints){const parent=joint.parent?points.get(joint.parent):undefined;if(parent?.valid&&joint.valid){ctx.beginPath();ctx.moveTo(...parent.image as [number,number]);ctx.lineTo(...joint.image as [number,number]);ctx.stroke();}if(joint.valid){ctx.beginPath();ctx.arc(...joint.image as [number,number],Math.max(3,width/180),0,Math.PI*2);ctx.fill();}}return canvas;
      }
      const pose=options?.pose??this.openPose(camera,width,height,kind==='skeleton'&&(options?.hideOccludedHands??true));paintSkeleton(ctx,pose,kind==='skeleton');return canvas;
    }
    const pixels=this.renderPixels(camera,width,height,kind,transparent,options?.depthRange??(kind==='depth'?this.depthRange([camera]):{near:.01,far:10}));
    const image=ctx.createImageData(width,height),row=width*4;for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-y-1)*row,(height-y)*row),y*row);ctx.putImageData(image,0,0);return canvas;
  }

  private renderPixels(camera:THREE.Camera,width:number,height:number,kind:'surface'|DataKind,transparent=false,range:DepthRange={near:.01,far:10}){
    const prev={background:this.scene.background,override:this.scene.overrideMaterial,model:this.model.visible,helpers:this.helpers.visible,gizmo:this.transform.getHelper().visible,grid:this.grid.visible,ground:this.groundMesh.visible,bones:this.boneDisplay.visible,target:this.renderer.getRenderTarget(),alpha:this.renderer.getClearAlpha(),toneMapping:this.renderer.toneMapping};
    const data=kind!=='surface',material=data?dataMaterial(kind,camera as THREE.PerspectiveCamera|THREE.OrthographicCamera,range):null;
    const target=new THREE.WebGLRenderTarget(width,height,{samples:data?0:4});target.texture.colorSpace=data?THREE.NoColorSpace:THREE.SRGBColorSpace;
    const debug=this.renderer.debug,previousShaderError=debug?.onShaderError;
    try{
      if(debug)debug.onShaderError=(gl,program,vertex,fragment)=>{previousShaderError?.(gl,program,vertex,fragment);throw new Error('控制图着色器编译失败，请检查浏览器 WebGL 支持');};
      this.scene.background=data?new THREE.Color(0):transparent?null:new THREE.Color('#e7e8e5');this.scene.overrideMaterial=material;if(data)this.renderer.toneMapping=THREE.NoToneMapping;
      this.helpers.visible=false;this.transform.getHelper().visible=false;this.grid.visible=false;this.boneDisplay.visible=false;this.model.visible=true;this.groundMesh.visible=false;
      this.renderer.setClearAlpha(data?1:transparent?0:1);this.renderer.setRenderTarget(target);this.renderer.render(this.scene,camera);
      const buffer=new Uint8Array(width*height*4);this.renderer.readRenderTargetPixels(target,0,0,width,height,buffer);
      return buffer;
    }finally{
      this.scene.background=prev.background;this.scene.overrideMaterial=prev.override;this.model.visible=prev.model;this.helpers.visible=prev.helpers;this.transform.getHelper().visible=prev.gizmo;this.grid.visible=prev.grid;this.groundMesh.visible=prev.ground;this.boneDisplay.visible=prev.bones;this.renderer.setRenderTarget(prev.target);this.renderer.setClearAlpha(prev.alpha);this.renderer.toneMapping=prev.toneMapping;if(debug)debug.onShaderError=previousShaderError;target.dispose();material?.dispose();
    }
  }
  exportCamera(aspect:number){return cloneExportCamera(this.camera,aspect);}
  renderCurrent(width:number,height:number,kind:'surface'|'skeleton',transparent=false){return this.renderImage({id:'current',name:'当前视角',azimuth:0,elevation:0},width,height,kind,transparent,this.exportCamera(width/height));}
  getThumbnails(){const {width,height}=this.cameraState.output,w=180,h=Math.round(w*height/width);return this.views.map(v=>({id:v.id,name:v.name,url:this.renderImage(v,w,h,'surface').toDataURL('image/png')}));}
  resize(){if(this.dragBefore)this.interruptPoseDrag();const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);if(this.camera instanceof THREE.PerspectiveCamera)this.camera.aspect=w/h;else{const half=(this.camera.top-this.camera.bottom)/2;this.camera.left=-half*w/h;this.camera.right=half*w/h;}this.camera.updateProjectionMatrix();}
  private animate=(now=performance.now())=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);const seconds=this.lastFrame?(now-this.lastFrame)/1000:0;this.lastFrame=now;this.fly.update(seconds);if(this.motion?.tick(seconds)&&now-this.motionNotify>100){this.motionNotify=now;this.update(false);}if(!this.fly.active)this.orbit.update();this.renderer.render(this.scene,this.camera);};
  dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.frame);this.motion?.dispose();this.resizeObserver.disconnect();this.fly.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.renderer.domElement.removeEventListener('pointercancel',this.interruptPoseDrag);this.renderer.domElement.removeEventListener('lostpointercapture',this.poseCaptureLost);window.removeEventListener('blur',this.interruptPoseDrag);this.renderer.domElement.ownerDocument.removeEventListener('visibilitychange',this.poseVisibility);this.orbit.dispose();this.transform.dispose();disposeObject(this.scene);this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
