import {type AppearanceRef,MAX_CHARACTER_BYTES} from './characterAppearance';
import {assetRequest,assetTransaction,assetsChanged} from './assetDatabase';
export type CharacterAsset={ref:AppearanceRef;bytes:ArrayBuffer;key?:string;deletedAt?:number};
export const characterKey=(ref:AppearanceRef)=>`${ref.rig}@${ref.rigVersion}:${ref.id}`;
export const characterLibrary={
  async all(){return await assetRequest('characters','readonly',s=>s.getAll()) as CharacterAsset[];},
  async list(rig:string,version:number){return (await this.all()).filter(a=>!a.deletedAt&&a.ref.rig===rig&&a.ref.rigVersion===version).map(a=>a.ref);},
  async get(ref:AppearanceRef){return await assetRequest('characters','readonly',s=>s.get(characterKey(ref))) as CharacterAsset|undefined;},
  async put(asset:CharacterAsset){if(asset.bytes.byteLength>MAX_CHARACTER_BYTES)throw new Error('角色文件超过 32 MB');const ref=await assetTransaction<AppearanceRef>(['characters'],'readwrite',(tx,result)=>{const s=tx.objectStore('characters'),q=s.get(characterKey(asset.ref));q.onsuccess=()=>{const old=q.result as CharacterAsset|undefined,ref={...asset.ref,name:old?.ref.name??asset.ref.name};s.put({...asset,ref,key:characterKey(ref),deletedAt:undefined});result(ref);};});assetsChanged();return ref;},
  async edit(ref:AppearanceRef,change:{name?:string;deleted?:boolean}){
    if(change.name!==undefined&&(!change.name.trim()||change.name.trim().length>80))throw new Error('名称须为 1–80 个字符');
    await assetTransaction<void>(['characters'],'readwrite',tx=>{const s=tx.objectStore('characters'),q=s.get(characterKey(ref));q.onsuccess=()=>{const a=q.result as CharacterAsset|undefined;if(!a)return;if(change.name!==undefined)a.ref={...a.ref,name:change.name.trim()};if(change.deleted!==undefined)a.deletedAt=change.deleted?Date.now():undefined;s.put(a);};});assetsChanged();
  },
};
