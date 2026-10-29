import fs from 'node:fs';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Bone, Group, Matrix4, Vector3 } from 'three';

const zip=await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
const json=async p=>JSON.parse(await zip.file(p).async('string'));
const doc=await json('project.pose.json'),manifest=await json('manifest.json');
const bytes=fs.readFileSync(new URL('../public/models/human.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const root=new Group();root.add(gltf.scene);root.position.fromArray(doc.root.position);root.quaternion.fromArray(doc.root.quaternion);
const bones={};root.traverse(b=>{if(b instanceof Bone)bones[b.name]=b;});
for(const[n,j]of Object.entries(doc.joints)){bones[n].position.fromArray(j.position);bones[n].quaternion.fromArray(j.quaternion);}root.updateMatrixWorld(true);
const profile=JSON.parse(fs.readFileSync(new URL('../public/models/human-profile.json',import.meta.url),'utf8'));
const pos=n=>bones[n].getWorldPosition(new Vector3()),anchor=n=>bones.Head.localToWorld(new Vector3().fromArray(profile.headAnchors[n]));
const points=[anchor('nose'),pos('Neck'),pos('RightArm'),pos('RightForeArm'),pos('RightHand'),pos('LeftArm'),pos('LeftForeArm'),pos('LeftHand'),pos('RightUpLeg'),pos('RightLeg'),pos('RightFoot'),pos('LeftUpLeg'),pos('LeftLeg'),pos('LeftFoot'),anchor('rightEye'),anchor('leftEye'),anchor('rightEar'),anchor('leftEar')];
let maxError=0;
for(const view of manifest.views){
  const output=await json(`${view.id}/keypoints-coco18.json`),k=output.people[0].pose_keypoints_2d;
  assert.equal(k.length,54);const matrix=new Matrix4().fromArray(view.projectionMatrix).multiply(new Matrix4().fromArray(view.worldMatrix).invert());
  for(let i=0;i<18;i++){const p=points[i].clone().applyMatrix4(matrix),valid=Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&Math.abs(p.z)<=1;
    assert.equal(k[i*3+2],valid?1:0);if(valid)maxError=Math.max(maxError,Math.abs(k[i*3]-(p.x+1)*manifest.width/2),Math.abs(k[i*3+1]-(1-p.y)*manifest.height/2));
  }
  for(const name of ['mannequin.png','openpose-coco18.png']){const png=await zip.file(`${view.id}/${name}`).async('nodebuffer');assert.equal(png.readUInt32BE(16),manifest.width);assert.equal(png.readUInt32BE(20),manifest.height);}
}
assert.ok(maxError<.001,'PNG camera projection and exported keypoints must agree');
assert.equal(manifest.views.length,5);
console.log(JSON.stringify({views:manifest.views.length,files:Object.values(zip.files).filter(f=>!f.dir).length,width:manifest.width,height:manifest.height,keypointMaximumErrorPixels:maxError},null,2));
