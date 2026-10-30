import {useEffect,useRef,useState} from 'react';
import {X,Undo2,Pencil,Trash2,Check} from 'lucide-react';
import {characterLibrary,type CharacterAsset} from './characterLibrary';
import {motionLibrary,unpackMotionAsset,type MotionAsset} from './motionLibrary';
import {REGISTERED_RIGS,findRig} from './rigs';
import type {PoseEngine} from './PoseEngine';
import {t,language} from './workbenchState';
type Row={key:string;id:string;rig:string;version:number;name:string;kind:'character'|'motion';deleted:boolean;source:string;character?:CharacterAsset;motion?:MotionAsset};
export function AssetManager({engine,onClose,onBusy}:{engine:PoseEngine;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true);
  const [rows,setRows]=useState<Row[]>([]),[rig,setRig]=useState(engine.activeRig.id),[trash,setTrash]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState(''),[name,setName]=useState('');
  const load=async()=>{
    const [characters,motions]=await Promise.all([characterLibrary.all(),motionLibrary.all()]);
    if(alive.current)setRows([...characters.map(a=>({key:characterLibraryKey(a),id:a.ref.id,rig:a.ref.rig,version:a.ref.rigVersion,name:a.ref.name,kind:'character' as const,deleted:!!a.deletedAt,source:(a.ref.format??'glb').toUpperCase(),character:a})),...motions.flatMap(a=>a.clips.map(c=>({key:`${a.key}:${c.uuid}`,id:c.uuid,rig:a.rig,version:a.rigVersion,name:c.name,kind:'motion' as const,deleted:!!a.deletedClips?.[c.uuid],source:`${c.duration.toFixed(2)} s`,motion:a})))]);
  };
  useEffect(()=>{alive.current=true;dialog.current?.showModal();void load().catch(e=>setError(e.message)).finally(()=>setLoading(false));return()=>{alive.current=false;onBusy(false);};},[onBusy]);
  const edit=async(row:Row,change:{name?:string;deleted?:boolean})=>{
    setBusy(true);onBusy(true);setError('');try{
      // Validate a restored clip before making it visible in the library.
      const restored=change.deleted===false&&row.motion&&row.rig===engine.activeRig.id&&row.version===engine.activeRig.version?unpackMotionAsset({...row.motion,clips:row.motion.clips.filter(c=>c.uuid===row.id)},engine.activeRig,engine.rest):undefined;
      if(row.character){await characterLibrary.edit(row.character.ref,change);if(change.name)engine.renameAppearance(row.id,change.name.trim(),row.rig);}
      else if(row.motion){await motionLibrary.edit(row.motion.key,row.id,change);if(change.deleted)engine.removeMotion(row.id);else if(change.deleted===false)engine.restoreMotionAsset({...row.motion,clips:row.motion.clips.filter(c=>c.uuid===row.id)});if(change.name)engine.renameMotion(row.id,change.name.trim());}
      setEditing('');await load();
    }catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current){setBusy(false);onBusy(false);}}
  };
  const filtered=rows.filter(r=>(!rig||r.rig===rig)&&r.deleted===trash),groups=[...new Set([...(!trash?REGISTERED_RIGS.filter(r=>!rig||r.id===rig).map(r=>r.id):[]),...filtered.map(r=>r.rig)])];
  const rigLabel=(id:string)=>{const r=findRig(id);return r?(language.interfaceLanguage()==='en'?r.nameEn:r.name):id;};
  return <dialog ref={dialog} className="asset-dialog" aria-labelledby="asset-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}} onClose={onClose}>
    <div className="dialog-header"><h2 id="asset-title">{t('pose.manageAssets')}</h2><button aria-label={t('pose.closeAssets')} disabled={busy} onClick={onClose}><X size={18}/></button></div>
    <p className="dialog-description">{t('pose.assetsIntro')}</p>
    <div className="asset-filters"><label>{t('pose.activeRig')}<select value={rig} disabled={busy} onChange={e=>{setRig(e.target.value);setEditing('');}}><option value="">{t('pose.allRigs')}</option>{[...new Set([...REGISTERED_RIGS.map(r=>r.id),...rows.map(r=>r.rig)])].map(id=><option key={id} value={id}>{rigLabel(id)}</option>)}</select></label><label className="asset-trash"><input type="checkbox" checked={trash} disabled={busy} onChange={e=>{setTrash(e.target.checked);setEditing('');}}/>{t('pose.recycleBin')}</label></div>
    {error&&<p className="reference-error" role="alert">{error}</p>}
    <div className="asset-scroll" aria-busy={busy||loading}>
      {loading?<p className="field-help">{t('pose.assetsLoading')}</p>:groups.map(id=><section className="asset-group" key={id}><h3>{rigLabel(id)}</h3>
        {!trash&&<div className="asset-builtin"><span>{t('pose.originalCharacter')}</span><small>{t('pose.builtinAsset')}</small></div>}
        {!trash&&findRig(id)?.appearances?.map(a=><div className="asset-builtin" key={a.id}><span>{language.interfaceLanguage()==='en'?a.nameEn:a.name}</span><small>{t('pose.builtinAsset')}</small></div>)}
        {filtered.filter(r=>r.rig===id).map(row=><div className="asset-row" key={row.key}>
          {editing===row.key?<form className="asset-rename" onSubmit={e=>{e.preventDefault();void edit(row,{name});}}><input autoFocus aria-label={t('pose.assetName')} value={name} maxLength={80} disabled={busy} onChange={e=>setName(e.target.value)}/><button type="submit" aria-label={t('pose.confirmRename')} disabled={busy||!name.trim()}><Check size={16}/></button><button type="button" aria-label={t('pose.cancelRename')} disabled={busy} onClick={()=>setEditing('')}><X size={16}/></button></form>:<><div className="asset-name"><strong>{row.name}</strong><small>{t(row.kind==='character'?'pose.characterLook':'pose.motionClip')} · {row.source} · v{row.version}{engine.appearance?.id===row.id?` · ${t('pose.assetInUse')}`:''}</small></div>{!trash&&<button disabled={busy} aria-label={`${t('pose.renameAsset')} ${row.name}`} title={t('pose.renameAsset')} onClick={()=>{setEditing(row.key);setName(row.name);}}><Pencil size={15}/></button>}<button disabled={busy} aria-label={`${t(trash?'pose.restoreAsset':'pose.deleteAsset')} ${row.name}`} title={t(trash?'pose.restoreAsset':'pose.deleteAsset')} onClick={()=>void edit(row,{deleted:!trash})}>{trash?<Undo2 size={15}/>:<Trash2 size={15}/>}</button></>}
        </div>)}
        {!filtered.some(r=>r.rig===id)&&<p className="field-help">{t('pose.assetsEmpty')}</p>}
      </section>)}
      {!loading&&!groups.length&&<p className="field-help">{t('pose.trashEmpty')}</p>}
    </div><p className="asset-note">{t('pose.trashHelp')}</p>
  </dialog>;
}
const characterLibraryKey=(a:CharacterAsset)=>`${a.ref.rig}@${a.ref.rigVersion}:${a.ref.id}`;
