import {AnimationClip,AnimationMixer,Bone,LoopOnce,Matrix4,PropertyBinding,Quaternion,QuaternionKeyframeTrack,SkinnedMesh,Vector3,VectorKeyframeTrack,Object3D,type KeyframeTrack} from 'three';
import type {RigDefinition} from './rigs';
import type {PoseDocument,Vec3} from './types';
import {checkMotionAbort,type MotionSource} from './motionImport';

export const MOTION_ADAPTER_VERSION=1;
export const IMPORT_SAMPLE_RATE=30;
export const MAX_MOTION_SECONDS=120;
const MAX_SAMPLES=12_000;
export type ImportedMotionInfo={assetId:string;fileName:string;format:'fbx'|'glb';rig:string;rigVersion:number;adapterVersion:1;sampleRate:number;root:string;rootOrigin:Vec3;mappedBones:number;ignoredTranslations:number;reference:'skin-bind'|'node-rest'};
export const importedMotion=(clip:AnimationClip):ImportedMotionInfo|undefined=>{const value=clip.userData?.momoMotion;return value&&typeof value==='object'?value as ImportedMotionInfo:undefined;};
export function mixamoMotionName(name:string){
  const clean=name.replace(/^mixamorig\d*[:_]?/i,'');if(clean==='Spine2')return 'Chest';
  return clean.replace(/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([1-4])$/,(_,side,digit,n)=>`${side}${digit==='Pinky'?'Little':digit}${n}`);
}
const required=['Hips','Spine','Spine1','Chest','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];

/** Mixamo strategy: bind-world deltas bridge source bone axes to the editor's canonical axes. */
export async function retargetMixamoMotion(source:MotionSource,rig:RigDefinition,rest:PoseDocument,targetBones:Record<string,Bone>,assetId:string,fileName:string,signal?:AbortSignal){
  if(rig.motionImport!=='mixamo-human-v1')throw new Error('当前骨架尚未适配外部动画；请切换到人体骨架');
  if(source.clips.length>24)throw new Error('单个文件最多导入 24 段动画');
  const bones=new Map<string,Object3D>(),bindWorld=new Map<Object3D,Matrix4>();source.scene.updateMatrixWorld(true);
  source.scene.traverse(o=>{
    if(o instanceof Bone||rest.joints[mixamoMotionName(o.name)]){
      const name=mixamoMotionName(o.name),existing=bones.get(name);
      if(existing){
        // FBXLoader inserts same-ID leaf copies when two meshes share a joint.
        // Keep the outer animated Model; a second independent skeleton is rejected.
        const id=(o as Object3D&{ID?:number}).ID,existingId=(existing as Object3D&{ID?:number}).ID;
        let ancestor=o.parent;
        while(ancestor&&ancestor!==existing&&(ancestor as Object3D&{ID?:number}).ID===id&&mixamoMotionName(ancestor.name)===name&&!ancestor.userData.transformData)ancestor=ancestor.parent;
        if(!(source.format==='fbx'&&typeof id==='number'&&id===existingId&&ancestor===existing&&!o.userData.transformData))throw new Error(`源文件包含重复骨架：${name}`);
      }else bones.set(name,o);
    }
    if(o instanceof SkinnedMesh)o.skeleton.bones.forEach((b,i)=>{const matrix=o.skeleton.boneInverses[i]?.clone().invert();if(matrix&&!bindWorld.has(b))bindWorld.set(b,matrix);});
  });
  for(const name of required)if(!bones.has(name))throw new Error(`无法识别为 Mixamo 人体骨架：缺少 ${name}`);
  const mapped=Object.keys(rest.joints).filter(n=>bones.has(n)),virtual=!bones.has('UpperChest')?'UpperChest':null;
  for(const name of mapped){
    const actual=bones.get(name)!.parent;let expected=targetBones[name].parent;if(expected?.name===virtual)expected=expected.parent;
    const actualName=actual&&(actual instanceof Bone||bones.has(mixamoMotionName(actual.name)))?mixamoMotionName(actual.name):null,expectedName=expected instanceof Bone?expected.name:null;
    if(actualName!==expectedName)throw new Error(`源骨架层级不是受支持的 Mixamo 层级：${name}`);
  }
  // Recover bind locals using *all* actual parents, including an Armature group.
  // Skeleton.pose() assumes a root bone has no transformed non-bone parent.
  const originalWorld=new Map<Object3D,Matrix4>();bones.forEach(b=>originalWorld.set(b,b.matrixWorld.clone()));
  bones.forEach(b=>{const world=bindWorld.get(b);if(!world)return;const parent=b.parent instanceof Bone?(bindWorld.get(b.parent)??originalWorld.get(b.parent)!):b.parent?.matrixWorld??new Matrix4();parent.clone().invert().multiply(world).decompose(b.position,b.quaternion,b.scale);});
  source.scene.updateMatrixWorld(true);
  const bind=new Map([...bones].map(([name,b])=>[name,{position:b.getWorldPosition(new Vector3()),rotation:b.getWorldQuaternion(new Quaternion()).invert()}]));
  const locals=new Map<Object3D,{p:Vector3;q:Quaternion;s:Vector3}>();source.scene.traverse(o=>locals.set(o,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()}));
  const matrices=new Map<string,Matrix4>(),parents=new Map<string,string|null>(),order:string[]=[];
  const targetMatrix=(name:string):Matrix4=>{
    const cached=matrices.get(name);if(cached)return cached;const b=targetBones[name],j=rest.joints[name],parent=b.parent instanceof Bone?b.parent.name:null;
    const local=new Matrix4().compose(new Vector3().fromArray(j.position),new Quaternion().fromArray(j.quaternion),b.scale),world=(parent?targetMatrix(parent).clone():new Matrix4()).multiply(local);
    matrices.set(name,world);parents.set(name,parent);order.push(name);return world;
  };
  Object.keys(rest.joints).forEach(targetMatrix);
  const restWorldQ=new Map(order.map(name=>[name,new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(matrices.get(name)!))]));
  const extent=(ps:Vector3[])=>Math.max(...ps.map(p=>p.y))-Math.min(...ps.map(p=>p.y));
  const scale=extent(required.map(n=>new Vector3().setFromMatrixPosition(matrices.get(n)!)))/extent(required.map(n=>bind.get(n)!.position));
  if(!Number.isFinite(scale)||scale<1e-5||scale>1e5)throw new Error('源骨架单位或静止姿态无效');
  const restore=()=>{locals.forEach((s,o)=>{o.position.copy(s.p);o.quaternion.copy(s.q);o.scale.copy(s.s);});source.scene.updateMatrixWorld(true);};
  const mixer=new AnimationMixer(source.scene),result:AnimationClip[]=[];let sampleBudget=0;
  try{
    for(let index=0;index<source.clips.length;index++){
      checkMotionAbort(signal);const clip=source.clips[index];
      if(!Number.isFinite(clip.duration)||clip.duration<=0||clip.duration>MAX_MOTION_SECONDS)throw new Error('动画时长须大于 0，且不超过 120 秒');
      // KeyframeTrack stores Float32 times: deduplicate after that conversion so
      // a 30 Hz end key and a slightly rounded source duration cannot collide.
      const times=[...new Set(Float32Array.from(Array.from({length:Math.ceil(clip.duration*IMPORT_SAMPLE_RATE)+1},(_,i)=>Math.min(i/IMPORT_SAMPLE_RATE,clip.duration))))];
      sampleBudget+=times.length;if(sampleBudget>MAX_SAMPLES)throw new Error('动画文件采样总量过大，请拆分片段后导入');
      const usable:KeyframeTrack[]=[];let skeletal=false,ignoredTranslations=0;
      for(const track of clip.tracks){
        const parsed=PropertyBinding.parseTrackName(track.name),node=PropertyBinding.findNode(source.scene,parsed.nodeName);
        if(!(node instanceof Object3D))throw new Error(`动画引用了不存在的节点：${track.name}`);
        if(!['position','quaternion','scale'].includes(parsed.propertyName)||parsed.objectName||parsed.propertyIndex!==undefined)continue;
        const size=parsed.propertyName==='quaternion'?4:3;
        const cubic=!!(track as KeyframeTrack&{createInterpolant:{isInterpolantFactoryMethodGLTFCubicSpline?:boolean}}).createInterpolant?.isInterpolantFactoryMethodGLTFCubicSpline;
        if(!track.times.length||track.times.length>20_000||track.values.length!==track.times.length*size*(cubic?3:1)||!Array.from(track.times).every((t,i,a)=>Number.isFinite(t)&&t>=0&&t<=clip.duration+1e-3&&(i===0||t>a[i-1]))||!Array.from(track.values).every(Number.isFinite))throw new Error('动画采样时间或变换数据无效');
        const keyValues=cubic?Array.from(track.values).filter((_,i)=>Math.floor(i/size)%3===1):Array.from(track.values),tangents=cubic?Array.from(track.values).filter((_,i)=>Math.floor(i/size)%3!==1):[];
        if(parsed.propertyName==='quaternion')for(let i=0;i<keyValues.length;i+=4){const norm=keyValues.slice(i,i+4).reduce((s,v)=>s+v*v,0);if(Math.abs(norm-1)>.02)throw new Error('源动画包含无效旋转');}
        if(parsed.propertyName==='scale'&&(keyValues.some((v,i)=>Math.abs(v-keyValues[i%3])>1e-4)||tangents.some(v=>Math.abs(v)>1e-4)))throw new Error('首版暂不支持动画中改变骨骼缩放');
        if(bones.get(mixamoMotionName(node.name))===node&&mixamoMotionName(node.name)!==rig.root&&parsed.propertyName==='position'&&(keyValues.some((v,i)=>Math.abs(v-keyValues[i%3])>1e-3)||tangents.some(v=>Math.abs(v)>1e-3)))ignoredTranslations++;
        if(bones.get(mixamoMotionName(node.name))===node&&mapped.includes(mixamoMotionName(node.name))&&(parsed.propertyName==='quaternion'||parsed.propertyName==='position'&&mixamoMotionName(node.name)===rig.root))skeletal=true;
        usable.push(track);
      }
      if(!skeletal)throw new Error(`动画“${clip.name}”没有可映射的人体关节动作`);
      restore();const playable=new AnimationClip(clip.name,clip.duration,usable),action=mixer.clipAction(playable);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
      const values=new Map(order.map(n=>[n,new Float32Array(times.length*4)])),positions=new Float32Array(times.length*3),targetRoot=new Vector3().fromArray(rest.joints[rig.root].position);
      let first:Vector3|undefined;
      for(let frame=0;frame<times.length;frame++){
        checkMotionAbort(signal);action.enabled=true;action.paused=false;action.time=times[frame];mixer.update(0);action.paused=true;source.scene.updateMatrixWorld(true);
        const desired=new Map<string,Quaternion>();
        for(const name of order){
          const parent=parents.get(name),parentQ=parent?desired.get(parent)!:new Quaternion(),bone=bones.get(name);
          const world=bone?bone.getWorldQuaternion(new Quaternion()).multiply(bind.get(name)!.rotation).multiply(restWorldQ.get(name)!):parentQ.clone().multiply(new Quaternion().fromArray(rest.joints[name].quaternion));
          world.normalize();desired.set(name,world);parentQ.clone().invert().multiply(world).normalize().toArray(values.get(name)!,frame*4);
        }
        const root=bones.get(rig.root)!.getWorldPosition(new Vector3()).sub(bind.get(rig.root)!.position).multiplyScalar(scale);first??=root.clone();root.x-=first.x;root.z-=first.z;root.add(targetRoot);
        if(!root.toArray().every(v=>Number.isFinite(v)&&Math.abs(v)<=20))throw new Error('根部运动超出当前工程的 20 米坐标范围');
        root.toArray(positions,frame*3);
        if(frame%60===59)await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      mixer.stopAllAction();mixer.uncacheClip(playable);
      const tracks:KeyframeTrack[]=order.map(name=>new QuaternionKeyframeTrack(`${name}.quaternion`,times,values.get(name)!));tracks.push(new VectorKeyframeTrack(`${rig.root}.position`,times,positions));
      const converted=new AnimationClip((clip.name||`Clip ${index+1}`).slice(0,80),clip.duration,tracks);Object.assign(converted,{uuid:`${rig.id}@${rig.version}:${assetId}:${index}:v${MOTION_ADAPTER_VERSION}`});
      const info:ImportedMotionInfo={assetId,fileName:fileName.slice(0,120),format:source.format,rig:rig.id,rigVersion:rig.version,adapterVersion:1,sampleRate:IMPORT_SAMPLE_RATE,root:rig.root,rootOrigin:rest.joints[rig.root].position,mappedBones:mapped.length,ignoredTranslations,reference:bindWorld.size?'skin-bind':'node-rest'};
      converted.userData.momoMotion=info;result.push(converted);
    }
    return result;
  }finally{mixer.stopAllAction();mixer.uncacheRoot(source.scene);restore();}
}
