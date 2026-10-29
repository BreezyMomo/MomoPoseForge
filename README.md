# MomoPoseForge

在线人体姿势编辑器，使用 Three.js 与用户指定的 Mixamo X Bot 蒙皮人偶，提供 IK/FK、动作预设、五视图与 PNG / OpenPose COCO18 / 工程 JSON 导出。

```powershell
npm install
npm run dev
```

开发预览：<http://127.0.0.1:5173/>。

`npm run build` 生成静态网站到 `dist/`；`npm test` 运行姿态与文件校验测试。

- [产品设计](docs/product-design-v1.md)
- [实现与验证说明](docs/implementation-v0.1.md)
- [人体资产来源](web/public/models/XBOT-ASSET.md)
