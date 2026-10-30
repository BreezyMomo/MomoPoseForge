import {gestureName,currentGestureName} from './productLabels';
import {t} from './workbenchState';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeftRight,Download,Hand,Plus,Trash2,Upload} from 'lucide-react';
import type {PoseEngine} from './PoseEngine';
import type {EngineInfo,Side} from './types';
import {HAND_GESTURES,HAND_LIBRARY_KEY,handLibraryKey,MAX_SAVED_HANDS,handLibraryDocument,parseHandLibrary,type HandGesture} from './handGestures';
import {XBOT_RIG} from './rigs';
import {HandPreview} from './HandPreview';
import {download} from './files';

export function HandPanel({engine,info,side,onSide,onFine,onNotify}:{engine:PoseEngine|null;info:EngineInfo;side:Side;onSide:(side:Side)=>void;onFine:()=>void;onNotify:(message:string)=>void}){
  const rig=engine!.activeRig,storageKey=handLibraryKey(rig);
  const [saved,setSaved]=useState<HandGesture[]>([]),[loaded,setLoaded]=useState(false),[tab,setTab]=useState<'builtins'|'saved'>('builtins'),[name,setName]=useState(''),[error,setError]=useState(''),[removed,setRemoved]=useState<HandGesture|null>(null);
  const [images,setImages]=useState<Record<string,string>>({}),[previewError,setPreviewError]=useState(''),[retry,setRetry]=useState(0);
  const input=useRef<HTMLInputElement>(null),cache=useRef(new Map<string,string>()),sideName=side==='Left'?t('pose.leftHand'):t('pose.rightHand');
  useEffect(()=>{try{const raw=localStorage.getItem(storageKey)??(rig.id===XBOT_RIG.id?localStorage.getItem(HAND_LIBRARY_KEY):null);if(raw)setSaved(parseHandLibrary(raw,rig));}catch(e){setError(`本机手势库无法读取：${(e as Error).message}`);}setLoaded(true);},[storageKey]);
  useEffect(()=>{
    if(!engine||!info.ready||!loaded)return;let cancelled=false,preview:HandPreview|undefined;
    const gestures=[...HAND_GESTURES,...saved];setImages({});setPreviewError('');
    void(async()=>{try{
      for(const g of gestures){const key=JSON.stringify([side,g.values]);let url=cache.current.get(key);if(!url){await new Promise(r=>setTimeout(r,0));if(cancelled)return;preview??=new HandPreview(engine);url=preview.render(side,g.values);cache.current.set(key,url);}if(cancelled)return;setImages(p=>({...p,[JSON.stringify(g.values)]:url!}));}
    }catch{if(!cancelled)setPreviewError('手势缩略图生成失败，可以重试；仍可按名称应用手势。');}finally{preview?.dispose();}})();
    return()=>{cancelled=true;preview?.dispose();};
  },[engine,info.ready,loaded,side,saved,retry]);
  const persist=(next:HandGesture[])=>{try{localStorage.setItem(storageKey,JSON.stringify(handLibraryDocument(next,rig)));setSaved(next);setError('');return true;}catch{setError('无法保存本机手势库，请导出手势库备份后重试');return false;}};
  const save=()=>{if(!engine||!name.trim())return;if(saved.length>=MAX_SAVED_HANDS){setError(`最多保存 ${MAX_SAVED_HANDS} 个手势，请先导出备份或移除不需要的手势`);return;}const next={id:crypto.randomUUID(),name:name.trim(),values:engine.captureHand(side)};if(persist([...saved,next])){setName('');setTab('saved');onNotify(`已收藏${sideName}手势，可用于左右任一只手`);}};
  const apply=(g:HandGesture,builtin:boolean)=>{try{engine?.applyHandGesture(side,g.values,builtin?g.name:'自定义');onNotify(`已将“${g.name}”应用到${sideName}`);}catch(e){setError((e as Error).message);}};
  const importFile=async(file:File)=>{try{if(file.size>150_000)throw new Error('手势库超过 150 KB');const incoming=parseHandLibrary(await file.text(),rig),next=[...saved,...incoming.filter(g=>!saved.some(s=>s.id===g.id))];if(next.length>MAX_SAVED_HANDS)throw new Error(`合并后超过 ${MAX_SAVED_HANDS} 个手势`);if(persist(next)){setRemoved(previous=>next.some(g=>g.id===previous?.id)?null:previous);setTab('saved');onNotify(`已导入 ${next.length-saved.length} 个手势`);}}catch(e){setError((e as Error).message);}};
  const entries=tab==='builtins'?HAND_GESTURES:saved;
  return <section className="inspector-section hand-library"><div className="section-label"><h2>{t('pose.gestureLibrary')}</h2><Hand size={15}/></div><p className="field-help">{t('pose.gestureHelp')}</p>
    <div className="hand-target" aria-label={t('pose.gestureTarget')}>{(['Left','Right'] as const).map(s=><button key={s} disabled={!info.ready} aria-pressed={side===s} onClick={()=>onSide(s)}>{s==='Left'?t('pose.leftHand'):t('pose.rightHand')}</button>)}</div><div className="hand-current"><span>{sideName}{t('pose.currentGesture')}</span><strong>{currentGestureName(info.hands[side])}</strong></div>
    <div className="hand-copy"><button disabled={!info.ready} onClick={()=>{engine?.copyHand(side);onNotify(`已将${sideName}镜像复制到${side==='Left'?t('pose.rightHand'):t('pose.leftHand')}`);}}><ArrowLeftRight size={13}/>{sideName} → {side==='Left'?t('pose.rightHand'):t('pose.leftHand')}</button><button disabled={!info.ready} onClick={onFine}>{t('pose.handCloseup')}</button></div>
    <div className="hand-library-tabs"><button aria-pressed={tab==='builtins'} onClick={()=>setTab('builtins')}>{t('pose.commonGestures')}{HAND_GESTURES.length}</button><button aria-pressed={tab==='saved'} onClick={()=>setTab('saved')}>{t('pose.myGestures')}{saved.length}</button></div>
    {previewError&&<p className="hand-error" role="alert">{previewError}<button onClick={()=>setRetry(v=>v+1)}>{t('pose.retryThumbnail')}</button></p>}
    <div className="hand-gesture-grid">{entries.map(g=><div key={g.id} className="hand-gesture-item"><button disabled={!info.ready} className="hand-gesture" aria-label={`应用${g.name}到${sideName}`} aria-pressed={tab==='builtins'&&info.hands[side]===g.name} onClick={()=>apply(g,tab==='builtins')}><span className="hand-gesture-preview">{images[JSON.stringify(g.values)]?<img src={images[JSON.stringify(g.values)]} alt={`${g.name} ${sideName}真实模型预览`}/>:<span>{t('pose.previewing')}</span>}</span><span>{gestureName(g,tab==='builtins')}</span></button>{tab==='saved'&&<button className="hand-delete" aria-label={`移除手势 ${g.name}`} onClick={()=>{if(persist(saved.filter(s=>s.id!==g.id)))setRemoved(g);}}><Trash2 size={12}/></button>}</div>)}</div>
    {tab==='saved'&&!entries.length&&<p className="hand-empty">{t('pose.emptyGestures')}</p>}
    {removed&&<div className="hand-removed"><span>{t('pose.removed')}{removed.name}</span><button disabled={saved.length>=MAX_SAVED_HANDS} onClick={()=>{if(persist([...saved,removed]))setRemoved(null);}}>{t('pose.undoRemove')}</button></div>}
    <div className="hand-save"><label>{t('pose.saveCurrentPrefix')}{sideName}<input aria-label={t('pose.gestureName')} placeholder={t('pose.gesturePlaceholder')} value={name} maxLength={40} disabled={!info.ready||!loaded} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}}/></label><button disabled={!info.ready||!loaded||!name.trim()} onClick={save}><Plus size={14}/>{t('pose.saveGesture')}</button></div>
    {error&&<p className="hand-error" role="alert">{error}</p>}
    <div className="hand-library-files"><button disabled={!loaded||!saved.length} onClick={()=>download(new Blob([JSON.stringify(handLibraryDocument(saved,rig),null,2)],{type:'application/json'}),'momo-hand-library.json')}><Download size={13}/>{t('pose.exportGestures')}</button><button disabled={!loaded} onClick={()=>input.current?.click()}><Upload size={13}/>{t('pose.importGestures')}</button><input ref={input} type="file" accept=".json,application/json" className="visually-hidden" aria-label={t('pose.importGesturesFile')} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importFile(file);}}/></div><p className="field-help">{t('pose.gestureStoragePrefix')}{MAX_SAVED_HANDS}{t('pose.gestureStorageSuffix')}</p>
  </section>;
}
