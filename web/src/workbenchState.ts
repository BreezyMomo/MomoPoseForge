import {useSyncExternalStore} from 'react';
import {createLanguageController,createMessageCatalog} from '@momo/workbench/i18n';
import {createAppearance} from '@momo/workbench/appearance';
import {WORKBENCH_CATALOGS} from '@momo/workbench/locales';
import {POSE_MESSAGES} from './uiMessages';

const config={default:'zh-CN',languages:[{code:'zh-CN',name:'简体中文'},{code:'en',name:'English'}]};
const catalogs=Object.fromEntries(config.languages.map(({code})=>[code,{...(WORKBENCH_CATALOGS[code]??{}),...Object.fromEntries(Object.entries(POSE_MESSAGES).map(([key,value])=>[key,value[code==='en'?1:0]]))}]));
let storage:Storage|undefined;try{storage=globalThis.localStorage;}catch{/* Preferences remain usable when persistence is unavailable. */}
export const language=createLanguageController({config,storage,storageKey:'momo-pose-forge:language:v1'});
export const messages=createMessageCatalog({config,catalogs});
export const t=(key:string,...values:unknown[])=>messages.formatMessage(key,values,language.interfaceLanguage());
export const useLanguage=()=>useSyncExternalStore(language.onLanguageChange,language.interfaceLanguage,()=>config.default);
if(typeof document!=='undefined'){
  document.documentElement.lang=language.interfaceLanguage();
  language.onLanguageChange(()=>{document.documentElement.lang=language.interfaceLanguage();});
}

export const APPEARANCE_KEY='momo-pose-forge:appearance:v1';
export const appearance=createAppearance({storage,root:typeof document==='undefined'?undefined:document.documentElement,storageKey:APPEARANCE_KEY});
