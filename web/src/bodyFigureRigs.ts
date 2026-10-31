import type {RigDefinition,RigJointControl} from './rigs';
import type {Vec3} from './types';
import {DIGITS} from './types';
import {PRESETS} from './presets';
import chanProfile from '../public/models/body-figures/bodychan-profile.json';
import kunProfile from '../public/models/body-figures/bodykun-profile.json';

const controls:RigJointControl[]=[
  ...[['pelvis','骨盆','Pelvis'],['waist','腰部','Waist'],['spine','脊柱','Spine'],['chest','胸腔','Chest'],['upper_chest','上胸','Upper chest'],['neck','颈部','Neck'],['head','头部','Head']].map(([name,label,labelEn])=>({name,label,labelEn})),
  ...(['left','right'] as const).flatMap(side=>{
    const zh=side==='left'?'左':'右',en=side==='left'?'Left':'Right';
    return [
      ...[['shoulder','肩','shoulder'],['upper_arm','上臂','upper arm'],['forearm','肘','elbow'],['hand','手腕','wrist'],['thigh','髋','hip'],['shin','膝','knee'],['foot','踝','ankle'],['toe','脚趾','toes']].map(([name,label,labelEn])=>({name:`${side}_${name}`,label:zh+label,labelEn:`${en} ${labelEn}`})),
      ...[['thumb','拇指','thumb'],['index','食指','index'],['middle','中指','middle'],['ring','无名指','ring'],['little','小指','little']].flatMap(([digit,label,labelEn])=>[1,2,3].map(i=>({name:`${side}_${digit}_${i}`,label:`${zh}手${label} · 第 ${i} 节`,labelEn:`${en} ${labelEn} · ${i}`}))),
    ];
  }),
];
function figure(variant:'bodychan'|'bodykun',name:string,nameEn:string):RigDefinition{
  // Axes are measured in each model's own lower-joint bind frame. Corrected
  // mechanical knee centers have their own straight angle, separate from limits.
  const female=variant==='bodychan',profile=female?chanProfile:kunProfile;
  const joints=controls.map(control=>{
    const side=control.name.startsWith('left_')?1:-1;
    if(control.name.endsWith('_forearm')){
      const angle=(female ? .2572670408383215 : .42519480096665463)*180/Math.PI;
      return {...control,ikHinge:{axis:(female?[.4832720626,0,-side*.8754702448]:[-.80309581,0,-side*.59584994]) as Vec3,min:-angle,max:155-angle}};
    }
    if(control.name.endsWith('_shin')){
      const hinge=profile.kneeHinges[control.name as keyof typeof profile.kneeHinges];
      return {...control,ikHinge:{...hinge,axis:hinge.axis as Vec3}};
    }
    return control;
  });
  return {
    id:`momo-${variant}-fk`,version:1,name,nameEn,description:'四肢 IK、动作与手势库、手脚固定及身体/手指 FK',descriptionEn:'Limb IK, pose/hand libraries, pins and body/finger FK',
    strategy:'articulated',units:'metres',up:'+Y',forward:'+Z',root:'pelvis',initialSelection:'left_hand',
    asset:{kind:'gltf',url:`/models/body-figures/${variant}.glb`,profileUrl:`/models/body-figures/${variant}-profile.json`},
    sourceUrl:'/models/body-figures/BODY-FIGURES.md',license:'CC0 (source page declaration)',
    attribution:{authors:'vinchau',source:'https://blendswap.com/blend/23521',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',changes:'Converted user-supplied Blender asset to metre-scale glTF with independent 53-joint FK skeletons; consolidated Rigify deformation helpers and weights; calibrated knee pivots to the source spherical joints and rigidly weighted knee caps; retained source mesh proportions and FK bind axes; plain clay material; no Blender controllers or animations.'},
    editableJoints:controls.map(c=>c.name),jointControls:joints,
    figureHeight:female?1.68:1.78,
    calibration:{version:1,legacyPositions:Object.fromEntries(Object.entries(profile.legacyPositions).map(([name,p])=>[name,[p[0],p[1],p[2]] as Vec3])),chains:['left_foot','right_foot']},
    handSkeleton:Object.fromEntries((['Left','Right'] as const).map(side=>[side,{wrist:`${side.toLowerCase()}_hand`,digits:Object.fromEntries(DIGITS.map(d=>[d,[1,2,3].map(j=>`${side.toLowerCase()}_${d.toLowerCase()}_${j}`)]))}])) as RigDefinition['handSkeleton'],
    bendControls:{left_hand:[0,-1,-1],right_hand:[0,-1,-1],left_foot:[0,0,1],right_foot:[0,0,1]},
    drawingGuides:{head:'head',pelvis:'pelvis',chest:'chest',leftShoulder:'left_upper_arm',rightShoulder:'right_upper_arm'},
    ik:{solver:'constrained-fk',version:1,contactType:'hands-feet'},
    chains:{left_hand:['left_upper_arm','left_forearm','left_hand'],right_hand:['right_upper_arm','right_forearm','right_hand'],left_foot:['left_thigh','left_shin','left_foot'],right_foot:['right_thigh','right_shin','right_foot']},
    contacts:['left_hand','right_hand','left_foot','right_foot'],supportContacts:['left_foot','right_foot'],supportOrientation:true,mirrorPairs:[],
    capabilities:{hands:true,fullBodyIK:false,pins:true,floor:false,mirror:false,openPose:false,partialPresets:false},
    presets:PRESETS.filter(p=>!['cross-sit','kneel','both-kneel'].includes(p.id)).map(p=>({...p,...(p.id==='neutral'?{name:'中立姿态',description:'恢复此素体的自然静止姿态'}:{})})),
  };
}
// Stable historical IDs keep existing FK projects and actor drafts readable.
export const BODYCHAN_RIG=figure('bodychan','BodyChan 女素体 · IK / FK','BodyChan female · IK / FK');
export const BODYKUN_RIG=figure('bodykun','BodyKun 男素体 · IK / FK','BodyKun male · IK / FK');
