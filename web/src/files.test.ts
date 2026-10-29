import {describe,it,expect} from 'vitest';
import {parseDocument,safeName} from './files';
import {DEFAULT_VIEWS,END_EFFECTORS,type PoseDocument} from './types';
const fixture:PoseDocument={format:'momo-pose-forge',version:1,rig:'makehuman-core-v1',name:'测试姿势',root:{position:[0,0,0],quaternion:[0,0,0,1]},joints:{Hips:{position:[0,.9,0],quaternion:[0,0,0,1]},Head:{position:[0,.2,0],quaternion:[0,0,0,1]}},targets:Object.fromEntries(END_EFFECTORS.map(n=>[n,[0,0,0]])),poles:Object.fromEntries(END_EFFECTORS.map(n=>[n,[0,0,1]])),pins:{},hands:{Left:'张手',Right:'张手'},views:structuredClone(DEFAULT_VIEWS),ground:true};
describe('工程导入与文件名',()=>{
  it('保留可恢复的姿态和相机且返回独立副本',()=>{const d=parseDocument(JSON.stringify(fixture),fixture);expect(d).toEqual(fixture);d.views[0].azimuth=30;expect(fixture.views[0].azimuth).toBe(0);});
  it('拒绝不兼容的工程版本',()=>{expect(()=>parseDocument(JSON.stringify({...fixture,version:2}),fixture)).toThrow('版本不兼容');});
  it('不同人体骨骼的工程不会被直接载入或覆盖',()=>{expect(()=>parseDocument(JSON.stringify({...fixture,rig:'mixamo-xbot-v1'}),fixture)).toThrow('人体版本与当前模型不同');expect(fixture.rig).toBe('makehuman-core-v1');});
  it('拒绝改变骨长和非单位旋转',()=>{const d=structuredClone(fixture);d.joints.Head.position[1]=.3;expect(()=>parseDocument(JSON.stringify(d),fixture)).toThrow('骨段长度');d.joints.Head=structuredClone(fixture.joints.Head);d.root.quaternion=[0,0,0,0];expect(()=>parseDocument(JSON.stringify(d),fixture)).toThrow('无效');});
  it('拒绝损坏控制点和越界相机',()=>{const d=structuredClone(fixture);d.targets.LeftHand=[Infinity,0,0];expect(()=>parseDocument(JSON.stringify(d),fixture)).toThrow('IK');d.targets.LeftHand=[0,0,0];d.views[0].elevation=95;expect(()=>parseDocument(JSON.stringify(d),fixture)).toThrow('相机');});
  it('文件名不允许目录逃逸或 Windows 非法字符',()=>{expect(safeName('../a\\b:*.zip')).toBe('..-a-b--.zip');expect(safeName('  ')).toBe('pose');});
});
