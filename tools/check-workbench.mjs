import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const imports=['appearance','appearance-settings','language-selector','header-controls','dock','layout','i18n','locales','dock.css','motion.css','theme-tokens.css','appearance-settings.css','tabs.css','language-selector.css','header-controls.css'];

export function checkWorkbench(root=projectRoot){
  const fail=reason=>{throw new Error(`[PoseForge] 共享工作台依赖不可用：${reason}\n请停止开发服务，在 PoseForge 项目根目录执行 npm ci，再重新启动。\n复制源码时需保留 vendor/、package.json 和 package-lock.json；无需安装 MomoWorkbench 或 TextureForge 仓库。`);};
  const json=path=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{fail(`无法读取 ${path}`);}};
  const manifest=json(resolve(root,'package.json')),lock=json(resolve(root,'package-lock.json'));
  const dependency=manifest.dependencies?.['@momo/workbench'],locked=lock.packages?.['node_modules/@momo/workbench'];
  if(typeof dependency!=='string'||!dependency.startsWith('file:vendor/')||locked?.resolved!==dependency)fail('package.json 与 package-lock.json 中的框架依赖不一致');
  let archive;try{archive=readFileSync(resolve(root,dependency.slice(5)));}catch{fail(`缺少随仓库提供的 ${dependency.slice(5)}`);}
  const integrity=`sha512-${createHash('sha512').update(archive).digest('base64')}`;
  if(locked.integrity!==integrity)fail('vendor 中的框架包与依赖锁不匹配，请恢复仓库中的配套文件');
  const installed=json(resolve(root,'node_modules/@momo/workbench/package.json'));
  if(installed.name!=='@momo/workbench'||installed.version!==locked.version)fail('已安装的框架版本与依赖锁不一致');
  const require=createRequire(resolve(root,'package.json'));
  for(const name of imports){
    const specifier=`@momo/workbench/${name}`;
    let target;try{target=require.resolve(specifier);if(!statSync(target).isFile())throw new Error();}catch{fail(`无法解析 ${specifier}，安装可能不完整或仍为旧版本`);}
    const types=installed.exports?.[`./${name}`]?.types;
    if(types){try{if(!statSync(resolve(root,'node_modules/@momo/workbench',types)).isFile())throw new Error();}catch{fail(`${specifier} 缺少类型声明`);}}
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{checkWorkbench();}catch(error){console.error(error.message);process.exitCode=1;}
}
