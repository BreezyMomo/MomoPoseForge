import {useEffect,useRef,useState,type RefObject} from 'react';
import {Download,LoaderCircle} from 'lucide-react';
import type {PoseEngine} from './PoseEngine';
import {encodeModelGlb,type ModelExportOptions} from './modelExport';
import {download,safeName} from './files';
import {t} from './workbenchState';
import './modelExport.css';

export function ModelExportPanel({engine,busy,onBusy,onDone,abortRef}:{engine:PoseEngine;busy:boolean;onBusy:(busy:boolean)=>void;onDone:()=>void;abortRef:RefObject<AbortController|null>}){
  const [options,setOptions]=useState<ModelExportOptions>({mode:'static',scope:'scene'}),[error,setError]=useState(''),running=useRef(false);
  const actors=engine.actorList().filter(a=>a.visible&&(options.scope==='scene'||a.id===engine.info().activeActor)),props=options.scope==='scene'?(engine.props??[]).filter(p=>p.visible).length:0;
  useEffect(()=>()=>{abortRef.current?.abort();},[abortRef]);
  const save=async()=>{
    if(running.current)return;running.current=true;onBusy(true);setError('');const abort=new AbortController();abortRef.current=abort;
    try{const snapshot=engine.snapshotModelExport(options),bytes=await encodeModelGlb(snapshot,abort.signal);download(new Blob([bytes],{type:'model/gltf-binary'}),`${safeName(engine.name)}-${options.scope}-${options.mode}.glb`,{format:options.mode==='static'?'glb-static':'glb-rigged',scope:options.scope});onDone();}
    catch(e){if((e as Error).name!=='AbortError'){const message=(e as Error).message;setError(message.startsWith('pose.')?t(message):`${t('pose.modelExportFailed')}：${message}`);}}
    finally{running.current=false;onBusy(false);if(abortRef.current===abort)abortRef.current=null;}
  };
  return <>
    <div className="export-scroll model-export-content">
      <p className="dialog-description">{t('pose.modelExportIntro')}</p>
      <fieldset disabled={busy}>
        <legend>{t('pose.modelExportMode')}</legend>
        <div className="model-export-choices">{(['static','rigged'] as const).map(mode=><label key={mode} className="model-export-choice"><input type="radio" name="model-mode" value={mode} checked={options.mode===mode} onChange={()=>setOptions({...options,mode})}/><span>{t(mode==='static'?'pose.modelStatic':'pose.modelRigged')}<small>{t(mode==='static'?'pose.modelStaticHelp':'pose.modelRiggedHelp')}</small></span></label>)}</div>
        <label className="model-export-scope">{t('pose.exportScope')}<select value={options.scope} onChange={e=>setOptions({...options,scope:e.target.value as ModelExportOptions['scope']})}><option value="scene">{t('pose.modelScene')}</option><option value="selected">{t('pose.modelSelected')}</option></select></label>
      </fieldset>
      <div className="model-export-summary"><strong>{t('pose.modelExportSummary',actors.length,props)}</strong><p>{actors.map(a=>a.name).join('、')||t('pose.modelExportNoActors')}</p><small>{t('pose.modelPlacementHelp')}</small></div>
      <p className="field-help">{t('pose.modelExportControlsHelp')}</p>
      <p className="field-help">{t('pose.modelEngineHelp')}</p>
      {error&&<p className="reference-error" role="alert">{error}</p>}
    </div>
    <div className="dialog-footer"><span role="status">{busy?<><LoaderCircle size={14} className="spin"/>{t('pose.modelEncoding')}</>:t('pose.modelLocal')}</span>{busy?<button onClick={()=>abortRef.current?.abort()}>{t('pose.cancelExport')}</button>:<button className="primary-button" disabled={!actors.length&&!props} onClick={()=>void save()}><Download size={16}/>{t('pose.modelDownload')}</button>}</div>
  </>;
}
