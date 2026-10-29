import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Vector3,Box3 } from 'three';
const raw=fs.readFileSync(new URL('../public/models/xbot.glb',import.meta.url));
const {scene}=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
const profile=JSON.parse(fs.readFileSync(new URL('../public/models/xbot-profile.json',import.meta.url),'utf8'));
scene.updateMatrixWorld(true);const meshes=[];scene.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();meshes.push(o);}});
assert.equal(meshes.length,2);assert.equal(meshes[0].skeleton.bones.length,68);assert.equal(profile.id,'mixamo-xbot-v2');
assert.equal(scene.getObjectByName('LeftForeArm').parent.name,'LeftArm');assert.equal(scene.getObjectByName('LeftHand').parent.name,'LeftForeArm');
assert.equal(scene.getObjectByName('LeftLeg').parent.name,'LeftUpLeg');assert.equal(scene.getObjectByName('LeftFoot').parent.name,'LeftLeg');
assert.equal(scene.getObjectByName('Neck').parent.name,'UpperChest');
let restError=0,vertices=0;
for(const mesh of meshes){vertices+=mesh.geometry.attributes.position.count;for(let i=0;i<mesh.geometry.attributes.position.count;i++){const p=new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i),v=mesh.getVertexPosition(i,new Vector3());restError=Math.max(restError,p.distanceTo(v));assert.ok(Number.isFinite(v.x+v.y+v.z));}}
assert.ok(restError<1e-5);assert.equal(vertices,28374);
const bounds=new Box3().setFromObject(scene,true),height=bounds.max.y-bounds.min.y;assert.ok(Math.abs(height-1.7)<1e-5);assert.ok(Math.abs(bounds.min.y)<1e-5);
const shell=scene.getObjectByName('Beta_Surface'),joints=scene.getObjectByName('Beta_Joints');
assert.ok(shell.material.color.r>shell.material.color.g*2,'Original red shell must remain red');assert.ok(joints.material.color.r<shell.material.color.r*.6,'Joint material must remain darker than shell');
const wrist=scene.getObjectByName('LeftHand'),rightWrist=scene.getObjectByName('RightHand'),before=wrist.getWorldPosition(new Vector3()),rightBefore=rightWrist.getWorldPosition(new Vector3());
scene.getObjectByName('LeftArm').rotation.z=Math.PI/3;scene.updateMatrixWorld(true);let movedVertices=0;
for(const mesh of meshes){mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){const p=new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i),v=mesh.getVertexPosition(i,new Vector3());assert.ok(Number.isFinite(v.x+v.y+v.z));if(p.distanceTo(v)>.01)movedVertices++;}}
assert.ok(wrist.getWorldPosition(new Vector3()).distanceTo(before)>.3);assert.ok(rightWrist.getWorldPosition(new Vector3()).distanceTo(rightBefore)<1e-7);assert.ok(movedVertices>1000);
console.log(JSON.stringify({character:profile.name,rig:profile.id,meshes:meshes.length,bones:68,vertices,height,restError,skinVerticesMoved:movedVertices,originalMaterialsRetained:true},null,2));
