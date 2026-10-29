# MomoPoseForge

在线人体姿势编辑器，使用 Three.js 与用户指定的 Mixamo X Bot 蒙皮人偶，提供 IK/FK、动作预设、五视图与 PNG / OpenPose COCO18 / 工程 JSON 导出。

```powershell
npm install
npm run dev
```

开发预览：<http://127.0.0.1:5173/>。

镜头导航：在三维视口按住右键，鼠标转向、WASD 移动，Shift 加速；松开右键退出，F 聚焦人物。

摆姿联动：在右侧开启“全身联动”，点击“固定双脚”，再拖动骨盆或胸腔。较远的手脚目标可以带动肩、躯干和骨盆，固定点及关节限位优先；关闭联动可独立调整四肢。手部近景支持双手共 30 节指骨精调。

`npm run build` 生成静态网站到 `dist/`；`npm test` 运行姿态与文件校验测试。

- [产品设计](docs/product-design-v1.md)
- [实现与验证说明](docs/implementation-v0.1.md)
- [同类工具与控制器参考](docs/reference-tools-and-controls.md)
- [人体资产来源](web/public/models/XBOT-ASSET.md)
