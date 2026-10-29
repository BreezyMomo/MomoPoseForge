import {OrthographicCamera,PerspectiveCamera,Vector3,Quaternion} from 'three';
import type {Vec3,Quat} from './types';

export type CameraPose={projection:'perspective'|'orthographic';position:Vec3;target:Vec3;quaternion:Quat;up:Vec3;fov:number;verticalSpan:number;zoom:number;near:number;far:number};
export type CameraBookmark={id:string;name:string;camera:CameraPose};
export type CameraSettings={locked:boolean;fov:number;view:string;active:CameraPose;framing:{locked:boolean;center:Vec3;verticalSpan:number};bookmarks:CameraBookmark[];output:{width:number;height:number}};
export const FRAME_PRESETS=[{name:'竖幅 · 3:4',width:768,height:1024},{name:'方形 · 1:1',width:1024,height:1024},{name:'横幅 · 4:3',width:1024,height:768},{name:'宽屏 · 16:9',width:1536,height:864},{name:'高清竖幅',width:1536,height:2048}];
export const validOutputSize=(width:number,height:number)=>Number.isInteger(width)&&Number.isInteger(height)&&width>=256&&height>=256&&width<=2048&&height<=2048;
export function defaultCameraSettings():CameraSettings{
  const camera=new PerspectiveCamera(35,1,.01,100),target=new Vector3(0,.85,0);camera.position.set(1.25,1.4,2.8);camera.lookAt(target);
  return {locked:false,fov:35,view:'free',active:captureCamera(camera,target,35),framing:{locked:false,center:[0,.85,0],verticalSpan:1.98},bookmarks:[],output:{width:768,height:1024}};
}
export function captureCamera(camera:PerspectiveCamera|OrthographicCamera,target:Vector3,fov:number):CameraPose{
  return {projection:camera instanceof PerspectiveCamera?'perspective':'orthographic',position:camera.position.toArray(),target:target.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),fov:camera instanceof PerspectiveCamera?camera.fov:fov,verticalSpan:camera instanceof OrthographicCamera?camera.top-camera.bottom:1.98,zoom:camera.zoom,near:camera.near,far:camera.far};
}
export function restoreCamera(pose:CameraPose,aspect:number){
  const half=pose.verticalSpan/2,camera=pose.projection==='perspective'?new PerspectiveCamera(pose.fov,aspect,pose.near,pose.far):new OrthographicCamera(-half*aspect,half*aspect,half,-half,pose.near,pose.far);
  camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.up.fromArray(pose.up);camera.zoom=pose.zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);return camera;
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const vec=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(x=>finite(x,-1_000_000,1_000_000));
export function validateCameraPose(p:unknown):p is CameraPose{
  if(!record(p)||!['perspective','orthographic'].includes(p.projection as string)||!vec(p.position,3)||!vec(p.target,3)||!vec(p.quaternion,4)||!vec(p.up,3)||!finite(p.fov,15,100)||!finite(p.verticalSpan,.05,50)||!finite(p.zoom,.1,20)||!finite(p.near,.001,10)||!finite(p.far,.01,1000)||p.far<=p.near)return false;
  const pose=p as unknown as CameraPose,q=new Quaternion().fromArray(pose.quaternion),up=new Vector3().fromArray(pose.up),direction=new Vector3().fromArray(pose.target).sub(new Vector3().fromArray(pose.position));
  return Math.abs(q.length()-1)<.0001&&Math.abs(up.length()-1)<.0001&&direction.length()>.001&&direction.normalize().dot(new Vector3(0,0,-1).applyQuaternion(q))>.999;
}
export function validateCameraSettings(c:unknown):c is CameraSettings{
  if(!record(c)||typeof c.locked!=='boolean'||!finite(c.fov,15,100)||typeof c.view!=='string'||!['free','front','oblique','side','high','low'].includes(c.view)||!validateCameraPose(c.active)||!record(c.framing)||typeof c.framing.locked!=='boolean'||!vec(c.framing.center,3)||!finite(c.framing.verticalSpan,.05,50)||!record(c.output)||!validOutputSize(c.output.width as number,c.output.height as number)||!Array.isArray(c.bookmarks)||c.bookmarks.length>12)return false;
  const ids=new Set<string>();
  return c.bookmarks.every(b=>{if(!record(b)||typeof b.id!=='string'||!b.id.trim()||b.id.length>80||ids.has(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>30||!validateCameraPose(b.camera))return false;ids.add(b.id);return true;});
}
