import {describe,it,expect} from 'vitest';
import {Bone,Group,Vector3,PerspectiveCamera,OrthographicCamera,Box3,Scene,Color,Object3D,NoToneMapping,ACESFilmicToneMapping,MeshBasicMaterial} from 'three';
import {PoseEngine} from './PoseEngine';
import {handBones,projectPose,HAND_LINKS,HAND_NAMES,worldSkeleton,depthVisibility,handTolerance} from './poseOutput';
import {depthRangeFor,encodeDepth,encodeNormal,decodePackedDepth} from './renderPasses';
import {controlnetRecipe} from './controlnetWorkflow';
import rig from '../public/models/xbot-profile.json';

function rigPose(){
  const root=new Group(),bones:Record<string,Bone>={},profile=rig.bones as Record<string,{parent:string|null;position:number[]}>;
  for(const name of Object.keys(profile)){bones[name]=new Bone();bones[name].name=name;}
  for(const[name,p]of Object.entries(profile)){bones[name].position.fromArray(p.position);if(p.parent){bones[name].position.sub(new Vector3().fromArray(profile[p.parent].position));bones[p.parent].add(bones[name]);}else root.add(bones[name]);}root.updateMatrixWorld(true);
  const points=(side:'Left'|'Right')=>handBones(side).map(n=>bones[n].getWorldPosition(new Vector3()));
  return {root,bones,pose:{body:Array.from({length:18},()=>new Vector3(0,1,0)),Left:points('Left'),Right:points('Right')}};
}
function camera(){const cam=new PerspectiveCamera(60,.75,.01,20);cam.position.set(0,1,3);cam.lookAt(0,1,0);cam.updateMatrixWorld();return cam;}
function packed(value:number){const n=Math.floor(value*16777214)+1;return [Math.floor(n/65536),Math.floor(n/256)%256,n%256,255];}

describe('身体与双手控制数据',()=>{
  it('每手21点包含腕及五指各四点，索引、连接、左右镜像顺序正确',()=>{
    const {bones,pose}=rigPose();expect(HAND_NAMES).toHaveLength(21);expect(HAND_LINKS).toHaveLength(20);
    for(const side of ['Left','Right'] as const){expect(handBones(side)).toHaveLength(21);expect(handBones(side)[0]).toBe(`${side}Hand`);expect(handBones(side)[4]).toBe(`${side}Thumb4`);expect(handBones(side)[20]).toBe(`${side}Little4`);for(const name of handBones(side))expect(bones[name]).toBeInstanceOf(Bone);}
    const frame=projectPose(pose,camera(),768,1024).people[0];expect(frame.pose_keypoints_2d).toHaveLength(54);expect(frame.hand_left_keypoints_2d).toHaveLength(63);expect(frame.hand_right_keypoints_2d).toHaveLength(63);
    expect(frame.hand_left_keypoints_2d[0]).toBeGreaterThan(frame.hand_right_keypoints_2d[0]);expect(frame.hand_left_keypoints_2d.filter((_,i)=>i%3===2).every(c=>c===1)).toBe(true);
  });
  it('出画面、镜头后方、被遮挡点为零，不影响另一只手及身体',()=>{
    const {pose}=rigPose();pose.Left[4].set(100,1,0);pose.Left[8].set(0,1,5);
    const frame=projectPose(pose,camera(),768,1024,(_,i,side)=>side!=='Left'||i!==12).people[0];
    for(const i of [4,8,12])expect(frame.hand_left_keypoints_2d.slice(i*3,i*3+3)).toEqual([0,0,0]);
    expect(frame.pose_keypoints_2d.filter((_,i)=>i%3===2).every(c=>c===1)).toBe(true);expect(frame.hand_right_keypoints_2d.filter((_,i)=>i%3===2).every(c=>c===1)).toBe(true);
  });
  it('指骨旋转改变对应指尖投影及米制坐标，其他手保持',()=>{
    const {root,bones,pose}=rigPose(),before=projectPose(pose,camera(),768,1024).people[0];bones.LeftIndex1.rotation.z=-1;root.updateMatrixWorld(true);const next={...pose,Left:handBones('Left').map(n=>bones[n].getWorldPosition(new Vector3()))};
    const after=projectPose(next,camera(),768,1024).people[0];expect(after.hand_left_keypoints_2d.slice(24,27)).not.toEqual(before.hand_left_keypoints_2d.slice(24,27));expect(after.hand_right_keypoints_2d).toEqual(before.hand_right_keypoints_2d);
    const world=worldSkeleton(next);expect(world.hands.Left.points[8].name).toBe('index4');expect(world.hands.Left.points[8].position).toEqual(next.Left[8].toArray());expect(world.coordinates.units).toBe('metres');
  });
});

describe('控制图空间与遮挡约定',()=>{
  it('深度是线性米制近白远黑，正交/透视相机与五视图共享范围',()=>{
    const box=new Box3(new Vector3(-1,0,-.5),new Vector3(1,2,.5)),front=camera(),side=new OrthographicCamera(-2,2,2,-2,.01,20);side.position.set(3,1,0);side.lookAt(0,1,0);side.updateMatrixWorld();
    const range=depthRangeFor(box,[front,side]);expect(range.near).toBeLessThan(2);expect(range.far).toBeGreaterThan(4);expect(encodeDepth(range.near,range)).toBe(1);expect(encodeDepth(range.far,range)).toBe(0);expect(encodeDepth((range.near+range.far)/2,range)).toBeCloseTo(.5);
    const third=front.clone();third.position.set(0,1,5);third.updateMatrixWorld();expect(depthRangeFor(box,[front,side,third]).far).toBeGreaterThan(range.far);
  });
  it('法线编码正面蓝、左面红、上面绿，单位方向不依赖灯光',()=>{
    expect(encodeNormal(new Vector3(0,0,1)).toArray()).toEqual([.5,.5,1]);expect(encodeNormal(new Vector3(-1,0,0)).toArray()).toEqual([1,.5,.5]);expect(encodeNormal(new Vector3(0,1,0)).toArray()).toEqual([.5,1,.5]);
    expect(encodeNormal(new Vector3(-5,0,0)).toArray()).toEqual([1,.5,.5]);
  });
  it('24位可见性深度区分黑背景，量化误差低于微米',()=>{
    const range={near:2,far:4};expect(decodePackedDepth(0,0,0,range)).toBeNull();
    for(let i=0;i<=100;i++){const value=i/100,bytes=packed(value);expect(Math.abs(decodePackedDepth(bytes[0],bytes[1],bytes[2],range)!-(4-2*value))).toBeLessThan(.000001);}
  });
  it('遮挡判断使用相同相机与像素方向，允许关节在自身表面之内',()=>{
    const cam=camera(),width=4,height=4,range={near:2,far:4},pixels=new Uint8Array(width*height*4),i=((height-1-2)*width+2)*4;pixels.set(packed(.5),i);
    const visible=depthVisibility(pixels,cam,width,height,range);expect(visible(new Vector3(0,1,0),2)).toBe(true);expect(visible(new Vector3(0,1,-.005),2)).toBe(true);expect(visible(new Vector3(0,1,-.1),2)).toBe(false);
    expect(visible(new Vector3(100,1,0),2)).toBe(false);expect(handTolerance(0)).toBeGreaterThan(handTolerance(2));
  });
  it('导出着色器失败也恢复主视口材质、色调、背景与渲染目标',()=>{
    const e=Object.create(PoseEngine.prototype) as PoseEngine,scene=new Scene(),background=new Color('#123456'),override=new MeshBasicMaterial(),gizmo=new Object3D(),targetBefore={};scene.background=background;scene.overrideMaterial=override;
    const state={alpha:.25,target:targetBefore as unknown,toneMapping:ACESFilmicToneMapping};const renderer={getRenderTarget:()=>state.target,getClearAlpha:()=>state.alpha,toneMapping:state.toneMapping,setClearAlpha:(v:number)=>{state.alpha=v;},setRenderTarget:(v:unknown)=>{state.target=v;},render:()=>{expect(renderer.toneMapping).toBe(NoToneMapping);throw new Error('test shader failure');}};
    Object.assign(e,{scene,renderer,model:new Group(),helpers:new Group(),grid:new Object3D(),groundMesh:new Object3D(),boneDisplay:new Group(),transform:{getHelper:()=>gizmo}});
    expect(()=>(e as unknown as {renderPixels(c:PerspectiveCamera,w:number,h:number,k:string):void}).renderPixels(camera(),8,8,'normal')).toThrow('test shader failure');
    expect(scene.background).toBe(background);expect(scene.overrideMaterial).toBe(override);expect(state.target).toBe(targetBefore);expect(state.alpha).toBe(.25);expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);expect(e.helpers.visible&&e.grid.visible&&e.model.visible&&gizmo.visible).toBe(true);
  });
  it('工作流只引用存在的选定控制图，并固定模型、种子和输出尺寸',()=>{
    const recipe=controlnetRecipe(['front'],{skeleton:true,depth:true,normal:true});expect(recipe.controls.map(c=>c.file)).toEqual(['openpose-body-hands.png','depth.png','normal.png']);expect(recipe.models.pose.revision).toHaveLength(40);expect(recipe.generation.width/recipe.generation.height).toBe(.75);
    expect(controlnetRecipe(['current'],{skeleton:false,depth:true,normal:false}).controls.map(c=>c.kind)).toEqual(['depth']);
    const hand=controlnetRecipe(['current'],{skeleton:true,depth:true,normal:true},{side:'Left',shape:'指向'});expect(hand.generation.prompt).toContain('left hand');expect(hand.generation.prompt).toContain('index finger');expect(hand.framing.kind).toBe('hand');
  });
});
