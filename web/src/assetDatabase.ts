/** Product assets share a transaction; legacy stores are copied once, never removed. */
export const ASSET_DB='momo-pose-forge:assets';
export type AssetStore='characters'|'motions';
let migration:Promise<void>|undefined;
const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const r=indexedDB.open(ASSET_DB,1);
  r.onupgradeneeded=()=>{for(const s of ['characters','motions','meta'])r.result.createObjectStore(s,{keyPath:'key'});};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error??new Error('无法打开资源库'));
});
async function legacy(name:string,store:string):Promise<unknown[]>{
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(name);let missing=false;
    r.onupgradeneeded=()=>{missing=true;r.transaction!.abort();};
    r.onerror=()=>missing?resolve([]):reject(r.error);
    r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains(store)){db.close();resolve([]);return;}const tx=db.transaction(store),q=tx.objectStore(store).getAll();q.onsuccess=()=>{db.close();resolve(q.result);};q.onerror=()=>{db.close();reject(q.error);};};
  });
}
async function migrate(){
  const db=await open();try{
    const done=await new Promise<boolean>((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').get('legacy-v1');r.onsuccess=()=>resolve(!!r.result);r.onerror=()=>reject(r.error);});
    if(done)return;
    const [characters,motions]=await Promise.all([legacy('momo-pose-forge:characters','characters'),legacy('momo-pose-forge:motions','motions')]);
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['characters','motions','meta'],'readwrite');
      for(const [name,rows] of [['characters',characters],['motions',motions]] as const)for(const row of rows){
        const asset=row as {key?:unknown};if(typeof asset?.key!=='string')continue;
        const s=tx.objectStore(name),r=s.get(asset.key);r.onsuccess=()=>{if(!r.result)s.put(asset);};
      }
      tx.objectStore('meta').put({key:'legacy-v1'});tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??new Error('旧资源迁移失败'));
    });
  }finally{db.close();}
}
export async function assetTransaction<T>(stores:AssetStore[],mode:IDBTransactionMode,run:(tx:IDBTransaction,result:(value:T)=>void)=>void,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)throw new DOMException('操作已取消','AbortError');
  migration??=migrate().catch(e=>{migration=undefined;throw e;});await migration;
  const db=await open();try{return await new Promise<T>((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('操作已取消','AbortError'));return;}
    const tx=db.transaction(stores,mode);let value:T,failure:unknown;
    const cancel=()=>tx.abort(),cleanup=()=>signal?.removeEventListener('abort',cancel);signal?.addEventListener('abort',cancel,{once:true});
    tx.oncomplete=()=>{cleanup();resolve(value);};tx.onerror=tx.onabort=()=>{cleanup();reject(failure??(signal?.aborted?new DOMException('操作已取消','AbortError'):tx.error??new Error('资源保存失败，请检查浏览器可用空间')));};
    try{run(tx,v=>{value=v;});}catch(e){failure=e;tx.abort();}
  });}finally{db.close();}
}
export const assetRequest=<T>(store:AssetStore,mode:IDBTransactionMode,run:(s:IDBObjectStore)=>IDBRequest<T>,signal?:AbortSignal)=>assetTransaction<T>([store],mode,(tx,result)=>{run(tx.objectStore(store)).onsuccess=e=>result((e.target as IDBRequest<T>).result);},signal);
export const assetChanges=new EventTarget();
export function assetsChanged(){assetChanges.dispatchEvent(new Event('change'));}
