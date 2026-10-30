import type {RigDefinition,RigJointControl} from './rigs';
import {FOX_SCARF_ID} from './foxScarfAsset';
import type {Vec3} from './types';

const control=(name:string,label:string,labelEn:string,min:Vec3,max:Vec3,hinge?:0|1|2):RigJointControl=>({name,label,labelEn,limits:[min,max],...(hinge===undefined?{}:{hinge})});
const controls:RigJointControl[]=[
  control('b_Hip_01','根部 · 骨盆','Root · Pelvis',[-35,-35,-35],[35,35,35]),
  control('b_Spine01_02','脊柱 · 腰背','Spine · Lower back',[-15,-25,-25],[15,25,25]),
  control('b_Spine02_03','脊柱 · 胸背','Spine · Upper back',[-15,-25,-25],[15,25,25]),
  control('b_Neck_04','颈部','Neck',[-35,-45,-45],[35,45,45]),
  control('b_Head_05','头部','Head',[-25,-45,-35],[25,45,35]),
  control('b_RightUpperArm_06','右前腿 · 肩','Right front · Shoulder',[-25,-25,-65],[25,25,65]),
  control('b_RightForeArm_07','右前腿 · 肘','Right front · Elbow',[0,0,-4],[0,0,130],2),
  control('b_RightHand_08','右前爪','Right front paw',[-20,-20,-55],[20,20,55]),
  control('b_LeftUpperArm_09','左前腿 · 肩','Left front · Shoulder',[-25,-25,-65],[25,25,65]),
  control('b_LeftForeArm_010','左前腿 · 肘','Left front · Elbow',[0,0,-4],[0,0,130],2),
  control('b_LeftHand_011','左前爪','Left front paw',[-20,-20,-55],[20,20,55]),
  control('b_Tail01_012','尾巴 · 根部','Tail · Base',[-30,-55,-55],[30,55,55]),
  control('b_Tail02_013','尾巴 · 中段','Tail · Middle',[-30,-55,-55],[30,55,55]),
  control('b_Tail03_014','尾巴 · 末段','Tail · Tip',[-30,-55,-55],[30,55,55]),
  control('b_LeftLeg01_015','左后腿 · 髋','Left hind · Hip',[-30,-35,-70],[30,35,70]),
  control('b_LeftLeg02_016','左后腿 · 膝','Left hind · Knee',[0,0,-120],[0,0,20],2),
  control('b_LeftFoot01_017','左后腿 · 跗关节','Left hind · Hock',[0,0,-35],[0,0,85],2),
  control('b_LeftFoot02_018','左后爪','Left hind paw',[-15,-20,-40],[15,20,40]),
  control('b_RightLeg01_019','右后腿 · 髋','Right hind · Hip',[-30,-35,-70],[30,35,70]),
  control('b_RightLeg02_020','右后腿 · 膝','Right hind · Knee',[0,0,-120],[0,0,20],2),
  control('b_RightFoot01_021','右后腿 · 跗关节','Right hind · Hock',[0,0,-35],[0,0,85],2),
  control('b_RightFoot02_022','右后爪','Right hind paw',[-15,-20,-40],[15,20,40]),
];
export const FOX_RIG:RigDefinition={
  id:'khronos-fox',version:1,name:'小狐狸 · IK / FK',nameEn:'Fox · IK / FK',description:'拖动四爪、固定支撑 · 头颈与尾巴旋转',descriptionEn:'Drag paws, pin contacts, rotate the head and tail',
  strategy:'articulated',units:'metres',up:'+Y',forward:'+Z',root:'b_Hip_01',initialSelection:'b_LeftHand_011',
  asset:{kind:'gltf',url:'/models/fox/fox.glb',profileUrl:'/models/fox/fox-profile.json'},sourceUrl:'/models/fox/FOX-ASSET.md',license:'CC0 model; CC-BY-4.0 rig, animation and glTF conversion',
  appearances:[{id:FOX_SCARF_ID,name:'围巾狐狸',nameEn:'Fox with scarf',url:'/models/fox/fox-scarf.glb'}],
  attribution:{authors:'PixelMannen (model); tomkranis (rigging and animation); AsoboStudio and scurest (glTF conversion)',source:'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/4995a638c96dbc94376d3d6164e70fee3ac7f7a2/Models/Fox',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',changes:'Source coordinates, skin inverse bind translations and animation translations scaled by 0.01 for metre-based editing by MomoPoseForge. Exported images may show edited joint poses.'},
  editableJoints:controls.map(c=>c.name),jointControls:controls,ik:{solver:'constrained-fk',version:1},chains:{
    b_LeftHand_011:['b_LeftUpperArm_09','b_LeftForeArm_010','b_LeftHand_011'],
    b_RightHand_08:['b_RightUpperArm_06','b_RightForeArm_07','b_RightHand_08'],
    b_LeftFoot02_018:['b_LeftLeg01_015','b_LeftLeg02_016','b_LeftFoot01_017','b_LeftFoot02_018'],
    b_RightFoot02_022:['b_RightLeg01_019','b_RightLeg02_020','b_RightFoot01_021','b_RightFoot02_022'],
  },contacts:['b_LeftHand_011','b_RightHand_08','b_LeftFoot02_018','b_RightFoot02_022'],mirrorPairs:[],
  capabilities:{hands:false,fullBodyIK:false,pins:true,floor:false,mirror:false,openPose:false,partialPresets:false},
  presets:[{id:'neutral',name:'中立站姿',category:'基础',description:'恢复小狐狸的静止站姿'}],
};
