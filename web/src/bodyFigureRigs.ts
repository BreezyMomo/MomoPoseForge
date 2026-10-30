import type {RigDefinition,RigJointControl} from './rigs';

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
  return {
    id:`momo-${variant}-fk`,version:1,name,nameEn,description:'绘画素体 · 逐关节旋转、整体移动；手指逐节 FK',descriptionEn:'Drawing figure · joint rotation, placement and finger FK',
    strategy:'fk',units:'metres',up:'+Y',forward:'+Z',root:'pelvis',initialSelection:'chest',
    asset:{kind:'gltf',url:`/models/body-figures/${variant}.glb`,profileUrl:`/models/body-figures/${variant}-profile.json`},
    sourceUrl:'/models/body-figures/BODY-FIGURES.md',license:'CC0 (source page declaration)',
    attribution:{authors:'vinchau',source:'https://blendswap.com/blend/23521',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',changes:'Converted user-supplied Blender asset to metre-scale glTF with independent 53-joint FK skeletons; consolidated Rigify deformation helpers and weights; retained source proportions; plain clay material; no Blender controllers or animations.'},
    editableJoints:controls.map(c=>c.name),jointControls:controls,chains:{},contacts:[],mirrorPairs:[],
    capabilities:{hands:false,fullBodyIK:false,pins:false,floor:false,mirror:false,openPose:false,partialPresets:false},
    presets:[{id:'neutral',name:'中立姿态',category:'基础',description:'恢复此素体的自然静止姿态'}],
  };
}
export const BODYCHAN_RIG=figure('bodychan','BodyChan 女素体 · FK','BodyChan female · FK');
export const BODYKUN_RIG=figure('bodykun','BodyKun 男素体 · FK','BodyKun male · FK');
