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
旧 FK 工程保持可读；显式拖动 IK 时才投影该链的肘膝到 IK 弯曲轴。

膝盖校准（`rigCalibrationVersion: 1`）：原文件的 Rigify 膝转轴与实际球形关节中心
相差约 3.24 cm（BodyChan）/ 2.89 cm（BodyKun）。转换时按各自球体网格拟合中心，
移动膝转轴并重建逆绑定矩阵；膝盖球体完整跟随大腿，避免混合权重压扁关节。
原表面中立形状、身高、关节名称、53 关节拓扑和 FK 静止轴保持。
旧姿态载入时只迁移腿部到新转轴，按原脚位、脚朝向和弯曲平面重新匹配；身体、
手指、整体位置和固定目标不变。极限伸直目标若超出新骨段可达范围，保留固定目标，
按新骨长恢复最近姿态并提示残差，不拉伸骨骼。再次保存后使用新校准，重复打开不再迁移。

已适配 15 个常用动作与 12 种手势：动作按本模型的身高、肢体长度和静止框架求解，
手指按自己的指骨名称与静止弯曲轴旋转；支持左右手复制、手势收藏和近景精调。
肘膝朝向滑条保留腕踝位置和朝向，允许在固定末端时使用；完全伸直时需先略弯。
线稿可叠加贴合蒙皮表面的头部十字、躯干中线、肩线和骨盆线，并单独导出透明线层。

支持独立角色草稿/收藏/场景工程，以及素体、线稿、通用骨架/关节、深度和法线
导出。尚未适配自动全身够取、脚底贴地、任意人体动作迁移或人体 OpenPose；
固定的是关节位置，并非脚底与地面接触求解。男女模型属于独立骨架定义，切换
选中实例不会替换其他角色，原 X Bot、Y Bot 与 Fox 的能力保持不变。

Rebuild with Blender 4.4:

```
blender --background --factory-startup --disable-autoexec --python tools/prepare-body-figures.py -- "source.blend" "web/public/models/body-figures"
```
