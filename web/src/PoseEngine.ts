import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { solveTwoBone, solveLimbRotations, projectPoint } from './math';
import { DEFAULT_VIEWS, END_EFFECTORS, PART_NAMES, type Effector, type EngineInfo, type PoseDocument, type Preset, type Vec3, type ViewSlot } from './types';
import { CURRENT_MODEL } from './rig';
import {JOINT_LIMITS,constrainJointRotation,solveSpineTarget} from './poseControls';
import {FlyCameraControls,perspectiveForNavigation,cloneExportCamera} from './FlyCameraControls';

const V = THREE.Vector3, Q = THREE.Quaternion;
const CHAINS: Record<string, [string, string, string]> = {
  LeftHand: ['LeftArm', 'LeftForeArm', 'LeftHand'], RightHand: ['RightArm', 'RightForeArm', 'RightHand'],
  LeftFoot: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], RightFoot: ['RightUpLeg', 'RightLeg', 'RightFoot'],
};
const COCO_LINKS = [[1,2],[1,5],[2,3],[3,4],[5,6],[6,7],[1,8],[8,9],[9,10],[1,11],[11,12],[12,13],[1,0],[0,14],[14,16],[0,15],[15,17]];
const COCO_COLORS = ['#ff0000','#ff5500','#ffaa00','#ffff00','#aaff00','#55ff00','#00ff00','#00ff55','#00ffaa','#00ffff','#00aaff','#0055ff','#0000ff','#5500ff','#aa00ff','#ff00ff','#ff00aa','#ff0055'];
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
  selected = 'LeftHand';
  mode: 'translate' | 'rotate' = 'translate';
  display: 'surface' | 'skeleton' = 'surface';
  view = 'free';
  warning = '';
  ready = false;
  moreControls = false;
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
    for (const name of Object.values(CHAINS).flat()) if (!this.bones[name]) throw new Error(`人体缺少骨骼 ${name}`);
    this.model.updateMatrixWorld(true);
    for (const end of END_EFFECTORS) {
      this.targets[end] = asVec(this.world(end));
      const b = this.world(CHAINS[end][1]);
      this.poles[end] = asVec(b.add(new V(0,0,end.endsWith('Hand')?-.5:.5)));
    }
    this.rest = this.snapshot();
    for (const name of ['LeftHand','RightHand','LeftFoot','RightFoot','Hips','Chest','Head','LeftForeArm','RightForeArm','LeftLeg','RightLeg']) {
      const handle = new THREE.Mesh(new THREE.SphereGeometry(.022,16,12), new THREE.MeshBasicMaterial({ color:'#b1b6b6', depthTest:false, transparent:true, opacity:.9 }));
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
    let angle=2*Math.atan2(new V(q.x,q.y,q.z).dot(axis),q.w);
    if(angle>Math.PI)angle-=2*Math.PI;if(angle< -Math.PI)angle+=2*Math.PI;
    angle=THREE.MathUtils.clamp(angle,-restBend,THREE.MathUtils.degToRad(name.endsWith('Leg')?150:155)-restBend);
    bone.quaternion.setFromAxisAngle(axis,angle);bone.updateWorldMatrix(false,true);
  }

  private limitJoint(name:string){
    this.limitHinge(name);
    if(!JOINT_LIMITS[name]||!this.rest)return;
    const bone=this.bones[name],limited=constrainJointRotation(name,bone.quaternion,new Q().fromArray(this.rest.joints[name].quaternion));
    if(bone.quaternion.angleTo(limited)>1e-5)this.warning=`${PART_NAMES[name]}已到角度范围边界`;
    bone.quaternion.copy(limited);bone.updateWorldMatrix(false,true);
  }

  solve(end: string, target: THREE.Vector3, pole?: THREE.Vector3, preserveEndOrientation=true) {
    const chain = CHAINS[end]; if (!chain) return;
    const [a,b,c] = chain;
    const start = this.world(a), mid = this.world(b), last = this.world(c),endOrientation=this.bones[c].getWorldQuaternion(new Q());
    const result = solveTwoBone(start,target,pole ?? new V().fromArray(this.poles[end]),start.distanceTo(mid),mid.distanceTo(last),end.endsWith('Foot') ? 150:155);
    const rotations=solveLimbRotations(new V().fromArray(this.rest.joints[b].position),new V().fromArray(this.rest.joints[c].position),this.hingeAxis(b),result.elbow.clone().sub(start),result.end.clone().sub(result.elbow),end.endsWith('Foot')?150:155);
    this.setWorldQuaternion(this.bones[a],rotations.upperWorld);
    this.bones[b].quaternion.copy(rotations.lowerLocal);this.bones[b].updateWorldMatrix(false,true);
    if(preserveEndOrientation)this.setWorldQuaternion(this.bones[c],endOrientation);
    if (result.error > .009) this.warning = `${PART_NAMES[end]}目标超出当前可达范围`;
    return result;
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
    if (this.mode === 'rotate') {
      this.setWorldQuaternion(bone,this.gizmo.quaternion);
      this.limitJoint(this.selected);
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
      if (end) { this.poles[end] = asVec(this.gizmo.position); this.solve(end,new V().fromArray(this.targets[end])); }
    }
    this.solvePins();
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
  setDisplay(mode:'surface'|'skeleton'){this.display=mode;this.model.visible=mode==='surface';this.boneDisplay.visible=mode==='skeleton';this.update(false);}
  setGrid(value:boolean){this.grid.visible=value;}
  setGround(value:boolean){this.ground=value;this.commit();}
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
    if(!Number.isFinite(value))return;
    const bone=this.bones[this.selected],e=new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');
    const a=e.toArray() as [number,number,number,THREE.EulerOrder];a[axis]=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(value,-180,180));
    this.warning='';bone.quaternion.setFromEuler(new THREE.Euler(a[0],a[1],a[2],'XYZ'));bone.updateWorldMatrix(false,true);this.limitJoint(this.selected);
    this.solvePins();this.syncTargets();this.update(false);this.syncGizmo();this.commit();
  }
  private applyHandShape(side:'Left'|'Right',shape:string){
    this.hands[side]=shape;
    const index=new V().fromArray(this.rest.joints[`${side}Index1`].position),little=new V().fromArray(this.rest.joints[`${side}Little1`].position);
    const palmNormal=new V().crossVectors(index,little).normalize();if(side==='Right')palmNormal.negate();
    palmNormal.multiplyScalar(this.profile.handCurlNormalSign??1);
    for(const digit of ['Thumb','Index','Middle','Ring','Little'])for(let i=1;i<=3;i++){
      const bone=this.bones[`${side}${digit}${i}`];if(!bone)continue;
      bone.quaternion.fromArray(this.rest.joints[bone.name].quaternion);
      const curl=shape==='握拳'?(digit==='Thumb'?.45:1.0):shape==='指向'?(digit==='Index'?0:.95):0;
      const next=this.rest.joints[`${side}${digit}${Math.min(3,i+1)}`],direction=new V().fromArray(next.position).normalize();
      const axis=new V().crossVectors(direction,palmNormal).normalize();
      bone.quaternion.multiply(new Q().setFromAxisAngle(axis,curl));
    }
  }
  setHand(side:'Left'|'Right',shape:string){
    this.applyHandShape(side,shape);
    this.update(true);this.commit();
  }
  resetSelected(){const rest=this.rest.joints[this.selected];if(!rest)return;this.bones[this.selected].quaternion.fromArray(rest.quaternion);this.bones[this.selected].position.fromArray(rest.position);delete this.pins[this.selected as Effector];this.syncTargets();this.update(true);this.syncGizmo();this.commit();}

  applyPreset(preset:Preset,commit=true){
    const views=this.views,name=this.name;
    this.apply(this.rest,false);this.views=views;this.name=commit?preset.name:name;
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
    this.warning='';this.update(true);this.syncGizmo();if(commit)this.commit();
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
    return structuredClone({format:'momo-pose-forge',version:1,rig:CURRENT_MODEL.rig,name:this.name,root:{position:this.model.position.toArray(),quaternion:this.model.quaternion.toArray()},joints,targets:this.targets,poles:this.poles,pins:this.pins,hands:this.hands,views:this.views,ground:this.ground}) as PoseDocument;
  }
  apply(doc:PoseDocument,update=true){
    this.suppress=true;this.warning='';this.name=doc.name;this.views=structuredClone(doc.views);this.ground=doc.ground;
    this.model.position.fromArray(doc.root.position);this.model.quaternion.fromArray(doc.root.quaternion);
    for(const[name,j]of Object.entries(doc.joints)){const b=this.bones[name];if(b){b.position.fromArray(j.position);b.quaternion.fromArray(j.quaternion);}}
    if(this.rest)for(const name of Object.keys(JOINT_LIMITS))this.limitJoint(name);
    this.targets=structuredClone(doc.targets);this.poles=structuredClone(doc.poles);this.pins=structuredClone(doc.pins);this.hands={...doc.hands};
    this.model.updateMatrixWorld(true);this.suppress=false;if(update){this.update(true);this.syncGizmo();}
  }
  commit(){if(!this.ready)return;this.fit(false);this.onInfo(this.info());this.onCommit(this.snapshot());}

  info():EngineInfo{
    const bone=this.bones[this.selected];const e=bone?new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ'):new THREE.Euler();
    return {ready:this.ready,view:this.view,navigating:this.fly?.active??false,selected:this.selected,position:bone?asVec(this.world(this.selected)):[0,0,0],rotation:[e.x,e.y,e.z].map(THREE.MathUtils.radToDeg) as Vec3,pinned:!!this.pins[this.selected as Effector],orientationPinned:!!this.pins[this.selected as Effector]?.orientation,ground:this.ground,warning:this.warning,hands:{...this.hands},boneCount:Object.keys(this.bones).length,vertexCount:this.vertexCount};
  }

  private update(fit:boolean){
    if(!this.ready)return;this.model.updateMatrixWorld(true);
    if(fit)this.fit(false);
    for(const h of this.handles){const name=h.userData.part as string;h.position.copy(this.world(name));h.visible=this.moreControls||END_EFFECTORS.includes(name as Effector);const m=h.material as THREE.MeshBasicMaterial;m.color.set(name===this.selected?'#e3b969':this.pins[name as Effector]?'#e6d5af':'#a4abaa');h.scale.setScalar(name===this.selected?1.3:1);}
    if(this.display==='skeleton')this.updateSkeletonDisplay();
    this.onInfo(this.info());
  }
  private updateSkeletonDisplay(){
    this.boneDisplay.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();(o.material as THREE.Material).dispose();}});this.boneDisplay.clear();
    const pts=this.cocoWorld();
    COCO_LINKS.forEach(([a,b],i)=>{const g=new THREE.BufferGeometry().setFromPoints([pts[a],pts[b]]);this.boneDisplay.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:COCO_COLORS[i]})));});
    pts.forEach((p,i)=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.012,8,8),new THREE.MeshBasicMaterial({color:COCO_COLORS[i]}));s.position.copy(p);this.boneDisplay.add(s);});
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

  renderImage(slot:ViewSlot,width:number,height:number,kind:'surface'|'skeleton',transparent=false,viewCamera?:THREE.Camera):HTMLCanvasElement{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
    const camera=viewCamera??this.viewCamera(slot,width/height);
    if(kind==='skeleton'){
      ctx.fillStyle='#000000';ctx.fillRect(0,0,width,height);const k=this.keypoints(camera,width,height);
      ctx.lineWidth=Math.max(2,height*.005);ctx.lineCap='round';
      COCO_LINKS.forEach(([a,b],i)=>{if(!k[a*3+2]||!k[b*3+2])return;ctx.strokeStyle=COCO_COLORS[i];ctx.beginPath();ctx.moveTo(k[a*3],k[a*3+1]);ctx.lineTo(k[b*3],k[b*3+1]);ctx.stroke();});
      for(let i=0;i<18;i++){if(!k[i*3+2])continue;ctx.fillStyle=COCO_COLORS[i];ctx.beginPath();ctx.arc(k[i*3],k[i*3+1],Math.max(2,height*.005),0,Math.PI*2);ctx.fill();}
      return canvas;
    }
    const prev={background:this.scene.background,model:this.model.visible,helpers:this.helpers.visible,gizmo:this.transform.getHelper().visible,grid:this.grid.visible,ground:this.groundMesh.visible,bones:this.boneDisplay.visible,target:this.renderer.getRenderTarget()};
    const target=new THREE.WebGLRenderTarget(width,height,{samples:4});target.texture.colorSpace=THREE.SRGBColorSpace;
    try{
      this.scene.background=transparent?null:new THREE.Color('#e7e8e5');this.helpers.visible=false;this.transform.getHelper().visible=false;this.grid.visible=false;this.boneDisplay.visible=false;this.model.visible=true;this.groundMesh.visible=false;
      this.renderer.setClearAlpha(transparent?0:1);this.renderer.setRenderTarget(target);this.renderer.render(this.scene,camera);
      const buffer=new Uint8Array(width*height*4);this.renderer.readRenderTargetPixels(target,0,0,width,height,buffer);
      const image=ctx.createImageData(width,height),row=width*4;
      for(let y=0;y<height;y++)image.data.set(buffer.subarray((height-y-1)*row,(height-y)*row),y*row);
      ctx.putImageData(image,0,0);return canvas;
    }finally{
      this.scene.background=prev.background;this.model.visible=prev.model;this.helpers.visible=prev.helpers;this.transform.getHelper().visible=prev.gizmo;this.grid.visible=prev.grid;this.groundMesh.visible=prev.ground;this.boneDisplay.visible=prev.bones;this.renderer.setRenderTarget(prev.target);this.renderer.setClearAlpha(1);target.dispose();
    }
  }
  exportCamera(aspect:number){return cloneExportCamera(this.camera,aspect);}
  renderCurrent(width:number,height:number,kind:'surface'|'skeleton',transparent=false){return this.renderImage({id:'current',name:'当前视角',azimuth:0,elevation:0},width,height,kind,transparent,this.exportCamera(width/height));}
  getThumbnails(){return this.views.map(v=>({id:v.id,name:v.name,url:this.renderImage(v,180,200,'surface').toDataURL('image/png')}));}
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);if(this.camera instanceof THREE.PerspectiveCamera)this.camera.aspect=w/h;else{this.camera.left=-this.span*w/h/2;this.camera.right=this.span*w/h/2;this.camera.top=this.span/2;this.camera.bottom=-this.span/2;}this.camera.updateProjectionMatrix();}
  private animate=(now=performance.now())=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);const seconds=this.lastFrame?(now-this.lastFrame)/1000:0;this.lastFrame=now;this.fly.update(seconds);if(!this.fly.active)this.orbit.update();this.renderer.render(this.scene,this.camera);};
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.fly.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.orbit.dispose();this.transform.dispose();this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});this.renderer.dispose();this.renderer.domElement.remove();}
}
