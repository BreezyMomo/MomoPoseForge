import { useCallback, useEffect, useRef, useState, type ElementType } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Bone, Box, Check, ChevronDown, ChevronRight, CircleHelp, Copy, Download, Expand, FolderOpen, Grid2X2, Hand, Layers2, LoaderCircle, LockKeyhole, Maximize, MousePointer2, Move3D, Plus, Rotate3D, RotateCcw, Search, Settings2, Undo2, Redo2, UnlockKeyhole, X } from 'lucide-react';
import { PoseEngine } from './PoseEngine';
import { PRESETS } from './presets';
import { DEFAULT_VIEWS, END_EFFECTORS, PART_NAMES, type EngineInfo, type PoseDocument } from './types';
import { exportPose, parseDocument, saveProject, type ExportOptions } from './files';
import { CURRENT_MODEL } from './rig';
import {controlDescription} from './poseControls';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';

const DRAFT_KEY=`momo-pose-forge:draft:${CURRENT_MODEL.rig}`,LIBRARY_KEY=`momo-pose-forge:library:${CURRENT_MODEL.rig}`;
type Thumbnail={id:string;name:string;url:string};
type SavedPose={id:string;name:string;document:PoseDocument;thumbnail:string};
const INITIAL_INFO:EngineInfo={ready:false,view:'free',selected:'LeftHand',position:[0,0,0],rotation:[0,0,0],pinned:false,orientationPinned:false,ground:true,warning:'',hands:{Left:'张手',Right:'张手'},boneCount:0,vertexCount:0};

function IconButton({icon:Icon,label,text,active,disabled,onClick}:{icon:ElementType;label:string;text?:string;active?:boolean;disabled?:boolean;onClick:()=>void}){
  return <button className={`icon-button${text?' with-label':''}${active?' active':''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}><Icon size={17} strokeWidth={1.65}/>{text&&<span>{text}</span>}</button>;
}
function NumberField({value,label,unit,onChange,step=.01,disabled=false}:{value:number;label:string;unit:string;onChange:(v:number)=>void;step?:number;disabled?:boolean}){
  const [text,setText]=useState(value.toFixed(unit==='°'?1:3));const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(document.activeElement!==input.current)setText(value.toFixed(unit==='°'?1:3));},[value,unit]);
  return <label className="number-field"><span>{label}</span><input ref={input} type="number" disabled={disabled} step={step} value={text} onChange={e=>setText(e.target.value)} onBlur={()=>{const n=Number(text);setText(value.toFixed(unit==='°'?1:3));if(text.trim()&&Number.isFinite(n))onChange(n);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><small>{unit}</small></label>;
}

export default function App(){
  const viewport=useRef<HTMLDivElement>(null),engineRef=useRef<PoseEngine|null>(null),currentRef=useRef<PoseDocument|null>(null);
  const undoStack=useRef<PoseDocument[]>([]),redoStack=useRef<PoseDocument[]>([]),fileInput=useRef<HTMLInputElement>(null);
  const exportDialog=useRef<HTMLDialogElement>(null),helpDialog=useRef<HTMLDialogElement>(null),exportAbort=useRef<AbortController|null>(null);
  const [info,setInfo]=useState<EngineInfo>(INITIAL_INFO),[current,setCurrent]=useState<PoseDocument|null>(null),[historyTick,setHistoryTick]=useState(0);
  const [error,setError]=useState(''),[toast,setToast]=useState(''),[saveStatus,setSaveStatus]=useState('准备中');
  const [tab,setTab]=useState('presets'),[category,setCategory]=useState('全部'),[query,setQuery]=useState(''),[activePreset,setActivePreset]=useState('neutral');
  const [presetThumbs,setPresetThumbs]=useState<Record<string,string>>({}),[thumbnails,setThumbnails]=useState<Thumbnail[]>([]),[saved,setSaved]=useState<SavedPose[]>([]);
  const [mode,setMode]=useState<'translate'|'rotate'>('translate'),[space,setSpace]=useState<'world'|'local'>('world'),[display,setDisplay]=useState<'surface'|'skeleton'>('surface');
  const [more,setMore]=useState(false),[grid,setGrid]=useState(true),[view,setView]=useState('free'),[leftOpen,setLeftOpen]=useState(false),[rightOpen,setRightOpen]=useState(false);
  const [exportOpen,setExportOpen]=useState(false),[helpOpen,setHelpOpen]=useState(false),[exporting,setExporting]=useState(false),[progress,setProgress]=useState('');
  const [options,setOptions]=useState<ExportOptions>({scope:'five',surface:true,skeleton:false,keypoints:false,sheet:true,project:true,resolution:768,transparent:false});
  const [projectName,setProjectName]=useState('未命名姿势');

  const notify=useCallback((text:string)=>{setToast(text);},[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);},[toast]);
  const accept=useCallback((doc:PoseDocument,history=true)=>{
    if(history&&currentRef.current&&JSON.stringify(doc)!==JSON.stringify(currentRef.current)){undoStack.current.push(currentRef.current);if(undoStack.current.length>100)undoStack.current.shift();redoStack.current=[];}
    currentRef.current=structuredClone(doc);setCurrent(doc);setProjectName(doc.name);setHistoryTick(n=>n+1);
  },[]);
  const undo=useCallback(()=>{const doc=undoStack.current.pop();if(!doc||!currentRef.current)return;redoStack.current.push(currentRef.current);engineRef.current?.apply(doc);accept(doc,false);setActivePreset('');},[accept]);
  const redo=useCallback(()=>{const doc=redoStack.current.pop();if(!doc||!currentRef.current)return;undoStack.current.push(currentRef.current);engineRef.current?.apply(doc);accept(doc,false);setActivePreset('');},[accept]);

  useEffect(()=>{
    if(!viewport.current)return;let alive=true,initialized=false;
    let engine:PoseEngine;
    try{engine=new PoseEngine(viewport.current,i=>{if(alive){setInfo({...i,ready:initialized});setView(i.view);setMode(engineRef.current?.mode??'translate');}},doc=>{if(alive)accept(doc);});engineRef.current=engine;}catch(e){setError(`三维视口启动失败：${(e as Error).message}`);return;}
    void engine.load().then(async()=>{
      if(!alive)return;
      engine.applyPreset(PRESETS[0],false);engine.name='未命名姿势';
      try{const raw=localStorage.getItem(DRAFT_KEY);if(raw){engine.apply(parseDocument(raw,engine.rest));setActivePreset('');notify('已恢复上次的本地草稿');}}catch{notify('上次草稿无法读取，已打开新姿势');}
      const initial=engine.snapshot();engine.focus();
      try{const raw=JSON.parse(localStorage.getItem(LIBRARY_KEY)??'[]');if(Array.isArray(raw))setSaved(raw.slice(0,30).filter(s=>typeof s.id==='string'&&typeof s.name==='string'&&typeof s.thumbnail==='string'));}catch{/* start with empty user library */}
      const previews:Record<string,string>={};
      for(let i=0;i<PRESETS.length;i++){
        if(!alive)return;engine.applyPreset(PRESETS[i],false);
        previews[PRESETS[i].id]=engine.renderImage({...DEFAULT_VIEWS[1],azimuth:22},112,136,'surface').toDataURL('image/webp',.85);
      }
      if(alive){initialized=true;engine.apply(initial);engine.focus();accept(initial,false);setPresetThumbs(previews);setThumbnails(engine.getThumbnails());}
    }).catch(e=>{if(alive)setError(`人体载入失败：${(e as Error).message}`);});
    return()=>{alive=false;engine.dispose();if(engineRef.current===engine)engineRef.current=null;};
  },[accept,notify]);

  useEffect(()=>{
    if(!current||!engineRef.current?.ready)return;
    const timer=setTimeout(()=>{const engine=engineRef.current;if(engine?.ready)setThumbnails(engine.getThumbnails());},80);
    setSaveStatus('保存中');
    const save=setTimeout(()=>{try{localStorage.setItem(DRAFT_KEY,JSON.stringify(current));setSaveStatus('已保存在本机');}catch{setSaveStatus('本地保存失败');notify('浏览器无法保存草稿，请下载工程文件保留姿势');}},900);
    return()=>{clearTimeout(timer);clearTimeout(save);};
  },[current,notify]);
  useEffect(()=>{if(exportOpen)exportDialog.current?.showModal();else exportDialog.current?.close();},[exportOpen]);
  useEffect(()=>{if(helpOpen)helpDialog.current?.showModal();else helpDialog.current?.close();},[helpOpen]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement).closest('input,textarea,select')||exportDialog.current?.open||helpDialog.current?.open)return;
      const engine=engineRef.current;if(!engine?.ready)return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}
      else if(e.key.toLowerCase()==='w'){engine.setMode('translate');setMode(engine.mode);}
      else if(e.key.toLowerCase()==='e'){engine.setMode('rotate');setMode('rotate');}
      else if(e.key.toLowerCase()==='f'){engine.focus();}
      else if(e.key==='Escape')engine.cancelDrag();
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[redo,undo]);

  const choosePreset=(id:string)=>{const p=PRESETS.find(x=>x.id===id);if(!p)return;engineRef.current?.applyPreset(p);engineRef.current?.focus();setActivePreset(id);setLeftOpen(false);};
  const importFile=async(file:File)=>{try{if(file.size>2_000_000)throw new Error('工程文件超过 2 MB');const engine=engineRef.current!;const doc=parseDocument(await file.text(),engine.rest);engine.apply(doc);accept(engine.snapshot());setActivePreset('');notify('工程已打开，可以继续编辑');}catch(e){notify((e as Error).message);}};
  const saveToLibrary=()=>{
    const engine=engineRef.current;if(!engine?.ready)return;
    const doc=engine.snapshot(),item:SavedPose={id:crypto.randomUUID(),name:doc.name,document:doc,thumbnail:engine.renderImage(DEFAULT_VIEWS[1],112,136,'surface').toDataURL('image/webp',.8)};
    const next=[item,...saved].slice(0,30);try{localStorage.setItem(LIBRARY_KEY,JSON.stringify(next));setSaved(next);setTab('saved');notify('已加入我的姿势');}catch{notify('本地空间不足，请下载工程文件');}
  };
  const runExport=async()=>{
    if(!engineRef.current||exporting)return;setExporting(true);setProgress('正在准备姿态快照');const abort=new AbortController();exportAbort.current=abort;
    try{await exportPose(engineRef.current,options,abort.signal,setProgress);setExportOpen(false);notify('导出完成，ZIP 已开始下载');}catch(e){notify((e as Error).name==='AbortError'?'导出已取消':`导出失败：${(e as Error).message}`);}finally{setExporting(false);exportAbort.current=null;}
  };
  const changeMode=(m:'translate'|'rotate')=>{const engine=engineRef.current;if(engine){engine.setMode(m);setMode(engine.mode);}};
  const chooseView=(id:string)=>{engineRef.current?.setView(id);setView(id);};
  const filtered=PRESETS.filter(p=>(category==='全部'||p.category===category)&&`${p.name}${p.description}`.includes(query.trim()));
  const selectedEffector=END_EFFECTORS.includes(info.selected as typeof END_EFFECTORS[number]);
  const control=controlDescription(info.selected);
  void historyTick;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="MomoPoseForge 首页"><svg className="brand-mark" width="26" height="28" viewBox="0 0 26 28" fill="none"><path d="M3 23V8L13 17L23 8V23M13 17V26" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="13" cy="4" r="2.5" fill="currentColor"/></svg><span>Momo<span className="brand-light">PoseForge</span></span></a>
      <div className="project-meta"><ChevronRight size={14}/><input aria-label="姿势名称" value={projectName} maxLength={80} onChange={e=>setProjectName(e.target.value)} onBlur={()=>{if(engineRef.current&&projectName.trim()){engineRef.current.name=projectName.trim();engineRef.current.commit();}}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span className="save-status"><span className={saveStatus==='本地保存失败'?'status-dot failed':'status-dot'}/>{saveStatus}</span></div>
      <div className="top-actions">
        <div className="history-actions"><IconButton icon={Undo2} label="撤销 · Ctrl Z" disabled={!undoStack.current.length} onClick={undo}/><IconButton icon={Redo2} label="重做 · Ctrl Shift Z" disabled={!redoStack.current.length} onClick={redo}/></div>
        <button className="text-button open-project" disabled={!info.ready} onClick={()=>fileInput.current?.click()}><FolderOpen size={16}/>打开工程</button>
        <button className="text-button save-project" disabled={!info.ready} onClick={()=>currentRef.current&&saveProject(currentRef.current)}><ArrowDownToLine size={16}/>保存工程</button>
        <button className="primary-button" disabled={!info.ready} onClick={()=>setExportOpen(true)}><Download size={16}/>导出<span className="desktop-only">参考图</span></button>
      </div>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/>
    </header>

    <div className="mobile-tools"><button onClick={()=>{setLeftOpen(!leftOpen);setRightOpen(false);}}><Layers2 size={16}/>姿势库</button><span>姿势工作台</span><button onClick={()=>{setRightOpen(!rightOpen);setLeftOpen(false);}}><Settings2 size={16}/>部位</button></div>
    <div className="workspace">
      <aside className={`preset-panel ${leftOpen?'mobile-open':''}`} aria-label="姿势预设库">
        <div className="panel-heading"><h2>姿势库</h2><span>X Bot · 01</span></div>
        <div className="panel-tabs"><button className={tab==='presets'?'selected':''} onClick={()=>setTab('presets')}>动作预设</button><button className={tab==='saved'?'selected':''} onClick={()=>setTab('saved')}>我的姿势{saved.length>0&&<span>{saved.length}</span>}</button></div>
        {tab==='presets'?<>
          <label className="search-input"><Search size={15}/><input aria-label="搜索姿势" placeholder="搜索动作或姿势" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="清除搜索" onClick={()=>setQuery('')}><X size={13}/></button>}</label>
          <div className="category-filter" aria-label="动作类别">{['全部','基础','站姿','坐姿','蹲跪','动态','表达'].map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{c}</button>)}</div>
          <div className="preset-scroll"><div className="preset-grid">{filtered.map(p=><button key={p.id} className={`preset-tile${activePreset===p.id?' selected':''}`} disabled={!info.ready} onClick={()=>choosePreset(p.id)} title={p.description}><div className="preset-image">{presetThumbs[p.id]?<img src={presetThumbs[p.id]} alt={`${p.name}人体预览`}/>:<Bone size={25} strokeWidth={1}/>}<span className="preset-chosen"><Check size={12}/></span></div><span>{p.name}</span></button>)}</div>{!filtered.length&&<div className="empty-state">没有找到这个姿势。<button onClick={()=>{setQuery('');setCategory('全部');}}>显示全部预设</button></div>}</div>
        </>:<div className="preset-scroll saved-library"><button className="save-pose-button" disabled={!info.ready} onClick={saveToLibrary}><Plus size={16}/>收藏当前姿势</button>{saved.length?<div className="preset-grid">{saved.map(s=><div className="saved-item" key={s.id}><button className="preset-tile" onClick={()=>{try{const doc=parseDocument(JSON.stringify(s.document),engineRef.current!.rest);engineRef.current!.apply(doc);accept(doc);setActivePreset('');setLeftOpen(false);}catch(e){notify((e as Error).message);}}}><div className="preset-image"><img src={s.thumbnail} alt={s.name}/></div><span>{s.name}</span></button><button className="remove-saved" aria-label={`移除收藏 ${s.name}`} onClick={()=>{const next=saved.filter(p=>p.id!==s.id);try{localStorage.setItem(LIBRARY_KEY,JSON.stringify(next));setSaved(next);}catch{notify('无法更新本地收藏');}}}><X size={11}/></button></div>)}</div>:<div className="empty-state"><Hand size={25} strokeWidth={1.2}/><p>保留你的下一个好动作</p><span>调整姿势后收藏，随时从这里继续。</span></div>}</div>}
        <div className="library-footer"><span>{tab==='presets'?`${PRESETS.length} 个可编辑预设`:'仅保存在此浏览器'}</span><button aria-label="操作帮助" onClick={()=>setHelpOpen(true)}><CircleHelp size={16}/></button></div>
      </aside>

      <main className="stage-column">
        <div className="stage-toolbar"><div className="tool-group"><IconButton icon={Move3D} label="移动 · W" text="移动" disabled={!engineRef.current?.canTranslate(info.selected)} active={mode==='translate'} onClick={()=>changeMode('translate')}/><IconButton icon={Rotate3D} label="旋转 · E" text="旋转" active={mode==='rotate'} onClick={()=>changeMode('rotate')}/><span className="tool-divider"/><button className="space-button" onClick={()=>{const s=space==='world'?'local':'world';setSpace(s);engineRef.current?.setSpace(s);}}>{space==='world'?'世界坐标':'局部坐标'}<ChevronDown size={12}/></button></div><div className="tool-group"><button className="toolbar-label" onClick={()=>engineRef.current?.mirror()} title="沿人体对称面镜像"><ArrowLeftRight size={16}/><span>镜像</span></button><IconButton icon={RotateCcw} label="重置为中立站姿" onClick={()=>choosePreset('neutral')}/><span className="tool-divider"/><div className="display-switch"><button aria-label="素体显示" className={display==='surface'?'selected':''} onClick={()=>{setDisplay('surface');engineRef.current?.setDisplay('surface');}}><Box size={14}/><span>素体</span></button><button aria-label="骨架显示" className={display==='skeleton'?'selected':''} onClick={()=>{setDisplay('skeleton');engineRef.current?.setDisplay('skeleton');}}><Bone size={14}/><span>骨架</span></button></div></div></div>
        <div className="stage-wrap"><div ref={viewport} className="viewport"/>
          {!info.ready&&<div className="loading-state">{error?<><p>{error}</p><button onClick={()=>location.reload()}>重新载入</button></>:<><LoaderCircle className="spin" size={25}/><p>正在准备人体与骨骼</p><span>载入可编辑的蒙皮素体</span></>}</div>}
          <div className="view-label"><h1>{view==='free'?'自由视角':current?.views.find(v=>v.id===view)?.name??'自由视角'}</h1><small>{view==='free'?'3D':'正交'}</small></div>
          <div className="viewport-actions"><IconButton icon={Maximize} label="聚焦人体 · F" onClick={()=>engineRef.current?.focus()}/><IconButton icon={Grid2X2} label="显示地面网格" active={grid} onClick={()=>{setGrid(!grid);engineRef.current?.setGrid(!grid);}}/><IconButton icon={Expand} label="切换自由观察" active={view==='free'} onClick={()=>chooseView('free')}/></div>
          <div className="axis-widget" aria-label="世界坐标方向"><svg viewBox="0 0 72 72" width="66" height="66"><path d="M36 37L36 10M36 37L62 49M36 37L13 55" stroke="#7c8381" strokeWidth="1.3"/><circle cx="36" cy="37" r="3" fill="#c2c6c3"/><text x="32" y="8" fill="#c2c6c3">Y</text><text x="63" y="55" fill="#c2c6c3">X</text><text x="5" y="65" fill="#c2c6c3">Z</text></svg></div>
          <div className="stage-footnote"><span><MousePointer2 size={12}/>选中控制点，再拖动箭头</span><span>右键旋转 · 中键平移 · 滚轮缩放</span></div>
          {info.warning&&<div className="constraint-warning" role="status">{info.warning}</div>}
        </div>
        <section className="views-strip" aria-label="五视图预览"><div className="views-heading"><div><h2>五视图</h2><span>同一姿态，不同视角</span></div><button onClick={()=>{engineRef.current?.resetViews();notify('已恢复默认五视图');}} title="恢复默认相机"><RotateCcw size={13}/>重置视角</button></div><div className="views-grid">{DEFAULT_VIEWS.map((v,i)=>{const thumb=thumbnails.find(t=>t.id===v.id);return <div className={`view-card${view===v.id?' selected':''}`} key={v.id}><button className="view-image" onClick={()=>chooseView(v.id)} aria-label={`查看${v.name}`}>{thumb&&<img src={thumb.url} alt={`${v.name}姿态预览`}/>}<span className="view-number">0{i+1}</span></button><div className="view-caption"><button onClick={()=>chooseView(v.id)}>{current?.views[i].name??v.name}</button><button aria-label={`用当前观察替换${v.name}`} title="用当前观察替换此视角" onClick={()=>{engineRef.current?.captureView(v.id);notify(`已更新${v.name}相机`);}}><Copy size={12}/></button></div></div>;})}</div></section>
      </main>

      <aside className={`inspector-panel ${rightOpen?'mobile-open':''}`} aria-label="当前部位属性">
        <div className="inspector-title"><span><Settings2 size={15}/>姿态属性</span><button className="mobile-close" aria-label="关闭属性" onClick={()=>setRightOpen(false)}><X size={16}/></button></div>
        <section className="inspector-section"><div className="section-label"><h2>当前部位</h2><span>控制器</span></div><label className="part-select"><span className="selected-part-dot"/><select aria-label="选择身体部位" value={info.selected} onChange={e=>engineRef.current?.select(e.target.value)}>{Object.entries(PART_NAMES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><ChevronDown size={14}/></label><div className="selection-mode"><span>{control.label} · {mode==='translate'?'移动':'旋转'}</span><button onClick={()=>engineRef.current?.resetSelected()}>重置部位</button></div>
          <p className="field-help control-help">{control.help}</p><div className="coordinate-label">世界位置<span>米</span></div><div className="number-row">{['X','Y','Z'].map((a,i)=><NumberField key={`${info.selected}-p-${a}`} label={a} unit="m" disabled={!engineRef.current?.canTranslate(info.selected)} value={info.position[i]} onChange={v=>engineRef.current?.setSelectedPosition(i,v)}/>)}</div>
          <div className="coordinate-label">局部旋转<span>度</span></div><div className="number-row">{['X','Y','Z'].map((a,i)=><NumberField key={`${info.selected}-r-${a}`} label={a} unit="°" step={1} value={info.rotation[i]} onChange={v=>engineRef.current?.setSelectedRotation(i,v)}/>)}</div>
        </section>
        <section className="inspector-section"><div className="section-label"><h2>IK 与固定</h2><Bone size={14}/></div><label className={`setting-row ${!selectedEffector?'unavailable':''}`}><span>{info.pinned?<LockKeyhole size={14}/>:<UnlockKeyhole size={14}/>}固定当前手脚</span><input type="checkbox" role="switch" disabled={!selectedEffector} checked={info.pinned} onChange={e=>engineRef.current?.setPin(e.target.checked,info.orientationPinned)}/></label><label className="setting-row subsetting"><span>同时固定方向</span><input type="checkbox" disabled={!info.pinned} checked={info.orientationPinned} onChange={e=>engineRef.current?.setPin(true,e.target.checked)}/></label><p className="field-help">固定后移动骨盆，手脚保持在原位置。</p><label className="setting-row"><span>脚底地面约束</span><input type="checkbox" role="switch" checked={info.ground} onChange={e=>engineRef.current?.setGround(e.target.checked)}/></label><label className="setting-row"><span>更多身体控制点</span><input type="checkbox" role="switch" checked={more} onChange={e=>{setMore(e.target.checked);engineRef.current?.setMore(e.target.checked);}}/></label><p className="field-help">显示骨盆、胸腔、头部与肘膝控制。</p></section>
        <section className="inspector-section"><div className="section-label"><h2>手部姿态</h2><Hand size={14}/></div>{(['Left','Right'] as const).map(side=><div className="hand-row" key={side}><span>{side==='Left'?'左手':'右手'}</span><div className="hand-options">{['张手','握拳','指向'].map(shape=><button key={shape} className={info.hands[side]===shape?'selected':''} onClick={()=>engineRef.current?.setHand(side,shape)}>{shape}</button>)}</div></div>)}</section>
        <section className="inspector-section"><div className="section-label"><h2>对称编辑</h2><ArrowLeftRight size={14}/></div><div className="mirror-actions"><button onClick={()=>engineRef.current?.mirror('Left')}>左侧<ArrowUpRight size={12}/>右侧</button><button onClick={()=>engineRef.current?.mirror('Right')}>右侧<ArrowUpRight size={12}/>左侧</button></div><button className="save-pose-button" disabled={!info.ready} onClick={saveToLibrary}><Plus size={15}/>收藏当前姿势</button></section>
        <div className="inspector-bottom"><span><span className="status-dot"/>Mixamo X Bot</span><span>{info.ready?`${info.boneCount} 根骨骼 · 完整蒙皮`:'正在载入'}</span><a href={CURRENT_MODEL.sourceUrl} target="_blank" rel="noreferrer">模型来源与说明<ArrowUpRight size={12}/></a></div>
      </aside>
    </div>
    <footer className="statusbar"><span>MomoPoseForge<span className="version">v0.1</span></span><span><kbd>W</kbd>移动<kbd>E</kbd>旋转<kbd>F</kbd>聚焦</span><span>人体姿态编辑 · 数据留在你的设备上</span></footer>
    {toast&&<div className="toast" role="status"><Check size={15}/>{toast}<button aria-label="关闭提示" onClick={()=>setToast('')}><X size={14}/></button></div>}

    <dialog ref={exportDialog} className="export-dialog" onCancel={e=>{if(exporting){e.preventDefault();exportAbort.current?.abort();}else setExportOpen(false);}} onClose={()=>{if(!exporting)setExportOpen(false);}}>
      <div className="dialog-header"><div><span className="dialog-eyebrow">准备交付</span><h2>导出姿势参考</h2></div><IconButton icon={X} label="关闭导出" disabled={exporting} onClick={()=>setExportOpen(false)}/></div>
      <p className="dialog-description">所有视图来自同一份姿态，图片与关节点保持对应。</p>
      <div className="export-preview">{thumbnails.map(t=><div key={t.id}><img src={t.url} alt={t.name}/><span>{t.name}</span></div>)}</div>
      <fieldset disabled={exporting}><div className="export-layout"><div><h3>导出范围</h3><div className="choice-row"><button className={options.scope==='five'?'selected':''} onClick={()=>setOptions({...options,scope:'five'})}>完整五视图</button><button className={options.scope==='current'?'selected':''} onClick={()=>setOptions({...options,scope:'current'})}>当前视角</button></div></div><div><h3>单张分辨率</h3><select aria-label="导出分辨率" value={options.resolution} onChange={e=>setOptions({...options,resolution:Number(e.target.value) as 768|1536})}><option value={768}>768 × 1024</option><option value={1536}>1536 × 2048</option></select></div></div>
        <div className="export-section-label"><h3>文件内容</h3><button onClick={()=>setOptions({...options,surface:false,skeleton:true,keypoints:true,sheet:false,project:true})}>使用 AI 姿势控制方案<ChevronRight size={12}/></button></div>
        <div className="export-checks">{([['surface','人体素体图','PNG · X Bot 素体参考'],['skeleton','身体骨架图','PNG · 黑底 COCO18'],['keypoints','二维关节点','JSON · OpenPose COCO18'],['sheet','视图拼图','PNG · 便于整组查看'],['project','可编辑工程','JSON · 保留全部姿态与相机']] as const).map(([key,label,hint])=><label className="export-check" key={key}><input type="checkbox" checked={options[key]} onChange={e=>setOptions({...options,[key]:e.target.checked})}/><span>{label}<small>{hint}</small></span></label>)}</div><label className="setting-row export-transparent"><span>人体图使用透明背景</span><input type="checkbox" role="switch" checked={options.transparent} onChange={e=>setOptions({...options,transparent:e.target.checked})}/></label>
      </fieldset>
      <div className="dialog-footer"><span>{exporting?<><LoaderCircle size={14} className="spin"/>{progress}</>:<><LockKeyhole size={13}/>浏览器本地生成 ZIP</>}</span>{exporting?<button onClick={()=>exportAbort.current?.abort()}>取消导出</button>:<button className="primary-button" disabled={!Object.entries(options).some(([k,v])=>['surface','skeleton','keypoints','sheet','project'].includes(k)&&v)} onClick={()=>void runExport()}><Download size={16}/>生成并下载</button>}</div>
    </dialog>
    <dialog ref={helpDialog} className="help-dialog" onCancel={()=>setHelpOpen(false)} onClose={()=>setHelpOpen(false)}><div className="dialog-header"><h2>把想法摆出来</h2><IconButton icon={X} label="关闭帮助" onClick={()=>setHelpOpen(false)}/></div><p>从左侧选择接近的动作，拖动手脚控制点微调。需要调整身体时，打开“更多身体控制点”。</p><dl><dt>转动观察</dt><dd>按住右键拖动</dd><dt>平移观察</dt><dd>按住中键拖动</dd><dt>缩放</dt><dd>滚动鼠标滚轮</dd><dt>调整位置 / 旋转</dt><dd>W / E</dd><dt>聚焦人物</dt><dd>F</dd><dt>撤销 / 重做</dt><dd>Ctrl Z / Ctrl Shift Z</dd><dt>肘膝朝向</dt><dd>选中肘或膝，在移动模式调整弯曲方向</dd></dl><p>五视图下的复制按钮将当前观察存入对应相机。导出前检查每个视角，选择素体图或 AI 骨架图。</p><p className="field-help">草稿和收藏仅保存在此浏览器。下载工程文件可以在其他设备继续编辑。COCO18 身体输出不含手指和完整面部点集。</p><button className="primary-button" onClick={()=>setHelpOpen(false)}>开始摆姿势</button></dialog>
  </div>;
}
