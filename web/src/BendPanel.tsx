import {JointSlider} from './FineControls';
import type {PoseEngine} from './PoseEngine';
import type {EngineInfo} from './types';
import {t} from './workbenchState';

export function BendPanel({engine,info,label}:{engine:PoseEngine|null;info:EngineInfo;label:(name:string)=>string}){
  if(!engine?.activeRig.bendControls||!info.ready)return null;
  return <section className="inspector-section"><div className="section-label"><h2>{t('pose.bendDirections')}</h2></div><p className="field-help">{t('pose.bendHelp')}</p>{Object.keys(engine.activeRig.bendControls).map(end=>{
    const frame=engine.bendDirection(end),name=label(engine.activeRig.chains[end][1]);
    return <div key={end}><JointSlider label={t('pose.bendDirection',name)} value={frame?frame.angle*180/Math.PI:0} min={-180} max={180} disabled={!frame||info.actorEditable===false} onPreview={v=>engine.setBendDirection(end,v,false)} onCommit={()=>engine.commit()}/><button className="bend-reset" disabled={!frame||info.actorEditable===false} onClick={()=>engine.setBendDirection(end,0)}>{t('pose.resetBend',name)}</button>{!frame&&<p className="field-help">{t('pose.bendStraight')}</p>}</div>;
  })}</section>;
}
