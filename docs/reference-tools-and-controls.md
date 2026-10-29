# 同类工具与控制器参考

更新日期：2026 年 10 月 29 日。当前目标是稳定的在线人体摆姿、五视图与 AI 控制图导出，首版不接入 AI 推理。先借鉴交互和关节约束，再独立评估全身 IK，不直接替换整个编辑器。

## 参考工具

### PoseMy.Art

[官网功能](https://posemy.art/features/) · [工作台](https://posemy.art/app/) · [完整操作指南](https://posemy.art/blog/ultimate-posemyart-toolkit/)

提供 IK/FK、姿势和手势库、相机保存，以及普通图片、OpenPose、Depth、Normal、Canny 导出。已实际打开工作台并核对导出面板。优先参考从预设微调到出图的流程、关节旋转与末端移动的区分，以及输出面板的组织。

### JustSketchMe

[官方操作文档](https://justsketch.me/docs/)

将关节旋转与末端 IK 移动明确分开，可沿单轴或平面移动。优先参考模式命名、当前操作反馈和相机导航的分工，避免“想移动却旋转”的操作歧义。

### SetPose

[在线工作台](https://setpose.com/)

有 IK、人体约束开关、姿势和手势预设、相机与出图控制。后续参考轻量的弯曲、侧倾、转动操作入口。其约束实现尚未审查。

### Posegeni

[官网](https://posegeni.com/) · [工作台](https://posegeni.com/studio)

工作台提供人体角度约束、平衡、地面接触、手指控制、正交相机、多方向预设，以及 OpenPose、深度、法线、边缘图和 ZIP 导出。后续参考约束状态的展示、手部精调与多视角输出；本轮没有验证其求解器或拖动稳定性。

### Fullbody Pose Maker

[源码](https://github.com/neka-nat/fullbody-pose-maker) · [在线演示](https://fullbody-pose-maker.vercel.app/) · [求解器](https://github.com/neka-nat/fullbody-pose-maker/blob/main/lib/ik.ts)

与本项目同样使用 Mixamo X Bot / Y Bot、Three.js 与 TypeScript，代码采用 MIT 许可。已打开演示并审查源码版本 f687e407faaa5b8734d8a9ba89f5ec72517d2878。求解器通过数值 Jacobian 转置处理多个位置和方向目标，包含骨盆平移和简化重心修正；它限制的是每次迭代的旋转步长，没有完整的各关节摆动锥、扭转范围及肘膝单向铰链限制。

作为后续全身 IK 对照实现，不直接作为稳定性已验证的底座。评估前须固定模型、初始姿势、目标轨迹及约束组合，比较目标误差、角度越界、跳变、固定点漂移和耗时。

### Poseify

[源码与资产说明](https://github.com/iamtyroon/poseify)

README 列出 IK/FK、关节固定、独立手势、相机保存，以及 OpenPose、深度、法线等导出。可进一步参考标准骨骼定义、编辑状态和导出结构。代码的 MIT 许可不覆盖安装时下载的 PoseMy.Art 模型；仓库明确要求发布时移除这些模型或换成有权分发的资产。本项目继续使用既有 X Bot，不引入其模型包。本轮未实际运行该项目。

### 3D OpenPose Editor

[原项目](https://github.com/ZhUyU1997/open-pose-editor) · [ComfyUI IK 版本](https://github.com/Havlight/ComfyUI-3D-OpenPose-Editor2026_IK)

原项目面向 AI 图像工作流，提供关节和手部编辑、深度/法线/边缘图及工程保存。ComfyUI 版本补充四肢双骨 IK、肘膝方向控制、FK/IK 模式，以及相机与模型导航的区分。后续参考数据格式、相机状态和工作流对接，不能把四肢 IK 当成完整全身 IK。

### 原始参考与后续扩展

[AI Pose Gallery 中文版](https://github.com/anhao/ai-pose-gallery-zh) 用于分类检索和多角度展示参考；[UniMate](https://github.com/Friedrich-M/UniMate) 用于以后跨骨骼动作生成和动物扩展。首版不引入 UniMate 模型、权重或数据。

## 逐项参考顺序

1. 当前阶段：参考 PoseMy.Art 和 JustSketchMe 的控制分工，修复模式继承、相机与摆姿冲突及脊柱累积扭转。
2. 下一阶段：对照 Fullbody Pose Maker 验证多目标联动。只有在关节范围、固定点、连续拖动与性能通过独立评估后，才决定是否接入新的全身求解器。
3. 随后：对照 SetPose、Posegeni 改进人体控制和手部精调；对照 Poseify 和 3D OpenPose Editor 改进导出及下游数据兼容。
4. 后续扩展：评估动物骨骼与 UniMate；继续保持无 AI 推理的手动摆姿流程可独立使用。

## 本轮控制器修正

旧实现可复现两项问题：连续移动胸腔时腰部轴向扭转超过 43°；从头部切换到手脚后仍停留在旋转模式。它们已加入实际 PoseEngine 控制路径的回归用例。

- 移动和旋转在工具栏显示文字。选中手脚、骨盆、胸腔和肘膝时默认移动；选中其他关节时默认旋转，仍可主动切换。
- 左键用于选择和摆姿，右键旋转相机，中键平移，滚轮缩放；关闭相机惯性，避免控制点拖动时视角继续漂移。
- 脊柱与头颈使用静止姿态相对的摆动锥和轴向扭转限位。默认值是保守的编辑范围，不代表经过临床验证的人体活动范围。
- 胸腔位置求解保留当前局部扭转，只调整弯曲；一次拖动始终以按下鼠标时的姿态为基准，绕行后回到同一目标不累积额外旋转。
- 不可达目标保留骨长并提示边界；松开鼠标后操纵器回到实际关节位置。主动聚焦才改变编辑视口构图，导出仍独立计算统一的五视图范围。
- 角度输入、预设和旧工程恢复执行相同的脊柱/头颈约束；原始工程文件不被修改。

验收覆盖可达胸腔目标、连续拖动、路径一致性、已有转身角保持、固定脚下的骨盆移动、角度输入及旧工程恢复。仍未提供完整全身 IK、全身碰撞或物理平衡求解。

本轮 45 项自动测试通过，浏览器已检查胸腔边界拖动、模式切换、限位反馈、撤销与重做；五视图导出也已通过独立关节点重投影检查。尚未开展求解耗时和帧率测量，Fullbody Pose Maker 的独立对照评估是下一阶段。
