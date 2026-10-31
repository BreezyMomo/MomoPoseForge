import {digitName} from './productLabels';
import {t} from './workbenchState';
import {useEffect,useRef} from 'react';
import type {PoseEngine} from './PoseEngine';
import {DIGITS,DIGIT_NAMES,type Digit,type EngineInfo,type Side} from './types';
import {FINGER_CURL_LIMITS} from './articulation';
import {rigFinger} from './handRig';

export function JointSlider({label,value,min,max,disabled=false,onPreview,onCommit}:{label:string;value:number;min:number;max:number;disabled?:boolean;onPreview:(value:number)=>void;onCommit:()=>void}){
  const dragging=useRef(false),commit=useRef(onCommit);commit.current=onCommit;
  const finish=()=>{if(dragging.current){dragging.current=false;commit.current();}};
  useEffect(()=>{window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);return()=>{window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);};},[]);
  return <label className="joint-slider"><span>{label}<output>{Math.round(value)}°</output></span><input type="range" aria-label={label} disabled={disabled} min={min} max={max} step={1} value={Math.round(value)} onPointerDown={()=>{dragging.current=true;}} onBlur={finish} onChange={event=>{onPreview(Number(event.target.value));if(!dragging.current)commit.current();}}/></label>;
}

export function FineControls({engine,info}:{engine:PoseEngine|null;info:EngineInfo}){
  const side=info.handDetail,selected=engine?rigFinger(engine.activeRig,info.selected):null,digit=(selected?.digit??'Index') as Digit;
  const sideName=side==='Left'?t('pose.leftHand'):t('pose.rightHand');
  const open=(next:Side)=>{if(side===next){engine?.focus();return;}engine?.setHandDetail(next);engine?.focusHand(next);};
  const commit=()=>engine?.commit();
  return <>
    <section className="inspector-section fine-controls"><div className="section-label"><h2>{t('pose.fingerControls')}</h2><span>{t('pose.eachJoint')}</span></div>
      <div className="fine-tabs"><button disabled={!info.ready} aria-pressed={side==='Left'} onClick={()=>open('Left')}>{t('pose.leftHandControls')}</button><button disabled={!info.ready} aria-pressed={side==='Right'} onClick={()=>open('Right')}>{t('pose.rightHandControls')}</button></div>
      {side?<>
        <button className="fine-close" onClick={()=>engine?.focus()}>{t('pose.fullBody')}</button>
        <div className="fine-select"><label>{t('pose.finger')}<select aria-label={t('pose.chooseFinger')} value={digit} onChange={e=>engine?.select(engine.fingerName(side,e.target.value as Digit,1))}>{DIGITS.map(d=><option key={d} value={d}>{digitName(d)}</option>)}</select></label><button onClick={()=>engine?.focusHand(side)}>{t('pose.focusHand')}</button></div>
        <div className="fine-joints">{[1,2,3].map(joint=><button key={joint} aria-pressed={info.selected===engine?.fingerName(side,digit,joint)} onClick={()=>engine?.select(engine.fingerName(side,digit,joint))}>{t('pose.joint',joint)}</button>)}</div>
        {[1,2,3].map(joint=><JointSlider key={`${side}${digit}${joint}`} label={t('pose.fingerBend',sideName,digitName(digit),joint)} value={info.fingers[side][digit].curl[joint-1]} min={-10} max={FINGER_CURL_LIMITS[digit][joint-1]} onPreview={v=>engine?.setFinger(side,digit,joint,v,'curl',false)} onCommit={commit}/>)}
        <JointSlider label={t('pose.fingerSpread',sideName,digitName(digit))} value={info.fingers[side][digit].spread} min={digit==='Thumb'?-40:-20} max={digit==='Thumb'?40:20} onPreview={v=>engine?.setFinger(side,digit,1,v,'spread',false)} onCommit={commit}/>
      </>:<p className="field-help">{t('pose.fingersIntro')}</p>}
    </section>
    {engine?.humanoid&&<><section className="inspector-section fine-controls"><div className="section-label"><h2>{t('pose.forearmRoll')}</h2><span>{t('pose.keepElbow')}</span></div><p className="field-help">{t('pose.rollHelp')}</p>{(['Left','Right'] as const).map(s=><JointSlider key={s} disabled={!info.ready} label={t('pose.forearmSide',t(s==='Left'?'pose.left':'pose.right'))} value={info.forearmTwist[s]} min={-90} max={90} onPreview={v=>engine?.setForearmTwist(s,v,false)} onCommit={commit}/>)}</section>
    <section className="inspector-section fine-controls"><div className="section-label"><h2>{t('pose.toeControls')}</h2><span>{t('pose.forefootBend')}</span></div>{(['Left','Right'] as const).map(s=><JointSlider key={s} disabled={!info.ready||!!info.footContacts?.[`${s}Foot`]&&info.footContacts[`${s}Foot`].mode!=='free'} label={t('pose.toeSide',t(s==='Left'?'pose.left':'pose.right'))} value={info.toes[s]} min={-45} max={65} onPreview={v=>engine?.setToeBend(s,v,false)} onCommit={commit}/>)}</section></>}
  </>;
}
