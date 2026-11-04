import {useLayoutEffect,useRef} from 'react';
import {createAppearanceSettings,type AppearanceSettings} from '@momo/workbench/appearance-settings';
import {createLanguageSelector} from '@momo/workbench/language-selector';
import {appearance,language,t,useLanguage} from './workbenchState';
export function WorkbenchPreferences(){
 useLanguage();
 const select=useRef<HTMLSelectElement>(null),settings=useRef<AppearanceSettings|null>(null);
 useLayoutEffect(()=>{
  const controller=createAppearanceSettings({appearance,ui:{text:t,format:t,onLanguageChange:language.onLanguageChange}});
  const selector=createLanguageSelector({select:select.current!,language,ui:{text:t}});
  settings.current=controller;
  return()=>{selector.dispose();controller.dispose();settings.current=null;};
 },[]);
 return <>
  <span className="workbench-language"><select ref={select}/></span>
  <button className="text-button workbench-appearance" onClick={()=>settings.current?.open()}>{t('appearance.title')}</button>
 </>;
}
