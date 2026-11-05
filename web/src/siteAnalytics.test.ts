import {afterEach,describe,expect,it,vi} from 'vitest';
import {analyticsTarget,startSiteAnalytics,trackCompletedExport,type ExportStats} from './siteAnalytics';
import {download} from './files';

const official='https://breezymomo.github.io/MomoPoseForge/';
function environment(href=official){
  const scripts:HTMLScriptElement[]=[],click=vi.fn();
  const win={location:{href},_hmt:undefined as unknown as {push:(entry:unknown[])=>unknown}} as NonNullable<Parameters<typeof startSiteAnalytics>[0]>;
  const doc={referrer:'https://example.com/private?token=REFERRER_SECRET#private',getElementById:(id:string)=>scripts.find(script=>script.id===id),createElement:(tag:string)=>tag==='a'?{click}:{},head:{append:(script:HTMLScriptElement)=>scripts.push(script)}} as unknown as Document;
  return {win,doc,scripts,click};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe('official-site analytics',()=>{
  it('only accepts the official HTTPS editor, excluding local, offline, forks and manuals',()=>{
    for(const href of ['invalid','file:///MomoPoseForge/index.html','http://127.0.0.1:4173/MomoPoseForge/','http://breezymomo.github.io/MomoPoseForge/','https://example.com/MomoPoseForge/','https://breezymomo.github.io:8443/MomoPoseForge/','https://breezymomo.github.io/MomoTextureForge/','https://breezymomo.github.io/MomoPoseForge-copy/','https://breezymomo.github.io/MomoPoseForge/docs/index.html','https://user:secret@breezymomo.github.io/MomoPoseForge/'])expect(analyticsTarget(href),href).toBeNull();
    expect(analyticsTarget(official+'index.html?project=SECRET#pose=PRIVATE')).toEqual({id:'224b1fd988ecb72d0d8640b984083207',path:'/MomoPoseForge/'});
  });
  it('loads once, sends one sanitized pageview and disables automatic PV/click capture',()=>{
    const {win,doc,scripts}=environment(official+'?project=SECRET#pose=PRIVATE');
    expect(startSiteAnalytics(win,doc)).toBe(true);expect(startSiteAnalytics(win,doc)).toBe(false);
    expect(win._hmt).toEqual([['_setAutoPageview',false],['_setAutoEventTracking',false],['_setReferrerOverride','https://example.com/'],['_trackPageview','/MomoPoseForge/']]);
    expect(scripts).toHaveLength(1);expect(scripts[0]).toMatchObject({id:'momo-site-analytics',src:'https://hm.baidu.com/hm.js?224b1fd988ecb72d0d8640b984083207',async:true,referrerPolicy:'origin'});
    expect(JSON.stringify([win._hmt,scripts])).not.toMatch(/SECRET|PRIVATE|private/);
  });
  it('does not initialize a tracker or queue outside the official editor',()=>{
    const {win,doc,scripts}=environment('http://localhost:5173/');
    expect(startSiteAnalytics(win,doc)).toBe(false);trackCompletedExport({format:'images-zip',scope:'five'},win);
    expect(scripts).toHaveLength(0);expect(win._hmt).toBeUndefined();
  });
  it('records bounded export format/scope labels without forwarding user fields',()=>{
    const {win,doc}=environment();startSiteAnalytics(win,doc);
    const cases:ExportStats[]=[{format:'images-zip',scope:'five'},{format:'images-zip',scope:'current'},...(['glb-static','glb-rigged'] as const).flatMap(format=>(['scene','selected'] as const).map(scope=>({format,scope})))];
    for(const stats of cases){const detail={...stats,name:'PRIVATE',rig:'PRIVATE',actors:['PRIVATE']};trackCompletedExport(detail,win);}
    expect((win._hmt as unknown as unknown[][]).slice(4)).toEqual(cases.map(stats=>['_trackEvent','export','download',stats.format+'/'+stats.scope]));
    expect(JSON.stringify(win._hmt)).not.toContain('PRIVATE');
  });
  it('rejects unsupported formats, arbitrary names and invalid format/scope combinations',()=>{
    const {win,doc}=environment();startSiteAnalytics(win,doc);
    for(const stats of [null,{}, {format:'PRIVATE',scope:'scene'}, {format:'images-zip',scope:'PRIVATE'},{format:'glb-static',scope:'five'},{format:'images-zip',scope:'scene'},{format:'preview',scope:'current'}])trackCompletedExport(stats as ExportStats,win);
    expect(win._hmt).toHaveLength(4);
  });
  it('tolerates malformed referrers and blocked analytics',()=>{
    const {win,doc}=environment();Object.assign(doc,{referrer:'not a URL'});expect(startSiteAnalytics(win,doc)).toBe(true);
    expect(win._hmt).toContainEqual(['_setReferrerOverride','']);
    win._hmt={push(){throw Error('blocked');}};expect(()=>trackCompletedExport({format:'glb-rigged',scope:'selected'},win)).not.toThrow();
    expect(startSiteAnalytics(win,{getElementById(){throw Error('blocked');}} as unknown as Document)).toBe(false);
  });
});

describe('download completion boundary',()=>{
  it('self-hosted exports emit one sanitized local signal without loading Baidu',()=>{
    const {win,doc,scripts}=environment('https://pose.breezymomo.com/'),dispatchEvent=vi.fn((_event:Event)=>true);Object.assign(win,{CustomEvent,dispatchEvent});
    const detail={format:'images-zip' as const,scope:'five' as const,name:'PRIVATE',pose:'PRIVATE'};
    expect(startSiteAnalytics(win,doc)).toBe(false);trackCompletedExport(detail,win);
    expect(dispatchEvent).toHaveBeenCalledOnce();const event=dispatchEvent.mock.calls[0][0] as CustomEvent;expect(event).toMatchObject({type:'momo:export-completed',detail:{action:'download',format:'images-zip',scope:'five'}});
    expect(JSON.stringify(event.detail)).not.toContain('PRIVATE');expect(scripts).toHaveLength(0);expect(win._hmt).toBeUndefined();
  });
  it('counts one download after initiation; project saves and failed initiation do not count',()=>{
    vi.useFakeTimers();const {win,doc,click}=environment();startSiteAnalytics(win,doc);vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    const blob=new Blob(['PRIVATE']);
    download(blob,'PRIVATE.poseforge');expect(win._hmt).toHaveLength(4);
    click.mockImplementationOnce(()=>{expect(win._hmt).toHaveLength(4);});
    download(blob,'PRIVATE.zip',{format:'images-zip',scope:'five'});expect(win._hmt).toHaveLength(5);
    click.mockImplementationOnce(()=>{throw Error('download blocked');});
    expect(()=>download(blob,'PRIVATE.glb',{format:'glb-static',scope:'scene'})).toThrow('download blocked');expect(win._hmt).toHaveLength(5);
    expect(JSON.stringify(win._hmt)).not.toContain('PRIVATE');vi.runAllTimers();
  });
  it('a tracker failure cannot fail a completed file download',()=>{
    vi.useFakeTimers();const {win,doc,click}=environment();win._hmt={push(){throw Error('blocked');}};vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    expect(()=>download(new Blob(),'private.glb',{format:'glb-rigged',scope:'selected'})).not.toThrow();expect(click).toHaveBeenCalledOnce();vi.runAllTimers();
  });
});
