import {useEffect,useRef} from 'react';
import {Camera,Copy,Minus,Plus,RotateCcw} from 'lucide-react';
import {t} from './workbenchState';
import {viewName} from './productLabels';
import type {PoseEngine} from './PoseEngine';
import type {ViewSlot} from './types';
import type {CameraSettings} from './cameraState';
import './fiveViews.css';

function LiveView({engine,id,ready}:{engine:PoseEngine|null;id:string;ready:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{if(engine&&ready&&canvas.current)return engine.attachViewPreview(id,canvas.current);},[engine,id,ready]);
  return <canvas ref={canvas} aria-hidden="true"/>;
}

export function ViewProjection({engine,slot,label}:{engine:PoseEngine|null;slot:ViewSlot;label:string}){
  return <select disabled={!engine?.ready} aria-label={label} value={slot.projection??'orthographic'} onChange={e=>engine?.setViewProjection(slot.id,e.target.value as 'orthographic'|'perspective')}><option value="orthographic">{t('pose.orthographic')}</option><option value="perspective">{t('pose.perspective')}</option></select>;
}

export function FiveViews({engine,ready,slots,settings,view,onChoose,onCamera,onNotify}:{engine:PoseEngine|null;ready:boolean;slots:ViewSlot[];settings:CameraSettings;view:string;onChoose:(id:string)=>void;onCamera:()=>void;onNotify:(text:string)=>void}){
  return <section className="views-strip live-views-strip" aria-label={t('pose.viewsPreview')}>
    <div className="views-heading"><div><h2>{t('pose.panel.views')}</h2><span>{t('pose.liveViews')} · {settings.framing.locked?t('pose.framingLocked'):t('pose.autoFit')}</span></div><div className="views-heading-actions"><button disabled={!ready} onClick={()=>engine?.setFramingLock(!settings.framing.locked)} title={t('pose.framingHelp')}>{settings.framing.locked?t('pose.unlockViewFraming'):t('pose.lockFraming')}</button><button disabled={!ready} onClick={()=>engine?.reframe()}>{t('pose.refit')}</button><button disabled={!ready} onClick={onCamera}><Camera size={13}/>{t('pose.camera')}</button><button disabled={!ready} onClick={()=>{engine?.resetViews();onNotify(t('pose.defaultViewsRestored'));}} title={t('pose.resetCamera')}><RotateCcw size={13}/>{t('pose.resetViews')}</button></div></div>
    <div className="views-grid live-views-grid">{slots.map((slot,i)=><div className={`view-card${view===slot.id?' selected':''}`} key={slot.id}>
      <button className="view-image" disabled={!ready||settings.locked} onClick={()=>onChoose(slot.id)} aria-label={viewName(slot)}><LiveView engine={engine} id={slot.id} ready={ready}/><span className="view-number">0{i+1}</span></button>
      <div className="view-caption"><button disabled={!ready||settings.locked} onClick={()=>onChoose(slot.id)}>{viewName(slot)}</button><button disabled={!ready} aria-label={t('pose.copyViewDirection',viewName(slot))} title={t('pose.replaceView')} onClick={()=>{engine?.captureView(slot.id);onNotify(t('pose.viewUpdated',viewName(slot)));}}><Copy size={12}/></button></div>
      <div className="view-camera-tools"><ViewProjection engine={engine} slot={slot} label={t('pose.slotProjection',i+1)}/><div className="view-zoom"><button disabled={!ready||(slot.zoom??1)<=.25} aria-label={t('pose.zoomOutView',viewName(slot))} onClick={()=>engine?.setViewZoom(slot.id,(slot.zoom??1)/1.2)}><Minus size={12}/></button><button disabled={!ready} className="view-zoom-reset" aria-label={t('pose.resetViewZoom',viewName(slot))} onClick={()=>engine?.setViewZoom(slot.id,1)}>{Math.round((slot.zoom??1)*100)}%</button><button disabled={!ready||(slot.zoom??1)>=4} aria-label={t('pose.zoomInView',viewName(slot))} onClick={()=>engine?.setViewZoom(slot.id,(slot.zoom??1)*1.2)}><Plus size={12}/></button></div></div>
    </div>)}</div>
  </section>;
}
