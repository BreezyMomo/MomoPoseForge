export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export const END_EFFECTORS = ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'] as const;
export type Effector = typeof END_EFFECTORS[number];
export type ViewSlot = { id: string; name: string; azimuth: number; elevation: number };
export const DEFAULT_VIEWS: ViewSlot[] = [
  { id: 'front', name: '正面', azimuth: 0, elevation: 0 },
  { id: 'oblique', name: '斜侧', azimuth: 45, elevation: 0 },
  { id: 'side', name: '侧面', azimuth: 90, elevation: 0 },
  { id: 'high', name: '俯视', azimuth: 0, elevation: 45 },
  { id: 'low', name: '仰视', azimuth: 0, elevation: -30 },
];
export type Pin = { position: Vec3; quaternion: Quat; orientation: boolean };
export type PoseDocument = {
  format: 'momo-pose-forge'; version: 1; rig: 'makehuman-core-v1'; name: string;
  root: { position: Vec3; quaternion: Quat };
  joints: Record<string, { position: Vec3; quaternion: Quat }>;
  targets: Record<string, Vec3>; poles: Record<string, Vec3>;
  pins: Partial<Record<Effector, Pin>>;
  hands: { Left: string; Right: string }; views: ViewSlot[]; ground: boolean;
};
export type Preset = {
  id: string; name: string; category: string; description: string;
  drop?: number; lean?: number; twist?: number; head?: number;
  hands?: Partial<Record<Effector, Vec3>>;
  feet?: Partial<Record<Effector, Vec3>>;
  poles?: Partial<Record<Effector, Vec3>>;
  handShape?: string; ground?: boolean;
};
export const PART_NAMES: Record<string, string> = {
  Hips: '骨盆', Spine: '腰部', Spine1: '脊柱', Chest: '胸腔', UpperChest: '上胸', Neck: '颈部', Head: '头部',
  LeftShoulder: '左肩', LeftArm: '左上臂', LeftForeArm: '左肘', LeftHand: '左手',
  RightShoulder: '右肩', RightArm: '右上臂', RightForeArm: '右肘', RightHand: '右手',
  LeftUpLeg: '左髋', LeftLeg: '左膝', LeftFoot: '左脚',
  RightUpLeg: '右髋', RightLeg: '右膝', RightFoot: '右脚',
};
export type EngineInfo = {
  ready: boolean; view: string; selected: string; position: Vec3; rotation: Vec3;
  pinned: boolean; orientationPinned: boolean; ground: boolean; warning: string;
  hands: { Left: string; Right: string }; boneCount: number; vertexCount: number;
};
