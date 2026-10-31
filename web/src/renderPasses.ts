import * as THREE from 'three';

export type DepthRange={near:number;far:number};
export type RenderKind='surface'|'lineart'|'guides'|'skeleton'|'body-skeleton'|'depth'|'normal'|'mask';
export type DataKind='depth'|'normal'|'mask'|'visibility';
/** Transparent guide meshes blend into a zero-alpha target as premultiplied
 * colors. Canvas ImageData / PNG need straight RGB to avoid dark fringes. */
export function straightAlpha(pixels:Uint8Array){for(let i=0;i<pixels.length;i+=4){const alpha=pixels[i+3];for(let c=0;c<3;c++)pixels[i+c]=alpha?Math.min(255,Math.round(pixels[i+c]*255/alpha)):0;}return pixels;}
export const NORMAL_CONVENTION={space:'camera',cameraAxes:{x:'right',y:'up',z:'towards viewer'},encoding:'RGB = 0.5 * (-Nx, Ny, Nz) + 0.5',protocol:'ControlNet 1.1 Normal / ScanNet visualization',colorSpace:'linear data, no tone mapping or sRGB transfer',background:[0,0,0]};
export function depthRangeFor(box:THREE.Box3,cameras:THREE.Camera[]):DepthRange{
  let near=Infinity,far=-Infinity;
  for(const camera of cameras){camera.updateMatrixWorld();for(let i=0;i<8;i++){
    const p=new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(camera.matrixWorldInverse),depth=-p.z;
    near=Math.min(near,depth);far=Math.max(far,depth);
  }}
  near=Math.max(.001,Number.isFinite(near)?near:.001);far=Math.max(near+.01,Number.isFinite(far)?far:near+1);
  const pad=Math.max(.005,(far-near)*.02);return {near:Math.max(.001,near-pad),far:far+pad};
}
export const encodeDepth=(depth:number,range:DepthRange)=>THREE.MathUtils.clamp((range.far-depth)/(range.far-range.near),0,1);
export function decodePackedDepth(r:number,g:number,b:number,range:DepthRange){const packed=r*65536+g*256+b;return packed===0?null:range.far-(packed-1)/16777214*(range.far-range.near);}
export const encodeNormal=(normal:THREE.Vector3)=>normal.clone().normalize().multiply(new THREE.Vector3(-1,1,1)).multiplyScalar(.5).addScalar(.5);

export function dataMaterial(kind:DataKind,camera:THREE.PerspectiveCamera|THREE.OrthographicCamera,range:DepthRange):THREE.Material{
  if(kind==='mask')return new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
  if(kind==='normal'){
    const material=new THREE.MeshNormalMaterial({toneMapped:false});
    material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('packNormalToRGB( normal )','packNormalToRGB( vec3( -normal.x, normal.y, normal.z ) )');};
    material.customProgramCacheKey=()=> 'pose-normal-scannet-v1';return material;
  }
  const material=new THREE.MeshDepthMaterial({depthPacking:THREE.BasicDepthPacking,toneMapped:false});
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{poseCameraNear:{value:camera.near},poseCameraFar:{value:camera.far},poseDepthNear:{value:range.near},poseDepthFar:{value:range.far}});
    shader.fragmentShader='uniform float poseCameraNear;\nuniform float poseCameraFar;\nuniform float poseDepthNear;\nuniform float poseDepthFar;\n'+shader.fragmentShader;
    const fn=camera instanceof THREE.PerspectiveCamera?'perspectiveDepthToViewZ':'orthographicDepthToViewZ';
    const output=kind==='visibility'?'float packed = floor( value * 16777214.0 ) + 1.0;\nvec3 bytes = vec3( floor( packed / 65536.0 ), floor( mod( packed, 65536.0 ) / 256.0 ), mod( packed, 256.0 ) );\ngl_FragColor = vec4( bytes / 255.0, 1.0 );':'gl_FragColor = vec4( vec3( value ), 1.0 );';
    shader.fragmentShader=shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',`float metres = -${fn}( fragCoordZ, poseCameraNear, poseCameraFar );\nfloat value = clamp( ( poseDepthFar - metres ) / ( poseDepthFar - poseDepthNear ), 0.0, 1.0 );\n${output}`);
  };
  material.customProgramCacheKey=()=>`pose-${kind}-linear-v1-${camera.type}`;return material;
}
