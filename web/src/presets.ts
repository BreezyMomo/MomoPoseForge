import type { Preset } from './types';
// Coordinates are metres, referenced to model ground. Left uses the rig's own side sign.
export const PRESETS: Preset[] = [
  { id: 'neutral', name: '中立站姿', category: '基础', description: '从自然站姿开始' },
  { id: 't-pose', name: 'T 姿态', category: '基础', description: '双臂水平展开', hands: { LeftHand: [.63, 1.37, .015], RightHand: [-.63, 1.37, .015] } },
  { id: 'a-pose', name: 'A 姿态', category: '基础', description: '双臂自然展开', hands: { LeftHand: [.48, 1.04, 0], RightHand: [-.48, 1.04, 0] } },
  { id: 'weight', name: '重心偏移', category: '站姿', description: '放松的单侧重心', drop: .04, twist: -.08, hands: { LeftHand: [.23, .82, .04], RightHand: [-.32, .86, .08] }, feet: { LeftFoot: [.11, .10, 0], RightFoot: [-.26, .10, .07] } },
  { id: 'hip', name: '单手叉腰', category: '站姿', description: '腰侧手位与外展手肘', hands: { LeftHand: [.22, 1.02, .015] }, poles: { LeftHand: [.65, 1.1, -.13] } },
  { id: 'cross', name: '抱臂', category: '站姿', description: '交叠的前臂', hands: { LeftHand: [-.19, 1.29, .20], RightHand: [.19, 1.25, .27] }, poles: { LeftHand: [.42, 1.05, .16], RightHand: [-.42, 1.02, .20] } },
  { id: 'sit', name: '正坐', category: '坐姿', description: '双膝向前的坐姿', drop: .44, lean: .05, hands: { LeftHand: [.19, .70, .35], RightHand: [-.19, .70, .35] }, feet: { LeftFoot: [.13, .10, .43], RightFoot: [-.13, .10, .43] } },
  { id: 'sit-lean', name: '前倾坐', category: '坐姿', description: '身体前倾，双手搭膝', drop: .44, lean: .37, hands: { LeftHand: [.21, .65, .40], RightHand: [-.21, .65, .40] }, feet: { LeftFoot: [.19, .10, .42], RightFoot: [-.19, .10, .42] } },
  { id: 'cross-sit', name: '盘腿坐', category: '坐姿', description: '低重心与交叠双腿', drop: .72, lean: .06, ground: false, hands: { LeftHand: [.29, .40, .22], RightHand: [-.29, .40, .22] }, feet: { LeftFoot: [-.12, .12, .30], RightFoot: [.12, .15, .36] }, poles: { LeftFoot: [.7, .18, .18], RightFoot: [-.7, .18, .18] } },
  { id: 'squat', name: '深蹲', category: '蹲跪', description: '双脚着地，骨盆下沉', drop: .56, lean: .38, hands: { LeftHand: [.23, .70, .58], RightHand: [-.23, .70, .58] }, feet: { LeftFoot: [.22, .10, .14], RightFoot: [-.22, .10, .14] } },
  { id: 'kneel', name: '单膝跪', category: '蹲跪', description: '前后脚的非对称姿态', drop: .41, lean: .12, feet: { LeftFoot: [.12, .10, .43], RightFoot: [-.14, .10, -.40] }, poles: { RightFoot: [-.16, .20, .36] }, hands: { LeftHand: [.20, .70, .35], RightHand: [-.24, .51, -.02] } },
  { id: 'both-kneel', name: '双膝跪', category: '蹲跪', description: '低重心的双膝姿态', drop: .58, feet: { LeftFoot: [.12, .10, -.34], RightFoot: [-.12, .10, -.34] }, hands: { LeftHand: [.19, .47, .12], RightHand: [-.19, .47, .12] } },
  { id: 'walk', name: '行走定格', category: '动态', description: '迈步与自然摆臂', drop: .05, twist: -.08, feet: { LeftFoot: [.12, .10, .34], RightFoot: [-.12, .13, -.32] }, hands: { LeftHand: [.22, .88, -.20], RightHand: [-.22, .95, .30] } },
  { id: 'run', name: '跑步定格', category: '动态', description: '前倾躯干与屈膝摆臂', drop: .10, lean: .25, ground: false, feet: { LeftFoot: [.15, .45, .40], RightFoot: [-.15, .40, -.35] }, hands: { LeftHand: [.23, 1.30, .34], RightHand: [-.25, .96, -.27] }, handShape: '握拳' },
  { id: 'lunge', name: '弓步', category: '动态', description: '拉开的前后步幅', drop: .30, lean: .12, feet: { LeftFoot: [.13, .10, .56], RightFoot: [-.14, .10, -.46] }, hands: { LeftHand: [.25, 1.15, .48], RightHand: [-.33, 1.01, -.20] } },
  { id: 'wave', name: '挥手', category: '表达', description: '抬手，掌心向前', hands: { LeftHand: [.39, 1.74, .08] }, poles: { LeftHand: [.68, 1.38, .15] }, head: -.1 },
  { id: 'raise', name: '双手上举', category: '表达', description: '手臂向上伸展', hands: { LeftHand: [.25, 1.80, 0], RightHand: [-.25, 1.80, 0] }, poles: { LeftHand: [.60, 1.6, .1], RightHand: [-.60, 1.6, .1] } },
  { id: 'turn', name: '侧身回头', category: '表达', description: '躯干和头部的反向转动', twist: .65, head: -.85, hands: { LeftHand: [.23, .83, .12], RightHand: [-.25, .83, -.12] } },
];
