import {describe,it,expect} from 'vitest';
import {rasterInfo,referenceRect,referenceWithSettings,validateReferenceImage,MAX_REFERENCE_DATA_CHARS,MAX_REFERENCE_FILE_BYTES,readReferenceImage,type ReferenceImage} from './referenceImage';
export const tinyReference=():ReferenceImage=>({version:1,id:'test-reference',name:'示例.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',width:1,height:1,opacity:.4,scale:1,offsetX:0,offsetY:0,locked:true,visible:true});
describe('参考图片资源与屏幕放置',()=>{
  it('在解码前拒绝超过 10 MB 的输入',async()=>{
    await expect(readReferenceImage(new File([new Uint8Array(MAX_REFERENCE_FILE_BYTES+1)],'large.png'))).rejects.toThrow('10 MB');
  });
  it('不因扩展名伪装而解码 SVG 等非栅格输入',async()=>{
    await expect(readReferenceImage(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'],'image.png',{type:'image/png'}))).rejects.toThrow('格式');
  });
  it('先读取尺寸并拒绝超大画布，避免进入浏览器解码',async()=>{
    const bytes=Uint8Array.from(atob(tinyReference().dataUrl.split(',')[1]),c=>c.charCodeAt(0));new DataView(bytes.buffer).setUint32(16,9000);
    await expect(readReferenceImage(new File([bytes],'huge.png'))).rejects.toThrow('8192');
  });

  it('读取 PNG、WebP 和 JPEG 的实际尺寸，而不是信任扩展名',()=>{
    const image=tinyReference(),png=Uint8Array.from(atob(image.dataUrl.split(',')[1]),c=>c.charCodeAt(0));expect(rasterInfo(png)).toEqual({mime:'image/png',width:1,height:1});
    const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'),0);webp.set(new TextEncoder().encode('WEBPVP8X'),8);webp[24]=127;webp[25]=2;webp[27]=223;webp[28]=1;expect(rasterInfo(webp)).toEqual({mime:'image/webp',width:640,height:480});
    const jpeg=new Uint8Array([255,216,255,192,0,17,8,1,224,2,128,3,1,17,0,2,17,0,3,17,0,255,217]);expect(rasterInfo(jpeg)).toEqual({mime:'image/jpeg',width:640,height:480});expect(rasterInfo(new TextEncoder().encode('<svg/>'))).toBeNull();
  });
  it('只允许有界的内嵌静态资源，不接受远程地址、blob URL 或 SVG',()=>{
    const image=tinyReference();expect(validateReferenceImage(image)).toBe(true);
    for(const dataUrl of ['https://remote.invalid/reference.png','blob:http://localhost/image','data:image/svg+xml;base64,PHN2Zy8+','data:text/html;base64,PHNjcmlwdD4=','data:image/png;base64,!!!!'])expect(validateReferenceImage({...image,dataUrl})).toBe(false);
  });
  it('拒绝声明尺寸不一致、非有限变换及超限资源',()=>{
    const r=tinyReference();for(const patch of [{width:2},{height:1601},{opacity:NaN},{scale:0},{scale:4.01},{offsetX:1.51},{offsetY:Infinity},{name:''},{name:'a\u0000b'},{dataUrl:'x'.repeat(MAX_REFERENCE_DATA_CHARS+1)}])expect(validateReferenceImage({...r,...patch})).toBe(false);
  });
  it('横图、竖图、方图在三种视口尺寸下均保持比例，放置只改变中心与等比尺度',()=>{
    for(const [width,height]of [[1200,600],[600,900],[800,800]])for(const [vw,vh]of [[1440,900],[768,1024],[390,844]]){
      const r={width,height,scale:1,offsetX:0,offsetY:0},rect=referenceRect(r,vw,vh);expect(rect.width/rect.height).toBeCloseTo(width/height,12);expect(rect.left+rect.width/2).toBeCloseTo(vw/2,12);expect(rect.top+rect.height/2).toBeCloseTo(vh/2,12);expect(rect.width<=vw*.82+.0001&&rect.height<=vh*.82+.0001).toBe(true);
      const moved=referenceRect({...r,scale:2,offsetX:.1,offsetY:-.2},vw,vh);expect(moved.width).toBeCloseTo(rect.width*2,12);expect(moved.left+moved.width/2).toBeCloseTo(vw*.6,12);expect(moved.top+moved.height/2).toBeCloseTo(vh*.3,12);
    }
  });
  it('配置更新限制放置范围并保留原始资源，不让非有限输入破坏图片',()=>{
    const r=tinyReference(),next=referenceWithSettings(r,{opacity:3,scale:-2,offsetX:20,offsetY:NaN,locked:false});expect(next).toMatchObject({opacity:1,scale:.1,offsetX:1.5,offsetY:0,locked:false});expect(next.dataUrl).toBe(r.dataUrl);expect(r.opacity).toBe(.4);expect(validateReferenceImage(next)).toBe(true);
  });
});
