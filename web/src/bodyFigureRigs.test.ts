import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Bone,Box3,Matrix4,SkinnedMesh,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BODYCHAN_RIG,BODYKUN_RIG} from './bodyFigureRigs';
import {disposeObject} from './rigGeometry';
import {requiredHandBones} from './handRig';

describe('BodyChan / BodyKun 真实资源',()=>{
  for(const [rig,height] of [[BODYCHAN_RIG,1.68],[BODYKUN_RIG,1.78]] as const)it(`${rig.id}仅包含自身模型、完整蒙皮和 53 个可编辑 FK 关节`,async()=>{
    const file=rig.asset.kind==='gltf'?rig.asset.url:'';
    const bytes=readFileSync(new URL(`../public${file}`,import.meta.url)),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,new DataView(buffer).getUint32(12,true))));
    expect(json.scenes).toHaveLength(1);expect(json.animations??[]).toHaveLength(0);expect([...(json.images??[]),...(json.buffers??[])].every(x=>!x.uri)).toBe(true);
    const gltf=await new GLTFLoader().parseAsync(buffer,'');gltf.scene.updateMatrixWorld(true);
    const bones:Bone[]=[],meshes:SkinnedMesh[]=[];gltf.scene.traverse(o=>{if(o instanceof Bone)bones.push(o);if(o instanceof SkinnedMesh)meshes.push(o);});
    expect(bones.map(b=>b.name).sort()).toEqual([...rig.editableJoints].sort());expect(meshes.length).toBeGreaterThan(8);
    expect(requiredHandBones(rig)).toHaveLength(32);for(const name of requiredHandBones(rig))expect(bones.some(b=>b.name===name),name).toBe(true);
    const bounds=new Box3().setFromObject(gltf.scene,true);expect(bounds.min.y).toBeCloseTo(0,5);expect(bounds.getSize(new Vector3()).y).toBeCloseTo(height,5);
    for(const mesh of meshes){
      const weights=mesh.geometry.getAttribute('skinWeight'),positions=mesh.geometry.getAttribute('position');mesh.skeleton.update();
      for(let i=0;i<positions.count;i++){
        expect(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)).toBeCloseTo(1,5);
        expect(mesh.getVertexPosition(i,new Vector3()).distanceTo(new Vector3().fromBufferAttribute(positions,i))).toBeLessThan(1e-5);
      }
      for(let i=0;i<mesh.skeleton.bones.length;i++)expect(mesh.skeleton.bones[i].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i]).elements.every((n,k)=>Math.abs(n-new Matrix4().elements[k])<1e-5)).toBe(true);
    }
    expect(rig.capabilities.hands).toBe(true);expect(rig.capabilities.fullBodyIK||rig.capabilities.openPose).toBe(false);disposeObject(gltf.scene);
  });
});
