import {useLayoutEffect,useRef} from 'react';
import {createAppearanceSettings} from '@momo/workbench/appearance-settings';
import {createAppearanceTrigger} from '@momo/workbench/header-controls';
import {createLanguageSelector} from '@momo/workbench/language-selector';
import {appearance,language,t,useLanguage} from './workbenchState';
export function WorkbenchPreferences(){
 useLanguage();
 const select=useRef<HTMLSelectElement>(null),button=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{
  const settings=createAppearanceSettings({appearance,ui:{text:t,format:t,onLanguageChange:language.onLanguageChange}});
  const trigger=createAppearanceTrigger({button:button.current!,appearance,settings,ui:{text:t,onLanguageChange:language.onLanguageChange}});
  const selector=createLanguageSelector({select:select.current!,language,ui:{text:t}});
  return()=>{selector.dispose();trigger.dispose();settings.dispose();};
 },[]);
 return <>
  <button ref={button} className="workbench-appearance"/>
  <span className="workbench-language"><select ref={select}/></span>
 </>;
}
