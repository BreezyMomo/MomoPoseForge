import {describe,it,expect} from 'vitest';
import {sitePath,manualPath} from './sitePaths';

describe('static hosting paths',()=>{
  it('loads the same model below a repository directory',()=>{expect(sitePath('/models/fox/fox.glb','/MomoPoseForge/')).toBe('/MomoPoseForge/models/fox/fox.glb');});
  it('keeps root hosting compatible',()=>{expect(sitePath('/models/xbot.glb','/')).toBe('/models/xbot.glb');});
  it('opens published docs in development instead of an unavailable local page',()=>{expect(manualPath('zh-CN',true)).toBe('https://breezymomo.github.io/MomoPoseForge/docs/index.html');});
  it('uses the matching bundled manual in production',()=>{expect(manualPath('en',false)).toBe('/docs/index.en.html');expect(manualPath('zh-CN',false)).toBe('/docs/index.html');});
  it('keeps remote, blob and already relative resources unchanged',()=>{for(const path of ['https://example.com/a.glb','//cdn.example.com/a.glb','blob:example','data:image/png;base64,a','images/a.png'])expect(sitePath(path,'/MomoPoseForge/')).toBe(path);});
});
