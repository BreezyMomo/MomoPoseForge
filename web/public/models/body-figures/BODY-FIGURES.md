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

当前适配为 **四肢 IK 与 FK 编辑**：拖动手腕/脚踝，肘膝按各自骨架的弯曲轴
屈伸；手脚可分别固定位置和方向，固定双脚后可移动骨盆，超出可达范围时限制
身体移动以保留固定点。整体摆放会连同固定点搬动角色。身体和手指仍可逐节 FK
旋转，不拉伸骨长。保留原 `momo-bodychan-fk` / `momo-bodykun-fk` 骨架 ID 和资源，
旧 FK 工程的旋转原样恢复；显式拖动 IK 时才投影该链的肘膝到 IK 弯曲轴。

支持独立角色草稿/收藏/场景工程，以及素体、线稿、通用骨架/关节、深度和法线
导出。尚未适配自动全身够取、脚底贴地、手势库、动作预设迁移或人体 OpenPose；
固定的是关节位置，并非脚底与地面接触求解。男女模型属于独立骨架定义，切换
选中实例不会替换其他角色，原 X Bot、Y Bot 与 Fox 的能力保持不变。

Rebuild with Blender 4.4:

```
blender --background --factory-startup --disable-autoexec --python tools/prepare-body-figures.py -- "source.blend" "web/public/models/body-figures"
```
