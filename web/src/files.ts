import type { PoseDocument, ViewSlot } from './types';
import { END_EFFECTORS, DEFAULT_VIEWS } from './types';
import type { PoseEngine } from './PoseEngine';
import { CURRENT_MODEL } from './rig';
import {PerspectiveCamera} from 'three';

const vector=(x:unknown,n:number)=>Array.isArray(x)&&x.length===n&&x.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=20);
const quaternion=(x:unknown)=>vector(x,4)&&Math.abs((x as number[]).reduce((s,v)=>s+v*v,0)-1)<.02;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);

export function parseDocument(text:string,rest:PoseDocument):PoseDocument{
  if(text.length>2_000_000)throw new Error('工程文件过大，请使用本站导出的姿态 JSON');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('JSON 格式无效，当前姿势未改变');}
  if(!record(raw)||raw.format!=='momo-pose-forge')throw new Error('这不是 MomoPoseForge 工程文件');
  if(raw.version!==1)throw new Error('工程版本不兼容，请使用 v1 工程');
  if(raw.rig!==rest.rig)throw new Error('工程使用的人体版本与当前模型不同；原工程文件未修改');
  const d=raw as unknown as PoseDocument;
  if(typeof d.name!=='string'||d.name.length>80||!record(d.root)||!vector(d.root.position,3)||!quaternion(d.root.quaternion)||!record(d.joints)||!record(d.targets)||!record(d.poles)||!record(d.pins))throw new Error('工程结构或坐标无效');
  if(Object.keys(d.joints).length!==Object.keys(rest.joints).length)throw new Error('工程骨骼数量不匹配');
  for(const[name,base]of Object.entries(rest.joints)){
    const j=d.joints[name];if(!record(j)||!vector(j.position,3)||!quaternion(j.quaternion))throw new Error(`骨骼 ${name} 的数据无效`);
    if(name!=='Hips'&&j.position.some((v,i)=>Math.abs(v-base.position[i])>.0001))throw new Error('工程中的骨段长度与当前人体不一致');
  }
  for(const name of END_EFFECTORS){
    if(!vector(d.targets[name],3)||!vector(d.poles[name],3))throw new Error('IK 控制点无效');
    const pin=d.pins[name];if(pin&&(!record(pin)||!vector(pin.position,3)||!quaternion(pin.quaternion)||typeof pin.orientation!=='boolean'))throw new Error('固定点数据无效');
  }
  if(Object.keys(d.pins).some(k=>!END_EFFECTORS.includes(k as typeof END_EFFECTORS[number])))throw new Error('包含未知的固定部位');
  if(!Array.isArray(d.views)||d.views.length!==5||d.views.some((v,i)=>!record(v)||v.id!==DEFAULT_VIEWS[i].id||typeof v.name!=='string'||v.name.length>30||!Number.isFinite(v.azimuth)||Math.abs(v.azimuth)>360||!Number.isFinite(v.elevation)||Math.abs(v.elevation)>89))throw new Error('五视图相机设置无效');
  if(!record(d.hands)||!['张手','握拳','指向','自定义'].includes(d.hands.Left)||!['张手','握拳','指向','自定义'].includes(d.hands.Right)||typeof d.ground!=='boolean')throw new Error('手型或地面设置无效');
  if(d.fullBody!==undefined&&typeof d.fullBody!=='boolean')throw new Error('全身联动设置无效');
  return structuredClone(d);
}

export function download(blob:Blob,name:string){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);}
export const safeName=(name:string)=>name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').slice(0,64)||'pose';
export function saveProject(doc:PoseDocument){download(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),`${safeName(doc.name)}.pose.json`);}
const toBlob=(c:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('图片生成失败')),'image/png'));
export type ExportOptions={scope:'five'|'current';surface:boolean;skeleton:boolean;keypoints:boolean;sheet:boolean;project:boolean;resolution:768|1536;transparent:boolean};

export async function exportPose(engine:PoseEngine,options:ExportOptions,signal:AbortSignal,onProgress:(label:string)=>void){
  const {default:JSZip}=await import('jszip');
  const doc=engine.snapshot(),zip=new JSZip(),w=options.resolution,h=w*4/3;
  const slots:ViewSlot[]=options.scope==='five'?structuredClone(engine.views):[(()=>{const d=engine.camera.position.clone().sub(engine.orbit.target).normalize();return{id:'current',name:'当前视角',azimuth:Math.atan2(d.x,d.z)*180/Math.PI,elevation:Math.asin(d.y)*180/Math.PI};})()];
  const images:HTMLCanvasElement[]=[],manifestViews=[];
  const check=()=>{if(signal.aborted)throw new DOMException('导出已取消','AbortError');};
  try{
    for(let i=0;i<slots.length;i++){
      check();onProgress(`正在生成${slots[i].name} · ${i+1}/${slots.length}`);
      const slot=slots[i],camera=options.scope==='current'?engine.exportCamera(w/h):engine.viewCamera(slot,w/h);
      if(options.surface||options.sheet){const canvas=engine.renderImage(slot,w,h,'surface',options.transparent,camera);images.push(canvas);if(options.surface)zip.file(`${slot.id}/mannequin.png`,await toBlob(canvas));}
      if(options.skeleton)zip.file(`${slot.id}/openpose-coco18.png`,await toBlob(engine.renderImage(slot,w,h,'skeleton',false,camera)));
      if(options.keypoints)zip.file(`${slot.id}/keypoints-coco18.json`,JSON.stringify({version:1.3,people:[{person_id:[-1],pose_keypoints_2d:engine.keypoints(camera,w,h),face_keypoints_2d:[],hand_left_keypoints_2d:[],hand_right_keypoints_2d:[],pose_keypoints_3d:[],face_keypoints_3d:[],hand_left_keypoints_3d:[],hand_right_keypoints_3d:[]}]},null,2));
      manifestViews.push({...slot,projection:camera instanceof PerspectiveCamera?'perspective':'orthographic',worldMatrix:camera.matrixWorld.toArray(),projectionMatrix:camera.projectionMatrix.toArray()});
      await new Promise(r=>setTimeout(r,0));
    }
    check();
    if(options.sheet){
      const sheet=document.createElement('canvas');const cellW=Math.min(w,768),cellH=cellW*4/3,label=48;
      sheet.width=cellW*(slots.length>1?3:1);sheet.height=(cellH+label)*(slots.length>1?2:1);
      const ctx=sheet.getContext('2d')!;ctx.fillStyle='#e7e8e5';ctx.fillRect(0,0,sheet.width,sheet.height);
      images.forEach((img,i)=>{const x=(i%3)*cellW,y=Math.floor(i/3)*(cellH+label);ctx.drawImage(img,x,y,cellW,cellH);ctx.fillStyle='#333635';ctx.font='20px sans-serif';ctx.fillText(slots[i].name,x+24,y+cellH+30);});
      if(slots.length>1){const x=2*cellW,y=cellH+label;ctx.fillStyle='#252827';ctx.font='28px sans-serif';ctx.fillText('MomoPoseForge',x+32,y+65);ctx.font='22px sans-serif';ctx.fillText(doc.name.slice(0,20),x+32,y+112);ctx.font='18px sans-serif';ctx.fillText('同一姿态 · 五个视角',x+32,y+156);}
      zip.file('contact-sheet.png',await toBlob(sheet));
    }
    if(options.project)zip.file('project.pose.json',JSON.stringify(doc,null,2));
    zip.file('manifest.json',JSON.stringify({application:'MomoPoseForge',applicationVersion:'0.1.0',projectVersion:1,rig:doc.rig,width:w,height:h,coordinates:{world:'right-handed, Y up, +Z initial forward, metres',image:'top-left origin, +X right, +Y down, pixels'},keypointFormat:'OpenPose COCO18',keypointConfidence:'synthetic validity, not detection confidence',occlusionPolicy:'retain valid occluded joints; zero missing/out-of-frame points',viewFit:{center:engine.center.toArray(),verticalSpan:engine.span,sharedScale:true},views:manifestViews,model:CURRENT_MODEL.name,modelLicense:CURRENT_MODEL.license},null,2));
    zip.file('README.txt','MomoPoseForge 姿态导出\n\n每个视角的 mannequin.png 是人体参考图，openpose-coco18.png 是黑底身体骨架控制图。\nkeypoints-coco18.json 使用 OpenPose COCO18 点序，坐标为该 PNG 的像素，c=1 代表程序生成的有效点；不代表 AI 检测置信度。手指和面部点集未输出。\nproject.pose.json 可在 MomoPoseForge 中重新打开继续编辑。manifest.json 记录相机、图像尺寸与坐标约定。\ncontact-sheet.png 用于查看整组视角；单视角 AI 工作流请使用对应目录内的独立图。\n下游工具须支持相应的骨架图或 JSON 格式，并按其要求载入。本版本未对所有第三方工作流作兼容认证。\n角色资产：Adobe Mixamo X Bot，使用说明见 https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html 。\n');
    onProgress('正在打包文件');check();const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}},()=>check());check();download(blob,`${safeName(doc.name)}.zip`);
  }finally{engine.apply(doc);}
}
