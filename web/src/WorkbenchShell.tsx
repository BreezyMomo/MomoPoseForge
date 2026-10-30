import {useLayoutEffect,useMemo,useRef,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {createDockWorkspace,type DockWorkspace} from '@momo/workbench/dock';
import {createPoseLayout,POSE_WORKBENCH_PANELS,POSE_WORKBENCH_KEY} from './workbenchLayout';
import {t,language} from './workbenchState';
import '@momo/workbench/dock.css';
import '@momo/workbench/motion.css';
import './workbench.css';

type PanelId=typeof POSE_WORKBENCH_PANELS[number]['id'];
export function WorkbenchShell({panels,menuHost,managerRef,onMessage}:{panels:Record<PanelId,ReactNode>;menuHost:RefObject<HTMLDivElement|null>;managerRef:RefObject<DockWorkspace|null>;onMessage:(message:string)=>void}){
  const host=useRef<HTMLDivElement>(null),message=useRef(onMessage);message.current=onMessage;
  const containers=useMemo(()=>Object.fromEntries(POSE_WORKBENCH_PANELS.map(({id})=>{const node=document.createElement('div');node.className=`pose-workbench-panel pose-workbench-${id}`;node.dataset.workbenchPanel=id;return[id,node];})),[]);
  useLayoutEffect(()=>{
    if(!host.current||!menuHost.current)return;
    const compact=window.matchMedia('(max-width:900px)').matches;
    const manager=createDockWorkspace({
      host:host.current,menuHost:menuHost.current,panels:containers,model:createPoseLayout(compact),storageKey:POSE_WORKBENCH_KEY+(compact?':compact':''),
      ui:{text:t,format:(key:string,...values:unknown[])=>t(key,...values),onLanguageChange:language.onLanguageChange},
      menuPresets:[{id:'default',title:'layout.restoreDefaultLayout'},{id:'focus',title:'layout.focusCanvas'},{id:'inspect',title:'pose.layout.inspect'}],
      onMessage:(value:string)=>message.current(value),
    });
    managerRef.current=manager;
    return()=>{managerRef.current=null;manager.dispose();};
  },[containers,menuHost,managerRef]);
  return <><div ref={host} className="pose-workbench" aria-label={t('pose.workbench')}/>{Object.entries(panels).map(([id,content])=>createPortal(content,containers[id],id))}</>;
}
