import {useEffect,useRef,useState} from 'react';
import {Play,Pause,SkipBack,SkipForward,Check,Undo2,Upload,LoaderCircle} from 'lucide-react';
import type {PoseEngine} from './PoseEngine';
import type {EngineInfo} from './types';
import {t} from './workbenchState';
import {motionLibrary,packMotionAsset} from './motionLibrary';
export function MotionPanel({engine,info,onCapture,onBusy,onNotify}:{engine:PoseEngine|null;info:EngineInfo;onCapture:()=>void;onBusy:(busy:boolean)=>void;onNotify:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const file=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;setBusy(false);setError('');return()=>{alive.current=false;abort.current?.abort();onBusy(false);};},[engine,onBusy]);
  const importFile=async(file:File)=>{
    if(!engine?.ready)return;abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setError('');onBusy(true);
    try{
      const clips=await engine.prepareMotionImport(file,controller.signal);
      if(!alive.current||controller.signal.aborted||engine.disposed)return;
      await motionLibrary.put(packMotionAsset(clips),controller.signal);
      if(!alive.current||controller.signal.aborted||engine.disposed)return;
      engine.installImportedMotions(clips);engine.previewMotion(clips[0].uuid);onNotify(t('pose.motionImported',clips.length));
    }catch(e){if(alive.current&&!controller.signal.aborted)setError((e as Error).message);}
    finally{if(alive.current&&abort.current===controller){setBusy(false);onBusy(false);abort.current=null;}}
  };
  const motion=info.motion,clip=motion?.clips.find(c=>c.id===motion.clip)??motion?.clips[0];
  const label=(name:string)=>({Survey:t('pose.motionSurvey'),Walk:t('pose.motionWalk'),Run:t('pose.motionRun')}[name]??name);
  return <section className="motion-panel" aria-label={t('pose.motionTitle')} aria-busy={busy}>
    {engine?.activeRig.motionImport&&<><button className="character-action motion-import-button" disabled={busy||!info.ready} onClick={()=>file.current?.click()}>{busy?<LoaderCircle size={15} className="spin"/>:<Upload size={15}/>} {t(busy?'pose.motionImporting':'pose.importMotion')}</button><input ref={file} className="visually-hidden" type="file" accept=".fbx,.glb" onChange={e=>{const value=e.target.files?.[0];if(value)void importFile(value);e.target.value='';}}/>{busy&&<button className="character-action" onClick={()=>abort.current?.abort()}>{t('pose.cancelMotionImport')}</button>}</>}
    {error&&<p className="reference-error" role="alert">{error}</p>}
    {!clip?<><h3>{t('pose.motionTitle')}</h3><p className="field-help">{t(engine?.activeRig.motionImport?'pose.noMotions':'pose.motionImportUnsupported')}</p></>:<>
    <label className="character-field motion-clip-field"><span className="visually-hidden">{t('pose.motionClip')}</span><select aria-label={t('pose.motionClip')} disabled={busy} value={clip.id} onChange={e=>engine?.previewMotion(e.target.value)}>{motion!.clips.map(c=><option key={c.id} value={c.id}>{c.imported?`${c.imported.fileName.replace(/\.[^.]+$/,'')} · ${c.name}`:label(c.name)}</option>)}</select></label>
    <div className="motion-meta"><span>{clip.duration.toFixed(3)} s</span><span>{t('pose.sampleFrames',clip.frames)}</span></div>
    <div className="motion-transport">
      <button disabled={busy||!motion?.active} title={t('pose.previousFrame')} aria-label={t('pose.previousFrame')} onClick={()=>engine?.seekMotion((motion?.frame??0)-1)}><SkipBack size={16}/></button>
      <button className="motion-play" disabled={busy} aria-label={t(motion?.playing?'pose.pauseMotion':'pose.playMotion')} onClick={()=>{if(!motion?.active){engine?.previewMotion(clip.id);if(motion?.clip===clip.id)engine?.seekMotion(motion.frame);}engine?.playMotion(!motion?.playing);}}>{motion?.playing?<Pause size={17}/>:<Play size={17}/>}<span>{t(motion?.playing?'pose.pauseMotion':'pose.playMotion')}</span></button>
      <button disabled={busy||!motion?.active} title={t('pose.nextFrame')} aria-label={t('pose.nextFrame')} onClick={()=>engine?.seekMotion((motion?.frame??0)+1)}><SkipForward size={16}/></button>
    </div>
    <input className="motion-seek" type="range" min={0} max={clip.frames-1} step={1} value={motion?.clip===clip.id?motion.frame:0} disabled={busy||!motion?.active} aria-label={t('pose.motionFrame')} onInput={e=>engine?.seekMotion(Number(e.currentTarget.value))}/>
    <div className="motion-meta"><span>{motion?.clip===clip.id?motion.time.toFixed(3):'0.000'} s</span><span>{(motion?.clip===clip.id?motion.frame:0)+1} / {clip.frames}</span></div>

    <button className="character-action primary-button" disabled={busy||!motion?.active} onClick={()=>{engine?.captureMotion();onCapture();}}><Check size={15}/>{t('pose.captureMotion')}</button>
    <button className="character-action" disabled={busy||!motion?.active} onClick={()=>engine?.cancelMotion()}><Undo2 size={14}/>{t('pose.cancelMotion')}</button>
    {clip.imported&&<><label className="setting-row"><span>{t('pose.motionInPlace')}</span><input type="checkbox" checked={motion?.inPlace??true} onChange={e=>engine?.setMotionInPlace(e.target.checked)}/></label><p className="field-help motion-source-note">{t('pose.motionAdapted',clip.imported.sampleRate)}</p>{clip.imported.ignoredTranslations>0&&<p className="field-help motion-source-note">{t('pose.motionBoneLengths')}</p>}</>}
    <label className="character-field">{t('pose.motionSpeed')}<select aria-label={t('pose.motionSpeed')} value={motion?.speed??1} onChange={e=>engine?.configureMotion(Number(e.target.value),motion?.loop??true)}>{[.25,.5,1,2].map(s=><option key={s} value={s}>{s}×</option>)}</select></label>
    <label className="setting-row"><span>{t('pose.loopMotion')}</span><input type="checkbox" checked={motion?.loop??true} onChange={e=>engine?.configureMotion(motion?.speed??1,e.target.checked)}/></label>
    <p className="field-help">{t('pose.motionHelp')}</p>
    <p className="field-help">{t('pose.motionLimits')}</p>
    </>}
    {engine?.activeRig.motionImport&&<p className="field-help">{t('pose.motionImportHelp')}</p>}
  </section>;
}
