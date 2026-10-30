# 小狐狸 Fox

来源：[Khronos glTF Sample Assets / Fox](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/4995a638c96dbc94376d3d6164e70fee3ac7f7a2/Models/Fox)。固定源提交为 `4995a638c96dbc94376d3d6164e70fee3ac7f7a2`。

- 模型：PixelMannen，2014，CC0-1.0。
- 骨骼与动画：tomkranis，2014，CC-BY-4.0。
- glTF 转换：AsoboStudio 与 scurest，2017，CC-BY-4.0。

许可链接：[CC0](https://creativecommons.org/publicdomain/zero/1.0/)、[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)。保留原始许可、元数据与说明文件于同目录。导出 ZIP 附带作者、来源、许可链接及改动说明。

MomoPoseForge 的改动：把模型顶点、节点位移、蒙皮逆绑定矩阵的平移和动画平移统一按 0.01 缩放，作为米制编辑尺寸。加载时为原文件缺失的顶点法线生成法线，供法线图导出使用；保留原拓扑、纹理、材质、静止旋转与动画旋转；源模型的 +Y 向上、+Z 向前保持不变。原始 GLB 位于仓库 `assets/source/fox/Fox.glb`，运行 `node tools/prepare-fox.mjs` 可离线重建，哈希记录于 `source.json` 和 `prepared.json`。

原资产包含 24 个蒙皮关节，编辑器提供其中 22 个身体关节的控制，两个坐标基座不作为摆姿控制点。可旋转四肢、头颈、脊柱和三节尾巴，根部可移动；旋转数值是相对于静止姿态的角度，限位也使用该基准。

四爪支持位置 IK，拖动爪子会带动前腿两段、后腿三段骨骼，在各自关节范围内弯曲；可逐爪或同时固定四爪的位置，并可选择固定朝向。固定后手动移动或旋转根部，腿部会补偿，无法维持固定时限制身体移动。头颈、脊柱、尾巴及各关节仍可用 FK 精调。没有自动全身够取、真实脚底接触、地面约束或人体 OpenPose。

支持五视图、素体图、通用骨架及关节数据、深度、法线和可编辑工程。旧 Fox FK 工程保留原关节姿态，按该姿态派生 IK 目标；新增控制数据以 `ikVersion: 1` 标识。原资产保留 Survey、Walk、Run 三组动画，本轮不提供播放与暂停取姿。


## 围巾外观示例

`fox-scarf.glb` 使用同一 Fox 模型、纹理和骨架，添加 MomoPoseForge 制作的 30 顶点蒙皮围巾几何。原 Fox 作者、来源及许可不变。生成脚本为 `tools/prepare-fox-scarf.mjs`，源与输出 SHA-256 记录于 `scarf.json`。该外观不携带自己的动画，使用活动 Fox 骨架的动画与姿势。
