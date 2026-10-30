import {Bone,Box3,Group,Mesh,SkinnedMesh,DirectionalLight,SpotLight,PointLight,MeshStandardMaterial,SphereGeometry,CylinderGeometry,Vector3,type Object3D} from 'three';
import type {RigDefinition} from './rigs';

/** Some glTF assets rely on derivative flat shading and omit vertex normals. */
export function ensureRigNormals(root:Object3D){
  const processed=new Set<import('three').BufferGeometry>();
  root.traverse(object=>{if(object instanceof Mesh&&!processed.has(object.geometry)){processed.add(object.geometry);if(object.geometry.getAttribute('position')&&!object.geometry.getAttribute('normal'))object.geometry.computeVertexNormals();}});
}

/** Ignore cached/inactive appearances, even while the viewport shows skeleton lines. */
export function visibleSurfaceBounds(root:Object3D){
  const box=new Box3();root.updateWorldMatrix(true,true);
  const visit=(object:Object3D)=>{if(!object.visible)return;if(object instanceof Mesh)box.union(new Box3().setFromObject(object,true));else object.children.forEach(visit);};
  root.children.forEach(visit);return box;
}

/** Builds a real bone hierarchy; each rigid surface follows its owning joint. */
export function buildProceduralRig(rig:RigDefinition){
  if(rig.asset.kind!=='procedural')throw new Error('Expected a procedural rig');
  const group=new Group(),bones:Record<string,Bone>={},material=new MeshStandardMaterial({color:'#c5b49d',roughness:.7});
  for(const joint of rig.asset.joints){if(bones[joint.name])throw new Error('重复骨骼名称');const b=new Bone();b.name=joint.name;b.position.fromArray(joint.position);bones[joint.name]=b;}
  for(const joint of rig.asset.joints){
    const b=bones[joint.name];if(joint.parent){if(!bones[joint.parent])throw new Error('缺少父骨骼');bones[joint.parent].add(b);}else group.add(b);
    const head=joint.name==='head',sphere=new Mesh(new SphereGeometry(head?.105:.035,16,12),material);sphere.castShadow=true;b.add(sphere);
    if(joint.parent){
      const vector=new Vector3().fromArray(joint.position),length=vector.length(),radius=joint.name==='torso'?.1:joint.name==='neck'?.055:.035;
      const segment=new Mesh(new CylinderGeometry(radius*.85,radius,length,12),material);segment.position.copy(vector).multiplyScalar(.5);segment.quaternion.setFromUnitVectors(new Vector3(0,1,0),vector.normalize());segment.castShadow=true;bones[joint.parent].add(segment);
    }
  }
  group.updateMatrixWorld(true);return {group,bones};
}

export function disposeObject(group:Object3D){
  const geometries=new Set<import('three').BufferGeometry>(),materials=new Set<import('three').Material>(),textures=new Set<import('three').Texture>();
  const skeletons=new Set<import('three').Skeleton>();
  group.traverse(o=>{if(o instanceof DirectionalLight||o instanceof SpotLight||o instanceof PointLight)o.shadow.dispose();if(o instanceof SkinnedMesh)skeletons.add(o.skeleton);if(o instanceof Mesh||'isLine' in o){const mesh=o as Mesh;geometries.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){materials.add(material);for(const value of Object.values(material))if(value&&typeof value==='object'&&'isTexture' in value)textures.add(value as import('three').Texture);}}});
  skeletons.forEach(s=>s.dispose());
  geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());
}
