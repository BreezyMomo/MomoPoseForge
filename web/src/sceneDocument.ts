import type {PoseDocument,ViewSlot} from './types';
import type {CameraSettings} from './cameraState';
import type {ReferenceImage} from './referenceImage';
import type {SceneProp} from './sceneProps';
import {DEFAULT_VIEWS} from './types';
import {documentRig} from './files';
import {requireRig} from './rigs';
import {Matrix4,Quaternion,Vector3} from 'three';
import {validViewSlots} from './viewCameras';
export const MAX_ACTORS=8;
export const SCENE_DRAFT_KEY='momo-pose-forge:scene-draft:v1';
export type SceneActor={id:string;name:string;visible:boolean;locked:boolean;pose:PoseDocument};
export type SceneDocument={format:'momo-pose-forge-scene';version:1;name:string;activeActor:string;actors:SceneActor[];views:ViewSlot[];camera?:CameraSettings;referenceImage?:ReferenceImage;props?:SceneProp[]};
export type ActorSummary={id:string;name:string;rig:string;rigVersion:number;visible:boolean;locked:boolean;position:[number,number,number];rotation:[number,number,number]};
export function actorPose(pose:PoseDocument):PoseDocument{const copy=structuredClone(pose);delete copy.camera;delete copy.referenceImage;delete copy.props;copy.views=structuredClone(DEFAULT_VIEWS);return copy;}
export function sceneFromPose(pose:PoseDocument):SceneDocument{return {format:'momo-pose-forge-scene',version:1,name:pose.name,activeActor:'actor-1',actors:[{id:'actor-1',name:requireRig(pose.rig).name,visible:true,locked:false,pose:actorPose(pose)}],views:structuredClone(pose.views),camera:structuredClone(pose.camera),referenceImage:structuredClone(pose.referenceImage),props:structuredClone(pose.props)};}
/** Structural validation here; every pose is validated against its own loaded rest rig later. */
export function readSceneDocument(text:string):SceneDocument{
  if(text.length>8_000_000)throw new Error('场景工程超过 8 MB');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('工程 JSON 无效');}
  if(!raw||typeof raw!=='object')throw new Error('场景工程无效');
  const doc=raw as SceneDocument;
  if((raw as PoseDocument).format==='momo-pose-forge'){documentRig(text);return sceneFromPose(raw as PoseDocument);}
  if(doc.format!=='momo-pose-forge-scene'||doc.version!==1||typeof doc.name!=='string'||!doc.name.trim()||doc.name.length>80||!Array.isArray(doc.actors)||doc.actors.length<1||doc.actors.length>MAX_ACTORS)throw new Error('场景格式、名称或角色数量无效');
  const ids=new Set<string>();
  for(const actor of doc.actors){if(!actor||typeof actor.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(actor.id)||ids.has(actor.id)||typeof actor.name!=='string'||!actor.name.trim()||actor.name.length>80||typeof actor.visible!=='boolean'||typeof actor.locked!=='boolean'||!actor.pose||actor.pose.format!=='momo-pose-forge'||actor.pose.version!==1)throw new Error('场景角色定义无效');ids.add(actor.id);const rig=requireRig(actor.pose.rig);if((actor.pose.rigVersion??1)!==rig.version)throw new Error('场景角色骨架版本不兼容');}
  if(!ids.has(doc.activeActor))throw new Error('场景缺少选中的角色');
  if(!validViewSlots(doc.views))throw new Error('五视图相机设置无效');
  return structuredClone(doc);
}
export function poseWithScene(pose:PoseDocument,scene:SceneDocument):PoseDocument{return {...pose,name:scene.name,views:structuredClone(scene.views),camera:structuredClone(scene.camera),referenceImage:structuredClone(scene.referenceImage),props:structuredClone(scene.props)};}
export function sceneHistory(doc:SceneDocument){const copy=structuredClone(doc);delete copy.referenceImage;return copy;}
export function relocatePose(pose:PoseDocument,root:PoseDocument['root']):PoseDocument{
  const copy=structuredClone(pose),matrix=(r:PoseDocument['root'])=>new Matrix4().compose(new Vector3().fromArray(r.position),new Quaternion().fromArray(r.quaternion),new Vector3(1,1,1)),delta=matrix(root).multiply(matrix(pose.root).invert()),rotation=new Quaternion().fromArray(root.quaternion).multiply(new Quaternion().fromArray(pose.root.quaternion).invert());
  for(const values of [copy.targets,copy.poles])for(const name of Object.keys(values))values[name]=new Vector3().fromArray(values[name]).applyMatrix4(delta).toArray();
  for(const pin of Object.values(copy.pins))if(pin){pin.position=new Vector3().fromArray(pin.position).applyMatrix4(delta).toArray();pin.quaternion=rotation.clone().multiply(new Quaternion().fromArray(pin.quaternion)).toArray();}
  copy.root=structuredClone(root);return copy;
}
