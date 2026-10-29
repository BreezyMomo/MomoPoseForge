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
    <section className="inspector-section props-panel"><div className="section-label"><h2>基础道具</h2><span>{props.length} / {MAX_PROPS}</span></div>
      <div className="prop-add">{Object.entries(PROP_KINDS).map(([kind,name])=><button key={kind} disabled={!info.ready||props.length>=MAX_PROPS} onClick={()=>act(()=>{const id=engine?.addProp(kind as PropKind);if(id)setSelected(id);})}>+ {name}</button>)}</div>
      <div className="prop-list" aria-label="场景道具">{props.map((p,i)=><div className={p.id===prop?.id?'selected':''} key={p.id}><button aria-pressed={p.id===prop?.id} onClick={()=>setSelected(p.id)}><Box size={13}/>{PROP_KINDS[p.kind]} {i+1}</button><button aria-label={`${p.visible?'隐藏':'显示'}${PROP_KINDS[p.kind]} ${i+1}`} onClick={()=>act(()=>engine?.changeProp(p.id,{visible:!p.visible}))}>{p.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button aria-label={`移除${PROP_KINDS[p.kind]} ${i+1}`} onClick={()=>act(()=>engine?.removeProp(p.id))}><Trash2 size={13}/></button></div>)}</div>
      {!props.length&&<p className="field-help">添加椅子辅助坐姿、桌子辅助扶桌，或用方块设置踩踏高度。道具随工程保存，操作可撤销。</p>}
    </section>
    {prop&&<>
      <section className="inspector-section props-panel"><div className="section-label"><h2>{PROP_KINDS[prop.kind]}设置</h2><span>米 / 度</span></div>
        <p className="field-help">位置以底面中心为准；椅子高度指坐面高度。与人体重叠时，可手动调整位置、高度和深度。</p>
        <div className="prop-fields">{['X','Y','Z'].map((axis,i)=><PropNumber key={`position-${prop.id}-${i}`} label={`位置 ${axis}`} value={prop.position[i]} min={-5} max={5} onChange={v=>vector('position',i,v)}/>)}</div>
        <div className="prop-fields">{['宽度','高度','深度'].map((axis,i)=><PropNumber key={`size-${prop.id}-${i}`} label={axis} value={prop.size[i]} min={.02} max={3} onChange={v=>vector('size',i,v)}/>)}</div>
        <PropNumber key={`yaw-${prop.id}`} label="水平旋转" value={prop.yaw} min={-180} max={180} step={5} onChange={v=>change({yaw:v})}/>
      </section>
      <section className="inspector-section props-panel"><div className="section-label"><h2>接触辅助</h2><span>定位并固定</span></div>
        <label className="prop-select">部位<select aria-label="接触部位" value={end} onChange={e=>setEnd(e.target.value as Effector)}>{END_EFFECTORS.map(e=><option key={e} value={e}>{PART_NAMES[e]}{e.endsWith('Hand')?'腕':'底'}</option>)}</select></label>
        <label className="prop-select">接触点<select aria-label="道具接触点" value={anchor?.id??''} onChange={e=>setAnchorId(e.target.value)}>{anchors.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <button className="prop-contact" disabled={!info.ready||!prop.visible||!!engine?.pins[end]||prop.kind==='bar'&&end.endsWith('Foot')} onClick={()=>act(()=>{engine?.placeOnProp(prop.id,anchor!.id,end);onNotify(`${PART_NAMES[end]}已定位并固定，可一步撤销`);})}>{end.endsWith('Hand')?'手腕定位到接触点':'脚底踩到接触点'}</button>
        <button className="prop-unpin" disabled={!info.ready||!engine?.pins[end]} onClick={()=>act(()=>{engine?.select(end);engine?.setPin(false);})}>解除{PART_NAMES[end]}固定</button>
        <p className="field-help">脚底定位同时放平脚掌；手部按手腕定位，可继续精调手型。固定在世界位置，移动道具后请重新定位；不自动握合或处理碰撞。</p>
      </section>
    </>}
  </>;
}
