import type { PoseDocument, ViewSlot } from './types';
import { DEFAULT_VIEWS } from './types';
import type { PoseEngine } from './PoseEngine';
import {requireRig,XBOT_RIG,REGISTERED_RIGS,type RigDefinition} from './rigs';
import {PerspectiveCamera} from 'three';
import {NORMAL_CONVENTION} from './renderPasses';
import {BODY_NAMES,HAND_NAMES,handTolerance} from './poseOutput';
import {controlnetRecipe} from './controlnetWorkflow';
import runnerSource from '../../tools/run-controlnet.py?raw';
import requirementsSource from '../../tools/requirements-controlnet.txt?raw';
import {validateCameraSettings,validOutputSize} from './cameraState';
import {validateReferenceImage} from './referenceImage';
import {handShapeValid} from './handGestures';
import {validSceneProps} from './sceneProps';
import {validSymmetry} from './symmetry';
import {validAppearance} from './characterAppearance';
import {validSoleContact} from './footContacts';

const vector=(x:unknown,n:number)=>Array.isArray(x)&&x.length===n&&x.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=20);
const quaternion=(x:unknown)=>vector(x,4)&&Math.abs((x as number[]).reduce((s,v)=>s+v*v,0)-1)<.02;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);

export function documentRig(text:string,registry:readonly RigDefinition[]=REGISTERED_RIGS){
  if(text.length>2_000_000)throw new Error('工程文件过大');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('JSON 格式无效，当前姿势未改变');}
  if(!record(raw)||raw.format!=='momo-pose-forge'||raw.version!==1||typeof raw.rig!=='string')throw new Error('工程格式或版本不兼容');
  const rig=registry.find(r=>r.id===raw.rig);if(!rig)throw new Error(`未安装骨架：${raw.rig}；当前姿势未改变`);
  const version=raw.rigVersion??(rig.id===XBOT_RIG.id?1:undefined);
  if(version!==rig.version)throw new Error('骨架版本不兼容；当前姿势未改变');
  return rig;
}

export function parseDocument(text:string,rest:PoseDocument,definition:RigDefinition=requireRig(rest.rig)):PoseDocument{
  if(text.length>2_000_000)throw new Error('工程文件过大，请使用本站导出的姿态 JSON');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('JSON 格式无效，当前姿势未改变');}
  if(!record(raw)||raw.format!=='momo-pose-forge')throw new Error('这不是 MomoPoseForge 工程文件');
  if(raw.version!==1)throw new Error('工程版本不兼容，请使用 v1 工程');
  const rig=documentRig(text,[definition]);
  if(raw.rig!==rest.rig||(raw.rigVersion??1)!==(rest.rigVersion??1))throw new Error('工程使用的骨架与当前模型不同；原工程文件未修改');
  const d=raw as unknown as PoseDocument;
  if(typeof d.name!=='string'||d.name.length>80||!record(d.root)||!vector(d.root.position,3)||!quaternion(d.root.quaternion)||!record(d.joints)||!record(d.targets)||!record(d.poles)||!record(d.pins))throw new Error('工程结构或坐标无效');
  if(Object.keys(d.joints).length!==Object.keys(rest.joints).length)throw new Error('工程骨骼数量不匹配');
  for(const[name,base]of Object.entries(rest.joints)){
    const j=d.joints[name];if(!record(j)||!vector(j.position,3)||!quaternion(j.quaternion))throw new Error(`骨骼 ${name} 的数据无效`);
    if(name!==rig.root&&j.position.some((v,i)=>Math.abs(v-base.position[i])>.0001))throw new Error('工程中的骨段长度与当前骨架不一致');
  }
  // The original Fox FK format had no IK controls. Preserve its joint pose and
  // let the runtime derive targets from that pose after loading.
  if(rig.ik&&d.ikVersion===undefined&&Object.keys(d.targets).length===0&&Object.keys(d.poles).length===0&&Object.keys(d.pins).length===0)d.targets=structuredClone(rest.targets);
  if(d.ikVersion!==undefined&&(!rig.ik||d.ikVersion!==rig.ik.version))throw new Error('IK 控制版本不兼容');
  for(const name of Object.keys(rig.chains)){
    if(!vector(d.targets[name],3)||(!rig.ik||d.poles[name]!==undefined)&&!vector(d.poles[name],3))throw new Error('IK 控制点无效');
    const pin=d.pins[name];if(pin&&(!record(pin)||!vector(pin.position,3)||!quaternion(pin.quaternion)||typeof pin.orientation!=='boolean'))throw new Error('固定点数据无效');
    if(pin?.sole!==undefined&&(!rig.soles?.[name]||!validSoleContact(pin.sole)||!pin.orientation))throw new Error('脚底接触数据无效或骨架不支持');
  }
  if(Object.keys(d.pins).some(k=>!rig.contacts.includes(k)))throw new Error('包含未知的固定部位');
  for(const map of [d.targets,d.poles])if(Object.keys(map).some(k=>!rig.chains[k]))throw new Error('包含未知的 IK 控制点');
  if(d.selection!==undefined&&(!rig.editableJoints.includes(d.selection)))throw new Error('选中关节不属于当前骨架');
  if(!Array.isArray(d.views)||d.views.length!==5||d.views.some((v,i)=>!record(v)||v.id!==DEFAULT_VIEWS[i].id||typeof v.name!=='string'||v.name.length>30||!Number.isFinite(v.azimuth)||Math.abs(v.azimuth)>360||!Number.isFinite(v.elevation)||Math.abs(v.elevation)>89))throw new Error('五视图相机设置无效');
  if(!record(d.hands)||!handShapeValid(d.hands.Left)||!handShapeValid(d.hands.Right)||typeof d.ground!=='boolean')throw new Error('手型或地面设置无效');
  if(d.fullBody!==undefined&&typeof d.fullBody!=='boolean')throw new Error('全身联动设置无效');
  if(d.symmetry!==undefined&&!validSymmetry(d.symmetry))throw new Error('实时对称设置无效');
  if(d.camera!==undefined&&!validateCameraSettings(d.camera))throw new Error('相机书签、画幅或构图设置无效');
  if(d.referenceImage!==undefined&&!validateReferenceImage(d.referenceImage))throw new Error('参考图片或放置设置无效，当前工程未改变');
  if(d.props!==undefined&&!validSceneProps(d.props))throw new Error('场景道具数据无效，当前工程未改变');
  if(d.appearance!==undefined&&!validAppearance(d.appearance,rig))throw new Error('角色外观与当前骨架不兼容');
  return structuredClone(d);
}

export function download(blob:Blob,name:string){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);}
export const safeName=(name:string)=>name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').slice(0,64)||'pose';
export function saveProject(doc:PoseDocument){download(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),`${safeName(doc.name)}.pose.json`);}
const toBlob=(c:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('图片生成失败')),'image/png'));
export type ExportOptions={scope:'five'|'current';surface:boolean;skeleton:boolean;keypoints:boolean;depth:boolean;normal:boolean;sheet:boolean;project:boolean;resolution?:768|1536;width?:number;height?:number;transparent:boolean;hideOccludedHands:boolean};

export async function exportPose(engine:PoseEngine,options:ExportOptions,signal:AbortSignal,onProgress:(label:string)=>void){
  if(engine.motion?.active)throw new Error('请先取姿或返回原姿势，再导出');
  engine.fly?.stop();
  const rig=engine.activeRig,human=engine.hasHumanActors?.()??rig.capabilities.openPose,actors=engine.actorList?.()??[],multi=actors.length>1,scene=actors.length?engine.sceneSnapshot():undefined;
  if(actors.length&&!actors.some(a=>a.visible)&&!engine.props?.some(p=>p.visible))throw new Error('场景中没有可见角色或道具');
  const appearance=engine.appearance,customAppearance=!!appearance&&!rig.appearances?.some(a=>a.id===appearance.id);
  const doc=engine.snapshot(),output=engine.getCameraSettings().output,w=options.width??options.resolution??output.width,h=options.height??(options.resolution?options.resolution*4/3:output.height);
  if(!validOutputSize(w,h))throw new Error('图片宽高须为 256 至 2048 的整数');
  const slots:ViewSlot[]=options.scope==='five'?structuredClone(engine.views):[(()=>{const d=engine.camera.position.clone().sub(engine.orbit.target).normalize();return{id:'current',name:'当前视角',azimuth:Math.atan2(d.x,d.z)*180/Math.PI,elevation:Math.asin(d.y)*180/Math.PI};})()];
  const cameras=slots.map(slot=>options.scope==='current'?engine.exportCamera(w/h):engine.viewCamera(slot,w/h)),range=engine.depthRange(cameras),world=engine.skeletonData();
  const {default:JSZip}=await import('jszip');const zip=new JSZip();
  const images:HTMLCanvasElement[]=[],manifestViews=[];
  const check=()=>{if(signal.aborted)throw new DOMException('导出已取消','AbortError');};
  try{
    for(let i=0;i<slots.length;i++){
      check();onProgress(`正在生成${slots[i].name} · ${i+1}/${slots.length}`);
      const slot=slots[i],camera=cameras[i],frame=human&&(options.skeleton||options.keypoints)?engine.openPose(camera,w,h,options.hideOccludedHands):undefined;
      const renderOptions={pose:frame,depthRange:range,humanOnly:true};
      if(options.surface||options.sheet){const canvas=engine.renderImage(slot,w,h,'surface',options.transparent,camera);images.push(canvas);if(options.surface)zip.file(`${slot.id}/mannequin.png`,await toBlob(canvas));}
      if(options.skeleton&&(!human||multi))zip.file(`${slot.id}/skeleton.png`,await toBlob(engine.renderImage(slot,w,h,'skeleton',false,camera)));
      if(options.skeleton&&human){
        zip.file(`${slot.id}/openpose-coco18.png`,await toBlob(engine.renderImage(slot,w,h,'body-skeleton',false,camera,renderOptions)));
        zip.file(`${slot.id}/openpose-body-hands.png`,await toBlob(engine.renderImage(slot,w,h,'skeleton',false,camera,renderOptions)));
      }
      if(options.keypoints&&(!human||multi))zip.file(`${slot.id}/joints.json`,JSON.stringify(multi?engine.sceneJoints(camera,w,h):engine.genericSkeletonData(camera,w,h),null,2));
      if(options.keypoints&&human){
        zip.file(`${slot.id}/keypoints-openpose.json`,JSON.stringify(frame,null,2));
        const legacy=structuredClone(frame!);for(const person of legacy.people){person.hand_left_keypoints_2d=[];person.hand_right_keypoints_2d=[];}
        zip.file(`${slot.id}/keypoints-coco18.json`,JSON.stringify(legacy,null,2));
      }
      for(const kind of ['depth','normal'] as const)if(options[kind])zip.file(`${slot.id}/${kind}.png`,await toBlob(engine.renderImage(slot,w,h,kind,false,camera,renderOptions)));
      if(options.depth||options.normal)zip.file(`${slot.id}/mask.png`,await toBlob(engine.renderImage(slot,w,h,'mask',false,camera,renderOptions)));
      manifestViews.push({...slot,projection:camera instanceof PerspectiveCamera?'perspective':'orthographic',near:camera.near,far:camera.far,worldMatrix:camera.matrixWorld.toArray(),projectionMatrix:camera.projectionMatrix.toArray()});
      await new Promise(r=>setTimeout(r,0));
    }
    check();
    if(options.sheet){
      const sheet=document.createElement('canvas');const cellW=Math.min(w,768),cellH=Math.round(cellW*h/w),label=48;
      sheet.width=cellW*(slots.length>1?3:1);sheet.height=(cellH+label)*(slots.length>1?2:1);
      const ctx=sheet.getContext('2d')!;ctx.fillStyle='#e7e8e5';ctx.fillRect(0,0,sheet.width,sheet.height);
      images.forEach((img,i)=>{const x=(i%3)*cellW,y=Math.floor(i/3)*(cellH+label);ctx.drawImage(img,x,y,cellW,cellH);ctx.fillStyle='#333635';ctx.font='20px sans-serif';ctx.fillText(slots[i].name,x+24,y+cellH+30);});
      if(slots.length>1){const x=2*cellW,y=cellH+label;ctx.fillStyle='#252827';ctx.font='28px sans-serif';ctx.fillText('MomoPoseForge',x+32,y+65);ctx.font='22px sans-serif';ctx.fillText(doc.name.slice(0,20),x+32,y+112);ctx.font='18px sans-serif';ctx.fillText('同一姿态 · 五个视角',x+32,y+156);}
      zip.file('contact-sheet.png',await toBlob(sheet));
    }
    if(options.project)zip.file('project.pose.json',JSON.stringify(doc,null,2));
    if(options.project&&scene)zip.file('project.scene.json',JSON.stringify(scene,null,2));
    if(options.keypoints)zip.file('skeleton-world.json',JSON.stringify(world,null,2));
    if(human&&(options.skeleton||options.depth||options.normal)){
      const recipe=controlnetRecipe(slots.map(s=>s.id),options,options.scope==='current'&&engine.handDetail?{side:engine.handDetail,shape:engine.hands[engine.handDetail]}:undefined,{width:w,height:h});
      zip.file('workflow-controlnet.json',JSON.stringify(recipe,null,2));zip.file('tools/run-controlnet.py',runnerSource);zip.file('tools/requirements-controlnet.txt',requirementsSource);zip.file('workflows/controlnet-models.json',JSON.stringify(recipe.models,null,2));
    }
    zip.file('manifest.json',JSON.stringify({application:'MomoPoseForge',applicationVersion:'0.7.0',exportVersion:3,projectVersion:1,sceneVersion:scene?1:undefined,actors,sceneProps:{count:doc.props?.length??0,visible:doc.props?.filter(p=>p.visible).length??0,renderedIn:['surface','depth','normal','mask'],skeleton:'active rig only'},referenceImage:{rendered:false,embeddedInProject:!!doc.referenceImage&&options.project},rig:doc.rig,rigVersion:rig.version,width:w,height:h,channels:{surface:options.surface,skeleton:options.skeleton,keypoints:options.keypoints,depth:options.depth,normal:options.normal},coordinates:{world:'right-handed, Y up, +Z initial forward, metres',image:'top-left origin, +X right, +Y down, pixels'},keypointFormat:human?'OpenPose COCO18 + 2 x HAND21':'momo-skeleton v1',pointOrder:human?{body:BODY_NAMES,hand:HAND_NAMES}:{joints:Object.keys(engine.bones)},keypointConfidence:'synthetic validity, not detection confidence',occlusionPolicy:human?{body:'retain valid occluded joints',hands:options.hideOccludedHands?'zero out-of-frame or surface-occluded joints':'retain valid occluded joints',missing:'[0,0,0]',handToleranceMetres:{wrist:handTolerance(0),fingerBase:handTolerance(1),finger:handTolerance(2)}}:{joints:'retain valid occluded joints',projectionValidity:'explicit valid boolean; no human hand filtering'},depth:{quantity:'camera axial depth, metres',range,sharedAcrossViews:true,encoding:'gray = clamp((far - depth) / (far - near), 0, 1), 8-bit',near:'white',far:'black',background:'black; use mask.png to distinguish background',colorSpace:'linear data, no tone mapping or sRGB transfer'},normal:NORMAL_CONVENTION,mask:{foreground:255,background:0},viewFit:{center:engine.center.toArray(),verticalSpan:engine.span,sharedScale:options.scope==='five',locked:doc.camera?.framing.locked??false},views:manifestViews,model:appearance?.name??rig.name,appearance:appearance?{...appearance,source:customAppearance?'local user '+(appearance.format??'glb').toUpperCase():'bundled',embeddedInProject:false}:null,modelLicense:customAppearance?'Local source asset':rig.license,...(rig.attribution?{rigAttribution:rig.attribution,...(!customAppearance?{modelAttribution:rig.attribution}:{})}:{})},null,2));
    zip.file('README.txt',human?[
      'MomoPoseForge 姿态导出 v3','',
      '每个视角：mannequin.png 是素体参考；openpose-body-hands.png 是身体 COCO18 + 双手各21点的黑底骨架控制图。',
      'keypoints-openpose.json 使用 OpenPose 1.3 字段，像素坐标 x,y,c；每手从手腕开始，依次为拇指、食指、中指、无名指、小指，每指4点。',
      'c=1 是程序生成的有效点，不是 AI 检测置信度。出画面点为0；手部按所选遮挡设置过滤，判断容差见 manifest.json。未输出面部点集。',
      'openpose-coco18.png 和 keypoints-coco18.json 是保留的身体18点兼容文件。skeleton-world.json 是完整身体/手部的米制三维坐标，不是 OpenPose 的三角测量结果。',
      'depth.png：相机轴向深度线性归一化，近白远黑，五视图共用范围；normal.png：相机表面法线的 ControlNet 1.1 / ScanNet 可视化约定。数据图不含灯光、色调映射或 sRGB 转换。',
      'mask.png：白色是角色与可见道具，黑色是背景。用它区分深度/法线图的背景；相机和深度范围完整记录在 manifest.json。',
      'workflow-controlnet.json 提供固定模型版本、通道权重、种子与匹配画幅的生成配置（最长边512，8像素对齐）。非整比时等比缩放后补黑边，不拉伸控制图。ZIP 同时附带运行脚本、依赖和模型版本清单。',
      '本地复现：解压本 ZIP，在解压目录中创建 Python 虚拟环境，安装匹配显卡的 CUDA PyTorch，再 pip install -r tools/requirements-controlnet.txt；运行 python tools/run-controlnet.py 原ZIP路径 --ablation。首次运行下载约5GB公开模型，需要CUDA显卡。',
      '可用 --view 选择视角、--prompt 修改人物/服装描述、--seed 固定随机种子；--model-cache 指定模型缓存。已有模型时加 --offline。直接使用控制图，不要再做姿态/深度/法线估计。',
      '真实生成仍取决于所选模型和权重；X Bot 分段几何会进入深度/法线图，独立生成不同视角不会自动保证角色身份一致。',
      '参考图片为视口叠加层，不进入任何 PNG、深度、法线或关键点；如勾选工程，图片内嵌在 project.pose.json 中，可随工程恢复。',
      'project.pose.json 可重新打开编辑；contact-sheet.png 只用于整组查看，单视角工作流使用该视角目录内的独立图。',
      '场景道具为程序生成的椅子、桌子、方块或握杆；可见道具进入素体、深度、法线和 mask，骨架/关节点只含人体。道具位置、尺寸、朝向及显隐保存在工程中。',
      '角色资产：Adobe Mixamo X Bot，https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html 。','',
    ].join('\n'):[
      'MomoPoseForge 通用骨架导出',`骨架：${rig.name} / ${rig.id} v${rig.version}`,
      'skeleton.png 和 joints.json 是此骨架的连接图与投影关节数据，不是人体 OpenPose。',
      'skeleton-world.json 使用米制三维坐标，含关节名和父骨骼名；manifest.json 记录各相机矩阵。',
      'mannequin.png 为素体图；depth.png 为近白远黑线性深度；normal.png 为相机空间表面法线；mask.png 白色为前景。',
      '参考图不进入渲染；工程内可内嵌参考图。project.pose.json 可重新打开编辑。',
    ].join('\n'));
    if(rig.attribution)zip.file('ASSET-CREDITS.txt',[(customAppearance?'Rig reference: ':'')+rig.name,rig.attribution.authors,`Source: ${rig.attribution.source}`,`License: ${rig.license}`,rig.attribution.licenseUrl,`Changes: ${rig.attribution.changes}`].join('\n'));
    if(scene){
      zip.file('SCENE.txt',['Scene character IDs match joints.json actors[].id and OpenPose people[].actor_id.','Hidden characters are excluded from rendered images and exported joints. Locked characters remain visible.','OpenPose contains human characters only; skeleton.png combines human and nonhuman bones.','Depth, normal and mask share one render of all visible characters and props.','Open project.scene.json to restore the full scene. project.pose.json contains the selected character only.','This image-export ZIP does not embed custom character or motion files; save a full .poseforge project to transfer them.'].join('\n'));
      const used=[...new Set(scene.actors.map(a=>a.pose.rig))].map(requireRig);zip.file('SCENE-ASSET-CREDITS.txt',used.map(r=>[r.name,r.id,r.license,r.sourceUrl,r.attribution?.authors,r.attribution?.source,r.attribution?.licenseUrl,r.attribution?.changes].filter(Boolean).join('\n')).join('\n\n'));
    }
    if(appearance)zip.file('CHARACTER.txt',[appearance.name,`SHA-256: ${appearance.id}`,customAppearance?`Appearance source: local ${(appearance.format??'glb').toUpperCase()} supplied by the user.`:'Appearance source: bundled Fox with a geometric scarf by MomoPoseForge.',customAppearance?'Asset attribution was not supplied with this local file.':'Original Fox attribution: see ASSET-CREDITS.txt.','Source assets are not embedded in this image-export ZIP. Save a full .poseforge project to carry custom characters and selected clips.'].join('\n'));
    onProgress('正在打包文件');check();const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}},()=>check());check();download(blob,`${safeName(doc.name)}.zip`);
  }finally{
    // Rendering does not edit the pose. Re-applying an unchanged snapshot would
    // unnecessarily project joint limits again and introduce floating-point drift.
    if(JSON.stringify(engine.snapshot())!==JSON.stringify(doc))engine.apply(doc);
  }
}
