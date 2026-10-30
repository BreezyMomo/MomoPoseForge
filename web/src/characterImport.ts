import {LoadingManager,Mesh,TextureLoader,type Object3D,type Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {MAX_CHARACTER_BYTES,validateCharacterGlb} from './characterAppearance';
import {disposeObject} from './rigGeometry';
/** Appearance parsing retains embedded textures and never fetches sidecar files. */
export async function parseCharacter(bytes:ArrayBuffer,format:'glb'|'fbx'):Promise<{scene:Object3D;dispose:()=>void}>{
  if(!bytes.byteLength||bytes.byteLength>MAX_CHARACTER_BYTES)throw new Error('请导入 32 MB 以内的 GLB 或 FBX 角色');
  if(format==='glb'){
    validateCharacterGlb(bytes);const gltf=await new GLTFLoader().parseAsync(bytes,'');
    return {scene:gltf.scene,dispose:()=>disposeObject(gltf.scene)};
  }
  const manager=new LoadingManager(),textures=new Set<Texture>(),urls=new Set<string>(),tasks:Promise<void>[]=[],timers:ReturnType<typeof setTimeout>[]=[];
  let external=false,scene:Object3D|undefined;
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;const used=new Set<Texture>();scene?.traverse(o=>{if(o instanceof Mesh)for(const material of Array.isArray(o.material)?o.material:[o.material])for(const value of Object.values(material))if(value&&typeof value==='object'&&'isTexture' in value)used.add(value as Texture);});if(scene)disposeObject(scene);for(const texture of textures)if(!used.has(texture))texture.dispose();};
  const loader=new TextureLoader(manager),load=loader.load.bind(loader);
  loader.load=(url,onLoad,onProgress,onError)=>{
    if(!/^(blob:|data:)/.test(url)){external=true;throw new Error('FBX 须内嵌贴图，请导出时启用 Embed Media，或改用完整 GLB');}
    if(url.startsWith('blob:'))urls.add(url);
    let resolve!:()=>void,reject!:(e:unknown)=>void;const task=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    timers.push(setTimeout(()=>reject(new Error('FBX 内嵌贴图解码超时')),15_000));
    // Attach a rejection handler immediately: parse may fail before awaiting images.
    tasks.push(task);void task.catch(()=>{});
    try{const texture=load(url,t=>{onLoad?.(t);resolve();},onProgress,e=>{onError?.(e);reject(new Error('FBX 内嵌贴图解码失败'));});textures.add(texture);return texture;}catch(e){reject(e);throw e;}
  };
  manager.addHandler(/.*/,loader);
  try{
    scene=new FBXLoader(manager).parse(bytes,'');await Promise.all(tasks);
    if(external)throw new Error('FBX 包含外部贴图');
    scene.traverse(o=>{if(o instanceof Mesh)for(const material of Array.isArray(o.material)?o.material:[o.material])for(const value of Object.values(material))if(value&&typeof value==='object'&&'isTexture' in value&&!(value as Texture).image)throw new Error('FBX 贴图缺失或格式不支持，请内嵌 PNG / JPEG / WebP 贴图后重试');});
    return {scene,dispose};
  }catch(e){await Promise.allSettled(tasks);dispose();throw e;}
  finally{timers.forEach(clearTimeout);for(const url of urls)URL.revokeObjectURL(url);}
}
