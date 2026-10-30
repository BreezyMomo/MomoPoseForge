import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Bone,Box3,SkinnedMesh,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {YBOT_RIG,XBOT_RIG,RIGS} from './rigs';
import {handBones} from './poseOutput';
import {disposeObject} from './rigGeometry';

describe('Mixamo Y Bot 实际资源',()=>{
  it('独立规范骨架保留原网格、材质、比例和完整手指，静止蒙皮一致',async()=>{
    const bytes=readFileSync(new URL('../public/models/ybot.glb',import.meta.url)),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),gltf=await new GLTFLoader().parseAsync(buffer,'');gltf.scene.updateMatrixWorld(true);
    const bones:Bone[]=[],meshes:SkinnedMesh[]=[];gltf.scene.traverse(o=>{if(o instanceof Bone)bones.push(o);if(o instanceof SkinnedMesh)meshes.push(o);});
    expect(bones).toHaveLength(66);expect(meshes).toHaveLength(2);expect(gltf.animations).toHaveLength(0);expect(meshes.map(m=>m.name).sort()).toEqual(['Alpha_Joints','Alpha_Surface']);expect(meshes.reduce((n,m)=>n+m.geometry.getAttribute('position').count,0)).toBe(35434);
    for(const n of [...YBOT_RIG.editableJoints,...handBones('Left'),...handBones('Right')])expect(gltf.scene.getObjectByName(n)).toBeInstanceOf(Bone);
    for(const bone of bones)expect(bone.quaternion.angleTo(bone.quaternion.clone().identity())).toBeLessThan(1e-7);
    const box=new Box3().setFromObject(gltf.scene,true);expect(box.max.y-box.min.y).toBeCloseTo(1.8,5);expect(box.min.y).toBeCloseTo(0,5);
    const old=JSON.parse(readFileSync(new URL('../public/models/xbot-profile.json',import.meta.url),'utf8')),profile=JSON.parse(readFileSync(new URL('../public/models/ybot-profile.json',import.meta.url),'utf8'));
    expect(profile.id).toBe(YBOT_RIG.id);expect(profile.bones.LeftArm.position).not.toEqual(old.bones.LeftArm.position);expect(YBOT_RIG.soles).toBeUndefined();expect(RIGS).toContain(YBOT_RIG);expect(XBOT_RIG.soles).toBeDefined();
    for(const mesh of meshes){mesh.skeleton.update();const p=mesh.geometry.getAttribute('position');for(let i=0;i<p.count;i++)expect(mesh.getVertexPosition(i,new Vector3()).distanceTo(new Vector3().fromBufferAttribute(p,i))).toBeLessThan(1e-5);}
    disposeObject(gltf.scene);
  });
});
