import {Camera,Euler,MathUtils,OrthographicCamera,PerspectiveCamera,Vector3} from 'three';

const MOVE_KEYS=new Set(['KeyW','KeyA','KeyS','KeyD']);
const editable=(target:EventTarget|null)=>!!(target as HTMLElement|null)?.closest?.('input,textarea,select,[contenteditable="true"],dialog[open]');

export function flyTranslation(camera:Camera,keys:ReadonlySet<string>,seconds:number,fast=false){
  const forward=camera.getWorldDirection(new Vector3());
  const right=new Vector3(1,0,0).applyQuaternion(camera.quaternion);
  return forward.multiplyScalar(Number(keys.has('KeyW'))-Number(keys.has('KeyS')))
    .addScaledVector(right,Number(keys.has('KeyD'))-Number(keys.has('KeyA')))
    .normalize().multiplyScalar(MathUtils.clamp(seconds,0,.05)*1.2*(fast?3:1));
}

export function perspectiveForNavigation(camera:OrthographicCamera,target:Vector3){
  const perspective=new PerspectiveCamera(35,(camera.right-camera.left)/(camera.top-camera.bottom),.01,100);
  const height=(camera.top-camera.bottom)/camera.zoom,distance=height/(2*Math.tan(MathUtils.degToRad(35)/2));
  perspective.quaternion.copy(camera.quaternion);
  perspective.position.copy(target).addScaledVector(camera.getWorldDirection(new Vector3()),-distance);
  perspective.updateMatrixWorld(true);return perspective;
}

export function cloneExportCamera(camera:PerspectiveCamera|OrthographicCamera,aspect:number){
  const copy=camera.clone();
  if(copy instanceof PerspectiveCamera)copy.aspect=aspect;
  else{const half=(copy.top-copy.bottom)/2;copy.left=-half*aspect;copy.right=half*aspect;}
  copy.updateProjectionMatrix();copy.updateMatrixWorld(true);return copy;
}

/** Right mouse owns navigation until release. Window listeners and pointer capture
 * stop movement reliably even when the pointer leaves the viewport. */
export class FlyCameraControls{
  active=false;
  private keys=new Set<string>();
  private fast=false;
  private pointerId:number|null=null;
  private x=0;private y=0;
  constructor(private canvas:HTMLElement,private camera:()=>Camera,private changed:()=>void,private activity:(active:boolean)=>boolean|void,private host:Window=window){
    canvas.addEventListener('pointerdown',this.down);
    canvas.addEventListener('contextmenu',this.contextMenu);
    canvas.addEventListener('lostpointercapture',this.cancel);
    host.addEventListener('pointermove',this.move);
    host.addEventListener('pointerup',this.up);
    host.addEventListener('pointercancel',this.cancel);
    host.addEventListener('blur',this.cancel);
    host.addEventListener('keydown',this.keyDown,true);
    host.addEventListener('keyup',this.keyUp,true);
    canvas.ownerDocument.addEventListener('visibilitychange',this.visibility);
  }
  private contextMenu=(event:Event)=>event.preventDefault();
  private down=(event:PointerEvent)=>{
    if(event.button!==2||this.active||this.canvas.ownerDocument.querySelector('dialog[open]'))return;
    this.active=true;
    if(this.activity(true)===false){this.active=false;return;}
    event.preventDefault();this.pointerId=event.pointerId;this.x=event.clientX;this.y=event.clientY;
    this.canvas.focus({preventScroll:true});
    this.canvas.setPointerCapture?.(event.pointerId);
  };
  private move=(event:PointerEvent)=>{
    if(!this.active||event.pointerId!==this.pointerId)return;
    if(!(event.buttons&2)){this.stop();return;}
    const dx=event.clientX-this.x,dy=event.clientY-this.y;this.x=event.clientX;this.y=event.clientY;
    if(!dx&&!dy)return;
    const camera=this.camera(),angles=new Euler().setFromQuaternion(camera.quaternion,'YXZ');
    angles.y-=dx*.003;angles.x=MathUtils.clamp(angles.x-dy*.003,-Math.PI/2+.01,Math.PI/2-.01);angles.z=0;
    camera.quaternion.setFromEuler(angles);camera.updateMatrixWorld(true);this.changed();
  };
  private up=(event:PointerEvent)=>{if(event.button===2)this.stop();};
  private cancel=()=>this.stop();
  private visibility=()=>{if(this.canvas.ownerDocument.hidden)this.stop();};
  private keyDown=(event:KeyboardEvent)=>{
    if(editable(event.target)){if(this.active)this.stop();return;}
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    // Remember keys pressed just before the right button, without consuming the
    // ordinary editor shortcut. Movement itself always requires the right button.
    if(MOVE_KEYS.has(event.code))this.keys.add(event.code);
    this.fast=event.shiftKey;
    if(!this.active)return;
    if(event.code==='Escape'){event.preventDefault();event.stopPropagation();this.stop();return;}
    if(MOVE_KEYS.has(event.code)){event.preventDefault();event.stopPropagation();}
  };
  private keyUp=(event:KeyboardEvent)=>{
    this.keys.delete(event.code);this.fast=event.shiftKey;
    if(this.active&&MOVE_KEYS.has(event.code)){event.preventDefault();event.stopPropagation();}
  };
  update(seconds:number){
    if(!this.active||!this.keys.size)return;
    const camera=this.camera(),delta=flyTranslation(camera,this.keys,seconds,this.fast);
    if(!delta.lengthSq())return;
    camera.position.add(delta);camera.updateMatrixWorld(true);this.changed();
  }
  stop(){
    const wasActive=this.active;this.active=false;this.keys.clear();this.fast=false;
    if(this.pointerId!==null&&this.canvas.hasPointerCapture?.(this.pointerId))this.canvas.releasePointerCapture?.(this.pointerId);
    this.pointerId=null;if(wasActive)this.activity(false);
  }
  dispose(){
    this.stop();this.canvas.removeEventListener('pointerdown',this.down);this.canvas.removeEventListener('contextmenu',this.contextMenu);this.canvas.removeEventListener('lostpointercapture',this.cancel);
    this.host.removeEventListener('pointermove',this.move);this.host.removeEventListener('pointerup',this.up);this.host.removeEventListener('pointercancel',this.cancel);this.host.removeEventListener('blur',this.cancel);
    this.host.removeEventListener('keydown',this.keyDown,true);this.host.removeEventListener('keyup',this.keyUp,true);this.canvas.ownerDocument.removeEventListener('visibilitychange',this.visibility);
  }
}
