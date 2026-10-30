import {AnimationMixer,LoopOnce,type AnimationClip,type AnimationAction,type Object3D} from 'three';
import {importedMotion,type ImportedMotionInfo} from './mixamoMotion';

export type MotionState={clips:{id:string;name:string;duration:number;frames:number;imported?:ImportedMotionInfo}[];clip:string;active:boolean;playing:boolean;time:number;frame:number;speed:number;loop:boolean;inPlace:boolean};
/** Samples source key times rather than inventing a frame rate for an imported clip. */
export class MotionPreview {
  private mixer:AnimationMixer;
  private action?:AnimationAction;
  private selected?:AnimationClip;
  private samples=new Map<string,number[]>();
  private rawRoot?:[number,number,number];
  active=false;playing=false;time=0;speed=1;loop=true;inPlace=true;
  constructor(private root:Object3D,private clips:AnimationClip[]){
    this.clips=[...clips];
    this.mixer=new AnimationMixer(root);
    this.append([]);
  }
  append(clips:AnimationClip[]){
    for(const clip of clips)if(!this.clips.some(c=>c.uuid===clip.uuid))this.clips.push(clip);
    for(const clip of this.clips)if(!this.samples.has(clip.uuid))this.samples.set(clip.uuid,[...new Set(clip.tracks.flatMap(t=>Array.from(t.times)))].sort((a,b)=>a-b));
  }
  state():MotionState{
    const times=this.selected?this.samples.get(this.selected.uuid)??[]:[];
    const frame=times.reduce((best,t,i)=>Math.abs(t-this.time)<Math.abs(times[best]-this.time)?i:best,0);
    return {clips:this.clips.map(c=>({id:c.uuid,name:c.name,duration:c.duration,frames:this.samples.get(c.uuid)!.length,...(importedMotion(c)?{imported:importedMotion(c)}:{})})),clip:this.selected?.uuid??'',active:this.active,playing:this.playing,time:this.time,frame,speed:this.speed,loop:this.loop,inPlace:this.inPlace};
  }
  select(id:string){
    const clip=this.clips.find(c=>c.uuid===id);if(!clip)throw new Error('此动画不属于当前骨架');
    this.mixer.stopAllAction();this.rawRoot=undefined;this.selected=clip;this.time=0;this.playing=false;this.active=true;
    this.action=this.mixer.clipAction(clip);this.action.setLoop(LoopOnce,1);this.action.clampWhenFinished=true;this.action.play();this.sample(0);
  }
  sample(time:number){
    if(!this.selected||!this.action||!Number.isFinite(time))return;
    this.time=Math.max(0,Math.min(this.selected.duration,time));
    const info=importedMotion(this.selected),root=info?this.root.getObjectByName(info.root):undefined;
    if(root&&this.rawRoot)root.position.fromArray(this.rawRoot);
    this.action.enabled=true;this.action.paused=false;this.action.time=this.time;this.mixer.update(0);this.action.paused=true;
    if(root&&info){this.rawRoot=root.position.toArray();if(this.inPlace){root.position.x=info.rootOrigin[0];root.position.z=info.rootOrigin[2];}}
    this.root.updateMatrixWorld(true);
  }
  seekFrame(frame:number){const times=this.selected?this.samples.get(this.selected.uuid):undefined;if(times?.length){this.playing=false;this.sample(times[Math.max(0,Math.min(times.length-1,Math.round(frame)))]);}}
  play(value:boolean){if(!this.active)return;if(value&&this.time>=this.selected!.duration)this.sample(0);this.playing=value;}
  setInPlace(value:boolean){this.inPlace=value;if(this.active)this.sample(this.time);}
  tick(seconds:number){
    if(!this.playing||!this.selected)return false;
    let time=this.time+Math.max(0,Math.min(.1,seconds))*this.speed;
    if(time>this.selected.duration){if(this.loop)time%=this.selected.duration;else{time=this.selected.duration;this.playing=false;}}
    this.sample(time);return true;
  }
  stop(){this.playing=false;this.active=false;this.mixer.stopAllAction();this.action=undefined;this.rawRoot=undefined;}
  dispose(){this.stop();this.mixer.uncacheRoot(this.root);}
}
