import {useSyncExternalStore} from 'react';
import {createLanguageController,createMessageCatalog} from '@momo/workbench/i18n';
import {createAppearance,normalizeAppearance,type AppearanceController,type AppearancePreferences,type ThemeId} from '@momo/workbench/appearance';
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
let appearance:AppearanceController|undefined;
if(typeof document!=='undefined'){try{if(storage?.getItem(APPEARANCE_KEY))appearance=createAppearance({storage,root:document.documentElement,storageKey:APPEARANCE_KEY});}catch{/* Keep the original grayscale when settings are unavailable. */}}
export type AppearanceChoice={theme:'original'|ThemeId;preferences:AppearancePreferences};
export const currentAppearance=():AppearanceChoice=>({theme:appearance?appearance.get().theme:'original',preferences:appearance?.get()??normalizeAppearance(null)});
export function applyAppearance(choice:AppearanceChoice,persist=false){
  if(choice.theme==='original'){
    appearance?.dispose();appearance=undefined;
    const root=document.documentElement;
    for(const key of ['theme','appearanceTheme','paletteRoles','interfaceStyle','density','tabStyle','tabOverride','momoWorkbench'])delete root.dataset[key];
    for(const property of Array.from(root.style))if(property.startsWith('--ui-'))root.style.removeProperty(property);
    root.style.removeProperty('color-scheme');
    if(persist){try{storage?.removeItem(APPEARANCE_KEY);}catch{return false;}}
    return true;
  }
  appearance??=createAppearance({storage,root:document.documentElement,storageKey:APPEARANCE_KEY});
  const next={...choice.preferences,theme:choice.theme};
  if(persist)return appearance.save(next);
  appearance.preview(next);return true;
}
