# Fox 原始模型

`Fox.glb` 是 Khronos glTF Sample Assets 固定提交 `4995a638c96dbc94376d3d6164e70fee3ac7f7a2` 的原始文件，未修改。

来源、文件哈希和许可元数据保留于 `web/public/models/fox/source.json`、`SOURCE-metadata.json`、`SOURCE-LICENSE.md` 和 `SOURCE-README.md`。模型为 PixelMannen 的 CC0 作品；tomkranis 的骨骼/动画与 AsoboStudio、scurest 的 glTF 转换为 CC-BY-4.0。

在仓库根目录运行 `node tools/prepare-fox.mjs`，从此文件生成供编辑器使用的米制 GLB、骨架 profile 和转换哈希记录。加载时会为原模型缺失的顶点法线生成法线数据，以支持法线图导出；原始模型不受影响。
