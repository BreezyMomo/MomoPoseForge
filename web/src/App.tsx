import {t,useLanguage,language} from './workbenchState';
import {WorkbenchShell} from './WorkbenchShell';
import {WorkbenchPreferences} from './WorkbenchPreferences';
import {HelpMenu} from './HelpMenu';
import type {DockWorkspace} from '@momo/workbench/dock';
import { useCallback, useEffect, useRef, useState, type ElementType } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Bone, Box, Camera, Check, ChevronDown, ChevronRight, CircleHelp, Copy, Download, Expand, FolderOpen, Grid2X2, Hand, ImagePlus, Layers2, LoaderCircle, LockKeyhole, Maximize, MousePointer2, Move3D, Plus, Pencil, Rotate3D, RotateCcw, Search, Settings2, Undo2, Redo2, UnlockKeyhole, X } from 'lucide-react';
import { PoseEngine,type SceneLoadOptions } from './PoseEngine';
import {sitePath,manualPath} from './sitePaths';
import {PRESET_SCOPES,type PresetScope} from './presetScopes';
import { DEFAULT_VIEWS, type Side, type EngineInfo, type PoseDocument } from './types';
import { exportPose, parseDocument, documentRig, type ExportOptions } from './files';
import {MAX_PROJECT_BYTES} from './projectBundle';
import {readSceneBundle,scenePackageOptions,type ScenePackage} from './sceneBundle';
import {AssetManager} from './AssetManager';
import {ProjectSaveDialog} from './ProjectSaveDialog';
import {RIGS,rigOptions,XBOT_RIG,requireRig,rigStorageKey,readRigStorage,type RigDefinition} from './rigs';
import {SCENE_DRAFT_KEY,sceneHistory,sceneFromPose,readSceneDocument,relocatePose,type SceneDocument} from './sceneDocument';
import {SceneActorsPanel} from './SceneActorsPanel';
import {partName,presetName,presetDescription,categoryName,scopeName,scopeHelp,viewName,partControl,currentGestureName} from './productLabels';
import {emptyHandValues} from './articulation';
import {FineControls} from './FineControls';
import {FootContactsPanel} from './FootContactsPanel';
import type {RenderKind} from './renderPasses';
import {CameraPanel,FrameControls} from './CameraPanel';
import {defaultCameraSettings} from './cameraState';
import {ReferenceLayer,ReferencePanel} from './ReferencePanel';
import {readReferenceImage,referenceWithSettings} from './referenceImage';
import {HandPanel} from './HandPanel';
import {BendPanel} from './BendPanel';
import {rigFinger} from './handRig';
import {symmetricLimb} from './symmetry';
import {PropsPanel} from './PropsPanel';
import {MotionPanel} from './MotionPanel';
import {CharacterPanel} from './CharacterPanel';
import './character.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';

const LAST_RIG_KEY='momo-pose-forge:active-rig';
const initialRig=()=>{try{return RIGS.find(r=>r.id===localStorage.getItem(LAST_RIG_KEY))??XBOT_RIG;}catch{return XBOT_RIG;}};
type Thumbnail={id:string;name:string;url:string};
type SavedPose={id:string;name:string;document:PoseDocument;thumbnail:string};
const INITIAL_INFO:EngineInfo={ready:false,view:'free',navigating:false,selected:'LeftHand',position:[0,0,0],rotation:[0,0,0],pinned:false,orientationPinned:false,ground:true,fullBody:true,fixedFeet:0,warning:'',hands:{Left:'张手',Right:'张手'},handDetail:null,fingers:{Left:emptyHandValues(),Right:emptyHandValues()},forearmTwist:{Left:0,Right:0},toes:{Left:0,Right:0},boneCount:0,vertexCount:0};
const INITIAL_CAMERA=defaultCameraSettings();
const poseHistory=(doc:PoseDocument)=>{const entry={...doc};delete entry.referenceImage;delete entry.symmetry;return entry;};

function IconButton({icon:Icon,label,text,active,disabled,onClick}:{icon:ElementType;label:string;text?:string;active?:boolean;disabled?:boolean;onClick:()=>void}){
  return <button className={`icon-button${text?' with-label':''}${active?' active':''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}><Icon size={17} strokeWidth={1.65}/>{text&&<span>{text}</span>}</button>;
}
function NumberField({value,label,unit,onChange,step=.01,disabled=false}:{value:number;label:string;unit:string;onChange:(v:number)=>void;step?:number;disabled?:boolean}){
  const [text,setText]=useState(value.toFixed(unit==='°'?1:3));const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(document.activeElement!==input.current)setText(value.toFixed(unit==='°'?1:3));},[value,unit]);
  return <label className="number-field"><span>{label}</span><input ref={input} type="number" disabled={disabled} step={step} value={text} onChange={e=>setText(e.target.value)} onBlur={()=>{const n=Number(text);setText(value.toFixed(unit==='°'?1:3));if(text.trim()&&Number.isFinite(n))onChange(n);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><small>{unit}</small></label>;
}

export default function App(){
  useLanguage();
  const workbenchMenu=useRef<HTMLDivElement>(null),workbenchManager=useRef<DockWorkspace|null>(null);
  const revealPanel=(id:'presets'|'viewport'|'inspector')=>{const manager=workbenchManager.current;if(!manager)return;if(window.matchMedia('(max-width:900px)').matches)manager.control([{action:'preset',preset:id==='viewport'?'focus':id}]);else manager.show(id);};
  const viewport=useRef<HTMLDivElement>(null),engineRef=useRef<PoseEngine|null>(null),currentRef=useRef<PoseDocument|null>(null);
  const undoStack=useRef<SceneDocument[]>([]),redoStack=useRef<SceneDocument[]>([]),sceneRef=useRef<SceneDocument|null>(null),fileInput=useRef<HTMLInputElement>(null);
  const initializedRef=useRef(false);
  const exportDialog=useRef<HTMLDialogElement>(null),helpDialog=useRef<HTMLDialogElement>(null),cameraDialog=useRef<HTMLDialogElement>(null),exportAbort=useRef<AbortController|null>(null);
  const [info,setInfo]=useState<EngineInfo>(INITIAL_INFO),[current,setCurrent]=useState<PoseDocument|null>(null),[historyTick,setHistoryTick]=useState(0);
  const [error,setError]=useState(''),[toast,setToast]=useState(''),[saveStatus,setSaveStatus]=useState('pose.preparing');
  const [tab,setTab]=useState('presets'),[category,setCategory]=useState('全部'),[query,setQuery]=useState(''),[activePreset,setActivePreset]=useState('neutral');
  const activePresetRef=useRef(activePreset);activePresetRef.current=activePreset;
  const [presetScope,setPresetScope]=useState<PresetScope>('all');
  const [presetThumbs,setPresetThumbs]=useState<Record<string,string>>({}),[thumbnails,setThumbnails]=useState<Thumbnail[]>([]),[saved,setSaved]=useState<SavedPose[]>([]);
  const [mode,setMode]=useState<'translate'|'rotate'>('translate'),[space,setSpace]=useState<'world'|'local'>('world'),[display,setDisplay]=useState<'surface'|'skeleton'|'lineart'>('surface');
  const [more,setMore]=useState(true),[grid,setGrid]=useState(true),[view,setView]=useState('free'),[leftOpen,setLeftOpen]=useState(false),[rightOpen,setRightOpen]=useState(false);
  const [exportOpen,setExportOpen]=useState(false),[helpOpen,setHelpOpen]=useState(false),[cameraOpen,setCameraOpen]=useState(false),[exporting,setExporting]=useState(false),[progress,setProgress]=useState('');
  const [options,setOptions]=useState<ExportOptions>({scope:'five',surface:true,lineart:false,skeleton:false,keypoints:false,depth:false,normal:false,sheet:true,project:true,transparent:false,hideOccludedHands:true});
  const [exportPreviewKind,setExportPreviewKind]=useState<RenderKind>('surface'),[exportPreviews,setExportPreviews]=useState<Thumbnail[]>([]),[previewBusy,setPreviewBusy]=useState(false),[previewError,setPreviewError]=useState('');
  const [exportPreviewEpoch,setExportPreviewEpoch]=useState(0);
  const referenceRequest=useRef(0);
  const [characterBusy,setCharacterBusy]=useState(false);
  const previewing=!!info.motion?.active;
  const [inspectorTab,setInspectorTab]=useState<'pose'|'reference'|'hands'|'props'|'character'>('pose'),[handSide,setHandSide]=useState<Side>('Left'),[referenceBusy,setReferenceBusy]=useState(false),[referenceError,setReferenceError]=useState({id:'',message:''});
  const referenceStatus=useCallback((id:string,message:string)=>setReferenceError(previous=>previous.id===id&&previous.message===message?previous:{id,message}),[]);
  const [projectName,setProjectName]=useState('未命名姿势');
  const [activeRig,setActiveRig]=useState<RigDefinition>(initialRig),[pendingRig,setPendingRig]=useState<RigDefinition|null>(null);
  const requestRig=useRef<(rig:RigDefinition,text?:string,bundle?:ScenePackage)=>Promise<void>>(async()=>{});
  const [assetsOpen,setAssetsOpen]=useState(false),[saveOpen,setSaveOpen]=useState(false);
  const actorUi=useRef('');
  const runtimeOptions=useRef({display,grid,more,space});runtimeOptions.current={display,grid,more,space};
  const rigName=(rig:RigDefinition)=>language.interfaceLanguage()==='en'?rig.nameEn:rig.name;
  const activePartName=(id:string)=>{const asset=activeRig.asset;const j=activeRig.jointControls?.find(j=>j.name===id)??(asset.kind==='procedural'?asset.joints.find(j=>j.name===id):undefined);return j?(language.interfaceLanguage()==='en'?j.labelEn:j.label):partName(id);};
  const rigPresets=activeRig.presets;
  const LIBRARY_KEY=rigStorageKey('library',activeRig);
  const switching=!!pendingRig;

  const notify=useCallback((text:string)=>{setToast(text);},[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);},[toast]);
  const accept=useCallback((doc:PoseDocument,history=true)=>{
    const scene=engineRef.current?.sceneSnapshot()??sceneFromPose(doc);
    if(history&&sceneRef.current&&JSON.stringify(scene)!==JSON.stringify(sceneRef.current)){undoStack.current.push(sceneHistory(sceneRef.current));if(undoStack.current.length>50)undoStack.current.shift();redoStack.current=[];}
    sceneRef.current=scene;
    currentRef.current=structuredClone(doc);setCurrent(doc);setProjectName(doc.name);setHistoryTick(n=>n+1);
  },[]);
  const restoreHistory=useCallback(async(back:boolean)=>{const from=back?undoStack.current:redoStack.current,to=back?redoStack.current:undoStack.current,doc=from.at(-1),engine=engineRef.current;if(!doc||!sceneRef.current||!engine)return;const before=sceneRef.current,target=structuredClone(doc);target.referenceImage=engine.referenceImage;for(const a of target.actors){const live=before.actors.find(b=>b.id===a.id&&b.pose.rig===a.pose.rig);if(live){a.pose.symmetry=live.pose.symmetry;a.pose.selection=live.pose.selection;}}setCharacterBusy(true);try{await engine.restoreScene(target,{},false);from.pop();to.push(sceneHistory(before));accept(engine.snapshot(),false);setActivePreset('');}catch(e){notify((e as Error).message);}finally{setCharacterBusy(false);}},[accept,notify]);
  const undo=useCallback(()=>void restoreHistory(true),[restoreHistory]),redo=useCallback(()=>void restoreHistory(false),[restoreHistory]);

  useEffect(()=>{
    if(!viewport.current)return;let alive=true,initialized=false,rigRequest=0;initializedRef.current=false;
    const host=document.createElement('div');host.className='rig-runtime';viewport.current.appendChild(host);
    const engine=new PoseEngine(host,i=>{if(alive&&engineRef.current===engine){setInfo(initialized?i:{...i,ready:false});setActiveRig(engine.activeRig);setView(i.view);setMode(engine.mode);}},(doc,history=true)=>{if(alive&&initialized&&engineRef.current===engine)accept(doc,history);},initialRig());
    engineRef.current=engine;
    engine.setInteractionBlocked(true);
    requestRig.current=async(rig,text,bundle)=>{
      if(!alive||!initialized||!engine.ready)return;const ticket=++rigRequest;setPendingRig(rig);setError('');
      try{
        if(text){
          const scene=readSceneDocument(text);
          await engine.restoreScene(scene,bundle?scenePackageOptions(bundle):{},false);
          undoStack.current=[];redoStack.current=[];accept(engine.snapshot(),false);notify(t('pose.projectOpened',rigName(engine.activeRig)));
        }else{await engine.replaceActorRig(rig);notify(t('pose.rigSwitched',rigName(rig)));}
        try{localStorage.setItem(LAST_RIG_KEY,engine.activeRig.id);}catch{}
      }catch(e){if(alive&&ticket===rigRequest&&(e as Error).name!=='AbortError')notify((e as Error).message);}
      finally{if(alive&&ticket===rigRequest)setPendingRig(null);}
    };
    void(async()=>{try{
      await engine.load();if(!alive)return;
      await engine.restoreMotionLibrary().catch(()=>notify(t('pose.motionLibraryUnavailable')));
      let restored=false;
      const recovery:SceneLoadOptions={recoverAppearance:(_id,ref)=>{notify(t('pose.appearanceDraftFallback',ref.name));return true;}};
      let sceneText:string|null=null;try{sceneText=localStorage.getItem(SCENE_DRAFT_KEY);}catch{notify(t('pose.rigSaveFailed'));}
      if(sceneText){try{await engine.restoreScene(readSceneDocument(sceneText),recovery,false);restored=true;}catch(e){if(alive)setError(t('pose.sceneDraftFailed',(e as Error).message));return;}}
      else{let legacy:string|null=null;try{legacy=readRigStorage(localStorage,'draft',engine.activeRig);}catch(e){notify((e as Error).message);}if(legacy){try{await engine.restoreScene(readSceneDocument(legacy),recovery,false);restored=true;}catch(e){if(alive)setError(t('pose.sceneDraftFailed',(e as Error).message));return;}}}
      if(!alive)return;
      const settings=runtimeOptions.current;engine.setDisplay(settings.display);engine.setGrid(settings.grid);engine.setMore(settings.more);engine.setSpace(settings.space);
      if(!restored){engine.applyPreset(engine.activeRig.presets[0],false);engine.name='未命名姿势';engine.focus();}
      initialized=true;initializedRef.current=true;engine.setInteractionBlocked(false);undoStack.current=[];redoStack.current=[];accept(engine.snapshot(),false);setInfo(engine.info());setActiveRig(engine.activeRig);if(restored)notify(t('pose.restoredDraft'));
    }catch(e){if(alive)setError((e as Error).message);}})();
    return()=>{alive=false;referenceRequest.current++;if(initialized&&engine.ready&&!engine.disposed){try{localStorage.setItem(SCENE_DRAFT_KEY,JSON.stringify(engine.sceneSnapshot()));}catch{}}engine.dispose();host.remove();if(engineRef.current===engine)engineRef.current=null;};
  },[accept,notify]);

  useEffect(()=>{
    engineRef.current?.setInteractionBlocked(!initializedRef.current||characterBusy||switching||exporting);
  },[characterBusy,switching,exporting,info.ready]);

  useEffect(()=>{
    const engine=engineRef.current;if(!engine?.ready||engine.activeRig.id!==activeRig.id)return;let alive=true;
    const actorKey=`${info.activeActor}:${activeRig.id}`;if(actorUi.current!==actorKey){actorUi.current=actorKey;setQuery('');setCategory('全部');setPresetScope('all');setInspectorTab('pose');setActivePreset('');}
    if(engine.motion?.active||characterBusy||switching)return;
    try{setPresetThumbs(engine.presetThumbnails());}catch{setPresetThumbs({});}
    try{const raw=JSON.parse(readRigStorage(localStorage,'library',activeRig)??'[]');setSaved(Array.isArray(raw)?raw.slice(0,30).filter(s=>typeof s.id==='string'&&typeof s.name==='string'&&typeof s.thumbnail==='string'&&s.document?.rig===activeRig.id):[]);}catch{if(alive)setSaved([]);}
    return()=>{alive=false;};
  },[activeRig.id,info.activeActor,info.appearance?.id,info.motion?.active,characterBusy,switching]);

  useEffect(()=>{
    if(!current||!engineRef.current?.ready)return;
    const timer=setTimeout(()=>{const engine=engineRef.current;if(engine?.ready)setThumbnails(engine.getThumbnails());},80);
    setSaveStatus('pose.saving');
    const save=setTimeout(()=>{try{localStorage.setItem(SCENE_DRAFT_KEY,JSON.stringify(engineRef.current!.sceneSnapshot()));setSaveStatus('pose.savedLocal');}catch{setSaveStatus('pose.saveFailed');notify('浏览器无法保存草稿，请下载工程文件保留姿势');}},900);
    return()=>{clearTimeout(timer);clearTimeout(save);};
  },[current,notify]);
  useEffect(()=>{
    const flush=()=>{const doc=sceneRef.current;if(!doc)return;try{localStorage.setItem(SCENE_DRAFT_KEY,JSON.stringify(doc));}catch{setSaveStatus('pose.saveFailed');}};
    const hidden=()=>{if(document.hidden)flush();};window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);};
  },[]);
  useEffect(()=>{if(exportOpen){exportDialog.current?.showModal();if(exportDialog.current)exportDialog.current.scrollTop=0;}else exportDialog.current?.close();},[exportOpen]);
  useEffect(()=>{
    const engine=engineRef.current;if(!exportOpen||!engine?.ready)return;let alive=true;
    setPreviewBusy(true);setPreviewError('');setExportPreviews([]);
    void(async()=>{try{
      const slots=options.scope==='five'?structuredClone(engine.views):[{id:'current',name:'当前视角',azimuth:0,elevation:0}];
      const {width,height}=engine.cameraState.output,aspect=width/height,w=180,h=Math.round(w/aspect);
      const cameras=slots.map(slot=>options.scope==='current'?engine.exportCamera(aspect):engine.viewCamera(slot,aspect)),range=engine.depthRange(cameras),previews:Thumbnail[]=[];
      for(let i=0;i<slots.length;i++){await new Promise(r=>setTimeout(r,0));if(!alive)return;previews.push({id:slots[i].id,name:slots[i].name,url:engine.renderImage(slots[i],w,h,exportPreviewKind,false,cameras[i],{depthRange:range,hideOccludedHands:options.hideOccludedHands}).toDataURL('image/png')});}
      if(alive)setExportPreviews(previews);
    }catch(e){if(alive)setPreviewError(`预览生成失败：${(e as Error).message}`);}finally{if(alive)setPreviewBusy(false);}})();
    return()=>{alive=false;};
  },[exportOpen,exportPreviewKind,options.scope,options.hideOccludedHands,current,exportPreviewEpoch]);
  useEffect(()=>{
    if(!exportOpen)return;let frame=0;
    const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setExportPreviewEpoch(n=>n+1));};
    window.addEventListener('resize',resize);return()=>{window.removeEventListener('resize',resize);cancelAnimationFrame(frame);};
  },[exportOpen]);
  useEffect(()=>{if(helpOpen)helpDialog.current?.showModal();else helpDialog.current?.close();},[helpOpen]);
  useEffect(()=>{if(cameraOpen)cameraDialog.current?.showModal();else cameraDialog.current?.close();},[cameraOpen]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement).closest('input,textarea,select')||document.querySelector('dialog[open]'))return;
      const engine=engineRef.current;if(!info.ready||!engine?.ready||engine.motion?.active||characterBusy)return;
      if(engine.fly.active)return;
      if(engine.referenceImage?.visible&&!engine.referenceImage.locked){if(e.key==='Escape')engine.setReferenceSettings({locked:true});return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}
      else if(e.key.toLowerCase()==='w'){engine.setMode('translate');setMode(engine.mode);}
      else if(e.key.toLowerCase()==='e'){engine.setMode('rotate');setMode('rotate');}
      else if(e.key.toLowerCase()==='f'){engine.focus();}
      else if(e.key==='Escape')engine.cancelDrag();
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[redo,undo,characterBusy,info.ready]);

  const choosePreset=(id:string,scope:PresetScope=presetScope)=>{const p=rigPresets.find(x=>x.id===id),engine=engineRef.current;if(!p||!engine?.ready)return;try{engine.applyPreset(p,true,scope);if(scope==='all')engine.focus();setActivePreset(id);setLeftOpen(false);if(window.matchMedia('(max-width:900px)').matches)revealPanel('viewport');notify(t('pose.appliedPreset',presetName(p),scopeName(scope)));}catch(e){notify((e as Error).message);}};
  const importFile=async(file:File)=>{setCharacterBusy(true);try{if(/\.poseforge$/i.test(file.name)){if(file.size>MAX_PROJECT_BYTES)throw new Error('完整工程包超过 128 MB');const bundle=await readSceneBundle(await file.arrayBuffer()),active=bundle.scene.actors.find(a=>a.id===bundle.scene.activeActor)!;await requestRig.current(requireRig(active.pose.rig),JSON.stringify(bundle.scene),bundle);}else{if(file.size>8_000_000)throw new Error('场景 JSON 超过 8 MB');const text=await file.text(),scene=readSceneDocument(text),active=scene.actors.find(a=>a.id===scene.activeActor)!;await requestRig.current(requireRig(active.pose.rig),text);}}catch(e){notify((e as Error).message);}finally{setCharacterBusy(false);}};
  const saveToLibrary=()=>{
    const engine=engineRef.current;if(!engine?.ready)return;
    const doc=poseHistory(engine.snapshot()),item:SavedPose={id:crypto.randomUUID(),name:doc.name,document:doc,thumbnail:engine.selectedThumbnail()};
    const next=[item,...saved].slice(0,30);try{localStorage.setItem(LIBRARY_KEY,JSON.stringify(next));setSaved(next);setTab('saved');notify(t('pose.poseSaved'));}catch{notify('本地空间不足，请下载工程文件');}
  };
  const importReference=async(file:File)=>{
    const request=++referenceRequest.current,engine=engineRef.current;if(!engine?.ready)return;setReferenceBusy(true);
    try{const image=await readReferenceImage(file);if(request!==referenceRequest.current||engineRef.current!==engine)return;const previous=engine.referenceImage;engine.setReferenceImage(previous?referenceWithSettings(image,{opacity:previous.opacity,scale:previous.scale,offsetX:previous.offsetX,offsetY:previous.offsetY,locked:true,visible:true}):image);referenceStatus(image.id,'');notify(t('pose.referenceImported'));}
    catch(e){if(request===referenceRequest.current)notify((e as Error).message);}finally{if(request===referenceRequest.current)setReferenceBusy(false);}
  };
  const removeReference=()=>{referenceRequest.current++;setReferenceBusy(false);engineRef.current?.setReferenceImage();setReferenceError({id:'',message:''});notify(t('pose.referenceRemoved'));};
  const runExport=async()=>{
    if(!engineRef.current||exporting||referenceBusy)return;setExporting(true);setProgress(t('pose.exportPreparing'));const abort=new AbortController();exportAbort.current=abort;
    try{await exportPose(engineRef.current,options,abort.signal,setProgress);setExportOpen(false);notify(t('pose.exportDone'));}catch(e){notify((e as Error).name==='AbortError'?t('pose.exportCancelled'):`导出失败：${(e as Error).message}`);}finally{setExporting(false);exportAbort.current=null;}
  };
  const changeMode=(m:'translate'|'rotate')=>{const engine=engineRef.current;if(engine){engine.setMode(m);setMode(engine.mode);}};
  const chooseView=(id:string)=>{engineRef.current?.setView(id);setView(id);};
  const filtered=rigPresets.filter(p=>(category==='全部'||p.category===category)&&`${p.name}${p.description}${presetName(p)}${presetDescription(p)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedEffector=activeRig.contacts.includes(info.selected);
  const pawRig=!!activeRig.ik&&activeRig.ik.contactType!=='hands-feet';
  const supportCount=(activeRig.supportContacts??activeRig.contacts).length,pinnedCount=info.fixedContacts??info.fixedFeet,allSupportPinned=supportCount>0&&pinnedCount===supportCount,pinState=allSupportPinned?'all':pinnedCount?'partial':'none';
  const control=activeRig.strategy==='xbot-humanoid'?partControl(info.selected):activeRig.ik&&selectedEffector?{label:t(pawRig?'pose.pawIKControl':'pose.limbIKControl'),help:t(pawRig?'pose.pawIKHelp':'pose.limbIKHelp')}:{label:t('pose.fkControl'),help:t(info.selected===activeRig.root?(activeRig.ik?(pawRig?'pose.pinnedRootHelp':'pose.limbRootHelp'):'pose.fkRootHelp'):'pose.fkHelp')};
  const limb=symmetricLimb(info.selected),activeSymmetry=limb&&info.symmetry?.[limb.group]?(limb.group==='arms'?t('pose.armsSymmetry'):t('pose.legsSymmetry')):'';
  const camera=info.camera??INITIAL_CAMERA;
  void historyTick;

  return <div className="app-shell" data-momo-motion="">
    <header className="topbar">
      <a className="brand" href={sitePath("/")} aria-label={t('pose.home')}><svg className="brand-mark" width="26" height="28" viewBox="0 0 26 28" fill="none"><path d="M3 23V8L13 17L23 8V23M13 17V26" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="13" cy="4" r="2.5" fill="currentColor"/></svg><span>Momo<span className="brand-light">PoseForge</span></span></a>
      <div className="project-meta"><ChevronRight size={14}/><input aria-label={t('pose.name')} disabled={previewing||characterBusy} value={projectName} maxLength={80} onChange={e=>setProjectName(e.target.value)} onBlur={()=>{if(engineRef.current&&projectName.trim()){engineRef.current.name=projectName.trim();engineRef.current.commit();}}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span className="save-status"><span className={saveStatus==='pose.saveFailed'?'status-dot failed':'status-dot'}/>{t(saveStatus)}</span></div>
      <div className="top-actions"><div className="workbench-menu-host" ref={workbenchMenu}/><WorkbenchPreferences/><HelpMenu onQuickGuide={()=>setHelpOpen(true)}/>
        <div className="history-actions"><IconButton icon={Undo2} label={t('pose.undo')} disabled={previewing||characterBusy||switching||!undoStack.current.length} onClick={undo}/><IconButton icon={Redo2} label={t('pose.redo')} disabled={previewing||characterBusy||switching||!redoStack.current.length} onClick={redo}/></div>
        <button className="text-button open-project" disabled={!info.ready||switching||characterBusy} onClick={()=>fileInput.current?.click()}><FolderOpen size={16}/>{t('pose.open')}</button>
        <button className="text-button save-project" disabled={!info.ready||previewing||characterBusy||switching} onClick={()=>setSaveOpen(true)}><ArrowDownToLine size={16}/>{t('pose.save')}</button>
        <button className="primary-button" disabled={!info.ready||referenceBusy||switching||previewing||characterBusy} onClick={()=>setExportOpen(true)}><Download size={16}/>{t('pose.export')}<span className="desktop-only">{t('pose.references')}</span></button>
      </div>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".poseforge,.json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/>
    </header>

    <div className="mobile-tools"><button onClick={()=>{setLeftOpen(!leftOpen);setRightOpen(false);revealPanel(leftOpen?'viewport':'presets');}}><Layers2 size={16}/>{t('pose.panel.presets')}</button><span>{t('pose.workbench')}</span><button onClick={()=>{setRightOpen(!rightOpen);setLeftOpen(false);revealPanel(rightOpen?'viewport':'inspector');}}><Settings2 size={16}/>{t('pose.panel.inspector')}</button></div>
    <WorkbenchShell managerRef={workbenchManager} menuHost={workbenchMenu} onMessage={notify} panels={{
      presets: <aside className={`preset-panel ${leftOpen?'mobile-open':''}`} aria-label={t('pose.presetLibrary')}>
        <div className="panel-heading"><h2>{t('pose.panel.presets')}</h2><span>{rigName(activeRig)}</span></div>
        <SceneActorsPanel engine={engineRef.current} info={info} disabled={characterBusy||switching||exporting||referenceBusy} onBusy={setCharacterBusy} onNotify={notify}/>
        <div className="rig-selector" aria-busy={switching}><label htmlFor="active-rig">{t('pose.selectedActorRig')}</label><div className="preset-scope-select"><select id="active-rig" value={(pendingRig??activeRig).id} aria-label={t('pose.switchRig')} disabled={exporting||referenceBusy||characterBusy||info.actorEditable===false} onChange={e=>void requestRig.current(requireRig(e.target.value))}>{rigOptions(pendingRig??activeRig).map(rig=><option key={rig.id} value={rig.id}>{rigName(rig)}</option>)}</select><ChevronDown size={13}/></div><p role="status">{switching?t('pose.switchingRig'):language.interfaceLanguage()==='en'?activeRig.descriptionEn:activeRig.description}</p></div>
        <div className="panel-tabs"><button className={tab==='presets'?'selected':''} onClick={()=>setTab('presets')}>{t('pose.presets')}</button><button className={tab==='saved'?'selected':''} onClick={()=>setTab('saved')}>{t('pose.saved')}{saved.length>0&&<span>{saved.length}</span>}</button><button className={tab==='motions'?'selected':''} onClick={()=>setTab('motions')}>{t('pose.motions')}</button></div>
        {tab==='motions'?<MotionPanel key={`${info.activeActor}:${activeRig.id}`} engine={engineRef.current} info={info} onBusy={setCharacterBusy} onNotify={notify} onCapture={()=>{setActivePreset('');notify(t('pose.capturedMotion'));if(window.matchMedia('(max-width:900px)').matches)revealPanel('viewport');}}/>:tab==='presets'?<>
          {activeRig.capabilities.partialPresets&&<div className="preset-scope"><label htmlFor="preset-scope">{t('pose.scope')}</label><div className="preset-scope-select"><select id="preset-scope" aria-label={t('pose.presetScope')} aria-describedby="preset-scope-help" value={presetScope} onChange={e=>{setPresetScope(e.target.value as PresetScope);setActivePreset('');}}>{Object.entries(PRESET_SCOPES).map(([id,item])=><option key={id} value={id}>{scopeName(id as PresetScope)}</option>)}</select><ChevronDown size={13}/></div><p id="preset-scope-help">{scopeHelp(presetScope)}{t('pose.choosePreset')}</p>{presetScope!=='all'&&<span>{t('pose.partialPreview')}</span>}</div>}
          <label className="search-input"><Search size={15}/><input aria-label={t('pose.search')} placeholder={t('pose.searchPlaceholder')} value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label={t('pose.clearSearch')} onClick={()=>setQuery('')}><X size={13}/></button>}</label>
          <div className="category-filter" aria-label={t('pose.categories')}>{['全部','基础','站姿','坐姿','蹲跪','动态','表达'].filter(c=>c==='全部'||rigPresets.some(p=>p.category===c)).map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{categoryName(c)}</button>)}</div>
          <div className="preset-scroll" inert={previewing||characterBusy||info.actorEditable===false}><div className="preset-grid">{filtered.map(p=><button key={p.id} className={`preset-tile${activePreset===p.id?' selected':''}`} disabled={!info.ready} onClick={()=>choosePreset(p.id)} title={presetDescription(p)}><div className="preset-image">{presetThumbs[p.id]?<img src={presetThumbs[p.id]} alt={presetName(p)}/>:<Bone size={25} strokeWidth={1}/>}<span className="preset-chosen"><Check size={12}/></span></div><span>{presetName(p)}</span></button>)}</div>{!filtered.length&&<div className="empty-state">{t('pose.noMatches')}<button onClick={()=>{setQuery('');setCategory('全部');}}>{t('pose.showAll')}</button></div>}</div>
        </>:<div className="preset-scroll saved-library" inert={previewing||characterBusy||info.actorEditable===false}><button className="save-pose-button" disabled={!info.ready} onClick={saveToLibrary}><Plus size={16}/>{t('pose.favorite')}</button>{saved.length?<div className="preset-grid">{saved.map(s=><div className="saved-item" key={s.id}><button className="preset-tile" onClick={()=>void(async()=>{const engine=engineRef.current;if(!engine)return;setCharacterBusy(true);try{const doc=parseDocument(JSON.stringify(s.document),engine.rest);if(doc.appearance)await engine.prepareAppearance(doc.appearance);if(engineRef.current!==engine)return;engine.apply({...relocatePose(doc,engine.snapshot().root),name:engine.name,views:engine.views,camera:engine.getCameraSettings(),props:engine.props,referenceImage:engine.referenceImage},true,false,false,false);accept(engine.snapshot());setActivePreset('');setLeftOpen(false);}catch(e){notify((e as Error).message);}finally{setCharacterBusy(false);}})()}><div className="preset-image"><img src={s.thumbnail} alt={s.name}/></div><span>{s.name}</span></button><button className="remove-saved" aria-label={`移除收藏 ${s.name}`} onClick={()=>{const next=saved.filter(p=>p.id!==s.id);try{localStorage.setItem(LIBRARY_KEY,JSON.stringify(next));setSaved(next);}catch{notify('无法更新本地收藏');}}}><X size={11}/></button></div>)}</div>:<div className="empty-state"><Hand size={25} strokeWidth={1.2}/><p>{t('pose.savedEmptyTitle')}</p><span>{t('pose.savedEmptyHelp')}</span></div>}</div>}
        <div className="library-footer"><button disabled={!info.ready||characterBusy||switching} onClick={()=>setAssetsOpen(true)}>{t('pose.manageAssets')}</button><button aria-label={t('pose.help')} onClick={()=>setHelpOpen(true)}><CircleHelp size={16}/></button></div>
      </aside>,
      viewport: <main className="stage-column">
        <div className="stage-toolbar"><div className="tool-group"><IconButton icon={Move3D} label={t('pose.moveShortcut')} text={t('pose.move')} disabled={previewing||characterBusy||info.actorEditable===false||!engineRef.current?.canTranslate(info.selected)} active={mode==='translate'} onClick={()=>changeMode('translate')}/><IconButton icon={Rotate3D} label={t('pose.rotateShortcut')} text={t('pose.rotate')} disabled={previewing||characterBusy||info.actorEditable===false||![0,1,2].some(axis=>engineRef.current?.canRotateAxis(axis))} active={mode==='rotate'} onClick={()=>changeMode('rotate')}/><span className="tool-divider"/><button className="space-button" onClick={()=>{const s=space==='world'?'local':'world';setSpace(s);engineRef.current?.setSpace(s);}}>{space==='world'?t('pose.world'):t('pose.local')}<ChevronDown size={12}/></button></div><div className="tool-group"><button className="toolbar-label" disabled={previewing||characterBusy||info.actorEditable===false||!activeRig.capabilities.mirror} onClick={()=>engineRef.current?.mirror()} title={t('pose.mirrorTitle')}><ArrowLeftRight size={16}/><span>{t('pose.mirror')}</span></button><IconButton icon={RotateCcw} label={t('pose.neutral')} disabled={previewing||characterBusy||info.actorEditable===false} onClick={()=>choosePreset('neutral','all')}/><span className="tool-divider"/><div className="display-switch"><button aria-label={t('pose.surfaceDisplay')} aria-pressed={display==='surface'} className={display==='surface'?'selected':''} onClick={()=>{setDisplay('surface');engineRef.current?.setDisplay('surface');}}><Box size={14}/><span>{t('pose.surface')}</span></button><button aria-label={t('pose.lineartDisplay')} aria-pressed={display==='lineart'} className={display==='lineart'?'selected':''} onClick={()=>{setDisplay('lineart');engineRef.current?.setDisplay('lineart');}}><Pencil size={14}/><span>{t('pose.lineart')}</span></button><button aria-label={t('pose.skeletonDisplay')} aria-pressed={display==='skeleton'} className={display==='skeleton'?'selected':''} onClick={()=>{setDisplay('skeleton');engineRef.current?.setDisplay('skeleton');}}><Bone size={14}/><span>{t('pose.skeleton')}</span></button></div></div></div>
        <div className={`stage-wrap${display==='lineart'?' lineart-stage':''}`}><div ref={viewport} className="viewport"/>{info.ready&&info.referenceImage&&engineRef.current&&<ReferenceLayer engine={engineRef.current} image={info.referenceImage} onStatus={referenceStatus}/>}
          {!info.ready&&<div className="loading-state">{error?<><p>{error}</p><button onClick={()=>location.reload()}>{t('pose.reload')}</button></>:<><LoaderCircle className="spin" size={25}/><p>{t('pose.loading')}</p><span>{t('pose.loadingHelp')}</span></>}</div>}
          <div className="view-label"><h1>{view==='free'?t('pose.free'):current?.views.find(v=>v.id===view)?.name??'自由视角'}</h1><small>{camera.locked?t('pose.locked'):info.navigating?'WASD / QE':camera.active.projection==='perspective'?t('pose.perspective'):t('pose.orthographic')}</small></div>
          {display==='lineart'&&<div className="lineart-settings"><label><span>{t('pose.lineWidth')}</span><input aria-label={t('pose.lineWidth')} type="range" min="0.5" max="3" step="0.25" value={camera.lineArt?.lineWidth??1.25} onChange={e=>engineRef.current?.setLineWidth(Number(e.target.value))}/><output>{camera.lineArt?.lineWidth??1.25}</output></label><label><input type="checkbox" role="switch" aria-label={t('pose.constructionGuides')} disabled={!engineRef.current?.hasDrawingGuideActors()} checked={!!camera.lineArt?.constructionGuides} onChange={e=>engineRef.current?.setConstructionGuides(e.target.checked)}/>{t('pose.constructionGuides')}</label></div>}
          <div className="viewport-actions">{info.handDetail&&<IconButton icon={Maximize} label={t('pose.fullBody')} text={t('pose.fullBody')} onClick={()=>engineRef.current?.focus()}/>}<IconButton icon={ImagePlus} label={t('pose.reference')} disabled={!info.ready} active={inspectorTab==='reference'} onClick={()=>{setInspectorTab('reference');setRightOpen(true);setLeftOpen(false);revealPanel('inspector');}}/><IconButton icon={camera.locked?LockKeyhole:UnlockKeyhole} label={camera.locked?'解除观察相机锁定':t('pose.lockCamera')} active={camera.locked} disabled={!info.ready} onClick={()=>engineRef.current?.setCameraLock(!camera.locked)}/><IconButton icon={Camera} label={t('pose.camera')} disabled={!info.ready} onClick={()=>setCameraOpen(true)}/><IconButton icon={Maximize} label={t('pose.focusShortcut')} disabled={camera.locked} onClick={()=>engineRef.current?.focus()}/><IconButton icon={Grid2X2} label={display==='lineart'?t('pose.lineartBackground'):t('pose.grid')} disabled={display==='lineart'} active={grid&&display!=='lineart'} onClick={()=>{setGrid(!grid);engineRef.current?.setGrid(!grid);}}/><IconButton icon={Expand} label={t('pose.freeView')} disabled={camera.locked} active={view==='free'} onClick={()=>chooseView('free')}/></div>
          <div className="axis-widget" aria-label={t('pose.axes')}><svg viewBox="0 0 72 72" width="66" height="66"><path d="M36 37L36 10M36 37L62 49M36 37L13 55" stroke="#7c8381" strokeWidth="1.3"/><circle cx="36" cy="37" r="3" fill="#c2c6c3"/><text x="32" y="8" fill="#c2c6c3">Y</text><text x="63" y="55" fill="#c2c6c3">X</text><text x="5" y="65" fill="#c2c6c3">Z</text></svg></div>
          <div className="stage-footnote"><span><MousePointer2 size={12}/>{info.navigating?t('pose.flying'):`${info.actorTransform?(info.actors?.find(a=>a.id===info.activeActor)?.name??activePartName(info.selected)):activePartName(info.selected)} · ${activeSymmetry||t('pose.selectedControl')}`}</span><span>{t('pose.navigationHint')}</span></div>
          {(info.warning||info.framingWarning)&&<div className="constraint-warning" role="status">{info.warning||`${info.framingWarning} · 可在相机面板重新适配`}</div>}
        </div>

      </main>,
      views: <section className="views-strip" aria-label={t('pose.viewsPreview')}><div className="views-heading"><div><h2>{t('pose.panel.views')}</h2><span>{camera.framing.locked?t('pose.framingLocked'):t('pose.autoFit')}</span></div><div className="views-heading-actions"><button disabled={!info.ready} onClick={()=>setCameraOpen(true)}><Camera size={13}/>{t('pose.camera')}</button><button onClick={()=>{engineRef.current?.resetViews();notify(t('pose.defaultViewsRestored'));}} title={t('pose.resetCamera')}><RotateCcw size={13}/>{t('pose.resetViews')}</button></div></div><div className="views-grid">{DEFAULT_VIEWS.map((v,i)=>{const slot=current?.views[i]??v,thumb=thumbnails.find(t=>t.id===v.id);return <div className={`view-card${view===v.id?' selected':''}`} key={v.id}><button className="view-image" disabled={camera.locked} onClick={()=>chooseView(v.id)} aria-label={viewName(slot)}>{thumb&&<img src={thumb.url} alt={viewName(slot)}/>}<span className="view-number">0{i+1}</span></button><div className="view-caption"><button disabled={camera.locked} onClick={()=>chooseView(v.id)}>{viewName(slot)}</button><button aria-label={`用当前观察替换${slot.name}`} title={t('pose.replaceView')} onClick={()=>{engineRef.current?.captureView(v.id);notify(t('pose.viewUpdated',viewName(slot)));}}><Copy size={12}/></button></div></div>;})}</div></section>,
      inspector: <aside className={`inspector-panel ${rightOpen?'mobile-open':''}`} aria-label={inspectorTab==='character'?t('pose.characterTitle'):inspectorTab==='props'?t('pose.sceneProps'):inspectorTab==='reference'?'参考图片设置':inspectorTab==='hands'?t('pose.gestureLibrary'):'当前部位属性'}>
        <div className="inspector-title"><span><Settings2 size={15}/>{inspectorTab==='character'?t('pose.characterTitle'):inspectorTab==='props'?t('pose.sceneProps'):inspectorTab==='reference'?t('pose.referenceImage'):inspectorTab==='hands'?t('pose.gestures'):'姿态属性'}</span><button className="mobile-close" aria-label={t('pose.closeProperties')} onClick={()=>{setRightOpen(false);revealPanel('viewport');}}><X size={16}/></button></div><div className="inspector-tabs" aria-label={t('pose.inspectorContents')}><button disabled={!info.ready} aria-pressed={inspectorTab==='character'} onClick={()=>setInspectorTab('character')}>{t('pose.characterTab')}</button><button disabled={!info.ready} aria-pressed={inspectorTab==='pose'} onClick={()=>setInspectorTab('pose')}>{t('pose.bodyPose')}</button><button disabled={!info.ready} aria-pressed={inspectorTab==='reference'} onClick={()=>setInspectorTab('reference')}>{t('pose.referenceImage')}</button>{activeRig.capabilities.hands&&<button disabled={!info.ready} aria-pressed={inspectorTab==='hands'} onClick={()=>setInspectorTab('hands')}>{t('pose.gestures')}</button>}<button disabled={!info.ready} aria-pressed={inspectorTab==='props'} onClick={()=>setInspectorTab('props')}>{t('pose.props')}</button></div>
        {info.actorTransform&&inspectorTab==='pose'&&<p className="preview-notice">{t('pose.placingActorHelp')}</p>}<div inert={switching||((info.actorEditable===false||characterBusy)&&!['props','reference'].includes(inspectorTab))||(!!info.actorTransform&&['pose','hands'].includes(inspectorTab))}>{inspectorTab==='character'?<CharacterPanel key={`${info.activeActor}:${activeRig.id}`} engine={engineRef.current} info={info} onNotify={notify} onBusy={setCharacterBusy} onManage={()=>setAssetsOpen(true)}/>:previewing?<p className="preview-notice">{t('pose.previewNotice')}<button className="character-action" onClick={()=>{setTab('motions');revealPanel('presets');}}>{t('pose.motions')}</button></p>:inspectorTab==='props'?<PropsPanel engine={engineRef.current} info={info} onNotify={notify}/>:inspectorTab==='reference'?<ReferencePanel engine={engineRef.current} image={info.referenceImage} ready={info.ready} busy={referenceBusy} error={referenceError.id===info.referenceImage?.id?referenceError.message:''} onImport={file=>void importReference(file)} onRemove={removeReference} onBeginEdit={()=>{setRightOpen(false);revealPanel('viewport');}}/>:inspectorTab==='hands'&&activeRig.capabilities.hands?<HandPanel key={`${info.activeActor}:${activeRig.id}`} engine={engineRef.current} info={info} side={handSide} onSide={setHandSide} onNotify={notify} onFine={()=>{engineRef.current?.setHandDetail(handSide);engineRef.current?.focusHand(handSide);setInspectorTab('pose');}}/>:<>

        <section className="inspector-section"><div className="section-label"><h2>{t('pose.currentPart')}</h2><span>{t('pose.controller')}</span></div><label className="part-select"><span className="selected-part-dot"/><select aria-label={t('pose.choosePart')} value={info.selected} onChange={e=>engineRef.current?.select(e.target.value)}><optgroup label={t('pose.bodyJoints')}>{activeRig.editableJoints.filter(id=>!rigFinger(activeRig,id)).map(id=><option key={id} value={id}>{activePartName(id)}</option>)}</optgroup>{activeRig.capabilities.hands&&<><optgroup label={t('pose.leftFingers')}>{activeRig.editableJoints.filter(id=>rigFinger(activeRig,id)?.side==='Left').map(id=><option key={id} value={id}>{activePartName(id)}</option>)}</optgroup><optgroup label={t('pose.rightFingers')}>{activeRig.editableJoints.filter(id=>rigFinger(activeRig,id)?.side==='Right').map(id=><option key={id} value={id}>{activePartName(id)}</option>)}</optgroup></>}</select><ChevronDown size={14}/></label><div className="selection-mode"><span>{control.label} · {mode==='translate'?t('pose.move'):t('pose.rotate')}</span><button onClick={()=>engineRef.current?.resetSelected()}>{t('pose.resetPart')}</button></div>
          <p className="field-help control-help">{info.pinned?t(info.orientationPinned?'pose.selectedPosePinned':'pose.selectedPositionPinned'):activeSymmetry?`${activeSymmetry}：同步另一侧整条肢体，保留躯干、骨盆和各自手型。有固定点时先解除该组固定。`:control.help}</p><div className="coordinate-label">{t('pose.worldPosition')}<span>{t('pose.metres')}</span></div><div className="number-row">{['X','Y','Z'].map((a,i)=><NumberField key={`${info.selected}-p-${a}`} label={a} unit="m" disabled={!engineRef.current?.canTranslate(info.selected)} value={info.position[i]} onChange={v=>engineRef.current?.setSelectedPosition(i,v)}/>)}</div>
          <div className="coordinate-label">{t(activeRig.strategy!=='xbot-humanoid'?'pose.restRotation':'pose.localRotation')}<span>{t('pose.degrees')}</span></div><div className="number-row">{['X','Y','Z'].map((a,i)=><NumberField key={`${info.selected}-r-${a}`} label={a} unit="°" step={1} disabled={!info.ready||!engineRef.current?.canRotateAxis(i)} value={info.rotation[i]} onChange={v=>engineRef.current?.setSelectedRotation(i,v)}/>)}</div>
        </section>
        {activeRig.capabilities.mirror&&<section className="inspector-section symmetry-controls"><div className="section-label"><h2>{t('pose.symmetry')}</h2><ArrowLeftRight size={14}/></div>{(['arms','legs'] as const).map(group=><label className="setting-row" key={group}><span>{group==='arms'?t('pose.armsSymmetry'):t('pose.legsSymmetry')}</span><input type="checkbox" role="switch" disabled={!info.ready} checked={!!info.symmetry?.[group]} onChange={e=>engineRef.current?.setSymmetry(group,e.target.checked)}/></label>)}<p className="field-help">{t('pose.symmetryHelp')}</p><p className="field-help">{t('pose.symmetryLimits')}</p><div className="coordinate-label">{t('pose.copySide')}</div><div className="mirror-actions"><button onClick={()=>engineRef.current?.mirror('Left')}>{t('pose.left')}<ArrowUpRight size={12}/>{t('pose.right')}</button><button onClick={()=>engineRef.current?.mirror('Right')}>{t('pose.right')}<ArrowUpRight size={12}/>{t('pose.left')}</button></div><button className="save-pose-button" disabled={!info.ready} onClick={saveToLibrary}><Plus size={15}/>{t('pose.favorite')}</button></section>}
        {activeRig.capabilities.pins&&<section className="inspector-section"><div className="section-label"><h2>{t(activeRig.ik?(pawRig?'pose.pawIK':'pose.limbIK'):'pose.ikPins')}</h2><span>{activeRig.ik?t('pose.pinnedCount',pinnedCount,supportCount):<Bone size={14}/>}</span></div>
          {activeRig.capabilities.fullBodyIK&&<><label className="setting-row"><span>{t('pose.fullBodyIK')}</span><input type="checkbox" role="switch" disabled={!info.ready} checked={info.fullBody} onChange={e=>engineRef.current?.setFullBody(e.target.checked)}/></label><p className="field-help">{t('pose.fullBodyIKHelp')}</p></>}
          {activeRig.ik&&<><p className="field-help">{t(pawRig?'pose.pawIKHelp':'pose.limbIKHelp')}</p><div className="ik-contact-buttons" aria-label={t(pawRig?'pose.choosePaw':'pose.chooseLimbEnd')}>{activeRig.contacts.map(end=><button key={end} disabled={!info.ready} aria-pressed={info.selected===end} onClick={()=>engineRef.current?.select(end)}>{activePartName(end)}{current?.pins[end]&&<LockKeyhole size={11}/>}</button>)}</div></>}
          <div className="pin-state" data-state={pinState} role="status"><span>{t(pawRig?'pose.pawsPinState':'pose.feetPinState')}</span><strong>{t(allSupportPinned?'pose.pinsAll':pinnedCount?'pose.pinsPartial':'pose.pinsNone')} · {pinnedCount}/{supportCount}</strong></div>
          <button className="feet-pin-button" aria-pressed={allSupportPinned} data-state={pinState} disabled={!info.ready} onClick={()=>engineRef.current?.setFeetPin(!allSupportPinned)}>{allSupportPinned?<LockKeyhole size={13}/>:<UnlockKeyhole size={13}/>} {t(pawRig?(allSupportPinned?'pose.releasePaws':'pose.pinPaws'):(allSupportPinned?'pose.releaseFeet':'pose.pinFeet'))}</button>
          <label className={`setting-row ${!selectedEffector?'unavailable':''}`}><span>{info.pinned?<LockKeyhole size={14}/>:<UnlockKeyhole size={14}/>}{t(pawRig?'pose.pinPaw':'pose.pinCurrent')}</span><input type="checkbox" role="switch" disabled={!selectedEffector} checked={info.pinned} onChange={e=>engineRef.current?.setPin(e.target.checked,info.orientationPinned)}/></label><label className="setting-row subsetting"><span>{t('pose.pinOrientation')}</span><input type="checkbox" disabled={!info.pinned} checked={info.orientationPinned} onChange={e=>engineRef.current?.setPin(true,e.target.checked)}/></label><p className="field-help">{t(pawRig?'pose.pawPinHelp':activeRig.ik?'pose.limbPinHelp':'pose.pinHelp')}</p>
          {activeRig.capabilities.floor&&<label className="setting-row"><span>{t('pose.floor')}</span><input type="checkbox" role="switch" checked={info.ground} onChange={e=>engineRef.current?.setGround(e.target.checked)}/></label>}
          <label className="setting-row"><span>{t('pose.allControls')}</span><input type="checkbox" role="switch" checked={more} onChange={e=>{setMore(e.target.checked);engineRef.current?.setMore(e.target.checked);}}/></label><p className="field-help">{t(activeRig.ik?(pawRig?'pose.rigControlsHelp':'pose.limbControlsHelp'):'pose.allControlsHelp')}</p></section>}

        <FootContactsPanel engine={engineRef.current} info={info}/>
        <BendPanel engine={engineRef.current} info={info} label={activePartName}/>
        {activeRig.capabilities.hands&&<><section className="inspector-section"><div className="section-label"><h2>{t('pose.handPose')}</h2><Hand size={14}/></div>{(['Left','Right'] as const).map(side=><div className="hand-row" key={side}><span>{side==='Left'?t('pose.leftHand'):t('pose.rightHand')} · {currentGestureName(info.hands[side])}</span><button className="hand-library-entry" onClick={()=>{setHandSide(side);setInspectorTab('hands');}}>{t('pose.chooseGesture')}<ChevronRight size={13}/></button></div>)}</section>
        <FineControls engine={engineRef.current} info={info}/></>}
        </> }
        </div><div className="inspector-bottom"><span><span className="status-dot"/>{rigName(activeRig)}</span><span>{info.ready?t(activeRig.asset.kind==='gltf'?'pose.boneCount':'pose.rigidBoneCount',info.boneCount):t('pose.loadingShort')}</span><a href={sitePath(activeRig.sourceUrl)} target="_blank" rel="noreferrer">{t('pose.assetInfo')}<ArrowUpRight size={12}/></a></div>
      </aside>,
    }}/>
    <footer className="statusbar"><span>MomoPoseForge<span className="version">v0.7</span></span><span><kbd>W</kbd>{t('pose.move')}<kbd>E</kbd>{t('pose.rotate')}<kbd>F</kbd>{t('pose.focus')}</span><span>{t('pose.privacy')}</span></footer>
    {toast&&<div className="toast" role="status"><Check size={15}/>{toast}<button aria-label={t('pose.closeNotice')} onClick={()=>setToast('')}><X size={14}/></button></div>}

    {assetsOpen&&engineRef.current&&<AssetManager engine={engineRef.current} onClose={()=>setAssetsOpen(false)} onBusy={setCharacterBusy}/>}
    {saveOpen&&engineRef.current&&<ProjectSaveDialog engine={engineRef.current} onClose={()=>setSaveOpen(false)} onBusy={setCharacterBusy}/>}
    <dialog ref={exportDialog} className="export-dialog" onCancel={e=>{if(exporting){e.preventDefault();exportAbort.current?.abort();}else setExportOpen(false);}} onClose={()=>{if(!exporting)setExportOpen(false);}}>
      <div className="dialog-header"><div><span className="dialog-eyebrow">{t('pose.delivery')}</span><h2>{t('pose.exportTitle')}</h2></div><IconButton icon={X} label={t('pose.closeExport')} disabled={exporting} onClick={()=>setExportOpen(false)}/></div>
      <p className="dialog-description">{t((info.actors?.length??0)>1?'pose.sceneExportHelp':'pose.exportIntro')}</p>
      {exportPreviewKind==='lineart'&&<label className="setting-row"><span>{t('pose.lineWidth')}</span><input aria-label={t('pose.lineWidth')} type="range" min="0.5" max="3" step="0.25" value={camera.lineArt?.lineWidth??1.25} onChange={e=>{engineRef.current?.setLineWidth(Number(e.target.value));setExportPreviewEpoch(n=>n+1);}}/><span>{camera.lineArt?.lineWidth??1.25}</span></label>}
      {(exportPreviewKind==='lineart'||exportPreviewKind==='guides')&&<><label className="setting-row"><span>{t('pose.constructionGuides')}</span><input type="checkbox" role="switch" aria-label={t('pose.constructionGuides')} disabled={exportPreviewKind==='guides'||!engineRef.current?.hasDrawingGuideActors()} checked={exportPreviewKind==='guides'||!!camera.lineArt?.constructionGuides} onChange={e=>{engineRef.current?.setConstructionGuides(e.target.checked);setExportPreviewEpoch(n=>n+1);}}/></label><p className="field-help">{t('pose.guidesHelp')}</p></>}
      <div className="export-preview-controls" role="group" aria-label={t('pose.previewChannels')}>{([['surface',t('pose.surface')],['lineart',t('pose.lineart')],['guides',t('pose.guidesChannel')],['skeleton',t((engineRef.current?.hasHumanActors()??false)?'pose.bodyHands':'pose.genericSkeleton')],['depth',t('pose.depth')],['normal',t('pose.normal')]] as const).map(([kind,label])=><button key={kind} disabled={exporting||kind==='guides'&&!engineRef.current?.hasDrawingGuideActors()} aria-pressed={exportPreviewKind===kind} onClick={()=>setExportPreviewKind(kind)}>{label}</button>)}</div>
      {previewBusy?<p className="export-preview-status" role="status"><LoaderCircle size={14} className="spin"/>{t('pose.rendering')}</p>:previewError?<p className="export-preview-status error" role="alert">{previewError}</p>:<div className={`export-preview${options.scope==='current'?' single':''}`}>{exportPreviews.map(preview=><div key={preview.id}><img style={{aspectRatio:camera.output.width/camera.output.height}} src={preview.url} alt={`${preview.name}${exportPreviewKind==='depth'?t('pose.depth'):exportPreviewKind==='normal'?t('pose.normal'):exportPreviewKind==='skeleton'?t('pose.skeletonFile'):exportPreviewKind==='lineart'?t('pose.lineart'):exportPreviewKind==='guides'?t('pose.guidesChannel'):t('pose.surface')}预览`}/><span>{preview.name}</span></div>)}</div>}
      <div className="export-scroll"><fieldset disabled={exporting}><div className="export-layout"><div><h3>{t('pose.exportScope')}</h3><div className="choice-row"><button className={options.scope==='five'?'selected':''} onClick={()=>setOptions({...options,scope:'five'})}>{t('pose.allViews')}</button><button className={options.scope==='current'?'selected':''} onClick={()=>setOptions({...options,scope:'current'})}>{t('pose.currentView')}</button></div></div><div>{exportOpen&&<FrameControls engine={engineRef.current} settings={camera} notify={notify}/>}</div></div>
        <div className="export-section-label"><h3>{t('pose.fileContents')}</h3><button onClick={()=>setOptions({...options,surface:false,skeleton:true,keypoints:true,depth:true,normal:true,sheet:false,project:true})}>{t((engineRef.current?.hasHumanActors()??false)?'pose.allControlMaps':'pose.allRigMaps')}<ChevronRight size={12}/></button></div>
        <div className="export-checks">{([['lineart',t('pose.lineartFile'),t('pose.lineartHint')],['guides',t('pose.guidesFile'),t('pose.guidesHint')],['surface',t('pose.surfaceFile'),t((engineRef.current?.hasHumanActors()??false)?'pose.surfaceHint':'pose.rigSurfaceHint')],['skeleton',t((engineRef.current?.hasHumanActors()??false)?'pose.skeletonFile':'pose.genericSkeletonFile'),t((engineRef.current?.hasHumanActors()??false)?'pose.skeletonHint':'pose.genericSkeletonHint')],['keypoints',t((engineRef.current?.hasHumanActors()??false)?'pose.keypointFile':'pose.genericJointsFile'),t((engineRef.current?.hasHumanActors()??false)?'pose.keypointHint':'pose.genericJointsHint')],['depth',t('pose.depthFile'),t('pose.depthHint')],['normal',t('pose.normalFile'),t('pose.normalHint')],['sheet',t('pose.sheetFile'),t('pose.sheetHint')],['project',t('pose.projectFile'),t('pose.projectHint')]] as const).map(([key,label,hint])=><label className="export-check" key={key}><input type="checkbox" disabled={key==='guides'&&!engineRef.current?.hasDrawingGuideActors()} checked={!!options[key]&&(key!=='guides'||!!engineRef.current?.hasDrawingGuideActors())} onChange={e=>setOptions({...options,[key]:e.target.checked})}/><span>{label}<small>{hint}</small></span></label>)}</div>
        {(engineRef.current?.hasHumanActors()??activeRig.capabilities.openPose)&&<label className="setting-row export-transparent"><span>{t('pose.hideOccludedHands')}</span><input type="checkbox" role="switch" disabled={!options.skeleton&&!options.keypoints&&exportPreviewKind!=='skeleton'} checked={options.hideOccludedHands} onChange={e=>setOptions({...options,hideOccludedHands:e.target.checked})}/></label>}
        <label className="setting-row export-transparent"><span>{t('pose.transparent')}</span><input type="checkbox" role="switch" disabled={!options.surface&&!options.sheet&&!options.lineart} checked={options.transparent} onChange={e=>setOptions({...options,transparent:e.target.checked})}/></label>
        <p className="field-help">{t((info.actors?.length??0)>1?'pose.sceneExportHelp':(engineRef.current?.hasHumanActors()??false)?'pose.exportHelp':'pose.genericExportHelp')}</p>
      </fieldset></div>
      {(info.actors?.length??0)>1&&<p className="field-help">{t('pose.sceneSkeletonFiles')}</p>}<div className="dialog-footer"><span>{exporting?<><LoaderCircle size={14} className="spin"/>{progress}</>:<><LockKeyhole size={13}/>{t('pose.localZip')}</>}</span>{exporting?<button onClick={()=>exportAbort.current?.abort()}>{t('pose.cancelExport')}</button>:<button className="primary-button" disabled={!Object.entries(options).some(([k,v])=>['surface','lineart','guides','skeleton','keypoints','depth','normal','sheet','project'].includes(k)&&v)} onClick={()=>void runExport()}><Download size={16}/>{t('pose.download')}</button>}</div>
    </dialog>
    <dialog ref={cameraDialog} className="camera-dialog" onCancel={()=>setCameraOpen(false)} onClose={()=>setCameraOpen(false)}><div className="dialog-header"><div><span className="dialog-eyebrow">{t('pose.composition')}</span><h2>{t('pose.camera')}</h2></div><IconButton icon={X} label={t('pose.closeCamera')} onClick={()=>setCameraOpen(false)}/></div><div className="camera-scroll">{cameraOpen&&<CameraPanel engine={engineRef.current} settings={camera} views={current?.views??DEFAULT_VIEWS} warning={info.framingWarning} notify={notify}/>}</div><div className="dialog-footer"><span>{t('pose.cameraSaveHelp')}</span><button className="primary-button" onClick={()=>setCameraOpen(false)}>{t('pose.backToPose')}</button></div></dialog>
    <dialog ref={helpDialog} className="help-dialog" onCancel={()=>setHelpOpen(false)} onClose={()=>setHelpOpen(false)}><div className="dialog-header"><h2>{t('pose.helpTitle')}</h2><IconButton icon={X} label={t('pose.closeHelp')} onClick={()=>setHelpOpen(false)}/></div><p>{t(activeRig.capabilities.hands?'pose.helpIntro':'pose.helpIntroGeneric')}</p><dl><dt>{t('pose.fly')}</dt><dd>{t('pose.flyHelp')}</dd><dt>{t('pose.pan')}</dt><dd>{t('pose.panHelp')}</dd><dt>{t('pose.zoom')}</dt><dd>{t('pose.zoomHelp')}</dd><dt>{t('pose.moveRotate')}</dt><dd>W / E</dd><dt>{t('pose.focusCharacter')}</dt><dd>F</dd><dt>{t('pose.undoRedo')}</dt><dd>Ctrl Z / Ctrl Shift Z</dd>{activeRig.capabilities.fullBodyIK&&<><dt>{t('pose.fullBodyIK')}</dt><dd>{t('pose.fullBodyHelp')}</dd></>}{activeRig.capabilities.mirror&&<><dt>{t('pose.liveSymmetry')}</dt><dd>{t('pose.liveSymmetryHelp')}</dd></>}{activeRig.strategy==='xbot-humanoid'?<><dt>{t('pose.poles')}</dt><dd>{t('pose.polesHelp')}</dd></>:<><dt>{t('pose.fkControl')}</dt><dd>{t('pose.fkHelp')}</dd>{activeRig.ik&&<><dt>{t(pawRig?'pose.pawIKControl':'pose.limbIKControl')}</dt><dd>{t(pawRig?'pose.pawIKHelp':'pose.limbIKHelp')}</dd></>}</>}</dl><p>{t('pose.referenceCameraHelp')}</p><p className="field-help">{t(activeRig.capabilities.openPose?'pose.storageHelp':'pose.storageHelpGeneric')}</p><p><a href={manualPath(language.interfaceLanguage())} target="_blank" rel="noreferrer">{t('pose.manual')} ↗</a> · <a href="https://github.com/BreezyMomo/MomoPoseForge" target="_blank" rel="noreferrer">{t('pose.repository')} ↗</a></p><button className="primary-button" onClick={()=>setHelpOpen(false)}>{t('pose.start')}</button></dialog>
  </div>;
}
