import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {PoseEngine} from './PoseEngine';
import type {HandValues,Side} from './types';
import {writeHandValues} from './handGestures';

export function cloneHandRig(engine:Pick<PoseEngine,'model'|'rest'>){
  const model=clone(engine.model),bones:Record<string,THREE.Bone>={};model.visible=true;
  model.position.fromArray(engine.rest.root.position);model.quaternion.fromArray(engine.rest.root.quaternion);
  model.traverse(o=>{if(o instanceof THREE.Bone){bones[o.name]=o;const rest=engine.rest.joints[o.name];o.position.fromArray(rest.position);o.quaternion.fromArray(rest.quaternion);}});
  return {model,bones};
}

/** Dedicated rest-pose clone: thumbnail rendering cannot alter the editor rig. */
export class HandPreview {
  readonly model:THREE.Object3D;
  readonly bones:Record<string,THREE.Bone>={};
  private readonly scene=new THREE.Scene();
  private readonly renderer:THREE.WebGLRenderer;
  private disposed=false;
  constructor(private engine:PoseEngine){
    const rig=cloneHandRig(engine);this.model=rig.model;this.bones=rig.bones;
    this.scene.add(this.model,new THREE.HemisphereLight('#ffffff','#757575',2));
    const key=new THREE.DirectionalLight('#fff9ef',3.4);key.position.set(2.5,4,4);this.scene.add(key);
    const fill=new THREE.DirectionalLight('#dce8ff',1.5);fill.position.set(-3,2,-2);this.scene.add(fill);
    this.scene.background=new THREE.Color('#e7e8e5');
    this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setSize(144,168,false);this.renderer.setPixelRatio(1);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
  }
  render(side:Side,values:HandValues){
    if(this.disposed)throw new Error('手势预览已关闭');
    writeHandValues(this.bones,this.engine.rest.joints,side,values);this.model.updateMatrixWorld(true);
    const hand=this.bones[`${side}Hand`],origin=hand.getWorldPosition(new THREE.Vector3()),rotation=hand.getWorldQuaternion(new THREE.Quaternion());
    // Use a fixed rest-hand frame for all gestures, so their size is comparable.
    const along=new THREE.Vector3().fromArray(this.engine.rest.joints[`${side}Middle1`].position).normalize().applyQuaternion(rotation);
    const index=this.bones[`${side}Index1`].getWorldPosition(new THREE.Vector3()).sub(origin),little=this.bones[`${side}Little1`].getWorldPosition(new THREE.Vector3()).sub(origin);
    const palmNormal=new THREE.Vector3().crossVectors(index,little).normalize().multiplyScalar(side==='Left'?-1:1),center=origin.clone().addScaledVector(along,.09);
    const camera=new THREE.OrthographicCamera(-.12,.12,.14,-.14,.01,3);camera.up.copy(along);camera.position.copy(center).addScaledVector(palmNormal,.6).addScaledVector(along,.08);camera.lookAt(center);camera.updateMatrixWorld(true);
    this.renderer.render(this.scene,camera);return this.renderer.domElement.toDataURL('image/webp',.87);
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.model.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)(o as THREE.SkinnedMesh).skeleton.dispose();});this.renderer.dispose();this.renderer.forceContextLoss();}
}
