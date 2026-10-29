# Mixamo X Bot

当前角色是 Adobe Mixamo 的 X Bot，与用户指定的红色分段人偶一致。

## 来源

- 角色创作者与服务：[Adobe Mixamo](https://www.mixamo.com/)
- 原始 GLB：Three.js 官方 r180 示例中的 [Xbot.glb](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/Xbot.glb)
- 对应示例：[Three.js additive animation blending](https://threejs.org/examples/webgl_animation_skinning_additive_blending.html)
- 原始文件 SHA-256：`002f8d269de68e5dce3d25195caf390d1aa359bbfaae3fcf4c8dc78ec36c3ba5`
- 使用说明：[Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)

X Bot 资产使用 Adobe Mixamo 的相应条款，不使用 MakeHuman 资产的 CC0 声明，也不因 Three.js 程序代码的许可而改变角色资产的许可。

## 编辑器适配

保留原始角色的两组网格、蒙皮权重、红色外壳和深色关节材质。移除示例动画，把厘米单位和 Armature 缩放烘焙为米制坐标，统一为高 1.7 米、Y 向上、初始面向 +Z、脚底 Y=0。

骨骼整理为 68 根，包括原有手指末端和眼部参考点。将 Mixamo 的 `Spine2` 映射为 `Chest`，添加不改变绑定外形的 `UpperChest` 控制层；手脚保留直接双骨链。旋转轴规范化为单位初始旋转，逆绑定矩阵重新计算。

生成脚本：`node web/scripts/prepare-xbot.mjs`。

验证脚本：`node web/scripts/prepare-xbot.validate.mjs`。检查实际 GLTFLoader 加载、初始蒙皮误差、网格与骨骼数量、原始材质及手臂旋转后的真实变形。

网站导出姿态参考 PNG、关节点 JSON 与编辑器工程，不提供原始 X Bot 模型或动画作为导出内容。旧 MakeHuman 资产及其来源说明保留在仓库中，当前工作台不再使用。
