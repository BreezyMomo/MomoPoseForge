import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { solveTwoBone, solveLimbRotations, projectPoint } from './math';
import { DEFAULT_VIEWS, END_EFFECTORS, PART_NAMES, FINGER_PART_NAMES, DIGITS, type Digit, type Side, type Effector, type EngineInfo, type PoseDocument, type Preset, type Vec3, type ViewSlot } from './types';
import { CURRENT_MODEL } from './rig';
import {JOINT_LIMITS,constrainJointRotation,decomposeJointRotation,solveSpineTarget} from './poseControls';
import {FlyCameraControls,perspectiveForNavigation,cloneExportCamera} from './FlyCameraControls';
import {emptyHandValues,fingerPart,fingerAxes,fingerAngles,fingerRotation,forearmAngles,forearmRotation,twistAngle} from './articulation';
import {LIMB_LIMITS,constrainLimb,limbAxes} from './limbLimits';
import {LOCAL_AXES,solveConstrainedIK,captureJoints,restoreJoints,interpolateJoints,goalError,type PositionGoal,type SolverJoint} from './fullBodyIK';
import {COCO_LINKS,COCO_COLORS,HAND_LINKS,handBones,projectPose,paintSkeleton,worldSkeleton,depthVisibility,type OpenPoseFrame} from './poseOutput';
import {depthRangeFor,dataMaterial,type DepthRange,type RenderKind,type DataKind} from './renderPasses';

const V = THREE.Vector3, Q = THREE.Quaternion;
const CHAINS: Record<string, [string, string, string]> = {
  LeftHand: ['LeftArm', 'LeftForeArm', 'LeftHand'], RightHand: ['RightArm', 'RightForeArm', 'RightHand'],
  LeftFoot: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], RightFoot: ['RightUpLeg', 'RightLeg', 'RightFoot'],
};
const asVec = (v: THREE.Vector3): Vec3 => v.toArray() as Vec3;

export class PoseEngine {
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
  vertexCount = 0;
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
  onCommit: (document: PoseDocument) => void;

  constructor(public host: HTMLDivElement, onInfo: (info: EngineInfo) => void, onCommit: (document: PoseDocument) => void) {
    this.onInfo = onInfo; this.onCommit = onCommit;
    this.scene.background = new THREE.Color('#202121');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '可交互的三维人体姿势视口');
    this.renderer.domElement.tabIndex=0;
    this.host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
    this.camera.position.set(2.6,1.65,4.5);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.copy(this.center);
    this.orbit.enableDamping = false;
    this.orbit.minDistance = .5; this.orbit.maxDistance = 12;
    this.orbit.mouseButtons = { LEFT: undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: undefined };
    this.orbit.addEventListener('start', () => { this.view = 'free'; if(this.ready)this.onInfo(this.info()); });
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
      this.orbit.enabled = !event.value;
      if (event.value) { this.dragBefore = this.snapshot(); this.cancelPending = false; }
      else if (this.dragBefore) {
        if (this.cancelPending) this.apply(this.dragBefore);
        this.dragBefore = null; this.syncTargets(); this.syncGizmo(); this.update(false); if (!this.cancelPending) this.commit();
      }
    });
    this.transform.addEventListener('objectChange', () => { if (!this.suppress && this.ready) this.manipulate(); });
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.fly=new FlyCameraControls(this.renderer.domElement,()=>this.camera,()=>this.syncNavigationTarget(),active=>{
      if(active){
        if(this.transform.dragging)return false;
        if(this.camera instanceof THREE.OrthographicCamera){this.camera=perspectiveForNavigation(this.camera,this.orbit.target);this.orbit.object=this.camera;this.transform.camera=this.camera;}
        this.navigationDistance=this.camera.position.distanceTo(this.orbit.target);
        this.orbit.enabled=false;this.transform.enabled=false;this.view='free';
      }else{this.syncNavigationTarget();this.transform.enabled=true;this.orbit.enabled=!this.transform.dragging;}
      if(this.ready)this.onInfo(this.info());
    });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.host);
    this.resize(); this.animate();
  }

  private syncNavigationTarget(){this.orbit.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new V()),this.navigationDistance);}

  async load() {
    const [gltf, profile] = await Promise.all([
      new GLTFLoader().loadAsync(CURRENT_MODEL.modelUrl),
      fetch(CURRENT_MODEL.profileUrl).then(r => { if (!r.ok) throw new Error('人体定义载入失败'); return r.json(); }),
    ]);
    if (this.disposed) return;
    this.profile = profile;
    if(profile.id!==CURRENT_MODEL.rig)throw new Error('模型与骨骼定义版本不匹配');
    this.model.add(gltf.scene);
    this.model.traverse(obj => {
      if (obj instanceof THREE.Bone) this.bones[obj.name] = obj;
      if (obj instanceof THREE.SkinnedMesh) {
        obj.castShadow = true; obj.frustumCulled = false;
        // Preserve X Bot's original red shell and dark joint materials.
        this.vertexCount += obj.geometry.attributes.position.count;
      }
    });
    for (const name of [...Object.values(CHAINS).flat(),...handBones('Left'),...handBones('Right')]) if (!this.bones[name]) throw new Error(`人体缺少骨骼 ${name}`);
    this.model.updateMatrixWorld(true);
    for (const end of END_EFFECTORS) {
      this.targets[end] = asVec(this.world(end));
      const b = this.world(CHAINS[end][1]);
      this.poles[end] = asVec(b.add(new V(0,0,end.endsWith('Hand')?-.5:.5)));
    }
    this.rest = this.snapshot();
    for (const name of Object.keys(PART_NAMES)) {
      if(!this.bones[name])continue;
      const radius=fingerPart(name) ? .0065 : END_EFFECTORS.includes(name as Effector) ? .022 : .016;
      const handle = new THREE.Mesh(new THREE.SphereGeometry(radius,12,8), new THREE.MeshBasicMaterial({ color:'#b1b6b6', depthTest:false, transparent:true, opacity:.9 }));
      handle.userData.part = name; handle.renderOrder = 100; this.helpers.add(handle); this.handles.push(handle);
    }
    this.ready = true;
    this.update(true); this.select('LeftHand');
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

  private keepPinnedPose(baseline:PoseDocument){
    const goals=this.fixedGoals();if(!goals.length||this.contactError(goals)<=.0015)return;
    const joints=this.bodyJoints(),desired=captureJoints(joints),pins=structuredClone(this.pins);this.apply(baseline,false);this.pins=pins;const before=captureJoints(joints);restoreJoints(joints,desired);
    if(this.keepContacts(joints,before,goals,n=>this.limitJoint(n,false)))this.warning='已到固定点允许的关节范围边界';
    for(const end of END_EFFECTORS)if(this.pins[end]?.orientation)this.setWorldQuaternion(this.bones[end],new Q().fromArray(this.pins[end]!.quaternion));
  }

  private solvePins() {
    for (const end of END_EFFECTORS) {
      const pin = this.pins[end]; if (!pin) continue;
      this.solve(end,new V().fromArray(pin.position));
      if (pin.orientation) this.setWorldQuaternion(this.bones[end],new Q().fromArray(pin.quaternion));
    }
  }

  private manipulate() {
    this.warning = '';
    // TransformControls already computes from pointer-down. Match that baseline
    // for the skeleton too, rather than accumulating a different solve per event.
    if(this.dragBefore)this.apply(this.dragBefore,false);
    const bone = this.bones[this.selected]; if (!bone) return;
    const baseline=this.snapshot();
    if(this.mode==='translate'&&this.fullBody&&(CHAINS[this.selected]||this.selected==='Chest'||this.selected==='Hips')){
      const target=this.gizmo.position.clone();if(this.ground&&this.selected.endsWith('Foot'))target.y=Math.max(this.rest.targets[this.selected][1],target.y);
      this.solveBodyTarget(this.selected,target,baseline);this.syncTargets();this.update(false);return;
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
  }

  private pointerDown = (event: PointerEvent) => {
    if (!this.ready || event.button!==0 || this.transform.axis) return;
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.intersectObjects(this.handles.filter(h=>h.visible))[0];
    if(hit) this.select(hit.object.userData.part);
  };

  select(name: string) {
    if(!this.bones[name])return;
    this.selected=name;this.warning='';
    const digit=fingerPart(name);if(digit)this.handDetail=digit[1] as Side;else if(this.handDetail){this.handDetail=null;if(this.ready)this.focus();}
    this.setMode(this.canTranslate(name)?'translate':'rotate');
    this.syncGizmo(); this.transform.attach(this.gizmo); this.update(false);
  }
  canTranslate(name=this.selected){return !!CHAINS[name]||name==='Hips'||name==='Chest'||Object.values(CHAINS).some(c=>c[1]===name);}
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
  setHandDetail(side:Side|null){const previous=this.handDetail;this.handDetail=side;if(side)this.select(`${side}Index1`);else if(fingerPart(this.selected)&&previous)this.select(`${previous}Hand`);this.update(false);}
  focusHand(side:Side){
    if(!this.bones[`${side}Hand`])return;
    this.fly?.stop();const center=this.world(`${side}Hand`);for(const digit of DIGITS)center.add(this.world(`${side}${digit}2`));center.divideScalar(6);
    const direction=this.camera.position.clone().sub(this.orbit.target).normalize();this.view='free';
    this.camera=new THREE.PerspectiveCamera(35,this.host.clientWidth/Math.max(1,this.host.clientHeight),.01,100);
    this.camera.position.copy(center).addScaledVector(direction,.52);this.camera.lookAt(center);this.orbit.object=this.camera;this.orbit.target.copy(center);this.transform.camera=this.camera;this.orbit.update();this.onInfo(this.info());
  }
  setDisplay(mode:'surface'|'skeleton'){this.display=mode;this.model.visible=mode==='surface';this.boneDisplay.visible=mode==='skeleton';this.update(false);}
  setGrid(value:boolean){this.grid.visible=value;}
  setGround(value:boolean){this.ground=value;this.commit();}
  setFullBody(value:boolean){this.fullBody=value;this.update(false);this.commit();}
  setFeetPin(enabled:boolean){
    if(!this.ready)return;
    for(const end of ['LeftFoot','RightFoot'] as const){if(enabled)this.pins[end]={position:asVec(this.world(end)),quaternion:this.bones[end].getWorldQuaternion(new Q()).toArray(),orientation:true};else delete this.pins[end];}
    this.update(false);this.commit();
  }
  setPin(enabled:boolean,orientation=false){
    if(!END_EFFECTORS.includes(this.selected as Effector))return;
    if(enabled)this.pins[this.selected as Effector]={position:asVec(this.world(this.selected)),quaternion:this.bones[this.selected].getWorldQuaternion(new Q()).toArray(),orientation};
    else delete this.pins[this.selected as Effector];
    this.update(false);this.commit();
  }
  cancelDrag(){if(this.dragBefore){this.cancelPending=true;this.apply(this.dragBefore);this.transform.reset();}}

  setSelectedPosition(axis:number,value:number){
    if(!this.canTranslate()||!Number.isFinite(value)||Math.abs(value)>10)return;
    this.gizmo.position.copy(this.world(this.selected));this.gizmo.position.setComponent(axis,value);
    this.mode='translate';this.transform.setMode('translate');this.manipulate();this.update(true);this.syncGizmo();this.commit();
  }
  setSelectedRotation(axis:number,value:number){
    if(!Number.isFinite(value)||!this.bones[this.selected])return;
    const baseline=this.snapshot();
    const bone=this.bones[this.selected],e=new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');
    const a=e.toArray() as [number,number,number,THREE.EulerOrder];a[axis]=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(value,-180,180));
    this.warning='';bone.quaternion.setFromEuler(new THREE.Euler(a[0],a[1],a[2],'XYZ'));bone.updateWorldMatrix(false,true);this.limitJoint(this.selected);
    this.markCustomHand(this.selected);
    if(this.pins[this.selected as Effector])this.pins[this.selected as Effector]!.quaternion=bone.getWorldQuaternion(new Q()).toArray();
    this.solvePins();this.keepPinnedPose(baseline);this.syncTargets();this.update(false);this.syncGizmo();this.commit();
  }
  private applyHandShape(side:'Left'|'Right',shape:string){
    this.hands[side]=shape;
    for(const digit of DIGITS)for(let i=1;i<=3;i++){
      const bone=this.bones[`${side}${digit}${i}`];if(!bone)continue;
      bone.quaternion.fromArray(this.rest.joints[bone.name].quaternion);
      const curl=shape==='握拳'?(digit==='Thumb'?.45:1.0):shape==='指向'?(digit==='Index'?0:.95):0;
      bone.quaternion.copy(fingerRotation(digit,i,curl,0,fingerAxes(this.rest.joints,side,digit,i,this.profile.handCurlNormalSign)));
    }
  }
  private markCustomHand(name:string){const digit=fingerPart(name);if(digit)this.hands[digit[1] as Side]='自定义';}
  setFinger(side:Side,digit:Digit,joint:number,value:number,kind:'curl'|'spread',commit=true){
    if(!this.rest||!Number.isFinite(value)||!DIGITS.includes(digit)||![1,2,3].includes(joint))return;
    const name=`${side}${digit}${joint}`,bone=this.bones[name],axes=fingerAxes(this.rest.joints,side,digit,joint,this.profile.handCurlNormalSign),angles=fingerAngles(bone.quaternion,axes);
    bone.quaternion.copy(fingerRotation(digit,joint,kind==='curl'?THREE.MathUtils.degToRad(value):angles.curl,kind==='spread'?THREE.MathUtils.degToRad(value):angles.spread,axes));bone.updateWorldMatrix(false,true);
    this.markCustomHand(name);this.update(false);this.syncGizmo();if(commit)this.commit();
  }
  setForearmTwist(side:Side,value:number,commit=true){
    if(!this.rest||!Number.isFinite(value))return;
    const name=`${side}ForeArm`,bone=this.bones[name],axis=this.hingeAxis(name),lower=new V().fromArray(this.rest.joints[`${side}Hand`].position);
    const angles=forearmAngles(bone.quaternion,axis,lower);bone.quaternion.copy(forearmRotation(angles.bend,THREE.MathUtils.degToRad(value),axis,lower));bone.updateWorldMatrix(false,true);
    this.solvePins();this.syncTargets();this.update(false);this.syncGizmo();if(commit)this.commit();
  }
  setToeBend(side:Side,value:number,commit=true){
    if(!this.bones[`${side}ToeBase`]||!Number.isFinite(value))return;const name=`${side}ToeBase`;
    this.bones[name].quaternion.setFromAxisAngle(new V(1,0,0),THREE.MathUtils.degToRad(value));this.limitJoint(name);this.update(false);this.syncGizmo();if(commit)this.commit();
  }
  private readHand(side:Side){
    const values=emptyHandValues();if(!this.rest)return values;
    for(const digit of DIGITS)for(let i=1;i<=3;i++){
      const angles=fingerAngles(this.bones[`${side}${digit}${i}`].quaternion,fingerAxes(this.rest.joints,side,digit,i,this.profile.handCurlNormalSign));
      values[digit].curl[i-1]=THREE.MathUtils.radToDeg(angles.curl);if(i===1)values[digit].spread=THREE.MathUtils.radToDeg(angles.spread);
    }return values;
  }
  private readForearm(side:Side){if(!this.rest)return 0;const name=`${side}ForeArm`;return THREE.MathUtils.radToDeg(forearmAngles(this.bones[name].quaternion,this.hingeAxis(name),new V().fromArray(this.rest.joints[`${side}Hand`].position)).twist);}
  setHand(side:'Left'|'Right',shape:string){
    if(!this.rest)return;
    this.applyHandShape(side,shape);
    this.update(true);this.commit();
  }
  resetSelected(){const rest=this.rest.joints[this.selected];if(!rest)return;const baseline=this.snapshot();this.bones[this.selected].quaternion.fromArray(rest.quaternion);this.bones[this.selected].position.fromArray(rest.position);this.markCustomHand(this.selected);delete this.pins[this.selected as Effector];this.bones[this.selected].updateWorldMatrix(false,true);this.solvePins();this.keepPinnedPose(baseline);this.syncTargets();this.update(true);this.syncGizmo();this.commit();}

  applyPreset(preset:Preset,commit=true){
    const views=this.views,name=this.name,fullBody=this.fullBody;
    this.apply(this.rest,false);this.views=views;this.fullBody=fullBody;this.name=commit?preset.name:name;
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
    this.update(true);this.syncGizmo();if(commit)this.commit();
  }

  mirror(side?:'Left'|'Right'){
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

  private syncTargets(){this.model.updateMatrixWorld(true);for(const end of END_EFFECTORS)this.targets[end]=asVec(this.world(end));}
  snapshot():PoseDocument{
    const joints:PoseDocument['joints']={};for(const[name,b]of Object.entries(this.bones))joints[name]={position:b.position.toArray(),quaternion:b.quaternion.toArray()};
    return structuredClone({format:'momo-pose-forge',version:1,rig:CURRENT_MODEL.rig,name:this.name,root:{position:this.model.position.toArray(),quaternion:this.model.quaternion.toArray()},joints,targets:this.targets,poles:this.poles,pins:this.pins,hands:this.hands,views:this.views,ground:this.ground,fullBody:this.fullBody}) as PoseDocument;
  }
  apply(doc:PoseDocument,update=true){
    this.suppress=true;this.warning='';this.name=doc.name;this.views=structuredClone(doc.views);this.ground=doc.ground;
    this.fullBody=doc.fullBody??true;
    this.model.position.fromArray(doc.root.position);this.model.quaternion.fromArray(doc.root.quaternion);
    for(const[name,j]of Object.entries(doc.joints)){const b=this.bones[name];if(b){b.position.fromArray(j.position);b.quaternion.fromArray(j.quaternion);}}
    if(this.rest)for(const name of [...Object.keys(JOINT_LIMITS),...Object.keys(LIMB_LIMITS),...Object.keys(FINGER_PART_NAMES),'LeftForeArm','RightForeArm','LeftLeg','RightLeg','LeftToeBase','RightToeBase'])this.limitJoint(name);
    this.targets=structuredClone(doc.targets);this.poles=structuredClone(doc.poles);this.pins=structuredClone(doc.pins);this.hands={...doc.hands};
    this.model.updateMatrixWorld(true);this.suppress=false;if(update){this.update(true);this.syncGizmo();}
  }
  commit(){if(!this.ready)return;this.fit(false);this.onInfo(this.info());this.onCommit(this.snapshot());}

  info():EngineInfo{
    const bone=this.bones[this.selected];const e=bone?new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ'):new THREE.Euler();
    return {ready:this.ready,view:this.view,navigating:this.fly?.active??false,selected:this.selected,position:bone?asVec(this.world(this.selected)):[0,0,0],rotation:[e.x,e.y,e.z].map(THREE.MathUtils.radToDeg) as Vec3,pinned:!!this.pins[this.selected as Effector],orientationPinned:!!this.pins[this.selected as Effector]?.orientation,ground:this.ground,fullBody:this.fullBody??true,fixedFeet:Number(!!this.pins.LeftFoot)+Number(!!this.pins.RightFoot),warning:this.warning,hands:{...this.hands},handDetail:this.handDetail??null,fingers:{Left:this.readHand('Left'),Right:this.readHand('Right')},forearmTwist:{Left:this.readForearm('Left'),Right:this.readForearm('Right')},toes:{Left:this.bones.LeftToeBase?THREE.MathUtils.radToDeg(twistAngle(this.bones.LeftToeBase.quaternion,new V(1,0,0))):0,Right:this.bones.RightToeBase?THREE.MathUtils.radToDeg(twistAngle(this.bones.RightToeBase.quaternion,new V(1,0,0))):0},boneCount:Object.keys(this.bones).length,vertexCount:this.vertexCount};
  }

  private update(fit:boolean){
    if(!this.ready)return;this.model.updateMatrixWorld(true);
    if(fit)this.fit(false);
    for(const h of this.handles){const name=h.userData.part as string;h.position.copy(this.world(name));h.visible=this.handDetail?!!fingerPart(name)&&name.startsWith(this.handDetail):!fingerPart(name)&&(this.moreControls||END_EFFECTORS.includes(name as Effector));const m=h.material as THREE.MeshBasicMaterial;m.color.set(name===this.selected?'#e3b969':this.pins[name as Effector]?'#e6d5af':'#a4abaa');h.scale.setScalar(name===this.selected?1.4:1);}
    if(this.display==='skeleton')this.updateSkeletonDisplay();
    this.onInfo(this.info());
  }
  private updateSkeletonDisplay(){
    this.boneDisplay.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();(o.material as THREE.Material).dispose();}});this.boneDisplay.clear();
    const pts=this.cocoWorld();
    COCO_LINKS.forEach(([a,b],i)=>{const g=new THREE.BufferGeometry().setFromPoints([pts[a],pts[b]]);this.boneDisplay.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:COCO_COLORS[i]})));});
    pts.forEach((p,i)=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.012,8,8),new THREE.MeshBasicMaterial({color:COCO_COLORS[i]}));s.position.copy(p);this.boneDisplay.add(s);});
    for(const side of ['Left','Right'] as const){const points=this.handWorld(side);for(const[a,b]of HAND_LINKS){const geometry=new THREE.BufferGeometry().setFromPoints([points[a],points[b]]);this.boneDisplay.add(new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#d8bb77'})));}}
  }

  fit(updateCamera=true){
    this.model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
    const box=new THREE.Box3().setFromObject(this.model,true);if(box.isEmpty())return;
    box.getCenter(this.center);
    let maxY=0,maxX=0;
    for(const slot of this.views){const cam=this.viewCamera(slot,1);cam.updateMatrixWorld();const inv=cam.matrixWorldInverse;for(let i=0;i<8;i++){const p=new V(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(inv);maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y));}}
    this.span=Math.max(maxY*2,maxX*2/.75)*1.18;
    if(updateCamera&&this.camera instanceof THREE.OrthographicCamera){const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight);this.camera.top=this.span/2;this.camera.bottom=-this.span/2;this.camera.left=-this.span*aspect/2;this.camera.right=this.span*aspect/2;this.camera.updateProjectionMatrix();}
  }
  viewCamera(slot:ViewSlot,aspect=.75){
    const half=this.span/2,cam=new THREE.OrthographicCamera(-half*aspect,half*aspect,half,-half,.01,50);
    const a=THREE.MathUtils.degToRad(slot.azimuth),e=THREE.MathUtils.degToRad(slot.elevation);
    cam.position.set(Math.sin(a)*Math.cos(e)*5,Math.sin(e)*5,Math.cos(a)*Math.cos(e)*5).add(this.center);cam.lookAt(this.center);cam.updateMatrixWorld();return cam;
  }
  setView(id:string){
    this.fly?.stop();
    const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight),slot=this.views.find(v=>v.id===id);
    this.view=id;
    if(slot)this.camera=this.viewCamera(slot,aspect);
    else {this.camera=new THREE.PerspectiveCamera(35,aspect,.01,100);this.camera.position.copy(this.center).add(new V(1.25,.55,2.8));this.camera.lookAt(this.center);}
    this.orbit.object=this.camera;this.orbit.target.copy(this.center);this.transform.camera=this.camera;this.orbit.update();
  }
  captureView(id:string){
    const direction=this.camera.position.clone().sub(this.orbit.target).normalize();
    const slot=this.views.find(v=>v.id===id);if(!slot)return;
    slot.azimuth=THREE.MathUtils.radToDeg(Math.atan2(direction.x,direction.z));slot.elevation=THREE.MathUtils.radToDeg(Math.asin(direction.y));this.fit();this.commit();
  }
  resetViews(){this.views=structuredClone(DEFAULT_VIEWS);this.fit();this.commit();}
  focus(){this.fit();this.setView(this.view);}

  cocoWorld(){
    const head=this.bones.Head;
    const anchor=(name:string,fallback:Vec3)=>head.localToWorld(new V().fromArray(this.profile.headAnchors?.[name]??fallback));
    return [anchor('nose',[0,.065,.085]),this.world('Neck'),this.world('RightArm'),this.world('RightForeArm'),this.world('RightHand'),this.world('LeftArm'),this.world('LeftForeArm'),this.world('LeftHand'),this.world('RightUpLeg'),this.world('RightLeg'),this.world('RightFoot'),this.world('LeftUpLeg'),this.world('LeftLeg'),this.world('LeftFoot'),anchor('rightEye',[-.027,.095,.07]),anchor('leftEye',[.027,.095,.07]),anchor('rightEar',[-.065,.07,.005]),anchor('leftEar',[.065,.07,.005])];
  }
  keypoints(camera:THREE.Camera,width:number,height:number){
    camera.updateMatrixWorld();return this.cocoWorld().flatMap(p=>{const point=projectPoint(p,camera,width,height);return point.valid?[Number(point.x.toFixed(3)),Number(point.y.toFixed(3)),1]:[0,0,0];});
  }

  handWorld(side:Side){return handBones(side).map(name=>this.world(name));}
  worldPose(){this.model.updateWorldMatrix(true,true);return {body:this.cocoWorld(),Left:this.handWorld('Left'),Right:this.handWorld('Right')};}
  skeletonData(){return worldSkeleton(this.worldPose());}
  depthRange(cameras:THREE.Camera[]){this.model.updateWorldMatrix(true,true);return depthRangeFor(new THREE.Box3().setFromObject(this.model,true),cameras);}
  openPose(camera:THREE.Camera,width:number,height:number,hideOccludedHands=true){
    camera.updateMatrixWorld();const pose=this.worldPose();if(!hideOccludedHands)return projectPose(pose,camera,width,height);
    const range=this.depthRange([camera]),pixels=this.renderPixels(camera,width,height,'visibility',false,range),visible=depthVisibility(pixels,camera,width,height,range);
    return projectPose(pose,camera,width,height,visible);
  }

  renderImage(slot:ViewSlot,width:number,height:number,kind:RenderKind,transparent=false,viewCamera?:THREE.Camera,options?:{pose?:OpenPoseFrame;depthRange?:DepthRange;hideOccludedHands?:boolean}):HTMLCanvasElement{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
    const camera=viewCamera??this.viewCamera(slot,width/height);
    if(kind==='skeleton'||kind==='body-skeleton'){
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
  getThumbnails(){return this.views.map(v=>({id:v.id,name:v.name,url:this.renderImage(v,180,200,'surface').toDataURL('image/png')}));}
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);if(this.camera instanceof THREE.PerspectiveCamera)this.camera.aspect=w/h;else{this.camera.left=-this.span*w/h/2;this.camera.right=this.span*w/h/2;this.camera.top=this.span/2;this.camera.bottom=-this.span/2;}this.camera.updateProjectionMatrix();}
  private animate=(now=performance.now())=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);const seconds=this.lastFrame?(now-this.lastFrame)/1000:0;this.lastFrame=now;this.fly.update(seconds);if(!this.fly.active)this.orbit.update();this.renderer.render(this.scene,this.camera);};
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.fly.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.orbit.dispose();this.transform.dispose();this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});this.renderer.dispose();this.renderer.domElement.remove();}
}
