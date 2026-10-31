// Original drawing mannequin geometry. No source character meshes or images are
// embedded. Rebuild with: node tools/build-drawing-mannequin.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {Bone,Box3,BufferGeometry,Float32BufferAttribute,Group,Matrix4,MeshStandardMaterial,Skeleton,SkinnedMesh,SphereGeometry,Uint16BufferAttribute,Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'web/public/models/drawing-mannequin'),blockout=process.argv.includes('--blockout');
await fs.mkdir(out,{recursive:true});
const definitions={};
const joint=(name,parent,position)=>{definitions[name]={parent,position};};
joint('Hips',null,[0,.99,0]);
for(const [n,p,y,z]of [['Spine','Hips',1.085,0],['Spine1','Spine',1.18,0],['Chest','Spine1',1.28,0],['UpperChest','Chest',1.39,0],['Neck','UpperChest',1.48,0],['Head','Neck',1.56,0],['HeadTop_End','Head',1.775,0]])joint(n,p,[0,y,z]);
for(const [side,s]of [['Left',1],['Right',-1]]){
  for(const[n,p,x,y,z]of [['Shoulder','UpperChest',.065,1.4,0],['Arm',side+'Shoulder',.18,1.4,0],['ForeArm',side+'Arm',.46,1.4,-.005],['Hand',side+'ForeArm',.72,1.4,0],['UpLeg','Hips',.105,.945,0],['Leg',side+'UpLeg',.105,.53,.015],['Foot',side+'Leg',.105,.105,-.015],['ToeBase',side+'Foot',.105,.033,.13],['Toe_End',side+'ToeBase',.105,.025,.22]])joint(side+n,p,[s*x,y,z]);
  for(const [digit,x,z,lengths]of [['Index',.785,.036,[.031,.024,.018]],['Middle',.79,.010,[.036,.027,.020]],['Ring',.785,-.018,[.033,.025,.019]],['Little',.774,-.043,[.025,.020,.016]]]){
    let px=x;for(let j=1;j<=4;j++){if(j>1)px+=lengths[j-2];joint(side+digit+j,j===1?side+'Hand':side+digit+(j-1),[s*px,1.4,z]);}
  }
  for(let j=1;j<=4;j++)joint(side+'Thumb'+j,j===1?side+'Hand':side+'Thumb'+(j-1),[s*(.738+(j-1)*.026),1.388,.047+(j-1)*.015]);
}
const names=Object.keys(definitions),index=new Map(names.map((n,i)=>[n,i])),bones=Object.fromEntries(names.map(n=>{const b=new Bone();b.name=n;return [n,b];})),scene=new Group();scene.name='MomoDrawingMannequin';
for(const n of names){const d=definitions[n],p=new Vector3().fromArray(d.position);if(d.parent){bones[n].position.copy(p.sub(new Vector3().fromArray(definitions[d.parent].position)));bones[d.parent].add(bones[n]);}else{bones[n].position.copy(p);scene.add(bones[n]);}}
scene.updateMatrixWorld(true);const skeleton=new Skeleton(names.map(n=>bones[n]));skeleton.calculateInverses();
const clay=new MeshStandardMaterial({name:'Ivory clay',color:'#e6dfd3',roughness:.82,metalness:0}),jointMat=new MeshStandardMaterial({name:'Joint clay',color:'#d8d1c5',roughness:.88,metalness:0}),parts=new Map();
const point=n=>new Vector3().fromArray(definitions[n].position);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),smooth=t=>t*t*(3-2*t);
function skin(g,weights){
  g.deleteAttribute('uv');g.deleteAttribute('uv1');const ids=[],values=[],positions=g.getAttribute('position');
  for(let i=0;i<positions.count;i++){const w=weights(new Vector3().fromBufferAttribute(positions,i)),sum=w.reduce((a,v)=>a+v[1],0);for(let k=0;k<4;k++){ids.push(index.get(w[k]?.[0]??names[0]));values.push(w[k]?w[k][1]/sum:0);}}
  g.setAttribute('skinIndex',new Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new Float32BufferAttribute(values,4));return g;
}
function add(group,g,weights,material=clay){if(!parts.has(group))parts.set(group,{geometries:[],material});parts.get(group).geometries.push(skin(g,weights));}
function ellipsoid(group,center,size,bone,material=clay,reshape,weights){
  const g=new SphereGeometry(1,group==='Hands'?12:32,group==='Hands'?8:24),p=g.getAttribute('position');for(let i=0;i<p.count;i++){const v=new Vector3().fromBufferAttribute(p,i);if(reshape)reshape(v);v.multiply(new Vector3(...size)).add(center);p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();add(group,g,weights??(()=>[[bone,1]]),material);
}
function loft(centers,radii,weights,group,radial=32){
  const vertices=[],indices=[];
  for(let i=0;i<centers.length;i++){
    const axis=centers[Math.min(i+1,centers.length-1)].clone().sub(centers[Math.max(0,i-1)]).normalize(),u=(Math.abs(axis.x)>.8?new Vector3(0,0,1):new Vector3(1,0,0));u.addScaledVector(axis,-u.dot(axis)).normalize();const v=new Vector3().crossVectors(axis,u).normalize();
    for(let j=0;j<=radial;j++){const a=j/radial*Math.PI*2,p=centers[i].clone().addScaledVector(u,Math.cos(a)*radii[i][0]).addScaledVector(v,Math.sin(a)*radii[i][1]);vertices.push(...p.toArray());}
  }
  for(let i=0;i<centers.length-1;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+radial+1;indices.push(a,a+1,b,a+1,b+1,b);}
  const first=vertices.length/3;vertices.push(...centers[0].toArray(),...centers.at(-1).toArray());for(let j=0;j<radial;j++){indices.push(first,j+1,j);const a=(centers.length-1)*(radial+1)+j;indices.push(first+1,a,a+1);}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();add(group,g,weights);
}
function interpolate(keys,t){const i=Math.min(keys.length-2,Math.floor(t*(keys.length-1))),f=t*(keys.length-1)-i,a=keys[Math.max(0,i-1)],b=keys[i],c=keys[i+1],d=keys[Math.min(keys.length-1,i+2)];return b.map((v,k)=>.5*((2*v)+(-a[k]+c[k])*f+(2*a[k]-5*v+4*c[k]-d[k])*f*f+(-a[k]+3*v-3*c[k]+d[k])*f*f*f));}
function segment(group,start,end,profile,bone){const a=point(start),b=point(end),centers=[],radii=[],steps=group==='Hands'?6:24;for(let i=0;i<=steps;i++){const t=i/steps,r=interpolate(profile,t);centers.push(a.clone().lerp(b,t));radii.push([Math.max(.003,r[0]),Math.max(.003,r[1])]);}loft(centers,radii,()=>[[bone,1]],group,group==='Hands'?12:32);}

// Continuous closed torso: sculpted cross sections and distributed spine skin.
const sections=[[.86,.050,.043,0],[.885,.105,.075,0],[.925,.166,.112,-.008],[.965,.177,.119,-.012],[1.005,.153,.104,-.007],[1.055,.125,.088,0],[1.105,.110,.077,0],[1.155,.113,.079,.002],[1.205,.127,.087,.003],[1.255,.144,.098,.003],[1.305,.152,.100,0],[1.355,.153,.088,-.003],[1.4,.150,.066,-.006],[1.435,.100,.049,-.006],[1.46,.045,.043,-.006]],positions=[],triangles=[],rows=96,cols=64;
for(let i=0;i<=rows;i++){const [y,rx,rz,cz]=interpolate(sections,i/rows);for(let j=0;j<=cols;j++){const a=j/cols*Math.PI*2,x=rx*Math.sin(a),front=Math.cos(a),breast=.068*Math.exp(-(((Math.abs(x)-.074)/.058)**2+((y-1.297)/.062)**2))*Math.max(0,front)**2,butt=.027*Math.exp(-(((Math.abs(x)-.083)/.075)**2+((y-.947)/.06)**2))*Math.max(0,-front)**2;positions.push(x,y,cz+rz*front+breast-butt);}}
for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){const a=i*(cols+1)+j,b=a+cols+1;triangles.push(a,a+1,b,a+1,b+1,b);}
const bottom=positions.length/3;positions.push(0,.86,0,0,1.46,-.006);for(let j=0;j<cols;j++){triangles.push(bottom,j+1,j);const a=rows*(cols+1)+j;triangles.push(bottom+1,a,a+1);}
const torso=new BufferGeometry();torso.setAttribute('position',new Float32BufferAttribute(positions,3));torso.setIndex(triangles);torso.computeVertexNormals();
const spine=[['Hips',1.005],['Spine',1.095],['Spine1',1.18],['Chest',1.28],['UpperChest',1.395]];
const torsoWeights=p=>{if(p.y<=spine[0][1])return [['Hips',1]];for(let i=1;i<spine.length;i++)if(p.y<=spine[i][1]){const t=smooth((p.y-spine[i-1][1])/(spine[i][1]-spine[i-1][1]));return [[spine[i-1][0],1-t],[spine[i][0],t]];}return [['UpperChest',1]];};
add('Body',torso,torsoWeights);
// Intersecting smooth bust forms provide a readable under-bust contour for the
// drawing mannequin. They use the same distributed chest skin as the torso.
for(const s of [-1,1])ellipsoid('Bust',new Vector3(s*.073,1.295,.108),[.084,.086,.070],'Chest',clay,v=>{v.x*=1-.10*Math.max(v.y,0);v.z*=1-.30*Math.max(v.y,0);v.z-=.20*v.y;},torsoWeights);
ellipsoid('Head',new Vector3(0,1.657,.006),[.104,.118,.087],'Head',clay,v=>{if(v.y<0){v.x*=.90+.10*(1+v.y);v.z*=.94+.06*(1+v.y);}v.z+=.025*(1-v.y*v.y);});
const neckCenters=[],neckRadii=[];for(let i=0;i<=16;i++){const [y,r]=interpolate([[1.433,.052],[1.46,.043],[1.49,.036],[1.53,.033],[1.55,.032]],i/16);neckCenters.push(new Vector3(0,y,0));neckRadii.push([r,r]);}loft(neckCenters,neckRadii,p=>{const t=smooth(clamp((p.y-1.44)/.07,0,1));return [['UpperChest',1-t],['Neck',t]];},'Neck');
for(const [side,s]of [['Left',1],['Right',-1]]){
  ellipsoid('Joints',point(side+'Arm'),[.052,.052,.052],side+'Shoulder',jointMat);
  ellipsoid('Joints',point(side+'ForeArm'),[.034,.034,.034],side+'Arm',jointMat);
  ellipsoid('Joints',point(side+'Hand'),[.024,.024,.024],side+'ForeArm',jointMat);
  ellipsoid('Joints',point(side+'UpLeg'),[.072,.072,.072],'Hips',jointMat);
  ellipsoid('Joints',point(side+'Leg'),[.049,.049,.049],side+'UpLeg',jointMat);
  ellipsoid('Joints',point(side+'Foot'),[.031,.031,.031],side+'Leg',jointMat);
  segment('UpperArms',side+'Arm',side+'ForeArm',[[.043,.043],[.052,.049],[.050,.047],[.039,.037],[.030,.030]],side+'Arm');
  segment('Forearms',side+'ForeArm',side+'Hand',[[.030,.030],[.043,.040],[.039,.035],[.028,.026],[.021,.021]],side+'ForeArm');
  segment('Thighs',side+'UpLeg',side+'Leg',[[.065,.065],[.093,.096],[.093,.098],[.070,.074],[.043,.043]],side+'UpLeg');
  segment('Shins',side+'Leg',side+'Foot',[[.043,.043],[.064,.068],[.061,.066],[.040,.043],[.027,.027]],side+'Leg');
  ellipsoid('Hands',point(side+'Hand').add(new Vector3(s*.041,-.002,0)),[.067,.021,.046],side+'Hand');
  for(const digit of ['Thumb','Index','Middle','Ring','Little'])for(let j=1;j<=3;j++){
    const n=side+digit+j,r=(digit==='Thumb'?.010:digit==='Little'?.007:.0085)*(1-(j-1)*.10);segment('Hands',n,side+digit+(j+1),[[r,r],[r,r],[r*.90,r*.90]],n);ellipsoid('Hands',point(n),[r,r,r],n);if(j===3)ellipsoid('Hands',point(side+digit+'4'),[r*.86,r*.86,r*.86],n);
  }
  const foot=point(side+'Foot'),footSections=[[-.055,.023,.025,.032],[-.025,.039,.042,.044],[.035,.042,.036,.038],[.11,.053,.024,.025],[.17,.051,.021,.022],[.218,.018,.017,.018]],fv=[],fi=[],fr=36;
  for(let i=0;i<=36;i++){const [z,rx,ry,cy]=interpolate(footSections,i/36);for(let j=0;j<=fr;j++){const a=j/fr*Math.PI*2;fv.push(foot.x+rx*Math.cos(a),Math.max(0,cy+ry*Math.sin(a)-.001),z);}}
  for(let i=0;i<36;i++)for(let j=0;j<fr;j++){const a=i*(fr+1)+j,b=a+fr+1;fi.push(a,a+1,b,a+1,b+1,b);}const fbottom=fv.length/3;fv.push(foot.x,.032,-.055,foot.x,.018,.218);for(let j=0;j<fr;j++){fi.push(fbottom,j+1,j);const a=36*(fr+1)+j;fi.push(fbottom+1,a,a+1);}
  const fg=new BufferGeometry();fg.setAttribute('position',new Float32BufferAttribute(fv,3));fg.setIndex(fi);fg.computeVertexNormals();add('Feet',fg,p=>{const t=smooth(clamp((p.z-.105)/.06,0,1));return [[side+'Foot',1-t],[side+'ToeBase',t]];});
}
if(!blockout){
  const data=JSON.parse(gunzipSync(await fs.readFile(path.join(root,'assets/source/drawing-mannequin/torso.json.gz'))).toString('utf8'));
  for(const name of ['Body','Bust','Neck']){for(const g of parts.get(name).geometries)g.dispose();parts.delete(name);}
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(data.positions,3));geometry.setIndex(data.indices);geometry.computeVertexNormals();
  const controls=[...spine,['Neck',1.52]];
  add('Body',geometry,p=>{if(p.y<=controls[0][1])return [['Hips',1]];for(let i=1;i<controls.length;i++)if(p.y<=controls[i][1]){const t=smooth((p.y-controls[i-1][1])/(controls[i][1]-controls[i-1][1]));return [[controls[i-1][0],1-t],[controls[i][0],t]];}return [['Neck',1]];});
}
let vertices=0,faces=0;
for(const [name,{geometries,material}]of parts){const g=mergeGeometries(geometries,false);if(!g)throw new Error('Could not merge '+name);vertices+=g.getAttribute('position').count;faces+=g.index.count/3;const mesh=new SkinnedMesh(g,material);mesh.name=name;mesh.castShadow=true;mesh.frustumCulled=false;scene.add(mesh);mesh.bind(skeleton,new Matrix4());for(const p of geometries)p.dispose();}
scene.updateMatrixWorld(true);const box=new Box3().setFromObject(scene,true);
if(Math.abs(box.min.y)>.0001||Math.abs(box.max.y-1.775)>.002)throw new Error('Unexpected mannequin height: '+JSON.stringify([box.min.toArray(),box.max.toArray()]));
globalThis.FileReader=class{result=null;onloadend=null;async readAsArrayBuffer(blob){this.result=await blob.arrayBuffer();this.onloadend?.();}async readAsDataURL(blob){this.result='data:application/octet-stream;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onloadend?.();}};
const glb=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true}),destination=blockout?path.join(root,'artifacts/drawing-blockout.glb'):path.join(out,'drawing-female.glb');await fs.writeFile(destination,Buffer.from(glb));
const profile={id:'momo-drawing-female-v1',name:'绘画女素体',version:1,rigVersion:1,rigCalibrationVersion:2,height:1.775,units:'metres',forward:'+Z',up:'+Y',restRotation:'identity',handCurlNormalSign:-1,license:'Original MomoPoseForge procedural geometry',bones:definitions,hingeAxes:{LeftForeArm:[0,-1,0],RightForeArm:[0,1,0],LeftLeg:[1,0,0],RightLeg:[1,0,0]},headAnchors:{nose:[0,.095,.094],leftEye:[.03,.125,.080],rightEye:[-.03,.125,.080],leftEar:[.09,.095,0],rightEar:[-.09,.095,0]},mesh:{vertices,triangles:faces,bones:names.length,meshes:parts.size},source:{generator:'tools/build-drawing-mannequin.mjs + tools/refine-drawing-mannequin.py',geometry:'Self-authored lofts refined by Blender voxel union, smoothing and topology reduction; no third-party character mesh or reference image data embedded',notes:'Single closed spine-weighted shoulder/neck/torso/pelvis surface, faceless oval head, joint-centered mechanical balls. Not cloth, muscle or soft-body simulation.'}};
if(!blockout)await fs.writeFile(path.join(out,'drawing-female-profile.json'),JSON.stringify(profile,null,2)+'\n');console.log(JSON.stringify({file:destination,...profile.mesh,bytes:glb.byteLength,bounds:{min:box.min.toArray(),max:box.max.toArray()}},null,2));
