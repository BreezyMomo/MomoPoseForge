import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {marked} from 'marked';
import {chapters,pageName,slug,htmlLink} from './docs-pages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),source=join(root,'docs'),out=join(root,'dist/docs');
mkdirSync(out,{recursive:true});
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const english of [false,true]){
  const suffix=english?'.en':'',pages=chapters.map(chapter=>{const name=chapter+suffix,markdown=readFileSync(join(source,name+'.md'),'utf8');return {name,markdown,title:markdown.match(/^# (.+)$/m)?.[1]??name};});
  for(const page of pages){
    const tokens=marked.lexer(page.markdown);marked.walkTokens(tokens,token=>{if(token.type==='link')token.href=htmlLink(token.href);});
    let content=marked.parser(tokens),used=new Map();
    content=content.replace(/<h([1-6])>(.*?)<\/h\1>/gs,(_,level,text)=>{const base=slug(text),count=used.get(base)??0;used.set(base,count+1);return `<h${level} id="${base}${count?'-'+count:''}">${text}</h${level}>`;});
    const nav=pages.map(p=>`<a ${p.name===page.name?'aria-current="page" ':''}href="${pageName(p.name)}">${escape(p.title)}</a>`).join('');
    const alternate=page.name.replace(/\.en$/,'')+(english?'':'.en');
    writeFileSync(join(out,pageName(page.name)),`<!doctype html><html lang="${english?'en':'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(page.title)} · MomoPoseForge</title><link rel="stylesheet" href="manual.css"></head><body><a class="skip" href="#content">${english?'Skip to content':'跳到正文'}</a><header><a class="brand" href="../">Momo<span>PoseForge</span></a><a href="../">${english?'Open editor':'打开编辑器'} ↗</a><a href="${pageName(alternate)}" lang="${english?'zh-CN':'en'}">${english?'简体中文':'English'}</a></header><div class="book"><aside><details open><summary>${english?'User manual':'用户手册'}</summary><nav aria-label="${english?'Chapters':'手册目录'}">${nav}</nav></details></aside><main id="content">${content}<footer>MomoPoseForge · ${english?'Editing stays in your browser. Save a complete project for backup.':'编辑在浏览器中完成，请保存完整工程做好备份。'}</footer></main></div></body></html>`);
  }
}
cpSync(join(source,'manual.css'),join(out,'manual.css'));
if(existsSync(join(source,'images')))cpSync(join(source,'images'),join(out,'images'),{recursive:true});
writeFileSync(join(root,'dist/.nojekyll'),'');
console.log(`Built ${chapters.length*2} manual pages in dist/docs/`);
