import {useEffect,useRef,useState} from 'react';
import {Download,X,LoaderCircle} from 'lucide-react';
import type {PoseEngine} from './PoseEngine';
import {createProjectBundle} from './projectBundle';
import {download,safeName,saveProject} from './files';
import {t} from './workbenchState';
export function ProjectSaveDialog({engine,onClose,onBusy}:{engine:PoseEngine;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[clips]=useState(()=>engine.motion?.importedClips()??[]),[selected,setSelected]=useState<string[]>(()=>{const s=engine.motion?.state();return s?.clip?[s.clip]:[];}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();return()=>onBusy(false);},[onBusy]);
  const save=async()=>{setBusy(true);onBusy(true);setError('');try{const doc=engine.snapshot(),blob=await createProjectBundle(doc,engine.activeRig,clips.filter(c=>selected.includes(c.uuid)),engine.motion?.state());download(blob,`${safeName(doc.name)}.poseforge`);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}};
  const appearance=engine.appearance,builtin=!appearance||engine.activeRig.appearances?.some(a=>a.id===appearance.id);
  return <dialog ref={dialog} className="asset-dialog project-save-dialog" aria-labelledby="save-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}} onClose={onClose}>
    <div className="dialog-header"><h2 id="save-title">{t('pose.save')}</h2><button aria-label={t('pose.closeSave')} disabled={busy} onClick={onClose}><X size={18}/></button></div>
    <p className="dialog-description">{t('pose.bundleIntro')}</p>
    <div className="bundle-summary"><strong>{engine.snapshot().name}</strong><span>{appearance?.name??t('pose.originalCharacter')} · {t(builtin?'pose.bundledCharacterRef':'pose.bundledCharacterIncluded')}</span><small>{t('pose.bundleSceneHelp')}</small></div>
    <div className="asset-section-heading"><h3>{t('pose.bundleMotions')}</h3>{clips.length>0&&<button disabled={busy} onClick={()=>setSelected(selected.length===clips.length?[]:clips.map(c=>c.uuid))}>{t(selected.length===clips.length?'pose.selectNone':'pose.selectAll')}</button>}</div>
    <div className="bundle-clips">{clips.length?clips.map(c=><label key={c.uuid}><input type="checkbox" checked={selected.includes(c.uuid)} disabled={busy} onChange={e=>setSelected(old=>e.target.checked?[...old,c.uuid]:old.filter(id=>id!==c.uuid))}/><span>{c.name}<small>{c.duration.toFixed(2)} s</small></span></label>):<p className="field-help">{t('pose.bundleNoMotions')}</p>}</div>
    {error&&<p className="reference-error" role="alert">{error}</p>}
    <div className="dialog-footer"><button disabled={busy} onClick={()=>{saveProject(engine.snapshot());onClose();}}>{t('pose.saveLightJson')}</button><button className="primary-button" disabled={busy} onClick={()=>void save()}>{busy?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>} {t(busy?'pose.savingBundle':'pose.saveBundle')}</button></div>
  </dialog>;
}
