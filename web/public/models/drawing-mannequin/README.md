# 绘画女素体 · 原型

造型未达到预期，已从常用骨架与新增角色列表撤下；保留源文件及已有试验工程的读取兼容。

MomoPoseForge 原创程序化建模原型，参考绘画人偶的通用造型语言：无五官椭圆头、
圆润胸腰胯、连续躯干、分段四肢和球形关节。没有包含参考网站图片、第三方角色网格或贴图。
这不是参考作者的原始模型，也不是对二维线稿的一比一还原。

身高约 1.775 米，66 关节，静止姿态旋转为单位四元数；骨骼位置与体型独立定义，复用
PoseForge 已验证的人体控制拓扑。胸廓、腹部、骨盆、肩颈通过 Blender 体素融合、平滑及拓扑简化，形成一块闭合连通表面，再按骨盆、腰、脊柱、胸腔、上胸及颈部分配连续蒙皮；
膝、肘、髋和肩球体以实际旋转中心建模，避免控制点偏离球心。

支持人体 IK/FK、四肢固定、手势/手指、镜像、动作预设、五视图和人体/通用数据图导出，
以及最多 8 个角色的独立实例。脚底尚未标定平脚/前掌接触，不套用 X Bot 鞋底轮廓；
未开放外部动画导入。头部 OpenPose 点为几何估计，不代表存在眼鼻网格。

当前是线性蒙皮和独立刚性关节球，不包含肌肉、脂肪、布料、碰撞或软体物理模拟；
极端姿势仍可能出现体积损失及部件交叠，需要后续修形。

可重建源：`tools/build-drawing-mannequin.mjs`、`tools/refine-drawing-mannequin.py`。
仓库内的 `assets/source/drawing-mannequin/torso.json.gz` 是 Blender 整理后的原创躯干，
普通资源重建不需要本机安装 Blender：

```text
node tools/build-drawing-mannequin.mjs
```

修改源剖面后可完整重建融合网格：

```text
node tools/build-drawing-mannequin.mjs --blockout
blender --background --factory-startup --disable-autoexec --python tools/refine-drawing-mannequin.py -- artifacts/drawing-blockout.glb assets/source/drawing-mannequin/torso.json.gz artifacts/drawing-female.blend
node tools/build-drawing-mannequin.mjs
```

源脚本控制剖面、比例、球心和权重，输出独立 GLB 与骨架定义；Blender 文件保留蒙皮和骨架。
早期原型的头顶末端标记用 `rigCalibrationVersion: 2` 兼容恢复，不改变原姿态或手脚锚点。
