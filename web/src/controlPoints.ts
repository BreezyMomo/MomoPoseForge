import {BackSide,Mesh,MeshBasicMaterial,SphereGeometry} from 'three';

/** Capability colours are shared by the 3D controls and their on-screen key. */
export const CONTROL_POINT_COLORS={move:'#56c5ef',rotate:'#f08a4b',fixed:'#a0a6ad'} as const;
export type ControlPointKind=keyof typeof CONTROL_POINT_COLORS;
export const CONTROL_POINT_LABELS:Record<ControlPointKind,string>={move:'pose.controlPointMove',rotate:'pose.controlPointRotate',fixed:'pose.controlPointFixed'};

export function createControlPoint(name:string,radius:number,kind:ControlPointKind='rotate'){
  const point=new Mesh(new SphereGeometry(radius,12,8),new MeshBasicMaterial({color:CONTROL_POINT_COLORS[kind],depthTest:false,transparent:true,opacity:.95}));
  point.userData.part=name;point.renderOrder=100;
  const halo=new Mesh(new SphereGeometry(radius*1.28,12,8),new MeshBasicMaterial({color:'#f6f7f8',side:BackSide,depthTest:false,transparent:true,opacity:.9}));
  halo.name='selection-halo';halo.renderOrder=99;halo.visible=false;halo.raycast=()=>{};point.add(halo);return point;
}

export function updateControlPoint(point:Mesh,kind:ControlPointKind,selected:boolean){
  (point.material as MeshBasicMaterial).color.set(CONTROL_POINT_COLORS[kind]);point.scale.setScalar(selected?1.4:1);
  const halo=point.getObjectByName('selection-halo');if(halo)halo.visible=selected;
}
