# 项目开发约束

所有功能设计、实现与验证都需要考虑用户切换骨架；当前提供 X Bot 人体与 Fox 小狐狸，动物控制能力须按实际适配声明。

开始修改前读取并遵守 [.cursor/rules/rig-switching.mdc](.cursor/rules/rig-switching.mdc)。X Bot 保留人体 IK，Fox 支持四爪位置 IK、固定点与 FK 精调；基础测试人形仅用于旧工程兼容。具体能力和验收见 `docs/implementation-v0.1.md`；Fox 尚无自动全身够取和真实脚底接触，不视为通用动物 IK 已完成。

现有 X Bot 工程及已完成的编辑功能需要保持兼容。遵循用户当前任务范围逐步调整，不因该要求自动扩展为动物资产制作或全引擎重写。

布局、外观和多语言基础复用 `@momo/workbench`，源码维护于独立 MomoWorkbench 仓库。新增公共能力优先完善共享包并验证两个消费产品；不直接手改 vendor 包、生成快照或重新复制一份核心实现。骨架、IK、姿态与工程业务语义仍属于 PoseForge。
