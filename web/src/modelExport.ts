import {AnimationClip,Bone,BufferAttribute,Group,Matrix3,Matrix4,Mesh,Object3D,QuaternionKeyframeTrack,Scene,SkinnedMesh,Vector3,VectorKeyframeTrack,type Material} from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import type {RigDefinition} from './rigs';

export type ModelExportOptions={mode:'static'|'rigged';scope:'selected'|'scene'};
export type ModelExportActor={id:string;name:string;rig:RigDefinition;appearance?:string;model:Group};
export type ModelExportSource={name:string;actors:ModelExportActor[];props?:Group};
export type ModelExportSnapshot={scene:Scene;animations:AnimationClip[];dispose:()=>void};

/** Capture on detached copies before the asynchronous encoder runs. Never dispose editor assets. */
export function snapshotModelExport(source:ModelExportSource,options:ModelExportOptions):ModelExportSnapshot{
  if(!source.actors.length&&!source.props?.children.length)throw new Error('pose.modelExportEmpty');
  const scene=new Scene(),geometries=new Set<import('three').BufferGeometry>(),materials=new Set<Material>(),skeletons=new Set<import('three').Skeleton>();
  scene.name=source.name;
  scene.userData={application:'MomoPoseForge',modelExportVersion:1,mode:options.mode,coordinates:'right-handed, Y up, metres',scope:options.scope,controlsIncluded:false};
  const dispose=()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose());scene.clear();};
  const copyMaterial=(material:Material|Material[])=>{
    const copy=(m:Material)=>{const result=m.clone();materials.add(result);return result;};
    return Array.isArray(material)?material.map(copy):copy(material);
  };
  try{
    for(const actor of source.actors){
      const root=cloneSkeleton(actor.model);root.visible=true;
      const visible=new Set<Mesh>();
      const visit=(node:Object3D)=>{if(!node.visible)return;if(node instanceof Mesh)visible.add(node);node.children.forEach(visit);};visit(root);
      const keep=new Set<Object3D>([root]);
      const retain=(node:Object3D|null)=>{while(node){keep.add(node);node=node.parent;}};
      root.traverse(node=>{if(node instanceof SkinnedMesh)skeletons.add(node.skeleton);if(node instanceof Bone&&options.mode==='rigged')retain(node);});
      visible.forEach(retain);
      // Hidden original meshes and cached outfits can share the active outfit's bones.
      // Preserve their transform ancestors, without exporting their inactive surfaces.
      const prune=(node:Object3D)=>{
        for(const child of [...node.children]){if(!keep.has(child)){node.remove(child);continue;}prune(child);}
        node.userData=node instanceof Bone?{jointName:node.name}:{};node.visible=true;
        if(node instanceof Mesh&&!visible.has(node)){
          const group=new Group();group.name=node.name;group.position.copy(node.position);group.quaternion.copy(node.quaternion);group.scale.copy(node.scale);group.matrix.copy(node.matrix);group.matrixAutoUpdate=node.matrixAutoUpdate;
          group.add(...[...node.children]);node.parent?.add(group);node.removeFromParent();
        }
      };prune(root);
      root.name=actor.name;
      root.userData={actorId:actor.id,actorName:actor.name,rig:actor.rig.id,rigVersion:actor.rig.version,appearance:actor.appearance??null,rigSource:actor.rig.attribution?.source??new URL(actor.rig.sourceUrl.replace(/^\//,''),'https://breezymomo.github.io/MomoPoseForge/').href,rigLicense:actor.rig.license,rigAttribution:actor.rig.attribution??null,modelLicense:actor.appearance?'See the source character license':actor.rig.license};
      scene.add(root);root.updateMatrixWorld(true);
      const meshes:Mesh[]=[];root.traverse(node=>{if(node instanceof Mesh)meshes.push(node);});
      for(const mesh of meshes){
        mesh.geometry=mesh.geometry.clone();geometries.add(mesh.geometry);mesh.material=copyMaterial(mesh.material);
        if(options.mode==='static'){
          const geometry=mesh.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),positions=new Float32Array(position.count*3),normals=normal?new Float32Array(normal.count*3):null;
          const p=new Vector3(),n=new Vector3(),base=new Vector3(),morph=new Vector3(),skin=new Matrix4(),bone=new Matrix4(),direction=new Matrix3();
          if(mesh instanceof SkinnedMesh)mesh.skeleton.update();
          for(let i=0;i<position.count;i++){
            mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld).toArray(positions,i*3);
            if(normal&&normals){
              n.fromBufferAttribute(normal,i);base.copy(n);
              geometry.morphAttributes.normal?.forEach((attribute,k)=>{const weight=mesh.morphTargetInfluences?.[k]??0;if(weight){morph.fromBufferAttribute(attribute,i);if(!geometry.morphTargetsRelative)morph.sub(base);n.addScaledVector(morph,weight);}});
              if(mesh instanceof SkinnedMesh){
                skin.elements.fill(0);const indices=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight');
                for(let k=0;k<4;k++){const weight=weights.getComponent(i,k);if(!weight)continue;bone.fromArray(mesh.skeleton.boneMatrices,indices.getComponent(i,k)*16);for(let j=0;j<16;j++)skin.elements[j]+=bone.elements[j]*weight;}
                skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);n.applyMatrix3(direction.setFromMatrix4(skin));
              }
              n.applyMatrix3(direction.getNormalMatrix(mesh.matrixWorld)).normalize().toArray(normals,i*3);
            }
          }
          geometry.setAttribute('position',new BufferAttribute(positions,3));if(normals)geometry.setAttribute('normal',new BufferAttribute(normals,3));
          geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');geometry.deleteAttribute('tangent');geometry.morphAttributes={};geometry.computeBoundingBox();geometry.computeBoundingSphere();
          const baked=new Mesh(geometry,mesh.material);baked.name=mesh.name;root.attach(baked);baked.position.set(0,0,0);baked.quaternion.identity();baked.scale.set(1,1,1);
          // Positions above are in scene coordinates; undo the actor transform once.
          geometry.applyMatrix4(root.matrixWorld.clone().invert());mesh.removeFromParent();
        }
      }
      if(options.mode==='static'){
        // All surfaces are baked and now direct children. Remove bones and empty asset transforms.
        for(const child of [...root.children])if(!(child instanceof Mesh))root.remove(child);
      }
    }
    if(source.props){const props=source.props.clone(true);props.name='Props';props.traverse(node=>{node.userData={};if(node instanceof Mesh){node.geometry=node.geometry.clone();geometries.add(node.geometry);node.material=copyMaterial(node.material);}});props.userData={kind:'props'};scene.add(props);}
    scene.updateMatrixWorld(true);
    const animations:AnimationClip[]=[];
    if(options.mode==='rigged'){
      const tracks:import('three').KeyframeTrack[]=[];
      // UUID bindings distinguish equal bone names belonging to different actors.
      // Two identical keys give importers a nonzero-duration constant pose clip.
      scene.traverse(node=>{if(node instanceof Bone){const times=[0,1/30];tracks.push(new VectorKeyframeTrack(`${node.uuid}.position`,times,[...node.position.toArray(),...node.position.toArray()]),new QuaternionKeyframeTrack(`${node.uuid}.quaternion`,times,[...node.quaternion.toArray(),...node.quaternion.toArray()]),new VectorKeyframeTrack(`${node.uuid}.scale`,times,[...node.scale.toArray(),...node.scale.toArray()]));}});
      if(tracks.length)animations.push(new AnimationClip('PoseForge_CurrentPose',1/30,tracks));
    }
    return {scene,animations,dispose};
  }catch(error){dispose();throw error;}
}

export async function encodeModelGlb(snapshot:ModelExportSnapshot,signal?:AbortSignal):Promise<ArrayBuffer>{
  const check=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};
  try{check();const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');check();const result=await new GLTFExporter().parseAsync(snapshot.scene,{binary:true,trs:true,animations:snapshot.animations,onlyVisible:true});check();if(!(result instanceof ArrayBuffer))throw new Error('pose.modelExportFailed');return result;}finally{snapshot.dispose();}
}
