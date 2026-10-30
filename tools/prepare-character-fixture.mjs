// Self-authored skinned triangle on the editor's canonical human hierarchy.
import fs from 'node:fs/promises';
import {Bone,Matrix4,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const data=await fs.readFile(new URL('../web/public/models/xbot.glb',import.meta.url));
const {scene}=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
scene.updateMatrixWorld(true);const bones=[];scene.traverse(o=>{if(o instanceof Bone)bones.push(o);});
const ids=new Map(bones.map((b,i)=>[b,1+i]));
const model=bones.map(b=>`\tModel: ${ids.get(b)}, "Model::${b.name}", "LimbNode" {\n\t\tVersion: 232\n\t\tProperties70: {\n\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${b.position.clone().multiplyScalar(100).toArray()}\n\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0\n\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1\n\t\t}\n\t}`).join('\n');
const hips=bones.find(b=>b.name==='Hips'),p=hips.getWorldPosition(new Vector3()).multiplyScalar(100),vertices=[p.x-10,p.y,0,p.x+10,p.y,0,p.x,p.y+25,0];
const bind=new Matrix4().makeTranslation(p.x,p.y,p.z).toArray(),identity=new Matrix4().toArray();
const extra=`
\tGeometry: 500, "Geometry::Cloth", "Mesh" {
\t\tVertices: *9 {
\t\t\ta: ${vertices}
\t\t}
\t\tPolygonVertexIndex: *3 {
\t\t\ta: 0,1,-3
\t\t}
\t}
\tModel: 501, "Model::Cloth", "Mesh" {
\t\tVersion: 232
\t\tProperties70: {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
\t\t}
\t}
\tDeformer: 600, "Deformer::Skin", "Skin" {
\t\tVersion: 101
\t}
\tDeformer: 601, "SubDeformer::Hips", "Cluster" {
\t\tVersion: 100
\t\tIndexes: *3 {
\t\t\ta: 0,1,2
\t\t}
\t\tWeights: *3 {
\t\t\ta: 1,1,1
\t\t}
\t\tTransform: *16 {
\t\t\ta: ${identity}
\t\t}
\t\tTransformLink: *16 {
\t\t\ta: ${bind}
\t\t}
\t}`;
const connections=bones.map(b=>`\tC: "OO",${ids.get(b)},${ids.get(b.parent)??0}`).join('\n');
const text=`; FBX 7.4.0 project file - self-authored PoseForge skinned cloth fixture
FBXHeaderExtension: {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
}
Objects: {
${model}${extra}
}
Connections: {
${connections}
\tC: "OO",500,501
\tC: "OO",501,0
\tC: "OO",600,500
\tC: "OO",601,600
\tC: "OO",${ids.get(hips)},601
}
`;
await fs.writeFile(new URL('../web/src/fixtures/skinned-character.fbx',import.meta.url),text);
