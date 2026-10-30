import {Bone,BufferAttribute,Group,Matrix3,Matrix4,Mesh,Quaternion,Skeleton,SkinnedMesh,Vector3,type Object3D} from 'three';
import type {RigDefinition} from './rigs';
import type {PoseDocument} from './types';
import {disposeObject,ensureRigNormals} from './rigGeometry';

export type AppearanceRef={id:string;name:string;rig:string;rigVersion:number};
export const MAX_CHARACTER_BYTES=32*1024*1024;
export function validateCharacterGlb(bytes:ArrayBuffer){
  if(bytes.byteLength<20||bytes.byteLength>MAX_CHARACTER_BYTES)throw new Error('请导入 32 MB 以内的完整 GLB 角色文件');
  const view=new DataView(bytes),size=view.getUint32(12,true);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength||view.getUint32(16,true)!==0x4e4f534a||20+size>bytes.byteLength)throw new Error('GLB 文件结构无效');
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,size)));
  if([...(json.buffers??[]),...(json.images??[])].some(x=>x.uri&&!x.uri.startsWith('data:')))throw new Error('GLB 须内嵌网格和贴图，不能引用外部文件');
}
export function validAppearance(value:unknown,rig:RigDefinition):value is AppearanceRef{
  if(!value||typeof value!=='object')return false;const r=value as AppearanceRef;
  return typeof r.id==='string'&&/^[a-f0-9]{64}$/.test(r.id)&&typeof r.name==='string'&&r.name.length>0&&r.name.length<=80&&r.rig===rig.id&&r.rigVersion===rig.version;
}
export function appearanceBoneName(name:string,rig:RigDefinition){
  if(rig.strategy!=='xbot-humanoid')return name;
  const clean=name.replace(/^mixamorig[:_]?/i,'');
  if(clean==='Spine2')return 'Chest';
  return clean.replace(/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([1-4])$/,(_,side,digit,n)=>`${side}${digit==='Pinky'?'Little':digit}${n}`);
}
/** Rebind a compatible character's surface to canonical rest bones. No source animation enters the editor. */
export function buildAppearance(source:Object3D,rig:RigDefinition,rest:PoseDocument,targetBones:Record<string,Bone>){
  source.updateMatrixWorld(true);
  const sourceBones=new Map<string,Bone>(),meshes:SkinnedMesh[]=[];
  source.traverse(o=>{
    if(o instanceof Bone){const name=appearanceBoneName(o.name,rig);if(sourceBones.has(name))throw new Error(`外观骨骼重名：${name}`);sourceBones.set(name,o);}
    if(o instanceof SkinnedMesh)meshes.push(o);
    else if(o instanceof Mesh)throw new Error('请将服装与配件蒙皮后再导入；当前只接受蒙皮网格');
  });
  if(!meshes.length)throw new Error('文件中没有蒙皮角色');
  const virtual=rig.strategy==='xbot-humanoid'&&!sourceBones.has('UpperChest')?'UpperChest':null;
  for(const name of Object.keys(rest.joints)){
    if(name===virtual)continue;
    const bone=sourceBones.get(name);
    if(!bone){if(rig.strategy==='xbot-humanoid'&&!rig.editableJoints.includes(name))continue;throw new Error(`外观缺少当前骨架关节：${name}`);}
    let expected=targetBones[name]?.parent;
    if(expected?.name===virtual)expected=expected.parent;
    const actual=bone.parent instanceof Bone?appearanceBoneName(bone.parent.name,rig):null;
    if(actual!==(expected instanceof Bone?expected.name:null))throw new Error(`骨架连接不兼容：${name}`);
  }
  // Build canonical matrices without disturbing the current pose or preview.
  const canonical=new Map<string,Matrix4>();
  const matrixFor=(name:string):Matrix4=>{
    const cached=canonical.get(name);if(cached)return cached;
    const j=rest.joints[name],bone=targetBones[name],local=new Matrix4().compose(new Vector3().fromArray(j.position),new Quaternion().fromArray(j.quaternion),bone.scale);
    const parent=bone.parent instanceof Bone?matrixFor(bone.parent.name):new Matrix4();
    const world=parent.clone().multiply(local);canonical.set(name,world);return world;
  };
  // Bone parents can include normalized asset transforms (Fox's root is a Bone).
  Object.keys(rest.joints).forEach(matrixFor);
  const matched=[...sourceBones.keys()].filter(n=>canonical.has(n));
  const sourcePoint=(name:string)=>sourceBones.get(name)!.getWorldPosition(new Vector3());
  const targetPoint=(name:string)=>new Vector3().setFromMatrixPosition(canonical.get(name)!);
  const height=(points:Vector3[])=>Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
  const scale=height(matched.map(targetPoint))/height(matched.map(sourcePoint));
  if(!Number.isFinite(scale)||scale<1e-4||scale>1e4)throw new Error('角色单位或静止姿态不兼容');
  const alignedFrame=(name:string)=>{
    const children=(bone:Bone):string[]=>bone.children.flatMap(c=>c instanceof Bone?(sourceBones.has(c.name)?[c.name]:children(c)):[]);
    const child=children(targetBones[name])[0];
    let parent=targetBones[name].parent;while(parent instanceof Bone&&!sourceBones.has(parent.name))parent=parent.parent;
    const other=child??(parent instanceof Bone?parent.name:undefined),rotation=new Quaternion();
    if(other){const from=sourcePoint(other).sub(sourcePoint(name)),to=targetPoint(other).sub(targetPoint(name));if(from.lengthSq()>1e-12&&to.lengthSq()>1e-12)rotation.setFromUnitVectors(from.normalize(),to.normalize());}
    // Geometry is already in world axes. Bone-local rotations/scales are binding
    // conventions (Mixamo uses centimetre axes), not a geometric rest-frame delta.
    return new Matrix4().compose(targetPoint(name),rotation,new Vector3(scale,scale,scale)).multiply(new Matrix4().makeTranslation(sourcePoint(name).negate()));
  };
  const names=Object.keys(rest.joints),index=new Map(names.map((n,i)=>[n,i]));
  const group=new Group();group.name='CharacterAppearance';
  try{
    for(const mesh of meshes){
      const original=mesh.geometry,position=original.getAttribute('position'),skinIndex=original.getAttribute('skinIndex'),weight=original.getAttribute('skinWeight');
      if(!position||!skinIndex||!weight)throw new Error('角色缺少蒙皮权重');
      if(position.count>500_000)throw new Error('角色网格过大，请先简化至 50 万顶点以内');
      const normal=original.getAttribute('normal'),positions=new Float32Array(position.count*3),normals=normal?new Float32Array(position.count*3):null,indices=new Uint16Array(position.count*4);
      const matrices=mesh.skeleton.bones.map(b=>{
        const name=appearanceBoneName(b.name,rig),world=canonical.get(name);
        if(!world)throw new Error(`蒙皮引用了未适配的骨骼：${name}`);
        return alignedFrame(name).multiply(mesh.matrixWorld);
      });
      mesh.skeleton.update();
      for(let i=0;i<position.count;i++){
        const p=mesh.getVertexPosition(i,new Vector3()),sum=new Vector3(),n=new Vector3(),sourceNormal=normal?new Vector3().fromBufferAttribute(normal,i):null;let total=0;
        for(let k=0;k<4;k++){
          const w=weight.getComponent(i,k),old=skinIndex.getComponent(i,k);if(!Number.isFinite(w)||w<0||!matrices[old])throw new Error('角色蒙皮权重无效');
          indices[i*4+k]=index.get(appearanceBoneName(mesh.skeleton.bones[old].name,rig))!;
          if(w){sum.addScaledVector(p.clone().applyMatrix4(matrices[old]),w);if(sourceNormal)n.addScaledVector(sourceNormal.clone().applyMatrix3(new Matrix3().getNormalMatrix(matrices[old])).normalize(),w);total+=w;}
        }
        if(total<.99||total>1.01||!sum.toArray().every(Number.isFinite))throw new Error('角色蒙皮权重或坐标无效');
        sum.divideScalar(total).toArray(positions,i*3);if(normals)n.normalize().toArray(normals,i*3);
      }
      const g=original.clone();g.setAttribute('position',new BufferAttribute(positions,3));if(normals)g.setAttribute('normal',new BufferAttribute(normals,3));
      g.setAttribute('skinIndex',new BufferAttribute(indices,4));g.morphAttributes={};g.computeBoundingSphere();g.computeBoundingBox();
      const material=Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone();
      // Textures must outlive disposal of the temporary source scene.
      for(const m of Array.isArray(material)?material:[material])for(const [key,v]of Object.entries(m))if(v&&typeof v==='object'&&'isTexture'in v)(m as unknown as Record<string,unknown>)[key]=(v as import('three').Texture).clone();
      const result=new SkinnedMesh(g,material);result.name=mesh.name;result.castShadow=true;result.frustumCulled=false;
      result.bind(new Skeleton(names.map(n=>targetBones[n]),names.map(n=>canonical.get(n)!.clone().invert())),new Matrix4());group.add(result);
    }
    ensureRigNormals(group);return group;
  }catch(error){disposeObject(group);throw error;}
}
