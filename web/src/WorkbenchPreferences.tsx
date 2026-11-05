import {WorkbenchProvider,WorkbenchAppearance,WorkbenchLanguageSelect} from '@momo/workbench/react';
import {appearance,language,t,useLanguage} from './workbenchState';
export function WorkbenchPreferences(){
 useLanguage();
 return <WorkbenchProvider appearance={appearance} language={language} ui={{text:t,format:t,onLanguageChange:language.onLanguageChange}}><WorkbenchAppearance/><WorkbenchLanguageSelect/></WorkbenchProvider>;
}
