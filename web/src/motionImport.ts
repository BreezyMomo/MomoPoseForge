import {LoadingManager,Mesh,Texture,TextureLoader,type AnimationClip,type Object3D} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {disposeObject} from './rigGeometry';
import {validateCharacterGlb} from './characterAppearance';

export const MAX_MOTION_BYTES=32*1024*1024;
export type MotionSource={scene:Object3D;clips:AnimationClip[];format:'fbx'|'glb';dispose:()=>void};
export function checkMotionAbort(signal?:AbortSignal){if(signal?.aborted)throw new DOMException('动画导入已取消','AbortError');}
/** Parsing owns temporary source resources; neither its meshes nor textures enter the editor. */
export async function parseMotionSource(bytes:ArrayBuffer,fileName:string,signal?:AbortSignal):Promise<MotionSource>{
  checkMotionAbort(signal);
  if(bytes.byteLength<20||bytes.byteLength>MAX_MOTION_BYTES)throw new Error('请导入 32 MB 以内的 FBX 或 GLB 动画');
  const extension=fileName.split('.').at(-1)?.toLowerCase();
  if(extension!=='fbx'&&extension!=='glb')throw new Error('目前支持 FBX 和 GLB 动画文件');
  const manager=new LoadingManager(),placeholders=new Set<Texture>();
  // Animation import never loads external image files, including FBX texture paths.
  class MotionTextureLoader extends TextureLoader{override load(url:string){if(url.startsWith('blob:'))URL.revokeObjectURL(url);const texture=new Texture();placeholders.add(texture);return texture;}}
  manager.addHandler(/.*/,new MotionTextureLoader(manager));
  let scene:Object3D|undefined;
  let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;
    const used=new Set<Texture>();scene?.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])for(const value of Object.values(m))if(value instanceof Texture)used.add(value);});
    if(scene)disposeObject(scene);placeholders.forEach(t=>{if(!used.has(t))t.dispose();});
  };
  try{
    let clips:AnimationClip[];
    if(extension==='glb'){
      validateCharacterGlb(bytes);
      const loader=new GLTFLoader(manager);loader.register(()=>({name:'MOMO_MOTION_TEXTURES',loadTexture:async()=>{const texture=new Texture();placeholders.add(texture);return texture;}}));
      const gltf=await loader.parseAsync(bytes,'');scene=gltf.scene;clips=gltf.animations;
    }else{scene=new FBXLoader(manager).parse(bytes,'');clips=scene.animations;}
    checkMotionAbort(signal);
    clips=clips.filter(c=>c.tracks.length>0);
    if(!clips.length)throw new Error('文件中没有动画片段；请导出带动画的 FBX 或 GLB');
    return {scene,clips,format:extension,dispose};
  }catch(error){dispose();throw error;}
}
