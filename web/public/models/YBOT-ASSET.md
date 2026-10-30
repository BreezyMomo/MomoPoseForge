# Mixamo Y Bot

- Character creator/service: [Adobe Mixamo](https://www.mixamo.com/).
- glTF conversion source: [MULUALEM-TEKLE/IK-test](https://github.com/MULUALEM-TEKLE/IK-test/tree/404fe4a8791d1f8847cc92ef913685014dc52047/public), pinned commit `404fe4a8791d1f8847cc92ef913685014dc52047`.
- Original asset: [public/ybot.glb](https://raw.githubusercontent.com/MULUALEM-TEKLE/IK-test/404fe4a8791d1f8847cc92ef913685014dc52047/public/ybot.glb).
- Original SHA-256: `abfc9c5186f87459307881037f29208c92427c2bcb42239ac5fcae84d4083894`.
- Asset usage reference: [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html).

The character remains subject to Adobe Mixamo terms. It is not a CC0 asset and
does not inherit the license of any source repository's program code.

## 编辑器适配

保留 Y Bot 原始 Alpha_Surface / Alpha_Joints、两组材质及完整手指权重，
按自身比例规范为 1.8 米、脚底 Y=0、+Z 朝前。统一 Mixamo 关节命名和
单位初始旋转，添加 UpperChest 控制层，共 66 根骨骼，使用自己的静止姿态
及骨段长度。没有将模型拉伸到 X Bot 的比例，也没有从其他角色复制姿势。

支持现有人体策略的手脚 IK、固定点、全身联动、镜像、手指与脚趾精调、
手势、动作预设、Mixamo 动画导入、线稿和多人导出。它是独立骨架定义，
切换只作用于选中实例，其他角色保留；自身草稿单独恢复。

尚未标定 Y Bot 的平脚/前掌脚底支撑，故不显示该面板，不能复用 X Bot 的
鞋底包络。原有自由脚最低高度限制与手脚固定仍然可用。源文件不含眼骨，
OpenPose 面部参考点使用头部的几何估计，不代表人脸识别或精准面部标定。

转换：`node web/scripts/prepare-ybot.mjs`。与 X Bot 共用
`prepare-mixamo.mjs`，下载源按提交和 SHA-256 固定。导出姿势图和工程不提供
原始模型或源动画下载。
