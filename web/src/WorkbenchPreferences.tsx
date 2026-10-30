import {useRef,useState} from 'react';
import {THEME_IDS,normalizeAppearance,type ThemeId} from '@momo/workbench/appearance';
import {applyAppearance,currentAppearance,language,t,useLanguage,type AppearanceChoice} from './workbenchState';

const themeLabels:Record<ThemeId,[string,string]>={xuanhei:['玄黑鎏金','Ink and gold'],shuimo:['水墨朱砂','Ink wash'],yuebai:['月白墨青','Moon white'],qingci:['青瓷流金','Celadon'],qinghua:['青花映月','Blue porcelain'],mineral:['敦煌矿彩','Mineral'],ouhe:['藕荷雪青','Lotus']};
export function WorkbenchPreferences(){
  const code=useLanguage(),dialog=useRef<HTMLDialogElement>(null),before=useRef<AppearanceChoice>(currentAppearance()),committed=useRef(false);
  const [draft,setDraft]=useState(currentAppearance);
  const open=()=>{before.current=currentAppearance();setDraft(before.current);committed.current=false;dialog.current?.showModal();};
  const preview=(next:AppearanceChoice)=>{setDraft(next);applyAppearance(next);};
  const close=()=>dialog.current?.close();
  return <>
    <label className="workbench-language"><span className="visually-hidden">{t('pose.language')}</span><select aria-label={t('pose.language')} value={code} onChange={e=>language.setLanguage(e.target.value)}>{language.SUPPORTED_LANGUAGES.map(({code,name})=><option key={code} value={code}>{name}</option>)}</select></label>
    <button className="text-button workbench-appearance" onClick={open}>{t('pose.appearance')}</button>
    <dialog ref={dialog} className="workbench-appearance-dialog" onClose={()=>{if(!committed.current)applyAppearance(before.current);}}>
      <div className="dialog-header"><h2>{t('pose.previewAppearance')}</h2><button aria-label={t('pose.cancel')} onClick={close}>×</button></div>
      <div className="workbench-appearance-body">
        <label>{t('pose.theme')}<select aria-label={t('pose.theme')} value={draft.theme} onChange={e=>{const theme=e.target.value as AppearanceChoice['theme'];preview({theme,preferences:normalizeAppearance({...draft.preferences,theme:theme==='original'?'xuanhei':theme,colors:{}})});}}><option value="original">{t('pose.originalAppearance')}</option>{THEME_IDS.map(id=><option key={id} value={id}>{themeLabels[id][code==='en'?1:0]}</option>)}</select></label>
        <label>{t('pose.density')}<select aria-label={t('pose.density')} disabled={draft.theme==='original'} value={draft.preferences.density} onChange={e=>preview({...draft,preferences:{...draft.preferences,density:e.target.value as 'compact'|'comfortable'}})}><option value="compact">{t('pose.compact')}</option><option value="comfortable">{t('pose.comfortable')}</option></select></label>
        <p className="field-help">{t('pose.appearanceHelp')}</p>
      </div>
      <div className="dialog-footer"><button onClick={close}>{t('pose.cancel')}</button><button className="primary-button" onClick={()=>{if(applyAppearance(draft,true)){committed.current=true;close();}}}>{t('pose.saveAppearance')}</button></div>
    </dialog>
  </>;
}
