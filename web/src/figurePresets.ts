import {Euler,MathUtils,Matrix4,Quaternion,Vector3} from 'three';
import type {Preset,Side,Vec3} from './types';
import {restFrames} from './restFrames';
import {solveRigChain,type ArticulatedRig} from './articulatedIK';
import {fingerBone,handBone} from './handRig';

// Measured landmarks of the canonical X Bot recipe coordinate system.
const REFERENCE={height:1.8,pelvisY:.9801397123,shoulderY:1.3539736862,armLength:.5277767,footY:.1};

/** Human intent is mapped to this figure's own landmarks and reach, never by
 * copying X Bot joint quaternions into nonidentity Rigify bind frames. */
export function applyFigurePreset(state:ArticulatedRig,preset:Preset){
  const {rig,bones,model,rest}=state,height=rig.figureHeight!;
  if(preset.id==='neutral')return {} as Record<string,Vec3>;
  const frames=restFrames(model,rest),point=(name:string)=>new Vector3().setFromMatrixPosition(frames.get(bones[name])!),scale=height/REFERENCE.height;
  const pelvis=point(rig.root),rotate=(name:string,angles:[number,number,number])=>{
    const bind=new Quaternion().setFromRotationMatrix(frames.get(bones[name])!),delta=new Quaternion().setFromEuler(new Euler(...angles));
    bones[name].quaternion.fromArray(rest.joints[name].quaternion).multiply(bind.clone().invert().multiply(delta).multiply(bind));
  };
  const root=bones[rig.root],desired=model.localToWorld(pelvis.clone().add(new Vector3(0,-(preset.drop??0)*scale,0)));root.position.copy(root.parent!.worldToLocal(desired));
  for(const name of ['waist','spine','chest'])rotate(name,[name==='waist'?preset.lean??0:0,(preset.twist??0)/3,0]);
  rotate('head',[0,preset.head??0,0]);model.updateMatrixWorld(true);
  const poles:Record<string,Vec3>={};
  for(const limb of ['foot','hand'] as const)for(const side of ['Left','Right'] as const){
    const prefix=side.toLowerCase(),sign=side==='Left'?1:-1;
    const end=`${prefix}_${limb}`,chain=rig.chains[end],isHand=limb==='hand',source=preset[isHand?'hands':'feet']?.[`${side}${isHand?'Hand':'Foot'}`];
    const shoulder=point(chain[0]),middle=point(chain[1]),tip=point(end),upperLength=shoulder.distanceTo(middle),lowerLength=middle.distanceTo(tip),length=upperLength+lowerLength,armScale=length/REFERENCE.armLength;
    const handY=(y:number)=>shoulder.y-(preset.drop??0)*scale+(y-REFERENCE.shoulderY+(preset.drop??0))*armScale;
    let target=source?new Vector3(source[0]*scale,isHand?handY(source[1]):tip.y+(source[1]-REFERENCE.footY)*scale,source[2]*scale+pelvis.z):isHand?new Vector3(sign*.235*scale,handY(.93),.02*scale+pelvis.z):tip.clone();
    if(preset.id==='t-pose'&&isHand)target=shoulder.clone().add(new Vector3(sign*length*.997,0,0));
    if(preset.id==='hip'&&isHand&&side==='Left')target.set(.17*scale,pelvis.y+(shoulder.y-pelvis.y)*.42,pelvis.z+.015*scale);
    if(['sit','sit-lean'].includes(preset.id)&&isHand)target=model.worldToLocal(bones[`${prefix}_shin`].getWorldPosition(new Vector3())).add(new Vector3(0,.07*scale,.015*scale));
    if(preset.id==='squat'&&isHand)target.set(sign*.23*scale,pelvis.y-(preset.drop??0)*scale+.35*scale,pelvis.z+.5*scale);
    const start=bones[chain[0]].getWorldPosition(new Vector3()),worldTarget=model.localToWorld(target),direction=worldTarget.clone().sub(start);
    const maximum=length*.997,minimum=Math.sqrt(upperLength**2+lowerLength**2+2*upperLength*lowerLength*Math.cos(MathUtils.degToRad(isHand?152:147)));
    if(direction.length()>maximum)worldTarget.copy(start).addScaledVector(direction.normalize(),maximum);
    else if(direction.length()<minimum)worldTarget.copy(start).addScaledVector(direction.lengthSq()>1e-12?direction.normalize():new Vector3(0,-1,0),minimum);
    const sourcePole=preset.poles?.[`${side}${isHand?'Hand':'Foot'}`];
    const pole=model.localToWorld(sourcePole?new Vector3(sourcePole[0]*scale,isHand?handY(sourcePole[1]):pelvis.y+(sourcePole[1]-REFERENCE.pelvisY)*scale,sourcePole[2]*scale+pelvis.z):new Vector3(sign*(isHand ? .42 : .16)*scale,isHand?shoulder.y-(preset.drop??0)*scale-.4*scale:.4*scale,isHand?(['sit','sit-lean','squat'].includes(preset.id) ? .4 : -.2):1));
    solveRigChain(state,end,worldTarget,undefined,pole);poles[end]=pole.toArray();
    if(isHand&&['wave','raise'].includes(preset.id)&&(preset.id==='raise'||side==='Left'))orientFigureHand(state,side,new Vector3(0,1,0),new Vector3(0,0,1));
    else if(isHand&&preset.id==='hip'&&side==='Left')orientFigureHand(state,side,new Vector3(0,-1,0),new Vector3(-1,0,0));
    else if(isHand){
      const along=bones[end].getWorldPosition(new Vector3()).sub(bones[chain[1]].getWorldPosition(new Vector3())).normalize().applyQuaternion(model.getWorldQuaternion(new Quaternion()).invert());
      const palm=preset.id==='cross'?new Vector3(0,0,-1):Math.abs(along.y)>.7?new Vector3(-sign,0,0):new Vector3(0,-1,0);orientFigureHand(state,side,along,palm);
    }
  }
  return poles;
}
function orientFigureHand(state:ArticulatedRig,side:Side,up:Vector3,front:Vector3){
  const {rig,bones,model}=state,wrist=bones[handBone(rig,side)],origin=wrist.getWorldPosition(new Vector3());
  const along=bones[fingerBone(rig,side,'Middle',1)].getWorldPosition(new Vector3()).sub(origin).normalize();
  const index=bones[fingerBone(rig,side,'Index',1)].getWorldPosition(new Vector3()).sub(origin),little=bones[fingerBone(rig,side,'Little',1)].getWorldPosition(new Vector3()).sub(origin);
  const normal=new Vector3().crossVectors(index,little).normalize().multiplyScalar(side==='Left'?-1:1),right=new Vector3().crossVectors(along,normal).normalize();normal.crossVectors(right,along).normalize();
  const current=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right,along,normal));
  const modelQ=model.getWorldQuaternion(new Quaternion());up.applyQuaternion(modelQ);front.applyQuaternion(modelQ);
  up.normalize();front.addScaledVector(up,-front.dot(up));if(front.lengthSq()<1e-8){front.set(0,0,1).applyQuaternion(modelQ);front.addScaledVector(up,-front.dot(up));}front.normalize();
  const desired=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(up,front).normalize(),up,front));
  const rotation=desired.multiply(current.invert()).multiply(wrist.getWorldQuaternion(new Quaternion()));
  wrist.quaternion.copy(wrist.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));wrist.updateWorldMatrix(false,true);
}
