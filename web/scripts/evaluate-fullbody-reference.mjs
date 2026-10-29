// Read-only solver evaluation. Pass a locally reviewed checkout of
// https://github.com/neka-nat/fullbody-pose-maker; no assets are downloaded.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import * as THREE from 'three';

const reference=process.argv[2];if(!reference)throw new Error('请提供 Fullbody Pose Maker 本地源码路径');
const compile=(name,dependencies)=>{
  const source=fs.readFileSync(path.join(reference,'lib',name+'.ts'),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const require=name=>{if(name==='three')return THREE;if(name in dependencies)return dependencies[name];throw new Error('Unexpected reference import: '+name);};
  vm.runInNewContext('(function(require,module,exports){'+code+'\n})(require,module,module.exports)',{require,module});return module.exports;
};
const fbx=compile('fbx',{}),{solveIK}=compile('ik',{'./fbx':fbx});
const profile=JSON.parse(fs.readFileSync(new URL('../public/models/xbot-profile.json',import.meta.url),'utf8'));
const root=new THREE.Group(),bones={};
for(const name of Object.keys(profile.bones)){bones[name]=new THREE.Bone();bones[name].name=name;}
for(const[name,b]of Object.entries(profile.bones)){
  bones[name].position.fromArray(b.position);
  if(b.parent){bones[name].position.sub(new THREE.Vector3().fromArray(profile.bones[b.parent].position));bones[b.parent].add(bones[name]);}else root.add(bones[name]);
}
root.updateMatrixWorld(true);
const names=['LeftHand','RightHand','LeftFoot','RightFoot'];
const starts=Object.fromEntries(names.map(n=>[n,bones[n].getWorldPosition(new THREE.Vector3())]));
const floor=starts.LeftFoot.y;
const targets={LeftHand:new THREE.Vector3(.12,1.02,.35),RightHand:new THREE.Vector3(-.30,1.46,-.12),LeftFoot:new THREE.Vector3(.14,floor,.22),RightFoot:new THREE.Vector3(-.18,floor,-.10)};
const times=[];
for(let frame=0;frame<90;frame++){
  const t=Math.min(1,(frame+1)/60),constraints=names.map(n=>({effector:bones[n],root:bones.Hips,target:starts[n].clone().lerp(targets[n],t),posWeight:1,rotWeight:0}));
  const start=performance.now();solveIK(constraints,6,.12,{rootStep:.15,rootClamp:.06,comSupport:[targets.LeftFoot,targets.RightFoot],comGain:.03,rotGain:.5});times.push(performance.now()-start);
}
root.updateMatrixWorld(true);
const errors=Object.fromEntries(names.map(n=>[n,bones[n].getWorldPosition(new THREE.Vector3()).distanceTo(targets[n])*1000]));
const knees=Object.fromEntries(['LeftLeg','RightLeg'].map(n=>{
  const q=bones[n].quaternion,hinge=2*Math.atan2(q.x,q.w),onlyHinge=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),hinge);
  return[n,{hingeDegrees:THREE.MathUtils.radToDeg(hinge),offHingeDegrees:THREE.MathUtils.radToDeg(q.angleTo(onlyHinge))}];
}));
times.sort((a,b)=>a-b);
const report={reference:'neka-nat/fullbody-pose-maker',commit:execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,threeRevision:THREE.REVISION,rig:profile.id,frames:90,iterationsPerFrame:6,scope:'CPU solver only; not browser frame rate',targetsMetres:Object.fromEntries(names.map(n=>[n,targets[n].toArray()])),endErrorsMillimetres:errors,knees,medianSolveMilliseconds:times[Math.floor(times.length/2)],maxSolveMilliseconds:times.at(-1)};
console.log(JSON.stringify(report,null,2));
