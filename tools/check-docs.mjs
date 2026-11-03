import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {marked} from 'marked';
import {chapters,slug} from './docs-pages.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const pages=['README.md','README.en.md',...chapters.flatMap(name=>[`docs/${name}.md`,`docs/${name}.en.md`])];
const failures=[];
for(const page of pages){
  const source=resolve(root,page);if(!existsSync(source)){failures.push(`Missing ${page}`);continue;}
  const markdown=readFileSync(source,'utf8');
  marked.walkTokens(marked.lexer(markdown),token=>{
    if(token.type!=='link'&&token.type!=='image')return;
    const href=token.href;if(!href||/^(?:[a-z]+:|\/\/)/i.test(href))return;
    const [path,anchor]=href.split('#'),target=path?resolve(dirname(source),decodeURIComponent(path)):source;
    if(!existsSync(target)){failures.push(`${page}: missing ${href}`);return;}
    if(anchor&&statSync(target).isFile()&&target.endsWith('.md')){
      const headings=marked.lexer(readFileSync(target,'utf8')).filter(t=>t.type==='heading').map(t=>slug(t.text));
      if(!headings.includes(decodeURIComponent(anchor)))failures.push(`${page}: missing anchor ${href}`);
    }
  });
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(`Checked ${pages.length} documentation files: language pairs, links, images and anchors.`);
