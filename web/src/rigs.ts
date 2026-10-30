import type {Vec3, Preset} from './types';
import {PART_NAMES, END_EFFECTORS} from './types';
import {PRESETS} from './presets';
import {FOX_RIG} from './foxRig';
import {BODYCHAN_RIG,BODYKUN_RIG} from './bodyFigureRigs';

export type RigJointControl={name:string;label:string;labelEn:string;limits?:[Vec3,Vec3];hinge?:0|1|2};
export type RigJoint=RigJointControl&{parent:string|null;position:Vec3};
export type RigDefinition={
  id:string;version:number;name:string;nameEn:string;description:string;descriptionEn:string;
  strategy:'xbot-humanoid'|'fk'|'articulated';units:'metres';up:'+Y';forward:'+Z';root:string;initialSelection:string;
  asset:{kind:'gltf';url:string;profileUrl:string}|{kind:'procedural';joints:readonly RigJoint[]};
  sourceUrl:string;license:string;editableJoints:readonly string[];
  appearances?:readonly {id:string;name:string;nameEn:string;url:string}[];
  motionImport?:'mixamo-human-v1';
  jointControls?:readonly RigJointControl[];
  attribution?:{authors:string;source:string;licenseUrl:string;changes:string};
  chains:Readonly<Record<string,readonly string[]>>;
  ik?:{solver:'constrained-fk';version:1};
  supportContacts?:readonly string[];
  supportOrientation?:boolean;
  soles?:Readonly<Record<string,import('./footContacts').SoleDefinition>>;
  contacts:readonly string[];mirrorPairs:readonly (readonly [string,string])[];
  capabilities:{hands:boolean;fullBodyIK:boolean;pins:boolean;floor:boolean;mirror:boolean;openPose:boolean;partialPresets:boolean};
  presets:readonly Preset[];
};

// Supporting vertices measured on the original skinned foot's rounded sole.
// Y offsets below are relative to each ankle; toe counter-rotation leaves this
// rigid forefoot envelope unchanged. Other appearances may need new calibration.
const xbotSole=(toe:string,height:number):import('./footContacts').SoleDefinition=>({toe,heel:[0,-height,-.035],ball:[0,-height,.10412190],ballHull:[
  [0,-height,.10412190],[0,-height+.00035205,.10791812],[0,-height+.00122767,.11146923],
  [0,-height+.00267313,.11491627],[0,-height+.00464669,.11809747],[0,-height+.00709986,.12093454],
]});
export const XBOT_RIG:RigDefinition={
  id:'mixamo-xbot-v2',version:1,name:'Mixamo X Bot',nameEn:'Mixamo X Bot',description:'完整人体 IK、手指与脚趾控制',descriptionEn:'Full human IK, fingers and toes',
  strategy:'xbot-humanoid',units:'metres',up:'+Y',forward:'+Z',root:'Hips',initialSelection:'LeftHand',
  motionImport:'mixamo-human-v1',
  // X Bot v2 bind-surface sole (y=0), not the ankle joint's reference height.
  // These points belong to this rig/mesh; other skeletons need their own calibration.
  soles:{LeftFoot:xbotSole('LeftToeBase',.08235143),RightFoot:xbotSole('RightToeBase',.08235283)},
  asset:{kind:'gltf',url:'/models/xbot.glb',profileUrl:'/models/xbot-profile.json'},sourceUrl:'/models/XBOT-ASSET.md',license:'Adobe Mixamo terms',
  editableJoints:Object.keys(PART_NAMES),chains:{LeftHand:['LeftArm','LeftForeArm','LeftHand'],RightHand:['RightArm','RightForeArm','RightHand'],LeftFoot:['LeftUpLeg','LeftLeg','LeftFoot'],RightFoot:['RightUpLeg','RightLeg','RightFoot']},
  contacts:END_EFFECTORS,supportContacts:['LeftFoot','RightFoot'],supportOrientation:true,mirrorPairs:Object.keys(PART_NAMES).filter(n=>n.startsWith('Left')).map(n=>[n,n.replace('Left','Right')] as const),
  capabilities:{hands:true,fullBodyIK:true,pins:true,floor:true,mirror:true,openPose:true,partialPresets:true},presets:PRESETS,
};

// Same validated canonical humanoid strategy, with Y Bot's own rest proportions.
// X Bot's measured sole envelope must never be applied to a different surface.
export const YBOT_RIG:RigDefinition={
  ...XBOT_RIG,id:'mixamo-ybot-v1',name:'Mixamo Y Bot',nameEn:'Mixamo Y Bot',
  asset:{kind:'gltf',url:'/models/ybot.glb',profileUrl:'/models/ybot-profile.json'},
  sourceUrl:'/models/YBOT-ASSET.md',soles:undefined,
  attribution:{authors:'Adobe Mixamo (character); MULUALEM-TEKLE (source glTF conversion)',source:'https://github.com/MULUALEM-TEKLE/IK-test/tree/404fe4a8791d1f8847cc92ef913685014dc52047/public',licenseUrl:'https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html',changes:'Original Y Bot surface, joint materials and skin weights retained. Normalized to 1.8 m and a canonical identity-rest humanoid skeleton, with an added UpperChest control layer. No source animations included. Head OpenPose anchors are geometric estimates; X Bot sole-contact calibration is not reused.'},
};

const joint=(name:string,parent:string|null,position:Vec3,label:string,labelEn:string,limits?:[Vec3,Vec3]):RigJoint=>({name,parent,position,label,labelEn,limits});
const basicJoints:RigJoint[]=[
  joint('pelvis',null,[0,.96,0],'骨盆','Pelvis'),
  joint('torso','pelvis',[0,.34,0],'胸腔','Torso',[[-35,-45,-30],[55,45,30]]),
  joint('neck','torso',[0,.25,0],'颈部','Neck',[[-35,-60,-35],[45,60,35]]),
  joint('head','neck',[0,.12,0],'头部','Head',[[-30,-60,-30],[30,60,30]]),
  ...(['l','r'] as const).flatMap(side=>{
    const s=side==='l'?1:-1,zh=side==='l'?'左':'右',en=side==='l'?'Left':'Right';
    return [joint(`${side}_shoulder`,'torso',[s*.21,.16,0],`${zh}肩`,`${en} shoulder`),
      joint(`${side}_elbow`,`${side}_shoulder`,[s*.27,0,0],`${zh}肘`,`${en} elbow`,[[-5,side==='l'?-150:0,-5],[5,side==='l'?0:150,5]]),
      joint(`${side}_wrist`,`${side}_elbow`,[s*.25,0,0],`${zh}腕`,`${en} wrist`,[[-65,-45,-65],[65,45,65]]),
      joint(`${side}_hip`,'pelvis',[s*.115,-.04,0],`${zh}髋`,`${en} hip`),
      joint(`${side}_knee`,`${side}_hip`,[0,-.43,0],`${zh}膝`,`${en} knee`,[[0,0,0],[150,0,0]]),
      joint(`${side}_ankle`,`${side}_knee`,[0,-.4,0],`${zh}踝`,`${en} ankle`,[[-45,-20,-25],[60,20,25]])];
  }),
];
for(const joint of basicJoints){if(joint.name.endsWith('_elbow'))joint.hinge=1;if(joint.name.endsWith('_knee'))joint.hinge=0;}
export const BASIC_HUMAN_RIG:RigDefinition={
  id:'momo-basic-human',version:1,name:'基础人形 · FK',nameEn:'Basic human · FK',description:'16 关节，逐关节旋转；移动骨盆调整位置',descriptionEn:'16 joints; rotate joints and move the pelvis',
  strategy:'fk',units:'metres',up:'+Y',forward:'+Z',root:'pelvis',initialSelection:'pelvis',asset:{kind:'procedural',joints:basicJoints},
  sourceUrl:'/models/BASIC-HUMAN.md',license:'MomoPoseForge procedural geometry',editableJoints:basicJoints.map(j=>j.name),chains:{},contacts:[],mirrorPairs:[],
  capabilities:{hands:false,fullBodyIK:false,pins:false,floor:false,mirror:false,openPose:false,partialPresets:false},
  presets:[{id:'neutral',name:'中立姿态',category:'基础',description:'恢复基础人形的 T 形静止姿态'}],
};
export const RIGS:readonly RigDefinition[]=[XBOT_RIG,YBOT_RIG,FOX_RIG,BODYCHAN_RIG,BODYKUN_RIG];
// Old basic-human projects remain readable without keeping the test asset in the picker.
export const REGISTERED_RIGS:readonly RigDefinition[]=[...RIGS,BASIC_HUMAN_RIG];
export function findRig(id:string){return REGISTERED_RIGS.find(r=>r.id===id);}
export function rigOptions(active:RigDefinition){return RIGS.some(r=>r.id===active.id)?RIGS:[...RIGS,active];}
export function requireRig(id:string){const rig=findRig(id);if(!rig)throw new Error(`未安装骨架：${id}；当前姿势未改变`);return rig;}
export function rigStorageKey(kind:'draft'|'library',rig:RigDefinition){return `momo-pose-forge:${kind}:${rig.id}:v${rig.version}`;}
export function readRigStorage(storage:Pick<Storage,'getItem'>,kind:'draft'|'library',rig:RigDefinition){
  return storage.getItem(rigStorageKey(kind,rig))??(rig.id===XBOT_RIG.id&&rig.version===XBOT_RIG.version?storage.getItem(`momo-pose-forge:${kind}:${rig.id}`):null);
}
