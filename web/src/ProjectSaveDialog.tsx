import {useEffect,useRef,useState} from 'react';
import {Download,X,LoaderCircle} from 'lucide-react';
import type {PoseEngine} from './PoseEngine';
import {createSceneBundle,sceneClipKey} from './sceneBundle';
import {download,safeName} from './files';
import {t} from './workbenchState';
export function ProjectSaveDialog({engine,onClose,onBusy}:{engine:PoseEngine;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[actors]=useState(()=>engine.actorMotions()),[selected,setSelected]=useState<string[]>(()=>engine.actorMotions().flatMap(a=>a.state?.clip&&a.clips.some(c=>c.uuid===a.state!.clip)?[sceneClipKey(a.actorId,a.state.clip)]:[])),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const clips=actors.flatMap(a=>a.clips.map(clip=>({clip,id:sceneClipKey(a.actorId,clip.uuid),actorName:a.name})));
  useEffect(()=>{dialog.current?.showModal();return()=>onBusy(false);},[onBusy]);
  const save=async()=>{setBusy(true);onBusy(true);setError('');try{const doc=engine.sceneSnapshot(),blob=await createSceneBundle(doc,actors,selected);download(blob,`${safeName(doc.name)}.poseforge`);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}};
  return <dialog ref={dialog} className="asset-dialog project-save-dialog" aria-labelledby="save-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}} onClose={onClose}>
    <div className="dialog-header"><h2 id="save-title">{t('pose.save')}</h2><button aria-label={t('pose.closeSave')} disabled={busy} onClick={onClose}><X size={18}/></button></div>
    <p className="dialog-description">{t('pose.bundleIntro')}</p>
    <div className="bundle-summary"><strong>{engine.name}</strong>{engine.sceneSnapshot().actors.map(a=><span key={a.id}>{a.name} · {a.pose.appearance?.name??t('pose.originalCharacter')}</span>)}<small>{t('pose.bundleSceneHelp')}</small></div>
    <div className="asset-section-heading"><h3>{t('pose.bundleMotions')}</h3>{clips.length>0&&<button disabled={busy} onClick={()=>setSelected(selected.length===clips.length?[]:clips.map(c=>c.id))}>{t(selected.length===clips.length?'pose.selectNone':'pose.selectAll')}</button>}</div>
    <div className="bundle-clips">{clips.length?clips.map(c=><label key={c.id}><input type="checkbox" checked={selected.includes(c.id)} disabled={busy} onChange={e=>setSelected(old=>e.target.checked?[...old,c.id]:old.filter(id=>id!==c.id))}/><span>{c.clip.name}<small>{c.actorName} · {c.clip.duration.toFixed(2)} s</small></span></label>):<p className="field-help">{t('pose.bundleNoMotions')}</p>}</div>
    {error&&<p className="reference-error" role="alert">{error}</p>}
    <div className="dialog-footer"><button disabled={busy} onClick={()=>{const doc=engine.sceneSnapshot();download(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),`${safeName(doc.name)}.scene.json`);onClose();}}>{t('pose.saveLightScene')}</button><button className="primary-button" disabled={busy} onClick={()=>void save()}>{busy?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>} {t(busy?'pose.savingBundle':'pose.saveBundle')}</button></div>
  </dialog>;
}
