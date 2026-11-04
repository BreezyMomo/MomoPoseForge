export type LiveViewTarget={id:string;canvas:HTMLCanvasElement;context:CanvasRenderingContext2D;width:number;height:number};

/** Canvas surfaces only: no extra scene, WebGL context, PNG encoding or pose history. */
export class LiveViewPreviews{
  private targets=new Map<string,{canvas:HTMLCanvasElement;context:CanvasRenderingContext2D;revision:number}>();
  private revision=0;
  private lastFrame=-Infinity;
  attach(id:string,canvas:HTMLCanvasElement){
    const context=canvas.getContext('2d',{alpha:false});if(!context)return ()=>{};
    this.targets.set(id,{canvas,context,revision:-1});this.invalidate();
    return ()=>{if(this.targets.get(id)?.canvas===canvas)this.targets.delete(id);};
  }
  invalidate(){this.revision++;}
  render(now:number,aspect:number,draw:(targets:LiveViewTarget[])=>void){
    if(now-this.lastFrame<1000/20)return;
    this.lastFrame=now;
    const visible:LiveViewTarget[]=[];let changed=false;
    for(const[id,target]of this.targets){
      const {canvas,context}=target;
      const rect=canvas.getBoundingClientRect(),win=canvas.ownerDocument.defaultView;
      if(!canvas.isConnected||!win||canvas.ownerDocument.hidden||rect.width<=0||rect.height<=0||rect.bottom<=0||rect.right<=0||rect.top>=win.innerHeight||rect.left>=win.innerWidth)continue;
      const ratio=Math.min(2,win.devicePixelRatio||1),scale=Math.min(rect.width*ratio/aspect,rect.height*ratio,360);
      const width=Math.max(1,Math.round(scale*aspect)),height=Math.max(1,Math.round(scale));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;changed=true;}
      if(target.revision!==this.revision)changed=true;
      visible.push({id,canvas,context,width,height});
    }
    if(!visible.length||!changed)return;
    draw(visible);for(const target of visible)this.targets.get(target.id)!.revision=this.revision;
  }
  dispose(){this.targets.clear();}
}
