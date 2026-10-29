export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
import type {CameraSettings} from './cameraState';
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
  format: 'momo-pose-forge'; version: 1; rig: string; name: string;
  root: { position: Vec3; quaternion: Quat };
  joints: Record<string, { position: Vec3; quaternion: Quat }>;
  targets: Record<string, Vec3>; poles: Record<string, Vec3>;
  pins: Partial<Record<Effector, Pin>>;
  hands: { Left: string; Right: string }; views: ViewSlot[]; ground: boolean; fullBody?:boolean;
  camera?:CameraSettings;
};
export type Preset = {
  id: string; name: string; category: string; description: string;
  drop?: number; lean?: number; twist?: number; head?: number;
  hands?: Partial<Record<Effector, Vec3>>;
  feet?: Partial<Record<Effector, Vec3>>;
  poles?: Partial<Record<Effector, Vec3>>;
  handShape?: string; ground?: boolean;
};
export const BODY_PART_NAMES: Record<string, string> = {
  Hips: '骨盆', Spine: '腰部', Spine1: '脊柱', Chest: '胸腔', UpperChest: '上胸', Neck: '颈部', Head: '头部',
  LeftShoulder: '左肩', LeftArm: '左上臂', LeftForeArm: '左肘', LeftHand: '左手',
  RightShoulder: '右肩', RightArm: '右上臂', RightForeArm: '右肘', RightHand: '右手',
  LeftUpLeg: '左髋', LeftLeg: '左膝', LeftFoot: '左脚', LeftToeBase:'左脚趾',
  RightUpLeg: '右髋', RightLeg: '右膝', RightFoot: '右脚', RightToeBase:'右脚趾',
};
export const DIGITS=['Thumb','Index','Middle','Ring','Little'] as const;
export type Digit=typeof DIGITS[number];
export type Side='Left'|'Right';
export const DIGIT_NAMES:Record<Digit,string>={Thumb:'拇指',Index:'食指',Middle:'中指',Ring:'无名指',Little:'小指'};
export const FINGER_PART_NAMES:Record<string,string>=Object.fromEntries((['Left','Right'] as const).flatMap(side=>DIGITS.flatMap(digit=>[1,2,3].map(joint=>[`${side}${digit}${joint}`,`${side==='Left'?'左':'右'}手${DIGIT_NAMES[digit]} · 第 ${joint} 节`]))));
export const PART_NAMES:Record<string,string>={...BODY_PART_NAMES,...FINGER_PART_NAMES};
export type FingerValues={curl:[number,number,number];spread:number};
export type HandValues=Record<Digit,FingerValues>;
export type EngineInfo = {
  ready: boolean; view: string; navigating:boolean; selected: string; position: Vec3; rotation: Vec3;
  pinned: boolean; orientationPinned: boolean; ground: boolean; fullBody:boolean;fixedFeet:number;warning: string;
  hands: { Left: string; Right: string }; boneCount: number; vertexCount: number;
  handDetail:Side|null; fingers:Record<Side,HandValues>; forearmTwist:Record<Side,number>; toes:Record<Side,number>;
  camera?:CameraSettings; framingWarning?:string;
};
