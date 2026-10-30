import {createLayoutModel,type LayoutNode} from '@momo/workbench/layout';

// Product registrations stay here; the shared workbench does not know about poses.
const stack=(id:string,panels:string[])=>({kind:'stack' as const,id,panels,active:panels[0]});
const split=(id:string,axis:'x'|'y',ratio:number,first:LayoutNode,second:LayoutNode):LayoutNode=>({kind:'split',id,axis,ratio,first,second});
export const POSE_WORKBENCH_PANELS=[
  {id:'presets',title:'pose.panel.presets',showEdge:'left'},
  {id:'viewport',title:'pose.panel.viewport'},
  {id:'inspector',title:'pose.panel.inspector',showEdge:'right'},
  {id:'views',title:'pose.panel.views',showEdge:'bottom'},
] as const;
export const POSE_WORKBENCH_KEY='momo-pose-forge:workspace-layouts:v1';
export const createPoseLayout=(compact=false)=>createLayoutModel({
  panels:POSE_WORKBENCH_PANELS.map(panel=>({...panel})),
  anchorPanel:'viewport',
  storageKey:POSE_WORKBENCH_KEY,
  defaultPreset:'default',
  presets:{
    default:()=>({root:compact?stack('pose-compact',['viewport']):split('pose-columns','x',.18,stack('pose-presets',['presets']),split('pose-center-right','x',.73,split('pose-center','y',.72,stack('pose-viewport',['viewport']),stack('pose-views',['views'])),stack('pose-inspector',['inspector']))),floats:[]}),
    focus:()=>({root:stack('pose-focus',['viewport']),floats:[]}),
    inspect:()=>({root:compact?stack('pose-compact-properties',['inspector']):split('pose-inspect','x',.66,stack('pose-inspect-viewport',['viewport']),stack('pose-inspect-properties',['inspector'])),floats:[]}),
    presets:()=>({root:stack('pose-library',['presets']),floats:[]}),
    inspector:()=>({root:stack('pose-properties',['inspector']),floats:[]}),
  },
});
export const poseLayout=createPoseLayout();
