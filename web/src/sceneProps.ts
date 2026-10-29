import {BoxGeometry,CylinderGeometry,Group,Mesh,MeshStandardMaterial,Vector3,MathUtils} from 'three';
import type {Vec3} from './types';

export const PROP_KINDS={chair:'椅子',table:'桌子',box:'方块',bar:'握杆'} as const;
export type PropKind=keyof typeof PROP_KINDS;
export type SceneProp={id:string;kind:PropKind;position:Vec3;size:Vec3;yaw:number;visible:boolean};
export const MAX_PROPS=12;
export function newSceneProp(kind:PropKind,id:string):SceneProp{
  const defaults:Record<PropKind,{position:Vec3;size:Vec3}>={
    chair:{position:[0,0,-.08],size:[.5,.48,.5]},
    table:{position:[0,0,.65],size:[1.1,.75,.6]},
    box:{position:[.35,0,.25],size:[.35,.25,.35]},
    bar:{position:[.3,1,.3],size:[.04,.65,.04]},
  };
  return {id,kind,...structuredClone(defaults[kind]),yaw:0,visible:true};
}
export function validSceneProps(value:unknown):value is SceneProp[]{
  if(!Array.isArray(value)||value.length>MAX_PROPS)return false;
  const ids=new Set<string>();
  return value.every(p=>{
    if(!p||typeof p!=='object'||typeof p.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(p.id)||ids.has(p.id)||!Object.hasOwn(PROP_KINDS,p.kind)||typeof p.visible!=='boolean'||!Number.isFinite(p.yaw)||Math.abs(p.yaw)>180)return false;
    ids.add(p.id);
    return Array.isArray(p.position)&&p.position.length===3&&p.position.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=5)&&Array.isArray(p.size)&&p.size.length===3&&p.size.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=.02&&v<=3);
  });
}
/** Position is the base centre; chair height means seat height. */
export function propAnchors(prop:SceneProp){
  const [w,h,d]=prop.size;
  const local=prop.kind==='bar'?[{id:'middle',name:'杆中点',point:[0,h/2,0]}]:[
    {id:'center',name:prop.kind==='chair'?'坐面中心':'顶面中心',point:[0,h,0]},
    {id:'left',name:'顶面左侧',point:[w*.3,h,0]},
    {id:'right',name:'顶面右侧',point:[-w*.3,h,0]},
    {id:'front',name:'顶面前侧',point:[0,h,d*.3]},
  ];
  return local.map(a=>({...a,point:new Vector3(...a.point).applyAxisAngle(new Vector3(0,1,0),MathUtils.degToRad(prop.yaw)).add(new Vector3().fromArray(prop.position)).toArray() as Vec3}));
}
export function buildSceneProp(prop:SceneProp){
  const group=new Group(),material=new MeshStandardMaterial({color:'#83928e',roughness:.72});
  group.name=`prop:${prop.id}`;group.position.fromArray(prop.position);group.rotation.y=MathUtils.degToRad(prop.yaw);
  const [w,h,d]=prop.size;
  const box=(size:Vec3,position:Vec3)=>{const mesh=new Mesh(new BoxGeometry(...size),material);mesh.position.fromArray(position);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);};
  if(prop.kind==='box')box([w,h,d],[0,h/2,0]);
  else if(prop.kind==='bar'){
    const mesh=new Mesh(new CylinderGeometry(w/2,w/2,h,20),material);mesh.scale.z=d/w;mesh.position.y=h/2;mesh.castShadow=true;group.add(mesh);
  }else{
    const thickness=Math.min(.045,h*.15,w*.15,d*.15),leg=Math.min(.045,w*.15,d*.15);
    box([w,thickness,d],[0,h-thickness/2,0]);
    for(const x of [-1,1])for(const z of [-1,1])box([leg,h-thickness,leg],[x*(w-leg)/2,(h-thickness)/2,z*(d-leg)/2]);
    if(prop.kind==='chair'){
      const back=h*.85;
      box([w,back,thickness],[0,h+back/2,-(d-thickness)/2]);
    }
  }
  return group;
}
export function disposePropGroup(group:Group){
  const materials=new Set<MeshStandardMaterial>();
  group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();materials.add(o.material as MeshStandardMaterial);}});
  materials.forEach(m=>m.dispose());group.clear();
}
