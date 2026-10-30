import type {PoseEngine} from './PoseEngine';
import type {EngineInfo} from './types';
import type {FootContactMode} from './footContacts';
import {t} from './workbenchState';
import {partName} from './productLabels';

export function FootContactsPanel({engine,info}:{engine:PoseEngine|null;info:EngineInfo}){
  if(!engine?.activeRig.soles)return null;
  return <section className="inspector-section foot-contacts"><div className="section-label"><h2>{t('pose.soleTitle')}</h2></div>
    <p className="field-help">{t('pose.soleHelp')}</p>
    {Object.keys(engine.activeRig.soles).map(end=>{const state=info.footContacts?.[end],name=partName(end),mode=state?.mode??'free';return <div className="foot-contact" key={end}>
      <label className="setting-row"><span>{name}</span><select aria-label={t('pose.soleMode',name)} disabled={!info.ready} value={mode} onChange={e=>engine.setFootContact(end,e.target.value as FootContactMode,state?.mode==='ball'?state.angle:35)}>
        <option value="free">{t('pose.soleFree')}</option><option value="flat">{t('pose.soleFlat')}</option><option value="ball">{t('pose.soleBall')}</option>
      </select></label>
      {mode==='ball'&&<label className="setting-row"><span>{t('pose.heelAngle')}</span><input className="sole-angle" type="number" aria-label={t('pose.heelAngleSide',name)} key={`${end}-${state?.angle}`} min={0} max={45} step={5} defaultValue={state?.angle??35} onBlur={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value))engine.setFootContact(end,'ball',value);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>°</span></label>}
      {state&&mode!=='free'&&<p className={`field-help${state.error>.002?' sole-warning':''}`} role="status">{state.error>.002?t('pose.soleUnmet',(state.error*1000).toFixed(1)):t('pose.soleMet',(Math.max(0,state.heel[1])*100).toFixed(1))}</p>}
    </div>;})}
    <p className="field-help">{t('pose.soleLimits')}</p>
  </section>;
}
