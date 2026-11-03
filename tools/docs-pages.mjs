export const chapters=['README','01-quick-start','02-posing-and-rigs','03-scene-and-assets','04-animation-and-reference','05-camera-and-export','06-workspace-and-storage','faq','development'];
export const pageName=name=>name.replace(/^README(?=\.|$)/,'index')+'.html';
export const slug=text=>text.replace(/<[^>]*>/g,'').replace(/&[^;]+;/g,'').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'-');
export const htmlLink=href=>/^(?:[a-z]+:|\/\/)/i.test(href)?href:/^\.\.\/README(?:\.en)?\.md$/.test(href)?'../':href.replace(/README(\.en)?\.md(?=#|$)/,'index$1.html').replace(/\.md(?=#|$)/,'.html');
