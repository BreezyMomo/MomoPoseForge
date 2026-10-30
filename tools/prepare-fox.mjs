// Rebuild the metre-based distributable from the pinned, unmodified CC-licensed source.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'web/public/models/fox'),source=fs.readFileSync(path.join(root,'assets/source/fox/Fox.glb'));
const metadata=JSON.parse(fs.readFileSync(path.join(directory,'source.json'),'utf8'));
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
if(hash(source)!==metadata.sha256)throw new Error('Fox source hash mismatch');
const jsonLength=source.readUInt32LE(12),gltf=JSON.parse(source.subarray(20,20+jsonLength));
const binOffset=20+jsonLength;
if(source.readUInt32LE(binOffset+4)!==0x004e4942)throw new Error('Missing GLB BIN chunk');
const binary=Buffer.from(source.subarray(binOffset+8,binOffset+8+source.readUInt32LE(binOffset))),scale=.01;
const positions=new Set();
for(const mesh of gltf.meshes)for(const primitive of mesh.primitives)positions.add(primitive.attributes.POSITION);
for(const animation of gltf.animations??[])for(const channel of animation.channels)if(channel.target.path==='translation')positions.add(animation.samplers[channel.sampler].output);
function scaleAccessor(index,components,indices){
  const accessor=gltf.accessors[index],view=gltf.bufferViews[accessor.bufferView];
  if(accessor.componentType!==5126)throw new Error('Expected float accessor');
  const start=(view.byteOffset??0)+(accessor.byteOffset??0),stride=view.byteStride??components*4;
  for(let i=0;i<accessor.count;i++)for(const component of indices){const offset=start+i*stride+component*4;binary.writeFloatLE(binary.readFloatLE(offset)*scale,offset);}
  for(const bound of ['min','max'])if(accessor[bound])accessor[bound]=accessor[bound].map(v=>v*scale);
}
for(const index of positions)scaleAccessor(index,3,[0,1,2]);
for(const skin of gltf.skins)scaleAccessor(skin.inverseBindMatrices,16,[12,13,14]);
for(const node of gltf.nodes){if(node.translation)node.translation=node.translation.map(v=>v*scale);if(node.matrix)for(const i of [12,13,14])node.matrix[i]*=scale;}
gltf.asset.extras={...gltf.asset.extras,momoPoseForge:{sourceCommit:metadata.sourceCommit,changes:'Scaled source coordinates, skin inverse bind translations and animation translations by 0.01 for metre-based editing; topology, materials, textures and rotation tracks preserved.'}};
const json=Buffer.from(JSON.stringify(gltf)),jsonPadded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(jsonPadded);
const glb=Buffer.alloc(12+8+jsonPadded.length+8+binary.length);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(jsonPadded.length,12);glb.writeUInt32LE(0x4e4f534a,16);jsonPadded.copy(glb,20);const cursor=20+jsonPadded.length;glb.writeUInt32LE(binary.length,cursor);glb.writeUInt32LE(0x004e4942,cursor+4);binary.copy(glb,cursor+8);
fs.writeFileSync(path.join(directory,'fox.glb'),glb);
const parents=new Map();gltf.nodes.forEach((node,i)=>{for(const child of node.children??[])parents.set(child,i);});
const jointIds=new Set(gltf.skins[0].joints);
const bones=Object.fromEntries([...jointIds].map(i=>{const node=gltf.nodes[i],parent=parents.get(i);return [node.name,{parent:jointIds.has(parent)?gltf.nodes[parent].name:null,position:node.translation??[0,0,0],quaternion:node.rotation??[0,0,0,1]}];}));
fs.writeFileSync(path.join(directory,'fox-profile.json'),JSON.stringify({id:'khronos-fox',version:1,rigVersion:1,units:'metres',sourceCommit:metadata.sourceCommit,bones},null,2)+'\n');
fs.writeFileSync(path.join(directory,'prepared.json'),JSON.stringify({sourceSha256:hash(source),preparedSha256:hash(glb),units:'metres',sourceUnits:'original asset coordinates',scale,sourceCommit:metadata.sourceCommit,boneCount:jointIds.size,animations:gltf.animations.map(a=>a.name)},null,2)+'\n');
console.log(`Prepared Fox: ${jointIds.size} skin joints, ${glb.length} bytes, ${hash(glb)}`);
