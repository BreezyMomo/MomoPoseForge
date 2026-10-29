export type ReferenceImage={version:1;id:string;name:string;dataUrl:string;width:number;height:number;opacity:number;scale:number;offsetX:number;offsetY:number;locked:boolean;visible:boolean};
export type ReferenceSettings=Pick<ReferenceImage,'opacity'|'scale'|'offsetX'|'offsetY'|'locked'|'visible'>;
export const MAX_REFERENCE_FILE_BYTES=10*1024*1024,MAX_REFERENCE_DATA_CHARS=650_000;
const validSourceSize=(w:number,h:number)=>Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0&&w<=8192&&h<=8192&&w*h<=32_000_000;
export function rasterInfo(b:Uint8Array):{mime:string;width:number;height:number}|null{
  const ascii=(a:number,n:number)=>String.fromCharCode(...b.slice(a,a+n)),u16=(a:number)=>b[a]*256+b[a+1],le16=(a:number)=>b[a]+b[a+1]*256,le24=(a:number)=>b[a]+b[a+1]*256+b[a+2]*65536;
  if(b.length>=24&&b[0]===137&&ascii(1,7)==='PNG\r\n\x1a\n'&&ascii(12,4)==='IHDR'){const v=new DataView(b.buffer,b.byteOffset,b.byteLength);return{mime:'image/png',width:v.getUint32(16),height:v.getUint32(20)};}
  if(b.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
    const chunk=ascii(12,4);if(chunk==='VP8X')return{mime:'image/webp',width:le24(24)+1,height:le24(27)+1};
    if(chunk==='VP8 '&&ascii(23,3)==='\x9d\x01\x2a')return{mime:'image/webp',width:le16(26)&16383,height:le16(28)&16383};
    if(chunk==='VP8L'&&b[20]===47)return{mime:'image/webp',width:1+(b[21]|(b[22]&63)<<8),height:1+((b[22]>>6)|(b[23]<<2)|((b[24]&15)<<10))};
  }
  if(b[0]===255&&b[1]===216){for(let i=2;i+8<b.length;){if(b[i++]!==255)continue;while(b[i]===255)i++;const marker=b[i++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const length=u16(i);if(length<2||i+length>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return{mime:'image/jpeg',width:u16(i+5),height:u16(i+3)};i+=length;}}
  return null;
}
export function validateReferenceImage(value:unknown):value is ReferenceImage{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;const r=value as ReferenceImage;
  if(r.version!==1||typeof r.id!=='string'||!r.id.trim()||r.id.length>80||typeof r.name!=='string'||!r.name.trim()||r.name.length>120||/[\x00-\x1f]/.test(r.name)||typeof r.dataUrl!=='string'||r.dataUrl.length>MAX_REFERENCE_DATA_CHARS||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1||Math.max(r.width,r.height)>1600||typeof r.locked!=='boolean'||typeof r.visible!=='boolean')return false;
  if(![r.opacity,r.scale,r.offsetX,r.offsetY].every(Number.isFinite)||r.opacity<0||r.opacity>1||r.scale<.1||r.scale>4||Math.abs(r.offsetX)>1.5||Math.abs(r.offsetY)>1.5)return false;
  const match=/^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(r.dataUrl);if(!match||match[2].length%4)return false;
  try{const bytes=Uint8Array.from(atob(match[2].slice(0,65536)),c=>c.charCodeAt(0)),info=rasterInfo(bytes);return !!info&&info.mime===`image/${match[1]}`&&info.width===r.width&&info.height===r.height;}catch{return false;}
}
export function referenceWithSettings(r:ReferenceImage,patch:Partial<ReferenceSettings>):ReferenceImage{
  const next={...r};for(const[key,min,max]of [['opacity',0,1],['scale',.1,4],['offsetX',-1.5,1.5],['offsetY',-1.5,1.5]] as const){const v=patch[key];if(v!==undefined&&Number.isFinite(v))next[key]=Math.max(min,Math.min(max,v));}
  if(typeof patch.locked==='boolean')next.locked=patch.locked;if(typeof patch.visible==='boolean')next.visible=patch.visible;return next;
}
export function referenceRect(r:Pick<ReferenceImage,'width'|'height'|'scale'|'offsetX'|'offsetY'>,viewportWidth:number,viewportHeight:number){
  const ratio=Math.min(viewportWidth*.82/r.width,viewportHeight*.82/r.height)*r.scale,width=r.width*ratio,height=r.height*ratio;
  return {width,height,left:viewportWidth*(.5+r.offsetX)-width/2,top:viewportHeight*(.5+r.offsetY)-height/2};
}
const blobDataUrl=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(blob);});
const canvasBlob=(canvas:HTMLCanvasElement,quality:number)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片转换失败')),'image/webp',quality));
export async function readReferenceImage(file:File):Promise<ReferenceImage>{
  if(!file.size||file.size>MAX_REFERENCE_FILE_BYTES)throw new Error('请选择不超过 10 MB 的 PNG、JPEG 或 WebP 图片');
  const bytes=new Uint8Array(await file.arrayBuffer()),header=rasterInfo(bytes);if(!header)throw new Error('图片格式无法读取，请选择 PNG、JPEG 或 WebP');
  if(!validSourceSize(header.width,header.height))throw new Error('图片尺寸过大：最长边不得超过 8192 像素，总像素不超过 3200 万');
  const url=URL.createObjectURL(new Blob([bytes],{type:header.mime})),image=new Image();
  try{
    image.src=url;try{await image.decode();}catch{throw new Error('图片已损坏或浏览器无法解码，原参考图未改变');}
    if(!validSourceSize(image.naturalWidth,image.naturalHeight))throw new Error('图片尺寸无法使用');
    const canvas=document.createElement('canvas');let factor=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    for(let attempt=0;attempt<6;attempt++){
      canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法处理参考图');ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.86,.68,.48]){const blob=await canvasBlob(canvas,quality);if(blob.size*4/3+40>MAX_REFERENCE_DATA_CHARS)continue;const dataUrl=await blobDataUrl(blob),result:ReferenceImage={version:1,id:crypto.randomUUID(),name:file.name.replace(/[\x00-\x1f]/g,'').slice(0,120)||'参考图片',dataUrl,width:canvas.width,height:canvas.height,opacity:.4,scale:1,offsetX:0,offsetY:0,locked:true,visible:true};if(validateReferenceImage(result))return result;}
      factor*=.7;
    }
    throw new Error('图片优化后仍过大，请先缩小图片再导入');
  }finally{URL.revokeObjectURL(url);}
}
