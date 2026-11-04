import {describe,it,expect,vi} from 'vitest';
import {Group,Scene,Object3D,Vector3,Vector2,Vector4,Color} from 'three';
import {LiveViewPreviews} from './liveViewPreviews';
import {PoseEngine} from './PoseEngine';
import {DEFAULT_VIEWS} from './types';

function canvas(){
  const context={drawImage:vi.fn()},rect={width:150,height:100,top:0,left:0,right:150,bottom:100},ownerDocument={hidden:false,defaultView:{innerWidth:1440,innerHeight:900,devicePixelRatio:1}};
  return {width:0,height:0,isConnected:true,ownerDocument,getContext:()=>context,getBoundingClientRect:()=>rect,context,rect} as unknown as HTMLCanvasElement&{context:typeof context;rect:typeof rect};
}
describe('实时五视图调度',()=>{
  it('预览暂时失败时不阻断主视口的绘制循环，重复失败只提示一次',()=>{
    const engine=Object.create(PoseEngine.prototype) as PoseEngine,warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    Object.assign(engine,{ready:true,cameraState:{output:{width:768,height:1024}},livePreviews:{render(){throw new Error('copy unavailable');}}});
    try{expect(()=>(engine as any).renderViewPreviews(0)).not.toThrow();expect(()=>(engine as any).renderViewPreviews(100)).not.toThrow();expect(warn).toHaveBeenCalledTimes(1);}finally{warn.mockRestore();}
  });
  it('拖动更新在提交前生效，限制刷新频率；空闲、隐藏和离屏时不绘制，重新出现补最新状态',()=>{
    const previews=new LiveViewPreviews(),a=canvas(),b=canvas(),draw=vi.fn();previews.attach('front',a);previews.attach('side',b);
    previews.render(0,.75,draw);expect(draw).toHaveBeenCalledTimes(1);expect(a.width/a.height).toBe(.75);
    previews.invalidate();previews.render(16,.75,draw);expect(draw).toHaveBeenCalledTimes(1);previews.render(50,.75,draw);expect(draw).toHaveBeenCalledTimes(2);
    previews.render(100,.75,draw);expect(draw).toHaveBeenCalledTimes(2);
    b.rect.top=1000;b.rect.bottom=1100;previews.invalidate();previews.render(150,.75,draw);expect(draw.mock.calls.at(-1)![0]).toHaveLength(1);
    b.rect.top=0;b.rect.bottom=100;previews.render(200,.75,draw);expect(draw).toHaveBeenCalledTimes(4);expect(draw.mock.calls.at(-1)![0]).toHaveLength(2);
    Object.assign(a.ownerDocument,{hidden:true});Object.assign(b.ownerDocument,{hidden:true});previews.invalidate();previews.render(250,.75,draw);expect(draw).toHaveBeenCalledTimes(4);
  });
  it('布局和画幅变化会重绘；卸载旧窗口不误删新窗口，关闭后释放注册',()=>{
    const previews=new LiveViewPreviews(),a=canvas(),b=canvas(),draw=vi.fn(),detach=previews.attach('front',a);previews.render(0,.75,draw);
    a.rect.height=150;previews.render(50,.75,draw);expect(draw).toHaveBeenCalledTimes(2);
    previews.render(100,2,draw);expect(draw).toHaveBeenCalledTimes(3);expect(a.width/a.height).toBe(2);
    previews.attach('front',b);detach();previews.render(150,.75,draw);expect(draw.mock.calls.at(-1)![0][0].canvas).toBe(b);
    previews.dispose();previews.invalidate();previews.render(200,.75,draw);expect(draw).toHaveBeenCalledTimes(4);
  });
  for(const fails of [false,true])it(`共享渲染${fails?'失败':'完成'}后恢复主视口、隐藏角色和辅助层，不产生历史或姿态变化`,()=>{
    const scene=new Scene(),model=new Group(),hiddenActor=new Group(),helpers=new Group(),bones=new Group(),grid=new Object3D(),ground=new Object3D(),gizmo=new Object3D(),background=new Color('#123456');
    model.visible=false;hiddenActor.visible=false;scene.background=background;scene.add(model,hiddenActor,helpers,bones,grid,ground,gizmo);
    const state={viewport:new Vector4(2,3,800,600),scissor:new Vector4(4,5,400,300),scissorTest:false,target:{name:'existing target'},alpha:.3};
    const renderer={domElement:{},autoClear:false,shadowMap:{autoUpdate:true},getDrawingBufferSize:(v:Vector2)=>v.set(900,700),getPixelRatio:()=>1,getViewport:(v:Vector4)=>v.copy(state.viewport),getScissor:(v:Vector4)=>v.copy(state.scissor),getScissorTest:()=>state.scissorTest,getRenderTarget:()=>state.target,getClearAlpha:()=>state.alpha,
      setViewport:(...args:any[])=>{state.viewport=args[0] instanceof Vector4?args[0].clone():new Vector4(...args as [number,number,number,number]);},setScissor:(...args:any[])=>{state.scissor=args[0] instanceof Vector4?args[0].clone():new Vector4(...args as [number,number,number,number]);},setScissorTest:(v:boolean)=>{state.scissorTest=v;},setRenderTarget:(v:any)=>{state.target=v;},setClearAlpha:(v:number)=>{state.alpha=v;},render:vi.fn(()=>{expect(model.visible).toBe(true);expect(hiddenActor.visible).toBe(false);expect(helpers.visible||grid.visible||gizmo.visible).toBe(false);})};
    const engine=Object.create(PoseEngine.prototype) as PoseEngine;
    Object.assign(engine,{scene,model,helpers,boneDisplay:bones,grid,groundMesh:ground,transform:{getHelper:()=>gizmo},renderer,center:new Vector3(),span:2,views:structuredClone(DEFAULT_VIEWS),actors:new Map([['a',{visible:true,state:{model,helpers,boneDisplay:bones}}],['b',{visible:false,state:{model:hiddenActor,helpers:new Group(),boneDisplay:new Group()}}]]),onCommit:vi.fn()});
    const before=structuredClone(state),surface=canvas();if(fails)surface.context.drawImage.mockImplementation(()=>{throw new Error('copy failed');});
    const draw=()=> (engine as any).drawViewPreviews([{id:'front',canvas:surface,context:surface.context,width:75,height:100}]);
    if(fails)expect(draw).toThrow('copy failed');else draw();
    expect(state).toEqual(before);expect(scene.background).toBe(background);expect(model.visible||hiddenActor.visible).toBe(false);expect(helpers.visible&&bones.visible&&grid.visible&&ground.visible&&gizmo.visible).toBe(true);expect(renderer.autoClear).toBe(false);expect(renderer.shadowMap.autoUpdate).toBe(true);expect(engine.onCommit).not.toHaveBeenCalled();
  });
});
