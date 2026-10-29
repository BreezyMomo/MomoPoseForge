import {describe,it,expect,vi} from 'vitest';
import {Box3,Vector3,Mesh} from 'three';
import {newSceneProp,validSceneProps,propAnchors,buildSceneProp,disposePropGroup,MAX_PROPS,PROP_KINDS} from './sceneProps';

describe('基础道具几何与工程校验',()=>{
  for(const kind of Object.keys(PROP_KINDS) as (keyof typeof PROP_KINDS)[])it(`${kind}使用米制尺寸，底面为原点，接触点在表面`,()=>{
    const prop=newSceneProp(kind,'test-prop'),group=buildSceneProp(prop),box=new Box3().setFromObject(group,true);
    expect(validSceneProps([prop])).toBe(true);expect(box.min.y).toBeCloseTo(prop.position[1],6);
    const height=prop.size[1]*(kind==='chair'?1.85:1);
    expect(box.max.y-box.min.y).toBeCloseTo(height,6);
    expect(box.max.x-box.min.x).toBeCloseTo(prop.size[0],6);
    for(const anchor of propAnchors(prop))expect(box.clone().expandByScalar(1e-6).containsPoint(new Vector3().fromArray(anchor.point))).toBe(true);
    const meshes:Mesh[]=[];group.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});
    const geometrySpies=meshes.map(m=>vi.spyOn(m.geometry,'dispose')),materialSpy=vi.spyOn(meshes[0].material as {dispose():void},'dispose');
    disposePropGroup(group);expect(group.children).toHaveLength(0);geometrySpies.forEach(spy=>expect(spy).toHaveBeenCalledOnce());expect(materialSpy).toHaveBeenCalledOnce();
  });
  it('接触点跟随道具的水平旋转与平移，不改变源数据',()=>{
    const prop=newSceneProp('table','rotated');prop.position=[1,.2,-1];prop.yaw=90;
    const before=structuredClone(prop),point=propAnchors(prop).find(a=>a.id==='left')!.point;
    expect(point[0]).toBeCloseTo(1);expect(point[1]).toBeCloseTo(.95);expect(point[2]).toBeCloseTo(-1-prop.size[0]*.3);expect(prop).toEqual(before);
  });
  it('拒绝重复编号、未知形状、非法尺寸和超量道具',()=>{
    const prop=newSceneProp('box','box');
    for(const value of [null,{},[prop,prop],[{...prop,kind:'constructor'}],[{...prop,yaw:NaN}],[{...prop,visible:1}],[{...prop,size:[0,1,1]}],[{...prop,size:[4,1,1]}],[{...prop,position:[0,Infinity,0]}],[{...prop,position:[6,0,0]}],Array.from({length:MAX_PROPS+1},(_,i)=>({...prop,id:`box-${i}`}))])expect(validSceneProps(value)).toBe(false);
  });
});
