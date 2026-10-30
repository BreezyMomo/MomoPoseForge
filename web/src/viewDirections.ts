import type {ViewSlot} from './types';

/** Directions can replace any of the five slots; slot IDs remain stable in files. */
export const VIEW_DIRECTIONS=[
  {id:'front',name:'正面',nameEn:'Front',azimuth:0,elevation:0},
  {id:'oblique',name:'斜侧',nameEn:'Three-quarter',azimuth:45,elevation:0},
  {id:'side',name:'侧面',nameEn:'Side',azimuth:90,elevation:0},
  {id:'high',name:'斜俯视',nameEn:'High angle',azimuth:0,elevation:45},
  {id:'low',name:'斜仰视',nameEn:'Low angle',azimuth:0,elevation:-30},
  {id:'top',name:'顶视',nameEn:'Top',azimuth:0,elevation:90},
  {id:'bottom',name:'底视',nameEn:'Bottom',azimuth:0,elevation:-90},
] as const;
export type ViewDirectionId=typeof VIEW_DIRECTIONS[number]['id'];
export function viewDirectionId(slot:ViewSlot){return VIEW_DIRECTIONS.find(p=>Math.abs(p.elevation-slot.elevation)<1e-8&&(Math.abs(p.elevation)===90||Math.abs(((p.azimuth-slot.azimuth)%360+540)%360-180)<1e-8))?.id??'custom';}
export function normalizeViewNames(views:ViewSlot[]):ViewSlot[]{
  return views.map(v=>({...v,name:v.id==='high'&&v.name==='俯视'&&viewDirectionId(v)==='high'?'斜俯视':v.id==='low'&&v.name==='仰视'&&viewDirectionId(v)==='low'?'斜仰视':v.name}));
}
export function isDirectionName(name:string){return VIEW_DIRECTIONS.some(v=>v.name===name)||name==='俯视'||name==='仰视';}
