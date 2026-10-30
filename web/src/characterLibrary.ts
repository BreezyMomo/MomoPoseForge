import {type AppearanceRef,MAX_CHARACTER_BYTES} from './characterAppearance';
type CharacterAsset={ref:AppearanceRef;bytes:ArrayBuffer;key?:string};
const key=(ref:AppearanceRef)=>`${ref.rig}@${ref.rigVersion}:${ref.id}`;
const database=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('momo-pose-forge:characters',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('characters',{keyPath:'key'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('浏览器无法打开角色外观库'));
});
async function operation<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await database();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction('characters',mode),req=run(tx.objectStore('characters'));let result:T;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('角色外观存储失败，请检查浏览器可用空间'));});}finally{db.close();}
}
export const characterLibrary={
  async list(rig:string,version:number){const assets=await operation('readonly',s=>s.getAll()) as CharacterAsset[];return assets.filter(a=>a.ref.rig===rig&&a.ref.rigVersion===version).map(a=>a.ref);},
  async get(ref:AppearanceRef){return await operation('readonly',s=>s.get(key(ref))) as CharacterAsset|undefined;},
  async put(asset:CharacterAsset){if(asset.bytes.byteLength>MAX_CHARACTER_BYTES)throw new Error('角色文件超过 32 MB');await operation('readwrite',s=>s.put({...asset,key:key(asset.ref)}));},
};
