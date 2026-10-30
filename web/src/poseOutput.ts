import {Camera,Vector3} from 'three';
import {DIGITS,type Side} from './types';
import {projectPoint} from './math';
import {decodePackedDepth,type DepthRange} from './renderPasses';

export const BODY_NAMES=['nose','neck','rightShoulder','rightElbow','rightWrist','leftShoulder','leftElbow','leftWrist','rightHip','rightKnee','rightAnkle','leftHip','leftKnee','leftAnkle','rightEye','leftEye','rightEar','leftEar'];
export const COCO_LINKS=[[1,2],[1,5],[2,3],[3,4],[5,6],[6,7],[1,8],[8,9],[9,10],[1,11],[11,12],[12,13],[1,0],[0,14],[14,16],[0,15],[15,17]];
export const COCO_COLORS=['#ff0000','#ff5500','#ffaa00','#ffff00','#aaff00','#55ff00','#00ff00','#00ff55','#00ffaa','#00ffff','#00aaff','#0055ff','#0000ff','#5500ff','#aa00ff','#ff00ff','#ff00aa','#ff0055'];
export const HAND_LINKS=Array.from({length:5},(_,digit)=>{const base=1+digit*4;return [[0,base],[base,base+1],[base+1,base+2],[base+2,base+3]];}).flat();
export const HAND_NAMES=['wrist',...DIGITS.flatMap(d=>[1,2,3,4].map(n=>`${d.toLowerCase()}${n}`))];
export const handBones=(side:Side)=>[`${side}Hand`,...DIGITS.flatMap(d=>[1,2,3,4].map(n=>`${side}${d}${n}`))];
export type WorldPose={body:Vector3[];Left:Vector3[];Right:Vector3[]};
export type OpenPoseFrame=ReturnType<typeof projectPose>;
export const handTolerance=(index:number)=>index===0?.035:(index-1)%4===0?.018:.009;
export function depthVisibility(pixels:Uint8Array,camera:Camera,width:number,height:number,range:DepthRange){
  return (point:Vector3,index:number)=>{
    const p=projectPoint(point,camera,width,height);if(!p.valid)return false;
    const x=Math.min(width-1,Math.max(0,Math.floor(p.x))),y=Math.min(height-1,Math.max(0,Math.floor(p.y)));
    const sample=(a:number,b:number)=>{const i=((height-1-b)*width+a)*4;return decodePackedDepth(pixels[i],pixels[i+1],pixels[i+2],range);};
    let surface=sample(x,y);
    if(surface===null){let distance=Infinity;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const a=x+dx,b=y+dy;if(a<0||a>=width||b<0||b>=height)continue;const value=sample(a,b),d=dx*dx+dy*dy;if(value!==null&&d<distance){distance=d;surface=value;}
    }}
    const depth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z;
    return surface===null||depth-surface<=handTolerance(index);
  };
}

export function projectJoints(points:Vector3[],camera:Camera,width:number,height:number,visible?:(point:Vector3,index:number)=>boolean){
  camera.updateMatrixWorld();return points.flatMap((p,i)=>{const q=projectPoint(p,camera,width,height);return q.valid&&(!visible||visible(p,i))?[Number(q.x.toFixed(3)),Number(q.y.toFixed(3)),1]:[0,0,0];});
}
export function projectPose(pose:WorldPose,camera:Camera,width:number,height:number,visible?:(point:Vector3,index:number,side:Side)=>boolean){
  return {version:1.3,canvas_width:width,canvas_height:height,people:[{person_id:[-1],pose_keypoints_2d:projectJoints(pose.body,camera,width,height),face_keypoints_2d:[],hand_left_keypoints_2d:projectJoints(pose.Left,camera,width,height,visible?(p,i)=>visible(p,i,'Left'):undefined),hand_right_keypoints_2d:projectJoints(pose.Right,camera,width,height,visible?(p,i)=>visible(p,i,'Right'):undefined),pose_keypoints_3d:[],face_keypoints_3d:[],hand_left_keypoints_3d:[],hand_right_keypoints_3d:[]}]};
}
export function worldSkeleton(pose:WorldPose){
  const points=(names:string[],p:Vector3[])=>p.map((v,i)=>({name:names[i],position:v.toArray()}));
  return {format:'momo-pose-forge-skeleton',version:1,coordinates:{units:'metres',space:'world',handedness:'right',up:'+Y',initialForward:'+Z'},body:{format:'COCO18',points:points(BODY_NAMES,pose.body),links:COCO_LINKS},hands:{Left:{format:'HAND21',points:points(HAND_NAMES,pose.Left),links:HAND_LINKS},Right:{format:'HAND21',points:points(HAND_NAMES,pose.Right),links:HAND_LINKS}}};
}

function hueColor(hue:number){const h=hue*6,x=255*(1-Math.abs(h%2-1));const c=h<1?[255,x,0]:h<2?[x,255,0]:h<3?[0,255,x]:h<4?[0,x,255]:h<5?[x,0,255]:[255,0,x];return `rgb(${c.map(Math.round).join(',')})`;}
/** HAND21 edges and HSV edge colours follow ControlNet/OpenPose's convention.
 * Coordinates are already pixels, and c=0 is never drawn. */
export function paintSkeleton(ctx:CanvasRenderingContext2D,frame:OpenPoseFrame,includeHands=true){
  const {canvas_width:width,canvas_height:height}=frame;ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);ctx.lineCap='round';
  const draw=(k:number[],links:number[][],colors:string[],lineWidth:number,radius:number,jointColor?:string)=>{
    ctx.lineWidth=lineWidth;links.forEach(([a,b],i)=>{if(!k[a*3+2]||!k[b*3+2])return;ctx.strokeStyle=colors[i];ctx.beginPath();ctx.moveTo(k[a*3],k[a*3+1]);ctx.lineTo(k[b*3],k[b*3+1]);ctx.stroke();});
    for(let i=0;i<k.length/3;i++){if(!k[i*3+2])continue;ctx.fillStyle=jointColor??COCO_COLORS[i];ctx.beginPath();ctx.arc(k[i*3],k[i*3+1],radius,0,Math.PI*2);ctx.fill();}
  };
  for(const p of frame.people){draw(p.pose_keypoints_2d,COCO_LINKS,COCO_COLORS,Math.max(2,height*.005),Math.max(2,height*.005));
  if(includeHands)for(const hand of [p.hand_left_keypoints_2d,p.hand_right_keypoints_2d])draw(hand,HAND_LINKS,HAND_LINKS.map((_,i)=>hueColor(i/20)),Math.max(1,height/256),Math.max(1,height/128),'#0000ff');}
}
