import {describe,it,expect,vi} from 'vitest';
import {ACESFilmicToneMapping,Color,MeshBasicMaterial,NoToneMapping,PerspectiveCamera,Scene,WebGLRenderTarget,type WebGLRenderer} from 'three';
import {LineArtRenderer} from './LineArtRenderer';

describe('线稿渲染隔离',()=>{
  for(const fail of [false,true])it(`绘制${fail?'失败':'成功'}后恢复相机之外的全部渲染状态`,()=>{
    const pass=new LineArtRenderer(),scene=new Scene(),background=new Color('#123456'),override=new MeshBasicMaterial(),target=new WebGLRenderTarget(8,8),previous=new WebGLRenderTarget(4,4),color=new Color('#abcdef');scene.background=background;scene.overrideMaterial=override;
    const state={target:previous,color:color.clone(),alpha:.35};
    const renderer={toneMapping:ACESFilmicToneMapping,autoClear:false,shadowMap:{autoUpdate:true},
      getRenderTarget:()=>state.target,getClearColor:(out:Color)=>out.copy(state.color),getClearAlpha:()=>state.alpha,
      setRenderTarget:(v:WebGLRenderTarget)=>{state.target=v;},setClearColor:(v:Color|number,alpha:number)=>{state.color.set(v);state.alpha=alpha;},
      render:vi.fn(()=>{expect(renderer.toneMapping).toBe(NoToneMapping);expect(renderer.autoClear).toBe(true);if(fail)throw new Error('GPU failure');})};
    const run=()=>pass.render(renderer as unknown as WebGLRenderer,scene,new PerspectiveCamera(35,1,.01,100),target,8,8,true,2);
    if(fail)expect(run).toThrow('GPU failure');else{run();expect(renderer.render).toHaveBeenCalledTimes(3);}
    expect(scene.background).toBe(background);expect(scene.overrideMaterial).toBe(override);expect(state.target).toBe(previous);expect(state.color.equals(color)).toBe(true);expect(state.alpha).toBe(.35);expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);expect(renderer.autoClear).toBe(false);expect(renderer.shadowMap.autoUpdate).toBe(true);
    pass.dispose();target.dispose();previous.dispose();override.dispose();
  });
});
