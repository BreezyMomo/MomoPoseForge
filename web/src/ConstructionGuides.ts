import * as THREE from 'three';
import type {ArticulatedRig} from './articulatedIK';
import {restFrames} from './restFrames';

type Surface=THREE.Mesh<THREE.BufferGeometry>;
const surfaces=(model:THREE.Object3D)=>{const meshes:Surface[]=[];model.traverseVisible(o=>{if(o instanceof THREE.Mesh&&o.geometry.getAttribute('position'))meshes.push(o);});return meshes;};
const descends=(bone:THREE.Object3D|undefined,ancestor:THREE.Object3D)=>{for(let b=bone;b;b=b.parent??undefined)if(b===ancestor)return true;return false;};

/** Per-vertex bind coordinates stick to the actual skinned surface. Independent
 * geometries leave cached assets, actor meshes and all data channels untouched. */
export function guideGeometries(state:ArticulatedRig,meshes=surfaces(state.model)){
  const {rig,bones,model,rest}=state,anchors=rig.drawingGuides;if(!anchors)return [];
  const frames=restFrames(model,rest),position=(name:string)=>new THREE.Vector3().setFromMatrixPosition(frames.get(bones[name])!);
  const core=new Set<THREE.Object3D>();for(let b=bones[anchors.head].parent;b&&b!==model;b=b.parent)core.add(b);
  const headBounds=new THREE.Box3(),points:{source:Surface;positions:THREE.Vector3[];weights:[number,number][]}[]=[];
  for(const source of meshes){
    const attr=source.geometry.getAttribute('position'),skin=source as THREE.SkinnedMesh,weights: [number,number][]=[];
    const positions:THREE.Vector3[]=[];
    for(let i=0;i<attr.count;i++){
      const p=new THREE.Vector3().fromBufferAttribute(attr,i);let head=0,torso=0;
      if(skin.isSkinnedMesh){
        const indices=source.geometry.getAttribute('skinIndex'),values=source.geometry.getAttribute('skinWeight'),input=p.clone().applyMatrix4(skin.bindMatrix);p.set(0,0,0);
        for(let j=0;j<4;j++){
          const weight=values.getComponent(i,j);if(!weight)continue;const index=indices.getComponent(i,j),bone=skin.skeleton.bones[index];
          const matrix=frames.get(bone);if(!matrix)continue;
          p.addScaledVector(input.clone().applyMatrix4(matrix.clone().multiply(skin.skeleton.boneInverses[index])),weight);
          if(descends(bone,bones[anchors.head]))head+=weight;else if(core.has(bone))torso+=weight;
        }
        p.applyMatrix4(skin.bindMatrixInverse);
      }
      p.applyMatrix4(frames.get(source)!);positions.push(p);weights.push([head,torso]);if(head>.5)headBounds.expandByPoint(p);
    }
    points.push({source,positions,weights});
  }
  if(headBounds.isEmpty())headBounds.set(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5));
  const center=headBounds.getCenter(new THREE.Vector3()),size=headBounds.getSize(new THREE.Vector3()).max(new THREE.Vector3(.001,.001,.001));
  const pelvis=position(anchors.pelvis),chest=position(anchors.chest),left=position(anchors.leftShoulder),right=position(anchors.rightShoulder),width=Math.max(.05,left.distanceTo(right)/2),shoulderY=(left.y+right.y)/2,span=Math.max(.1,shoulderY-pelvis.y);
  return points.map(({source,positions,weights})=>{
    const a=new Float32Array(positions.length*4),b=new Float32Array(positions.length*4);
    positions.forEach((p,i)=>{
      a.set([(p.x-center.x)/(size.x/2),(p.y-(headBounds.min.y+size.y*.6))/(size.y/2),(p.z-center.z)/(size.z/2),weights[i][0]],i*4);
      const t=THREE.MathUtils.clamp((p.y-pelvis.y)/span,0,1),z=THREE.MathUtils.lerp(pelvis.z,chest.z,t);
      b.set([(p.x-THREE.MathUtils.lerp(pelvis.x,chest.x,t))/width,(p.y-pelvis.y)/span,(p.z-z)/width,weights[i][1]],i*4);
    });
    const geometry=source.geometry.clone();geometry.setAttribute('guideHead',new THREE.BufferAttribute(a,4));geometry.setAttribute('guideBody',new THREE.BufferAttribute(b,4));return {source,geometry};
  });
}

export class ConstructionGuides {
  private scene=new THREE.Scene();
  private entries=new Map<THREE.Object3D,{sources:Surface[];proxies:Surface[]}>();
  private width={value:1.25};
  private material=new THREE.MeshBasicMaterial({color:'#3e4145',transparent:true,depthWrite:false,depthTest:true,toneMapped:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  constructor(){
    this.material.onBeforeCompile=shader=>{
      shader.uniforms.guideWidth=this.width;
      shader.vertexShader='attribute vec4 guideHead;\nattribute vec4 guideBody;\nvarying vec4 vGuideHead,vGuideBody;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGuideHead=guideHead;vGuideBody=guideBody;');
      shader.fragmentShader='uniform float guideWidth;\nvarying vec4 vGuideHead,vGuideBody;\nfloat guideLine(float v){float w=max(fwidth(v),0.00001)*guideWidth;return 1.0-smoothstep(w*.2,w*.8,abs(v));}\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float face=smoothstep(.5,.8,vGuideHead.w)*smoothstep(.02,.15,vGuideHead.z);
        float head=max(guideLine(vGuideHead.x),guideLine(vGuideHead.y))*face;
        float torso=smoothstep(.5,.8,vGuideBody.w);
        float center=guideLine(vGuideBody.x)*smoothstep(.02,.15,vGuideBody.z)*step(-.35,vGuideBody.y)*step(vGuideBody.y,1.05);
        float bands=max(guideLine(vGuideBody.y-.87),guideLine(vGuideBody.y-.02));
        float ink=max(head,torso*max(center,bands));
        diffuseColor.a*=ink;if(diffuseColor.a<.01)discard;`);
    };
    this.material.customProgramCacheKey=()=> 'pose-construction-guides-v1';
  }
  private remove(model:THREE.Object3D){const entry=this.entries.get(model);for(const proxy of entry?.proxies??[]){this.scene.remove(proxy);proxy.geometry.dispose();}this.entries.delete(model);}
  forget(model:THREE.Object3D){this.remove(model);}
  render(renderer:THREE.WebGLRenderer,states:ArticulatedRig[],camera:THREE.Camera,target:THREE.WebGLRenderTarget|null,lineWidth:number){
    const models=new Set(states.map(s=>s.model));for(const model of this.entries.keys())if(!models.has(model))this.remove(model);
    for(const proxy of this.scene.children)proxy.visible=false;
    for(const state of states){
      if(!state.rig.drawingGuides||!state.model.visible)continue;const sources=surfaces(state.model);let entry=this.entries.get(state.model);
      if(!entry||entry.sources.length!==sources.length||entry.sources.some((s,i)=>s!==sources[i])){
        this.remove(state.model);const proxies=guideGeometries(state,sources).map(({source,geometry})=>{
          const proxy=source instanceof THREE.SkinnedMesh?new THREE.SkinnedMesh(geometry,this.material):new THREE.Mesh(geometry,this.material);
          if(proxy instanceof THREE.SkinnedMesh&&source instanceof THREE.SkinnedMesh){proxy.skeleton=source.skeleton;proxy.bindMode=source.bindMode;proxy.bindMatrix.copy(source.bindMatrix);proxy.bindMatrixInverse.copy(source.bindMatrixInverse);}
          proxy.matrixAutoUpdate=false;proxy.frustumCulled=false;proxy.morphTargetInfluences=source.morphTargetInfluences;this.scene.add(proxy);return proxy;
        });entry={sources,proxies};this.entries.set(state.model,entry);
      }
      state.model.updateWorldMatrix(true,true);
      entry.proxies.forEach((proxy,i)=>{const source=sources[i];proxy.visible=true;for(let p:THREE.Object3D|null=source;p&&p!==state.model;p=p.parent)if(!p.visible)proxy.visible=false;proxy.matrix.copy(source.matrixWorld);if(proxy instanceof THREE.SkinnedMesh)proxy.skeleton.update();});
    }
    const previous={target:renderer.getRenderTarget(),autoClear:renderer.autoClear};this.width.value=lineWidth;
    try{renderer.autoClear=false;renderer.setRenderTarget(target);renderer.render(this.scene,camera);}finally{renderer.autoClear=previous.autoClear;renderer.setRenderTarget(previous.target);}
  }
  dispose(){for(const model of this.entries.keys())this.remove(model);this.material.dispose();}
}
