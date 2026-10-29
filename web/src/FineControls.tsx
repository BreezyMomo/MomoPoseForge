import {useEffect,useRef} from 'react';
import type {PoseEngine} from './PoseEngine';
import {DIGITS,DIGIT_NAMES,type Digit,type EngineInfo,type Side} from './types';
import {FINGER_CURL_LIMITS,fingerPart} from './articulation';

function JointSlider({label,value,min,max,disabled=false,onPreview,onCommit}:{label:string;value:number;min:number;max:number;disabled?:boolean;onPreview:(value:number)=>void;onCommit:()=>void}){
  const dragging=useRef(false),commit=useRef(onCommit);commit.current=onCommit;
  const finish=()=>{if(dragging.current){dragging.current=false;commit.current();}};
  useEffect(()=>{window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);return()=>{window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);};},[]);
  return <label className="joint-slider"><span>{label}<output>{Math.round(value)}°</output></span><input type="range" aria-label={label} disabled={disabled} min={min} max={max} step={1} value={Math.round(value)} onPointerDown={()=>{dragging.current=true;}} onBlur={finish} onChange={event=>{onPreview(Number(event.target.value));if(!dragging.current)commit.current();}}/></label>;
}

export function FineControls({engine,info}:{engine:PoseEngine|null;info:EngineInfo}){
  const side=info.handDetail,selected=fingerPart(info.selected),digit=(selected?.[2]??'Index') as Digit;
  const sideName=side==='Left'?'左手':'右手';
  const open=(next:Side)=>{engine?.setHandDetail(next);engine?.focusHand(next);};
  const commit=()=>engine?.commit();
  return <>
    <section className="inspector-section fine-controls"><div className="section-label"><h2>手指精调</h2><span>逐节控制</span></div>
      <div className="fine-tabs"><button disabled={!info.ready} aria-pressed={side==='Left'} onClick={()=>open('Left')}>左手精调</button><button disabled={!info.ready} aria-pressed={side==='Right'} onClick={()=>open('Right')}>右手精调</button></div>
      {side?<>
        <div className="fine-select"><label>手指<select aria-label="选择手指" value={digit} onChange={e=>engine?.select(`${side}${e.target.value}1`)}>{DIGITS.map(d=><option key={d} value={d}>{DIGIT_NAMES[d]}</option>)}</select></label><button onClick={()=>engine?.focusHand(side)}>聚焦手部</button></div>
        <div className="fine-joints">{[1,2,3].map(joint=><button key={joint} aria-pressed={info.selected===`${side}${digit}${joint}`} onClick={()=>engine?.select(`${side}${digit}${joint}`)}>第 {joint} 节</button>)}</div>
        {[1,2,3].map(joint=><JointSlider key={`${side}${digit}${joint}`} label={`${sideName}${DIGIT_NAMES[digit]}第 ${joint} 节弯曲`} value={info.fingers[side][digit].curl[joint-1]} min={-10} max={FINGER_CURL_LIMITS[digit][joint-1]} onPreview={v=>engine?.setFinger(side,digit,joint,v,'curl',false)} onCommit={commit}/>)}
        <JointSlider label={`${sideName}${DIGIT_NAMES[digit]}张开`} value={info.fingers[side][digit].spread} min={digit==='Thumb'?-40:-20} max={digit==='Thumb'?40:20} onPreview={v=>engine?.setFinger(side,digit,1,v,'spread',false)} onCommit={commit}/>
        <button className="fine-close" onClick={()=>{engine?.setHandDetail(null);engine?.focus();}}>返回全身</button>
      </>:<p className="field-help">选择一只手进入近景，调整每节指骨和手指张开角度。</p>}
    </section>
    <section className="inspector-section fine-controls"><div className="section-label"><h2>前臂翻转</h2><span>保留弯肘</span></div><p className="field-help">沿前臂轴翻转手掌，不改变手腕位置。</p>{(['Left','Right'] as const).map(s=><JointSlider key={s} disabled={!info.ready} label={`${s==='Left'?'左':'右'}前臂翻转`} value={info.forearmTwist[s]} min={-90} max={90} onPreview={v=>engine?.setForearmTwist(s,v,false)} onCommit={commit}/>)}</section>
    <section className="inspector-section fine-controls"><div className="section-label"><h2>脚趾控制</h2><span>前脚掌弯曲</span></div>{(['Left','Right'] as const).map(s=><JointSlider key={s} disabled={!info.ready} label={`${s==='Left'?'左':'右'}脚趾弯曲`} value={info.toes[s]} min={-45} max={65} onPreview={v=>engine?.setToeBend(s,v,false)} onCommit={commit}/>)}</section>
  </>;
}
