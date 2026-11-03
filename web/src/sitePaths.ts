// Rig definitions keep stable application-root paths; resolve them at the edge
// so the same project also works below a static host's repository directory.
export function sitePath(path:string,base=import.meta.env.BASE_URL){
  if(!path.startsWith('/')||path.startsWith('//'))return path;
  return `${base.replace(/\/$/,'')}${path}`;
}

export function manualPath(language:string,development=import.meta.env.DEV){const path=`/docs/index${language==='zh-CN'?'':'.en'}.html`;return development?`https://breezymomo.github.io/MomoPoseForge${path}`:sitePath(path);}
