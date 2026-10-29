import { describe,it,expect } from 'vitest';
import { Vector3,OrthographicCamera } from 'three';
import { solveTwoBone,projectPoint } from './math';
describe('人体双骨 IK',()=>{
  it('在可达范围内到达末端且严格保持骨长',()=>{const a=new Vector3(),t=new Vector3(.3,.5,.2);const r=solveTwoBone(a,t,new Vector3(0,0,1),.4,.35);expect(r.elbow.distanceTo(a)).toBeCloseTo(.4,8);expect(r.elbow.distanceTo(r.end)).toBeCloseTo(.35,8);expect(r.end.distanceTo(t)).toBeLessThan(1e-8);});
  it('不可达目标停在骨长允许的范围',()=>{const a=new Vector3(),r=solveTwoBone(a,new Vector3(0,5,0),new Vector3(0,0,1),.4,.35);expect(r.end.length()).toBeLessThanOrEqual(.75);expect(r.elbow.distanceTo(r.end)).toBeCloseTo(.35,7);expect(r.error).toBeGreaterThan(4);});
  it('末端位于根部且极向共线时仍保持有限有效数值',()=>{for(const t of [new Vector3(),new Vector3(0,0,.6)]){const r=solveTwoBone(new Vector3(),t,new Vector3(0,0,1),.4,.4);expect([...r.elbow.toArray(),...r.end.toArray()].every(Number.isFinite)).toBe(true);expect(r.elbow.length()).toBeCloseTo(.4,7);expect(r.elbow.distanceTo(r.end)).toBeCloseTo(.4,7);}});
  it('极向选择能确定肘膝弯曲方向',()=>{const a=new Vector3(),t=new Vector3(0,.6,0);const front=solveTwoBone(a,t,new Vector3(0,0,1),.4,.4),back=solveTwoBone(a,t,new Vector3(0,0,-1),.4,.4);expect(front.elbow.z).toBeGreaterThan(0);expect(back.elbow.z).toBeLessThan(0);});
});
describe('关节点投影',()=>{
  const camera=new OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=3;camera.lookAt(0,0,0);camera.updateMatrixWorld();
  it('使用左上角原点和最终像素尺寸',()=>{expect(projectPoint(new Vector3(-.5,.5,0),camera,768,1024)).toEqual({x:192,y:256,valid:true});});
  it('排除相机背后和画框外点',()=>{expect(projectPoint(new Vector3(2,0,0),camera,768,1024).valid).toBe(false);expect(projectPoint(new Vector3(0,0,4),camera,768,1024).valid).toBe(false);});
});
