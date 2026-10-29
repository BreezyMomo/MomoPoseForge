import {describe,it,expect,vi} from 'vitest';
import {OrthographicCamera,PerspectiveCamera,Vector3,Euler} from 'three';
import {FlyCameraControls,flyTranslation,perspectiveForNavigation,cloneExportCamera} from './FlyCameraControls';

function fixture(){
  const host=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null});
  const captures=new Set<number>(),focus=vi.fn();
  const canvas=Object.assign(new EventTarget(),{ownerDocument:document,focus,setPointerCapture:(id:number)=>captures.add(id),hasPointerCapture:(id:number)=>captures.has(id),releasePointerCapture:(id:number)=>captures.delete(id)});
  const camera=new PerspectiveCamera(35,1,.01,100);camera.position.set(0,1,3);camera.updateMatrixWorld(true);
  const changed=vi.fn(),activity=vi.fn(),controls=new FlyCameraControls(canvas as unknown as HTMLElement,()=>camera,changed,activity,host as unknown as Window);
  const send=(target:EventTarget,type:string,props:Record<string,unknown>={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...props});target.dispatchEvent(e);return e;};
  const start=()=>send(canvas,'pointerdown',{button:2,buttons:2,pointerId:1,clientX:100,clientY:100});
  return{host,document,canvas,camera,changed,activity,controls,send,start,focus};
}

describe('右键飞行镜头的输入生命周期',()=>{
  it('不按右键时不接管 W，也不移动镜头',()=>{
    const f=fixture(),before=f.camera.position.clone();
    expect(f.send(f.host,'keydown',{code:'KeyW'}).defaultPrevented).toBe(false);f.controls.update(.05);
    expect(f.camera.position.equals(before)).toBe(true);f.controls.dispose();
  });
  it('按住右键与 W 持续前进，松开 W 立即停下',()=>{
    const f=fixture();f.start();expect(f.controls.active).toBe(true);expect(f.focus).toHaveBeenCalled();
    expect(f.send(f.host,'keydown',{code:'KeyW'}).defaultPrevented).toBe(true);
    for(let i=0;i<10;i++)f.controls.update(.025);
    expect(f.camera.position.z).toBeCloseTo(2.7,9);
    f.send(f.host,'keyup',{code:'KeyW'});const p=f.camera.position.clone();f.controls.update(.05);expect(f.camera.position.equals(p)).toBe(true);f.controls.dispose();
  });
  it('先按移动键再按右键也能导航，但输入框的按键不会参与移动',()=>{
    const f=fixture();f.send(f.host,'keydown',{code:'KeyW'});f.start();f.controls.update(.05);expect(f.camera.position.z).toBeCloseTo(2.94,9);f.controls.stop();
    Object.assign(f.host,{closest:()=>({})});f.send(f.host,'keydown',{code:'KeyW'});Object.assign(f.host,{closest:()=>null});f.start();const p=f.camera.position.clone();f.controls.update(.05);expect(f.camera.position.equals(p)).toBe(true);f.controls.dispose();
  });
  it('松开右键会清空移动键，下一次右键不会继续漂移',()=>{
    const f=fixture();f.start();f.send(f.host,'keydown',{code:'KeyW'});f.controls.update(.05);f.send(f.host,'pointerup',{button:2});
    const p=f.camera.position.clone();f.controls.update(.05);f.start();f.controls.update(.05);
    expect(f.camera.position.equals(p)).toBe(true);f.controls.dispose();
  });
  it('窗口失焦、页面隐藏、取消捕获和 Esc 都退出导航',()=>{
    for(const exit of ['blur','visibilitychange','lostpointercapture','pointercancel','Escape']){
      const f=fixture();f.start();f.send(f.host,'keydown',{code:'KeyW'});
      if(exit==='visibilitychange'){f.document.hidden=true;f.send(f.document,exit);}
      else if(exit==='lostpointercapture')f.send(f.canvas,exit);
      else if(exit==='Escape')f.send(f.host,'keydown',{code:'Escape'});
      else f.send(f.host,exit);
      expect(f.controls.active).toBe(false);const p=f.camera.position.clone();f.controls.update(.05);expect(f.camera.position.equals(p)).toBe(true);f.controls.dispose();
    }
  });
  it('右键鼠标只改变朝向，俯仰受限且不会倒立',()=>{
    const f=fixture(),p=f.camera.position.clone();f.start();f.send(f.host,'pointermove',{pointerId:1,buttons:2,clientX:200,clientY:-10000});
    const e=new Euler().setFromQuaternion(f.camera.quaternion,'YXZ');expect(e.y).toBeCloseTo(-.3,8);expect(e.x).toBeCloseTo(Math.PI/2-.01,8);expect(e.z).toBeCloseTo(0,8);expect(f.camera.position.equals(p)).toBe(true);f.controls.dispose();
  });
  it('释放按钮的移动事件与销毁控件均能安全停止',()=>{
    const f=fixture();f.start();f.send(f.host,'pointermove',{pointerId:1,buttons:0,clientX:100,clientY:100});expect(f.controls.active).toBe(false);
    f.start();f.controls.dispose();f.start();expect(f.controls.active).toBe(false);
  });
});

describe('飞行方向与相机投影',()=>{
  it('WASD 随镜头朝向，斜向不加速，Shift 加速，长帧不跳跃',()=>{
    const c=new PerspectiveCamera();c.rotation.y=Math.PI/2;c.updateMatrixWorld(true);
    const w=flyTranslation(c,new Set(['KeyW']),.05),d=flyTranslation(c,new Set(['KeyD']),.05),diagonal=flyTranslation(c,new Set(['KeyW','KeyD']),.05);
    expect(w.x).toBeCloseTo(-.06,10);expect(d.z).toBeCloseTo(-.06,10);expect(diagonal.length()).toBeCloseTo(w.length(),10);
    expect(flyTranslation(c,new Set(['KeyW']),.05,true).length()).toBeCloseTo(w.length()*3,10);
    expect(flyTranslation(c,new Set(['KeyW']),100).length()).toBeCloseTo(w.length(),10);
    expect(flyTranslation(c,new Set(['KeyW','KeyS']),.05).length()).toBe(0);
  });
  it('正交视图进入导航时保留目标平面的取景与朝向',()=>{
    const c=new OrthographicCamera(-.75,.75,1,-1,.01,100),target=new Vector3(0,.85,0);c.position.set(0,.85,5);c.lookAt(target);c.updateMatrixWorld(true);
    const fly=perspectiveForNavigation(c,target);
    for(const p of [target.clone(),new Vector3(.2,1.2,0)]){
      const a=p.clone().project(c),b=p.clone().project(fly);expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10);
    }
    expect(fly.quaternion.angleTo(c.quaternion)).toBeLessThan(1e-8);
  });
  it('当前视角导出保留飞行后的相机位置与朝向，仅适配输出宽高比',()=>{
    const c=new PerspectiveCamera(35,1.8,.01,100);c.position.set(1,2,3);c.lookAt(new Vector3(.3,1,0));c.updateMatrixWorld(true);
    const copy=cloneExportCamera(c,.75) as PerspectiveCamera;
    expect(copy.position.equals(c.position)).toBe(true);expect(copy.quaternion.equals(c.quaternion)).toBe(true);expect(copy.aspect).toBe(.75);expect(c.aspect).toBe(1.8);
  });
});
