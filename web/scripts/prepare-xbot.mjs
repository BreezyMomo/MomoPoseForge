// Preserve the actual Mixamo X Bot geometry/materials, normalize its rig to metres.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceUrl='https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/Xbot.glb';
const sourceFile=path.join(web,'assets-source','Xbot.glb');
let bytes;try{bytes=await fs.readFile(sourceFile);}catch{const r=await fetch(sourceUrl);if(!r.ok)throw new Error(`X Bot download: ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());await fs.mkdir(path.dirname(sourceFile),{recursive:true});await fs.writeFile(sourceFile,bytes);}
const sourceHash=createHash('sha256').update(bytes).digest('hex');
const source=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
source.scene.updateMatrixWorld(true);
const meshes=[];source.scene.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();meshes.push(o);}});
if(meshes.length!==2)throw new Error('Expected the X Bot surface and joint meshes');
const bounds=new THREE.Box3().setFromObject(source.scene,true),scale=1.7/(bounds.max.y-bounds.min.y);
const origin=new THREE.Vector3(0,bounds.min.y,0);
const canonical=p=>p.clone().sub(origin).multiplyScalar(scale);
const alias=name=>{
  const clean=name.replace(/^mixamorig[:_]?/i,'');if(clean==='Spine2')return 'Chest';
  return clean.replace(/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([1-4])$/,(_,side,digit,n)=>`${side}${digit==='Pinky'?'Little':digit}${n}`);
};
const oldBones=meshes[0].skeleton.bones,rest={},parents={},boneMap={};
for(const bone of oldBones){const name=alias(bone.name);rest[name]=canonical(bone.getWorldPosition(new THREE.Vector3()));parents[name]=bone.parent?.isBone?alias(bone.parent.name):null;boneMap[name]=new THREE.Bone();boneMap[name].name=name;}
rest.UpperChest=rest.Chest.clone().lerp(rest.Neck,.52);parents.UpperChest='Chest';boneMap.UpperChest=new THREE.Bone();boneMap.UpperChest.name='UpperChest';
for(const name of ['Neck','LeftShoulder','RightShoulder'])parents[name]='UpperChest';
const model=new THREE.Group();model.name='Mixamo_X_Bot';
for(const[name,bone]of Object.entries(boneMap)){
  const parent=parents[name];bone.position.copy(rest[name]);if(parent){bone.position.sub(rest[parent]);boneMap[parent].add(bone);}else model.add(bone);
}
model.updateMatrixWorld(true);
const bones=Object.values(boneMap),newIndex=Object.fromEntries(bones.map((b,i)=>[b.name,i]));
let vertexCount=0,triangleCount=0;
for(const mesh of meshes){
  const geometry=mesh.geometry.clone(),count=geometry.attributes.position.count;
  const positions=new Float32Array(count*3),normals=new Float32Array(count*3),indices=new Uint16Array(count*4);
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for(let i=0;i<count;i++){
    const p=canonical(mesh.localToWorld(mesh.getVertexPosition(i,new THREE.Vector3())));p.toArray(positions,i*3);
    new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,i).applyMatrix3(normalMatrix).normalize().toArray(normals,i*3);
    for(let j=0;j<4;j++)indices[i*4+j]=newIndex[alias(mesh.skeleton.bones[geometry.attributes.skinIndex.getComponent(i,j)].name)];
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('skinIndex',new THREE.BufferAttribute(indices,4));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const normalized=new THREE.SkinnedMesh(geometry,Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone());
  normalized.name=mesh.name;model.add(normalized);model.updateMatrixWorld(true);
  normalized.bind(new THREE.Skeleton(bones));normalized.normalizeSkinWeights();
  vertexCount+=count;triangleCount+=(geometry.index?.count??count)/3;
}
// GLTFExporter only needs FileReader for packaging the binary Blob, not a DOM.
globalThis.FileReader=class{
  result=null;onloadend=null;onerror=null;
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();}).catch(e=>this.onerror?.(e));}
  readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.();}).catch(e=>this.onerror?.(e));}
};
model.userData={source:'Adobe Mixamo X Bot',sourceUrl,sourceSha256:sourceHash,license:'Adobe Mixamo terms',rig:'mixamo-xbot-v2'};
const exported=await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:false});
const profile={
  id:'mixamo-xbot-v2',name:'Mixamo X Bot',version:2,height:1.7,forward:'+Z',up:'+Y',restRotation:'identity',handCurlNormalSign:-1,license:'Adobe Mixamo terms',
  hingeAxes:{LeftForeArm:[0,-1,0],RightForeArm:[0,1,0],LeftLeg:[1,0,0],RightLeg:[1,0,0]},
  bones:Object.fromEntries(bones.map(b=>[b.name,{parent:parents[b.name],position:rest[b.name].toArray()}])),
  chains:{leftArm:['LeftArm','LeftForeArm','LeftHand'],rightArm:['RightArm','RightForeArm','RightHand'],leftLeg:['LeftUpLeg','LeftLeg','LeftFoot'],rightLeg:['RightUpLeg','RightLeg','RightFoot']},
  headAnchors:{nose:[0,.035,.105],leftEye:rest.LeftEye.clone().sub(rest.Head).toArray(),rightEye:rest.RightEye.clone().sub(rest.Head).toArray(),leftEar:[.065,.055,0],rightEar:[-.065,.055,0]},
  source:{creator:'Adobe Mixamo',character:'X Bot',characterSite:'https://www.mixamo.com/',distribution:'Three.js r180 official example',url:sourceUrl,sha256:sourceHash,usageReference:'https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html'},
  mesh:{vertices:vertexCount,triangles:triangleCount,bones:bones.length,meshes:meshes.length},
};
const out=path.join(web,'public','models');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'xbot.glb'),Buffer.from(exported));await fs.writeFile(path.join(out,'xbot-profile.json'),JSON.stringify(profile,null,2));
console.log(JSON.stringify({model:'xbot.glb',bytes:exported.byteLength,...profile.mesh,restHips:rest.Hips.toArray(),restShoulder:rest.LeftArm.toArray(),restFoot:rest.LeftFoot.toArray(),sourceHash},null,2));
