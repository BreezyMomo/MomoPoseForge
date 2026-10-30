import {partName,propName,anchorName} from './productLabels';
import {t} from './workbenchState';
import {useEffect,useState} from 'react';
import {Box,Eye,EyeOff,Trash2} from 'lucide-react';
import type {PoseEngine} from './PoseEngine';
import {END_EFFECTORS,PART_NAMES,type Effector,type EngineInfo,type Vec3} from './types';
import {MAX_PROPS,PROP_KINDS,propAnchors,type PropKind,type SceneProp} from './sceneProps';

function PropNumber({label,value,min,max,step=.01,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(value:number)=>void}){
  const [text,setText]=useState(String(value));useEffect(()=>setText(String(value)),[value]);
  return <label className="prop-number"><span>{label}</span><input aria-label={label} type="number" min={min} max={max} step={step} value={text} onChange={e=>setText(e.target.value)} onBlur={()=>{const next=Number(text);setText(String(value));if(text.trim()&&Number.isFinite(next)&&next!==value)onChange(next);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>;
}

export function PropsPanel({engine,info,onNotify}:{engine:PoseEngine|null;info:EngineInfo;onNotify:(message:string)=>void}){
  const props=info.props??[],[selected,setSelected]=useState(''),[anchorId,setAnchorId]=useState('center'),[end,setEnd]=useState<Effector>('LeftHand');
  const prop=props.find(p=>p.id===selected)??props[0],anchors=prop?propAnchors(prop):[],anchor=anchors.find(a=>a.id===anchorId)??anchors[0];
  useEffect(()=>{if(END_EFFECTORS.includes(info.selected as Effector))setEnd(info.selected as Effector);},[info.selected]);
  const act=(action:()=>void)=>{try{action();}catch(e){onNotify((e as Error).message);}};
  const change=(patch:Partial<Pick<SceneProp,'position'|'size'|'yaw'|'visible'>>)=>{if(prop)act(()=>engine?.changeProp(prop.id,patch));};
  const vector=(field:'position'|'size',axis:number,value:number)=>{if(!prop)return;const next=[...prop[field]] as Vec3;next[axis]=value;change({[field]:next});};
  return <>
    <section className="inspector-section props-panel"><div className="section-label"><h2>{t('pose.basicProps')}</h2><span>{props.length} / {MAX_PROPS}</span></div>
      <div className="prop-add">{Object.entries(PROP_KINDS).map(([kind,name])=><button key={kind} disabled={!info.ready||props.length>=MAX_PROPS} onClick={()=>act(()=>{const id=engine?.addProp(kind as PropKind);if(id)setSelected(id);})}>+ {propName(kind as PropKind)}</button>)}</div>
      <div className="prop-list" aria-label={t('pose.sceneProps')}>{props.map((p,i)=><div className={p.id===prop?.id?'selected':''} key={p.id}><button aria-pressed={p.id===prop?.id} onClick={()=>setSelected(p.id)}><Box size={13}/>{propName(p.kind)} {i+1}</button><button aria-label={`${p.visible?'隐藏':'显示'}${propName(p.kind)} ${i+1}`} onClick={()=>act(()=>engine?.changeProp(p.id,{visible:!p.visible}))}>{p.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button aria-label={`移除${propName(p.kind)} ${i+1}`} onClick={()=>act(()=>engine?.removeProp(p.id))}><Trash2 size={13}/></button></div>)}</div>
      {!props.length&&<p className="field-help">{t('pose.propsIntro')}</p>}
    </section>
    {prop&&<>
      <section className="inspector-section props-panel"><div className="section-label"><h2>{propName(prop.kind)}{t('pose.settings')}</h2><span>{t('pose.metresDegrees')}</span></div>
        <p className="field-help">{t('pose.propOriginHelp')}</p>
        <div className="prop-fields">{['X','Y','Z'].map((axis,i)=><PropNumber key={`position-${prop.id}-${i}`} label={t('pose.positionAxis',axis)} value={prop.position[i]} min={-5} max={5} onChange={v=>vector('position',i,v)}/>)}</div>
        <div className="prop-fields">{[t('pose.widthFull'),t('pose.heightFull'),t('pose.depthFull')].map((axis,i)=><PropNumber key={`size-${prop.id}-${i}`} label={axis} value={prop.size[i]} min={.02} max={3} onChange={v=>vector('size',i,v)}/>)}</div>
        <PropNumber key={`yaw-${prop.id}`} label={t('pose.yaw')} value={prop.yaw} min={-180} max={180} step={5} onChange={v=>change({yaw:v})}/>
      </section>
      <section className="inspector-section props-panel"><div className="section-label"><h2>{t('pose.contactHelp')}</h2><span>{t('pose.positionAndPin')}</span></div>
        <label className="prop-select">{t('pose.part')}<select aria-label={t('pose.contactPart')} value={end} onChange={e=>setEnd(e.target.value as Effector)}>{END_EFFECTORS.map(e=><option key={e} value={e}>{partName(e)}{e.endsWith('Hand')?'腕':'底'}</option>)}</select></label>
        <label className="prop-select">{t('pose.contactPoint')}<select aria-label={t('pose.propContactPoint')} value={anchor?.id??''} onChange={e=>setAnchorId(e.target.value)}>{anchors.map(a=><option key={a.id} value={a.id}>{anchorName(prop.kind,a)}</option>)}</select></label>
        <button className="prop-contact" disabled={!info.ready||!prop.visible||!!engine?.pins[end]||prop.kind==='bar'&&end.endsWith('Foot')} onClick={()=>act(()=>{engine?.placeOnProp(prop.id,anchor!.id,end);onNotify(`${partName(end)}已定位并固定，可一步撤销`);})}>{end.endsWith('Hand')?t('pose.placeWrist'):t('pose.placeFoot')}</button>
        <button className="prop-unpin" disabled={!info.ready||!engine?.pins[end]} onClick={()=>act(()=>{engine?.select(end);engine?.setPin(false);})}>{t('pose.unpinPrefix')}{partName(end)}{t('pose.pinSuffix')}</button>
        <p className="field-help">{t('pose.propContactHelp')}</p>
      </section>
    </>}
  </>;
}
