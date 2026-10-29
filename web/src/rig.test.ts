import {describe,it,expect} from 'vitest';
import {Bone,Group,Vector3,Quaternion,Euler,MathUtils} from 'three';
import {solveTwoBone,solveLimbRotations} from './math';
import {PRESETS} from './presets';
import rig from '../public/models/xbot-profile.json';
import type {Effector,Vec3} from './types';

const profile=rig as {bones:Record<string,{parent:string|null;position:number[]}>;hingeAxes:Record<string,number[]>};
const chains:Record<Effector,[string,string,string]>={LeftHand:['LeftArm','LeftForeArm','LeftHand'],RightHand:['RightArm','RightForeArm','RightHand'],LeftFoot:['LeftUpLeg','LeftLeg','LeftFoot'],RightFoot:['RightUpLeg','RightLeg','RightFoot']};
function makeRig(){
  const root=new Group(),bones:Record<string,Bone>={};
  for(const name of Object.keys(profile.bones)){bones[name]=new Bone();bones[name].name=name;}
  for(const[name,b]of Object.entries(profile.bones)){bones[name].position.fromArray(b.position);if(b.parent){bones[name].position.sub(new Vector3().fromArray(profile.bones[b.parent].position));bones[b.parent].add(bones[name]);}else root.add(bones[name]);}
  root.updateMatrixWorld(true);return{root,bones};
}
const world=(b:Bone)=>b.getWorldPosition(new Vector3());
function solve(bones:Record<string,Bone>,end:Effector,target:Vector3,pole:Vector3){
  const[a,b,c]=chains[end],A=world(bones[a]),B=world(bones[b]),C=world(bones[c]),max=end.endsWith('Foot')?150:155;
  const result=solveTwoBone(A,target,pole,A.distanceTo(B),B.distanceTo(C),max);
  const hinge=new Vector3().fromArray(profile.hingeAxes[b]);
  const rotations=solveLimbRotations(bones[b].position,bones[c].position,hinge,result.elbow.clone().sub(A),result.end.clone().sub(result.elbow),max);
  const parent=bones[a].parent!.getWorldQuaternion(new Quaternion());bones[a].quaternion.copy(parent.invert().multiply(rotations.upperWorld));bones[a].updateWorldMatrix(false,true);
  bones[b].quaternion.copy(rotations.lowerLocal);bones[b].updateWorldMatrix(false,true);
  expect(world(bones[c]).distanceTo(result.end)).toBeLessThan(.00002);
  expect(world(bones[b]).distanceTo(result.elbow)).toBeLessThan(.00002);
  expect(rotations.flexion).toBeGreaterThanOrEqual(-1e-7);expect(rotations.flexion).toBeLessThanOrEqual(MathUtils.degToRad(max)+1e-7);
  const q=bones[b].quaternion,axis=new Vector3(q.x,q.y,q.z);
  expect(axis.clone().cross(hinge).length()).toBeLessThan(1e-6);
  return rotations;
}

describe('X Bot 肘膝只沿模型的正向铰链弯曲',()=>{
  for(const preset of PRESETS)it(`${preset.name}的四条肢体均保持正确铰链和骨长`,()=>{
    const{root,bones}=makeRig();bones.Hips.position.y-=preset.drop??0;bones.Spine.quaternion.setFromEuler(new Euler(preset.lean??0,preset.twist??0,0));root.updateMatrixWorld(true);
    const floor=profile.bones.LeftFoot.position[1];
    const defaults:Record<Effector,Vec3>={LeftHand:[.235,.93,.02],RightHand:[-.235,.93,.02],LeftFoot:[.14,floor,0],RightFoot:[-.14,floor,0]};
    for(const end of Object.keys(chains) as Effector[]){const t:Vec3=[...(preset.hands?.[end]??preset.feet?.[end]??defaults[end])];if(preset.feet?.[end])t[1]=floor+t[1]-.1;if(end.endsWith('Foot')&&(preset.ground??true))t[1]=Math.max(floor,t[1]);
      const pole=preset.poles?.[end]?new Vector3().fromArray(preset.poles[end]!):end.endsWith('Foot')?new Vector3(end.startsWith('Left')?.35:-.35,.4,.8):world(bones[chains[end][1]]).add(new Vector3(0,0,-.65));
      solve(bones,end,new Vector3().fromArray(t),pole);
    }
  });
  it('自然垂臂时手肘位于手腕后方，不能向前反折',()=>{
    const{bones}=makeRig();for(const side of ['Left','Right'] as const){const end=`${side}Hand` as Effector;solve(bones,end,new Vector3(side==='Left'?.235:-.235,.93,.02),world(bones[`${side}ForeArm`]).add(new Vector3(0,0,-.65)));expect(world(bones[`${side}ForeArm`]).z).toBeLessThan(world(bones[end]).z);}
  });
  it('拖过手臂上下与伸直附近时不会产生负屈曲角或累积扭转',()=>{
    const{bones}=makeRig(),pole=new Vector3(.4,1.3,-.65);
    for(let i=0;i<=100;i++){const t=i/100;solve(bones,'LeftHand',new Vector3(.235+.35*Math.sin(t*Math.PI),.93+.85*t,.02+.1*Math.sin(t*Math.PI*2)),pole);}
  });
});
