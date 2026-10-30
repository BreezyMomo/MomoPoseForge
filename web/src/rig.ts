import {XBOT_RIG} from './rigs';
/** Legacy X Bot adapter metadata. Runtime code reads engine.activeRig. */
export const CURRENT_MODEL = {
  rig: 'mixamo-xbot-v2',
  name: XBOT_RIG.name,
  modelUrl: '/models/xbot.glb',
  profileUrl: '/models/xbot-profile.json',
  sourceUrl: '/models/XBOT-ASSET.md',
  license: 'Adobe Mixamo terms',
} as const;
