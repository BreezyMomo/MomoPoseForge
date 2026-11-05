import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkWorkbench} from './check-workbench.mjs';

function fixture(t){
  const parent=resolve(tmpdir()),root=mkdtempSync(join(parent,'poseforge-dependency-'));
  assert.equal(dirname(root),parent);assert.ok(basename(root).startsWith('poseforge-dependency-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(name,value)=>{const path=join(root,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
  const archive='bundled workbench fixture',dependency='file:vendor/workbench.tgz';
  put('package.json',{dependencies:{'@momo/workbench':dependency}});
  put('vendor/workbench.tgz',archive);
  put('package-lock.json',{packages:{'node_modules/@momo/workbench':{version:'0.2.0',resolved:dependency,integrity:`sha512-${createHash('sha512').update(archive).digest('base64')}`}}});
  const installed={name:'@momo/workbench',version:'0.2.0',exports:{}};
  for(const name of ['appearance','react','dock','layout','i18n','locales','dock.css','motion.css','theme-tokens.css','react.css','tabs.css','header-controls.css']){
    installed.exports[`./${name}`]=name.endsWith('.css')?`./src/${name}`:{types:`./src/${name}.d.ts`,default:`./src/${name}.js`};
    put(`node_modules/@momo/workbench/src/${name}${name.endsWith('.css')?'':'.js'}`,'');
    if(!name.endsWith('.css'))put(`node_modules/@momo/workbench/src/${name}.d.ts`,'');
  }
  put('node_modules/@momo/workbench/package.json',installed);
  return {root,put,installed};
}

test('独立目录内依赖完整时通过，不需要兄弟仓库',t=>{const f=fixture(t);assert.doesNotThrow(()=>checkWorkbench(f.root));});
test('缺少 vendor 时明确提示恢复源码包',t=>{const f=fixture(t);rmSync(join(f.root,'vendor/workbench.tgz'));assert.throws(()=>checkWorkbench(f.root),/缺少随仓库提供的 vendor\/workbench.tgz/);});
test('缺少本地安装时提示 npm ci，不使用父级依赖',t=>{const f=fixture(t);rmSync(join(f.root,'node_modules'),{recursive:true});assert.throws(()=>checkWorkbench(f.root),/npm ci/);});
test('旧安装缺少 appearance 导出时提前拦截',t=>{const f=fixture(t);delete f.installed.exports['./appearance'];f.put('node_modules/@momo/workbench/package.json',f.installed);assert.throws(()=>checkWorkbench(f.root),/无法解析 @momo\/workbench\/appearance/);});
test('已有导出但实际文件缺失时提前拦截',t=>{const f=fixture(t);rmSync(join(f.root,'node_modules/@momo/workbench/src/appearance.js'));assert.throws(()=>checkWorkbench(f.root),/无法解析 @momo\/workbench\/appearance/);});
test('框架包与锁文件不匹配时拒绝混用',t=>{const f=fixture(t);f.put('vendor/workbench.tgz','different package');assert.throws(()=>checkWorkbench(f.root),/框架包与依赖锁不匹配/);});
