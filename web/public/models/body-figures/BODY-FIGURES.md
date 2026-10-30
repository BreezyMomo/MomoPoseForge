# BodyChan / BodyKun drawing figures

- Creator: **vinchau**.
- Source: https://blendswap.com/blend/23521 — “BodyChan - BodyKun | Posable Drawing Figures”.
- Source page license declaration: **CC0** — https://creativecommons.org/publicdomain/zero/1.0/ .
- Source supplied by the user: `BodyChan - BodyKun  Posable Drawing Figures.blend`.
- Source SHA-256 is recorded in each `*-profile.json`.

The original `.blend` is not modified or included here. `tools/prepare-body-figures.py`
opens it with automatic script execution disabled and exports two independent assets.
Only each figure's surface and its converted 53-joint FK skeleton are included;
source scenes, widgets, cameras, lights, embedded scripts, drivers, Rigify control
rigs and animation are excluded. Rigify bendy subdivisions, palm helpers and pelvis
helpers are consolidated into anatomical deformation joints; weights are normalized
and limited to four influences. Source surface proportions are retained, with
heights normalized to 1.68 m / 1.78 m, soles at Y=0, and a plain clay material.

当前适配为 **FK 预览与编辑**：整体摆放、骨盆移动、身体与手指逐节旋转、
独立角色草稿/收藏/场景工程，以及素体、线稿、通用骨架/关节、深度和法线导出。
尚未适配 X Bot 的全身 IK、手脚固定、脚底支撑、手势库、动作预设迁移或
人体 OpenPose；这些功能不会以已完成状态显示。男女模型属于独立骨架定义，
切换选中实例不会替换其他角色，原 X Bot 与 Fox 的能力保持不变。

Rebuild with Blender 4.4:

```
blender --background --factory-startup --disable-autoexec --python tools/prepare-body-figures.py -- "source.blend" "web/public/models/body-figures"
```
