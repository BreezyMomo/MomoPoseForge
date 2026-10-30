import {language,t} from './workbenchState';
import {PART_NAMES,DIGIT_NAMES,type Digit,type Preset,type ViewSlot} from './types';
import {PRESET_SCOPES,type PresetScope} from './presetScopes';
import {HAND_GESTURES,type HandGesture} from './handGestures';
import {PROP_KINDS,type PropKind} from './sceneProps';
import {VIEW_DIRECTIONS,normalizeViewNames} from './viewDirections';
import {controlDescription} from './poseControls';

// Human-specific display metadata belongs to PoseForge, never the shared workbench.
const english=()=>language.interfaceLanguage()==='en';
const bodyNames:Record<string,string>={Hips:'Pelvis',Spine:'Lower spine',Spine1:'Spine',Chest:'Chest',UpperChest:'Upper chest',Neck:'Neck',Head:'Head',LeftShoulder:'Left shoulder',LeftArm:'Left upper arm',LeftForeArm:'Left elbow',LeftHand:'Left hand',RightShoulder:'Right shoulder',RightArm:'Right upper arm',RightForeArm:'Right elbow',RightHand:'Right hand',LeftUpLeg:'Left hip',LeftLeg:'Left knee',LeftFoot:'Left foot',LeftToeBase:'Left toes',RightUpLeg:'Right hip',RightLeg:'Right knee',RightFoot:'Right foot',RightToeBase:'Right toes'};
const digits:Record<Digit,string>={Thumb:'Thumb',Index:'Index',Middle:'Middle',Ring:'Ring',Little:'Little'};
export const digitName=(digit:Digit)=>english()?digits[digit]:DIGIT_NAMES[digit];
export function partName(id:string){
  if(!english())return PART_NAMES[id]??id;
  const finger=/^(Left|Right)(Thumb|Index|Middle|Ring|Little)([1-4])$/.exec(id);
  return bodyNames[id]??(finger?`${finger[1]} ${digits[finger[2] as Digit].toLowerCase()} · joint ${finger[3]}`:id);
}
const presetNames:Record<string,[string,string]>={
 neutral:['Neutral stance','Start from a relaxed stance'],'t-pose':['T pose','Extend both arms horizontally'],'a-pose':['A pose','Open both arms naturally'],weight:['Weight shift','Relaxed weight on one side'],hip:['Hand on hip','Hand at waist with elbow outward'],cross:['Arms crossed','Cross the forearms'],sit:['Seated','Seated with both knees forward'],'sit-lean':['Lean forward seated','Lean forward with hands on knees'],'cross-sit':['Cross-legged','Low seated pose with crossed legs'],squat:['Squat','Lower the pelvis with both feet grounded'],kneel:['One-knee kneel','Asymmetric stance with one knee down'],'both-kneel':['Two-knee kneel','Low kneeling pose'],walk:['Walking pose','Stride with natural arm swing'],run:['Running pose','Lean forward with bent knees and swinging arms'],lunge:['Lunge','A long forward and backward stride'],wave:['Wave','Raise a hand with palm forward'],raise:['Arms raised','Reach both arms upward'],turn:['Look back','Turn torso and head in opposite directions'],
};
export const presetName=(preset:Preset)=>english()?(presetNames[preset.id]?.[0]??preset.name):preset.name;
export const presetDescription=(preset:Preset)=>english()?(presetNames[preset.id]?.[1]??preset.description):preset.description;
const categories:Record<string,string>={'全部':'All','基础':'Basic','站姿':'Standing','坐姿':'Seated','蹲跪':'Crouch / kneel','动态':'Action','表达':'Expression'};
export const categoryName=(id:string)=>english()?(categories[id]??id):id;
const scopes:Record<PresetScope,[string,string]>={all:['Full body','Replace the complete pose and hand shapes.'],upper:['Upper body','Apply the torso and arms; preserve pelvis, legs, head and hand shapes.'],lower:['Lower body','Apply pelvis and legs; retain upper-body local rotations.'],head:['Head','Apply neck and head rotations relative to the current torso.']};
export const scopeName=(id:PresetScope)=>english()?scopes[id][0]:PRESET_SCOPES[id].label;
export const scopeHelp=(id:PresetScope)=>english()?scopes[id][1]:PRESET_SCOPES[id].help;
export function viewName(view:ViewSlot){const name=normalizeViewNames([view])[0].name;return english()?(VIEW_DIRECTIONS.find(v=>v.name===name)?.nameEn??name):name;}
const gestureNames:Record<string,string>={open:'Open hand',fist:'Fist',point:'Point',relaxed:'Relaxed',peace:'Peace sign','thumbs-up':'Thumbs up',okay:'OK sign',pinch:'Pinch',grip:'Grip',cup:'Support',together:'Fingers together',hook:'Hook'};
export const gestureName=(gesture:HandGesture,builtin=true)=>english()&&builtin?(gestureNames[gesture.id]??gesture.name):gesture.name;
export function currentGestureName(name:string){if(!english())return name;if(name==='自定义')return 'Custom';const gesture=HAND_GESTURES.find(g=>g.name===name);return gesture?gestureName(gesture):name;}
const propNames:Record<PropKind,string>={chair:'Chair',table:'Table',box:'Box',bar:'Bar'};
export const propName=(kind:PropKind)=>english()?propNames[kind]:PROP_KINDS[kind];
export function anchorName(kind:PropKind,anchor:{id:string;name:string}){if(!english())return anchor.name;return ({middle:'Bar center',center:kind==='chair'?'Seat center':'Top center',left:'Top left',right:'Top right',front:'Top front'} as Record<string,string>)[anchor.id]??anchor.name;}
export function partControl(name:string){
  if(!english())return controlDescription(name);
  if(/^(Left|Right)(Thumb|Index|Middle|Ring|Little)[123]$/.test(name))return {label:'Finger joint',help:'Adjust curl and spread below, or rotate this joint with the gizmo.'};
  if(name.endsWith('ToeBase'))return {label:'Toe bend',help:'Raise or lower the forefoot while retaining ankle position.'};
  if(name.endsWith('Shoulder'))return {label:'Shoulder rotation',help:'Clavicle movement follows joint limits. A pinned hand makes the arm compensate.'};
  if(name.endsWith('Arm')&&!name.endsWith('ForeArm'))return {label:'Upper-arm rotation',help:'Swing and twist follow joint limits. Pinned IK targets take priority.'};
  if(name.endsWith('UpLeg'))return {label:'Hip rotation',help:'Flexion, lateral movement and twist follow joint limits. Pinned feet take priority.'};
  if(name.endsWith('Hand')||name.endsWith('Foot'))return {label:'Hand / foot IK',help:'Move the target or rotate its orientation. Full-body coupling allows the torso and pelvis to assist.'};
  if(name==='Hips')return {label:'Pelvis movement',help:'Pin both feet, then move the pelvis. Legs bend within their reachable range.'};
  if(name==='Chest')return {label:'Chest bend',help:'Bend while preserving torso twist. Full-body coupling allows pelvis and legs to assist.'};
  if(name.endsWith('ForeArm')||name==='LeftLeg'||name==='RightLeg')return {label:'Elbow / knee direction',help:'Move to change bend direction while retaining hand or foot targets.'};
  return {label:'Joint rotation',help:'Rotate the joint. Spine, neck and head respect their angle limits.'};
}
export const sideName=(side:'Left'|'Right')=>t(side==='Left'?'pose.leftHand':'pose.rightHand');
