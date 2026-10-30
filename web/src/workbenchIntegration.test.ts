import {afterEach,describe,expect,it} from 'vitest';
import {createLayoutModel} from '@momo/workbench/layout';
import {validateCatalogs} from '@momo/workbench/i18n';
import {WORKBENCH_CATALOGS} from '@momo/workbench/locales';
import {createPoseLayout,POSE_WORKBENCH_KEY} from './workbenchLayout';
import {POSE_MESSAGES} from './uiMessages';
import {language,t} from './workbenchState';
import {partName,presetName,viewName,gestureName} from './productLabels';
import {PRESETS} from './presets';
import {DEFAULT_VIEWS} from './types';

afterEach(()=>language.setLanguage('zh-CN'));
describe('PoseForge registers its panels in the shared workbench',()=>{
  it('keeps desktop pose panels while rejecting TextureForge panel IDs',()=>{
    const model=createPoseLayout(),layout=model.layoutPreset();
    for(const id of ['presets','viewport','inspector','views'])expect(model.panelStack(layout,id)?.active).toBe(id);
    const clean=model.sanitizeLayout({root:{kind:'stack',id:'foreign',panels:['nodes','library','timeline','viewport'],active:'nodes'},floats:[]});
    expect(clean.root).toMatchObject({panels:['viewport'],active:'viewport'});
    expect(model.LAYOUT_KEY).toBe(POSE_WORKBENCH_KEY);
  });
  it('uses a focused compact layout and can restore each registered panel',()=>{
    const model=createPoseLayout(true),initial=model.sanitizeLayoutSettings(null);
    expect(initial.current.root).toMatchObject({kind:'stack',panels:['viewport']});
    const properties=model.workspaceActions(initial,[{action:'preset',preset:'inspector'}]);
    expect(properties.current.root).toMatchObject({panels:['inspector']});
    const restored=model.workspaceActions(properties,[{action:'preset',preset:'focus'}]);
    expect(restored.current.root).toMatchObject({panels:['viewport']});
  });
  it('does not leak registrations or visibility changes into another application',()=>{
    const pose=createPoseLayout(),other=createLayoutModel({panels:[{id:'canvas',title:'other.canvas'}],storageKey:'other:layout'});
    const hidden=pose.closePanel(pose.layoutPreset(),'inspector');
    expect(pose.panelStack(hidden,'inspector')).toBeNull();
    expect(other.PANEL_IDS).toEqual(['canvas']);
    expect(other.LAYOUT_KEY).not.toBe(pose.LAYOUT_KEY);
    expect(pose.panelStack(pose.layoutPreset(),'inspector')).not.toBeNull();
  });
});

describe('product language is display state',()=>{
  it('has matching product and framework keys and interpolation in both catalogs',()=>{
    const config={default:'zh-CN',languages:[{code:'zh-CN',name:'简体中文'},{code:'en',name:'English'}]};
    const catalogs=Object.fromEntries(config.languages.map(({code})=>[code,{...WORKBENCH_CATALOGS[code],...Object.fromEntries(Object.entries(POSE_MESSAGES).map(([key,values])=>[key,values[code==='en'?1:0]]))}]));
    expect(validateCatalogs({config,catalogs}).keys).toBeGreaterThan(200);
    expect(Object.keys(POSE_MESSAGES).every(key=>/^pose\.[a-zA-Z]+(?:\.[a-zA-Z]+)*$/.test(key))).toBe(true);
  });
  it('changes labels without changing preset data or user-entered view and gesture names',()=>{
    const before=JSON.stringify({presets:PRESETS,views:DEFAULT_VIEWS});
    const view={...DEFAULT_VIEWS[0],name:'我的镜头 My view'};
    const gesture={id:'mine',name:'我的手势 My gesture',values:{} as never};
    language.setLanguage('en');
    expect(t('pose.panel.presets')).toBe('Pose library');
    expect(t('pose.boneCount',68)).toContain('68 bones');
    expect(partName('LeftForeArm')).toBe('Left elbow');
    expect(presetName(PRESETS[0])).toBe('Neutral stance');
    expect(viewName(view)).toBe(view.name);
    expect(gestureName(gesture,false)).toBe(gesture.name);
    expect(JSON.stringify({presets:PRESETS,views:DEFAULT_VIEWS})).toBe(before);
  });
});
