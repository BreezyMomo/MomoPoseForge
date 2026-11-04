import {MathUtils,OrthographicCamera,PerspectiveCamera,Vector3} from 'three';
import {DEFAULT_VIEWS,type ViewSlot} from './types';

/** Optional settings keep old projects' orthographic cameras unchanged. */
export function validViewSlots(value:unknown):value is ViewSlot[]{
  return Array.isArray(value)&&value.length===5&&value.every((v,i)=>v&&typeof v==='object'&&v.id===DEFAULT_VIEWS[i].id&&typeof v.name==='string'&&v.name.length<=30&&Number.isFinite(v.azimuth)&&Math.abs(v.azimuth)<=360&&Number.isFinite(v.elevation)&&Math.abs(v.elevation)<=90&&
    (v.projection===undefined||v.projection==='orthographic'||v.projection==='perspective')&&
    (v.fov===undefined||Number.isFinite(v.fov)&&v.fov>=15&&v.fov<=100)&&
    (v.zoom===undefined||Number.isFinite(v.zoom)&&v.zoom>=.25&&v.zoom<=4));
}

export function createViewCamera(slot:ViewSlot,center:Vector3,span:number,aspect:number){
  const half=span/2,fov=slot.fov??35,perspective=slot.projection==='perspective';
  const distance=perspective?half/Math.tan(MathUtils.degToRad(fov)/2):5;
  const camera=perspective?new PerspectiveCamera(fov,aspect,.01,Math.max(50,distance+span*4)):new OrthographicCamera(-half*aspect,half*aspect,half,-half,.01,50);
  const a=MathUtils.degToRad(slot.azimuth),e=MathUtils.degToRad(slot.elevation);
  if(Math.abs(slot.elevation)===90){const sign=Math.sign(slot.elevation);camera.position.set(0,sign*distance,0);camera.up.set(-Math.sin(a),0,-sign*Math.cos(a));}
  else camera.position.set(Math.sin(a)*Math.cos(e)*distance,Math.sin(e)*distance,Math.cos(a)*Math.cos(e)*distance);
  camera.zoom=slot.zoom??1;camera.position.add(center);camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld();return camera;
}
