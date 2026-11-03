import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]);
const entry=readFileSync(resolve(dist,'index.html'),'utf8'),script=entry.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
if(!script)throw new Error('Built entry has no module script');
const base=script.slice(0,script.indexOf('/assets/')+1),origin='https://poseforge.invalid';
const pages=walk(dist).filter(path=>path.endsWith('.html')),failures=[];
for(const page of pages){
  const url=new URL(base+relative(dist,page).replaceAll('\\','/'),origin);
  for(const match of readFileSync(page,'utf8').matchAll(/\b(?:href|src)="([^"]+)"/g)){
    const target=new URL(match[1].replaceAll('&amp;','&'),url);if(target.origin!==origin)continue;
    if(!target.pathname.startsWith(base)){failures.push(`${url.pathname}: outside base ${target.pathname}`);continue;}
    const path=resolve(dist,decodeURIComponent(target.pathname.slice(base.length))+(target.pathname.endsWith('/')?'index.html':''));
    if(!existsSync(path)||!statSync(path).isFile()){failures.push(`${url.pathname}: missing ${target.pathname}`);continue;}
    if(target.hash&&path.endsWith('.html')){const id=decodeURIComponent(target.hash.slice(1));if(!readFileSync(path,'utf8').includes(`id="${id}"`))failures.push(`${url.pathname}: missing ${target.hash}`);}
  }
}
for(const asset of walk(resolve(root,'web/public'))){const destination=resolve(dist,relative(resolve(root,'web/public'),asset));if(!existsSync(destination)||statSync(destination).size!==statSync(asset).size)failures.push(`Missing or incomplete public asset: ${asset}`);}
if(failures.length)throw new Error(failures.join('\n'));
console.log(`Checked ${pages.length} built pages, links and public assets below ${base}`);
