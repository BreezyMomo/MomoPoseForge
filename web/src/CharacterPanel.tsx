import {useEffect,useRef,useState} from 'react';
import {Upload,LoaderCircle} from 'lucide-react';
import type {PoseEngine} from './PoseEngine';
import type {EngineInfo} from './types';
import {MAX_CHARACTER_BYTES,type AppearanceRef} from './characterAppearance';
import {characterLibrary} from './characterLibrary';
import {t,language} from './workbenchState';
export function CharacterPanel({engine,info,onNotify,onBusy}:{engine:PoseEngine|null;info:EngineInfo;onNotify:(s:string)=>void;onBusy:(busy:boolean)=>void}){
  const [items,setItems]=useState<AppearanceRef[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const builtins=(engine?.activeRig.appearances??[]).map(a=>({id:a.id,name:language.interfaceLanguage()==='en'?a.nameEn:a.name,rig:engine!.activeRig.id,rigVersion:engine!.activeRig.version}));
  const options=[...builtins,...items.filter(i=>!builtins.some(b=>b.id===i.id))];
  const input=useRef<HTMLInputElement>(null),request=useRef(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;setItems([]);setError('');if(engine)void characterLibrary.list(engine.activeRig.id,engine.activeRig.version).then(rows=>{if(alive.current)setItems(rows);}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;request.current++;onBusy(false);};},[engine,onBusy]);
  const choose=async(ref?:AppearanceRef,file?:File)=>{
    if(!engine?.ready)return;const token=++request.current;setError('');setBusy(true);onBusy(true);
    try{
      let bytes:ArrayBuffer|undefined;
      if(file){
        if(!file.name.toLowerCase().endsWith('.glb')||file.size>MAX_CHARACTER_BYTES)throw new Error(t('pose.characterFileLimit'));
        bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes),id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        ref={id,name:file.name.replace(/\.glb$/i,'').slice(0,80)||'Character',rig:engine.activeRig.id,rigVersion:engine.activeRig.version};
      }
      if(ref)await engine.prepareAppearance(ref,bytes);
      if(!alive.current||token!==request.current||engine.disposed)return;
      if(bytes&&ref){await characterLibrary.put({ref,bytes});if(!alive.current||token!==request.current||engine.disposed)return;const added=ref;setItems(previous=>[added,...previous.filter(i=>i.id!==added.id)]);}
      engine.setAppearance(ref);onNotify(t('pose.characterChanged'));
    }catch(e){if(alive.current&&token===request.current)setError((e as Error).message);}
    finally{if(alive.current&&token===request.current){setBusy(false);onBusy(false);}}
  };
  return <section className="inspector-section character-panel" aria-label={t('pose.characterTitle')} aria-busy={busy}>
    <div className="section-label"><h2>{t('pose.characterTitle')}</h2><span>GLB</span></div>
    <label className="character-field">{t('pose.characterLook')}<select aria-label={t('pose.characterLook')} disabled={busy||!info.ready} value={info.appearance?.id??''} onChange={e=>void choose(options.find(i=>i.id===e.target.value))}><option value="">{t('pose.originalCharacter')}</option>{info.appearance&&!options.some(i=>i.id===info.appearance!.id)&&<option value={info.appearance.id}>{info.appearance.name}</option>}{options.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <button className="character-action" disabled={busy||!info.ready} onClick={()=>input.current?.click()}>{busy?<LoaderCircle size={15} className="spin"/>:<Upload size={15}/>} {t(busy?'pose.loadingCharacter':'pose.importCharacter')}</button>
    <input ref={input} type="file" accept=".glb,model/gltf-binary" className="visually-hidden" onChange={e=>{const file=e.target.files?.[0];if(file)void choose(undefined,file);e.target.value='';}}/>
    {error&&<p className="reference-error" role="alert">{error}</p>}
    <p className="field-help">{t('pose.characterHelp')}</p>
    <p className="field-help">{t(engine?.humanoid?'pose.characterHumanHelp':'pose.characterRigHelp')}</p>
    <p className="reference-storage-note">{t('pose.characterStorageHelp')}</p>
  </section>;
}
