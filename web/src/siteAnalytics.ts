// PoseForge's public Baidu site ID. Only the official editor sends statistics.
const SITE_ID='224b1fd988ecb72d0d8640b984083207';
const SCRIPT_ID='momo-site-analytics';
type AnalyticsWindow=Pick<Window,'location'>&{_hmt?:{push:(entry:unknown[])=>unknown}};
export type ExportStats=
  |{format:'images-zip';scope:'five'|'current'}
  |{format:'glb-static'|'glb-rigged';scope:'scene'|'selected'};

export function analyticsTarget(href:string){
  try{
    const url=new URL(href);
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.hostname!=='breezymomo.github.io'||!/^\/MomoPoseForge\/(?:index\.html)?$/.test(url.pathname))return null;
    return {id:SITE_ID,path:'/MomoPoseForge/'};
  }catch{return null;}
}

export function startSiteAnalytics(win:AnalyticsWindow=window,doc:Document=document){
  try{
    const target=analyticsTarget(win.location.href);
    if(!target||doc.getElementById(SCRIPT_ID))return false;
    const queue=win._hmt??([] as unknown[][]);win._hmt=queue;
    queue.push(['_setAutoPageview',false]);
    queue.push(['_setAutoEventTracking',false]);
    let referrer='';
    try{const url=new URL(doc.referrer);if(/^https?:$/.test(url.protocol))referrer=url.origin+'/';}catch{}
    queue.push(['_setReferrerOverride',referrer]);
    // Fixed path: query strings and fragments can contain shared project data.
    queue.push(['_trackPageview',target.path]);
    const script=doc.createElement('script');
    script.id=SCRIPT_ID;script.async=true;script.referrerPolicy='origin';
    // Baidu returns an empty script without a Referer; send the origin only.
    script.src='https://hm.baidu.com/hm.js?'+target.id;
    doc.head.append(script);
    return true;
  }catch{return false;}
}

export function trackCompletedExport(stats:ExportStats,win:AnalyticsWindow=window){
  try{
    if(!analyticsTarget(win.location.href))return;
    const valid=stats?.format==='images-zip'?['five','current'].includes(stats.scope):['glb-static','glb-rigged'].includes(stats?.format)&&['scene','selected'].includes(stats.scope);
    if(valid)win._hmt?.push(['_trackEvent','export','download',stats.format+'/'+stats.scope]);
  }catch{/* Statistics must not turn a completed download into an export failure. */}
}
