// Independent file-level verification: reconstruct the real GLB, raycast the
// deformed skin, and compare CPU surface depth/normals to exported GPU pixels.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {PNG} from 'pngjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Bone,Group,Vector2,Vector3,Vector4,Matrix3,Matrix4,Triangle,Raycaster,PerspectiveCamera,OrthographicCamera} from 'three';

const zip=await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
const json=async name=>JSON.parse(await zip.file(name).async('string'));
const png=async name=>PNG.sync.read(await zip.file(name).async('nodebuffer'));
const manifest=await json('manifest.json'),doc=await json('project.pose.json'),world=await json('skeleton-world.json');
const bytes=fs.readFileSync(new URL('../public/models/xbot.glb',import.meta.url));
const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const root=new Group();root.add(scene);root.position.fromArray(doc.root.position);root.quaternion.fromArray(doc.root.quaternion);
const bones={},meshes=[];root.traverse(o=>{if(o instanceof Bone)bones[o.name]=o;if(o.isSkinnedMesh)meshes.push(o);});
for(const[name,j]of Object.entries(doc.joints)){bones[name].position.fromArray(j.position);bones[name].quaternion.fromArray(j.quaternion);}root.updateMatrixWorld(true);
for(const mesh of meshes){mesh.skeleton.update();mesh.computeBoundingBox();mesh.computeBoundingSphere();}
const sides=['Left','Right'],digits=['Thumb','Index','Middle','Ring','Little'],handNames=side=>[`${side}Hand`,...digits.flatMap(d=>[1,2,3,4].map(n=>`${side}${d}${n}`))];
const raycaster=new Raycaster();let depthError=0,normalError=0,keypointError=0,samples=0,handVisibilityMismatches=0,worldError=0;
const results=[];

function skinnedNormal(mesh,index,camera){
  const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,matrix=new Matrix4().set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);
  for(let i=0;i<4;i++){const bone=new Matrix4().fromArray(mesh.skeleton.boneMatrices,indices.getComponent(index,i)*16),weight=weights.getComponent(index,i);for(let k=0;k<16;k++)matrix.elements[k]+=bone.elements[k]*weight;}
  matrix.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
  const base=new Vector3().fromBufferAttribute(mesh.geometry.attributes.normal,index),skinned=new Vector4(base.x,base.y,base.z,0).applyMatrix4(matrix);
  return new Vector3(skinned.x,skinned.y,skinned.z).applyMatrix3(new Matrix3().getNormalMatrix(new Matrix4().multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld))).normalize();
}
function hitAt(camera,x,y,w,h){raycaster.setFromCamera(new Vector2((x+.5)/w*2-1,1-(y+.5)/h*2),camera);return raycaster.intersectObjects(meshes,false)[0];}
function surfaceNormal(hit,camera){
  const mesh=hit.object,{a,b,c}=hit.face,local=hit.point.clone().applyMatrix4(mesh.matrixWorld.clone().invert()),bary=Triangle.getBarycoord(local,mesh.getVertexPosition(a,new Vector3()),mesh.getVertexPosition(b,new Vector3()),mesh.getVertexPosition(c,new Vector3()),new Vector3());
  return skinnedNormal(mesh,a,camera).multiplyScalar(bary.x).addScaledVector(skinnedNormal(mesh,b,camera),bary.y).addScaledVector(skinnedNormal(mesh,c,camera),bary.z).normalize();
}
for(const view of manifest.views){
  const camera=view.projection==='perspective'?new PerspectiveCamera():new OrthographicCamera();
  camera.projectionMatrix.fromArray(view.projectionMatrix);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.matrixWorld.fromArray(view.worldMatrix);camera.matrixWorldInverse.copy(camera.matrixWorld).invert();camera.matrixAutoUpdate=false;camera.matrixWorldAutoUpdate=false;
  const p=camera.projectionMatrix.elements;camera.near=view.near??(view.projection==='perspective'?p[14]/(p[10]-1):(p[14]+1)/p[10]);camera.far=view.far??(view.projection==='perspective'?p[14]/(p[10]+1):(p[14]-1)/p[10]);
  const {width:w,height:h}=manifest,depth=await png(`${view.id}/depth.png`),normal=await png(`${view.id}/normal.png`),mask=await png(`${view.id}/mask.png`),frame=(await json(`${view.id}/keypoints-openpose.json`)).people[0];
  for(const image of [depth,normal,mask]){assert.equal(image.width,w);assert.equal(image.height,h);}
  let foreground=0;
  for(let i=0;i<w*h;i++){const offset=i*4;assert.ok(mask.data[offset]===0||mask.data[offset]===255,'mask must be binary');if(mask.data[offset])foreground++;else{assert.equal(depth.data[offset]+depth.data[offset+1]+depth.data[offset+2],0);assert.equal(normal.data[offset]+normal.data[offset+1]+normal.data[offset+2],0);}}
  assert.ok(foreground>100,'nonempty character required');
  let viewSamples=0;
  // Keep enough surface samples when a wide/free camera leaves the figure small.
  const stride=Math.max(4,Math.floor(Math.sqrt(foreground/120)));
  for(let y=stride;y<h-stride;y+=stride)for(let x=stride;x<w-stride;x+=stride){
    if(![-1,0,1].every(d=>mask.data[(y*w+x+d)*4]===255&&mask.data[((y+d)*w+x)*4]===255))continue;
    const hit=hitAt(camera,x,y,w,h);assert.ok(hit,'foreground must correspond to the real skin');const eyeDepth=-hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const gray=Math.max(0,Math.min(1,(manifest.depth.range.far-eyeDepth)/(manifest.depth.range.far-manifest.depth.range.near)))*255,offset=(y*w+x)*4;
    for(let c=0;c<3;c++)depthError=Math.max(depthError,Math.abs(depth.data[offset+c]-gray));
    const n=surfaceNormal(hit,camera),rgb=[(-n.x+1)*127.5,(n.y+1)*127.5,(n.z+1)*127.5];
    for(let c=0;c<3;c++)normalError=Math.max(normalError,Math.abs(normal.data[offset+c]-rgb[c]));
    viewSamples++;samples++;
  }
  const valid={};
  for(const side of sides){
    const k=frame[side==='Left'?'hand_left_keypoints_2d':'hand_right_keypoints_2d'];assert.equal(k.length,63);valid[side]=0;
    for(const[name,i]of handNames(side).map((n,i)=>[n,i])){
      const point=bones[name].getWorldPosition(new Vector3()),worldPoint=world.hands[side].points[i];worldError=Math.max(worldError,point.distanceTo(new Vector3().fromArray(worldPoint.position)));
      const clip=point.clone().project(camera),inside=Math.abs(clip.x)<=1&&Math.abs(clip.y)<=1&&Math.abs(clip.z)<=1;
      if(k[i*3+2]){assert.ok(inside);keypointError=Math.max(keypointError,Math.abs(k[i*3]-(clip.x+1)*w/2),Math.abs(k[i*3+1]-(1-clip.y)*h/2));valid[side]++;}else assert.deepEqual(k.slice(i*3,i*3+3),[0,0,0]);
      if(!inside)continue;
      const x=Math.min(w-1,Math.max(0,Math.floor((clip.x+1)*w/2))),y=Math.min(h-1,Math.max(0,Math.floor((1-clip.y)*h/2)));
      let hit=hitAt(camera,x,y,w,h),distance=Infinity;
      if(!hit)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=x+dx,b=y+dy;if(a<0||a>=w||b<0||b>=h)continue;const candidate=hitAt(camera,a,b,w,h),d=dx*dx+dy*dy;if(candidate&&d<distance){distance=d;hit=candidate;}}
      const tol=i===0?.035:(i-1)%4===0?.018:.009,pointDepth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z,surface=hit?-hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z:Infinity,visible=!hit||pointDepth-surface<=tol;
      if(manifest.occlusionPolicy.hands.startsWith('zero')&&Boolean(k[i*3+2])!==visible&&Math.abs(pointDepth-surface-tol)>.0005)handVisibilityMismatches++;
    }
  }
  results.push({view:view.id,foregroundPixels:foreground,surfaceSamples:viewSamples,visibleHandPoints:valid});
}
assert.ok(samples>25,`Need at least 26 surface samples; got ${samples}`);assert.ok(depthError<2,`linear depth error ${depthError}`);assert.ok(normalError<3,`normal encoding error ${normalError}`);assert.ok(keypointError<.001);assert.ok(worldError<1e-6);assert.equal(handVisibilityMismatches,0);
const report={views:results,samples,maximumDepthByteError:depthError,maximumNormalByteError:normalError,maximumHandProjectionErrorPixels:keypointError,maximumWorldErrorMetres:worldError,handVisibilityMismatches};
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
