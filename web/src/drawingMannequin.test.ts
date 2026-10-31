import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Bone,Box3,Matrix4,Quaternion,SkinnedMesh,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRAWING_FEMALE_RIG,requireRig} from './rigs';
import profile from '../public/models/drawing-mannequin/drawing-female-profile.json';

const load=async()=>{const bytes=readFileSync(new URL('../public/models/drawing-mannequin/drawing-female.glb',import.meta.url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
describe('原创绘画女素体资源',()=>{
  it('融合后的肩颈胸腰胯是一块闭合连通表面，腰宽与胸胯投影保持造型差异',async()=>{
    const {scene}=await load(),body=scene.getObjectByName('Body') as SkinnedMesh,geometry=body.geometry,position=geometry.getAttribute('position'),indices=geometry.index!,parent=Array.from({length:position.count},(_,i)=>i),edges=new Map<string,number>();
    const root=(i:number):number=>parent[i]===i?i:parent[i]=root(parent[i]);
    for(let i=0;i<indices.count;i+=3){const face=[indices.getX(i),indices.getX(i+1),indices.getX(i+2)];for(let j=0;j<3;j++){const a=face[j],b=face[(j+1)%3];parent[root(a)]=root(b);const key=a<b?`${a}/${b}`:`${b}/${a}`;edges.set(key,(edges.get(key)??0)+1);}}
    expect(new Set(parent.map((_,i)=>root(i))).size).toBe(1);expect([...edges.values()].every(n=>n===2)).toBe(true);
    const slice=(y:number)=>{const box=new Box3();for(let i=0;i<position.count;i++)if(Math.abs(position.getY(i)-y)<.008)box.expandByPoint(new Vector3().fromBufferAttribute(position,i));return box;};
    const waist=slice(1.105),hips=slice(.95),bust=slice(1.295);expect(hips.getSize(new Vector3()).x).toBeGreaterThan(waist.getSize(new Vector3()).x*1.4);expect(bust.max.z).toBeGreaterThan(waist.max.z+.06);
  });
  it('独立骨架与资源、定义内身高、66 个单位静止旋转关节和完整绑定',async()=>{
    const {scene,animations}=await load();scene.updateMatrixWorld(true);const bones:Bone[]=[],meshes:SkinnedMesh[]=[];scene.traverse(o=>{if(o instanceof Bone)bones.push(o);if(o instanceof SkinnedMesh)meshes.push(o);});
    expect(requireRig(profile.id)).toBe(DRAWING_FEMALE_RIG);expect(bones).toHaveLength(66);expect(meshes).toHaveLength(9);expect(animations).toEqual([]);expect(DRAWING_FEMALE_RIG.soles).toBeUndefined();expect(DRAWING_FEMALE_RIG.motionImport).toBeUndefined();expect(DRAWING_FEMALE_RIG.capabilities.openPose).toBe(true);
    const box=new Box3().setFromObject(scene,true);expect(box.min.y).toBeCloseTo(0,6);expect(box.max.y).toBeCloseTo(profile.height,5);
    for(const bone of bones){expect(bone.quaternion.angleTo(new Quaternion()),bone.name).toBeLessThan(1e-7);expect(bone.getWorldPosition(new Vector3()).distanceTo(new Vector3().fromArray(profile.bones[bone.name as keyof typeof profile.bones].position))).toBeLessThan(1e-6);}
    for(const mesh of meshes){mesh.skeleton.update();const weights=mesh.geometry.getAttribute('skinWeight'),positions=mesh.geometry.getAttribute('position');for(let i=0;i<positions.count;i++){expect(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)).toBeCloseTo(1,5);expect(mesh.getVertexPosition(i,new Vector3()).distanceTo(new Vector3().fromBufferAttribute(positions,i))).toBeLessThan(1e-6);}for(let i=0;i<mesh.skeleton.bones.length;i++)expect(mesh.skeleton.bones[i].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i]).elements.every((v,j)=>Math.abs(v-new Matrix4().elements[j])<1e-6)).toBe(true);}
  });
  it('连续躯干包含多段混合蒙皮，腰胸旋转真实变形且球形膝关节中心保持对齐',async()=>{
    const {scene}=await load();scene.updateMatrixWorld(true);const body=scene.getObjectByName('Body') as SkinnedMesh,joints=scene.getObjectByName('Joints') as SkinnedMesh,bones=Object.fromEntries(body.skeleton.bones.map(b=>[b.name,b]));
    const weight=body.geometry.getAttribute('skinWeight'),skin=body.geometry.getAttribute('skinIndex');let mixed=0;const used=new Set<string>();for(let i=0;i<weight.count;i++)for(let k=0;k<4;k++){if(weight.getComponent(i,k)>.01)used.add(body.skeleton.bones[skin.getComponent(i,k)].name);if(k===1&&weight.getY(i)>.01&&weight.getX(i)>.01)mixed++;}
    expect([...used].sort()).toEqual(['Hips','Spine','Spine1','Chest','UpperChest','Neck'].sort());expect(mixed).toBeGreaterThan(2000);
    const source=body.geometry.getAttribute('position'),before=Array.from({length:source.count},(_,i)=>body.getVertexPosition(i,new Vector3()));bones.Spine.rotation.z=.20;bones.Spine1.rotation.z=-.15;bones.Chest.rotation.y=.18;
    const positions=joints.geometry.getAttribute('position'),jointSkin=joints.geometry.getAttribute('skinIndex'),jointWeights=joints.geometry.getAttribute('skinWeight');
    for(const side of ['Left','Right']){const knee=bones[side+'Leg'],parent=bones[side+'UpLeg'],center=new Vector3().fromArray(profile.bones[(side+'Leg') as keyof typeof profile.bones].position),indices:number[]=[];for(let i=0;i<positions.count;i++)if(Math.abs(new Vector3().fromBufferAttribute(positions,i).distanceTo(center)-.049)<1e-6){indices.push(i);expect(joints.skeleton.bones[jointSkin.getX(i)]).toBe(parent);expect(jointWeights.getX(i)).toBe(1);}expect(indices.length).toBeGreaterThan(500);
      parent.rotation.z=side==='Left'?-.4:.4;knee.rotation.x=1.5;scene.updateMatrixWorld(true);joints.skeleton.update();const oldCenter=center.clone().applyMatrix4(joints.skeleton.boneInverses[joints.skeleton.bones.indexOf(parent)]).applyMatrix4(parent.matrixWorld);expect(oldCenter.distanceTo(knee.getWorldPosition(new Vector3()))).toBeLessThan(1e-6);for(const i of indices)expect(joints.getVertexPosition(i,new Vector3()).distanceTo(oldCenter)).toBeCloseTo(.049,5);
    }
    scene.updateMatrixWorld(true);body.skeleton.update();let changed=0;for(let i=0;i<source.count;i++){const p=body.getVertexPosition(i,new Vector3());expect(p.toArray().every(Number.isFinite)).toBe(true);if(p.distanceTo(before[i])>.005)changed++;}expect(changed).toBeGreaterThan(2000);
  });
});
