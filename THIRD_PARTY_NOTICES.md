# 第三方内容声明

Aster 项目代码按根目录的 [MIT License](./LICENSE) 发布。第三方代码、依赖和品牌标识继续适用各自的许可证或使用条款；本文件记录仓库中直接迁入或保存的内容，不是全部依赖的完整清单。

## md-king 迁入代码

Aster 的 Markdown 编辑器、渲染和相关样式包含从 [md-king](https://github.com/GuoWWWX/md-king) 迁入或改编的代码。来源文件、快照与差异记录在 [md-king 迁移源清单](./doc/10-md-king迁移源清单.md)。

md-king 以 MIT License 发布，版权所有 © 2026 GuoWWWX。其许可证原文保存在 [licenses/md-king-LICENSE.txt](./licenses/md-king-LICENSE.txt)。

## 模型供应商品牌标识

供应商选择器中使用的 Gemini 和 Z.ai 图标分别来自 Google 和 Z.ai 的公开资源，来源地址见[品牌资源说明](./apps/web/src/features/settings/brand-assets/README.md)。其他部分图标来自 `@iconify-icons/simple-icons`。

这些品牌名称和标识属于各自权利人。仓库未附 Gemini 和 Z.ai 标识的单独再分发许可；使用或再分发时应核对权利人的条款。Google 提供[品牌使用指引](https://about.google/brand-resource-center/guidance/)，Simple Icons 也提供[图标和商标说明](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)。Aster 的 MIT 许可证不授予第三方商标权，也不表示这些供应商认可或赞助 Aster。

## 依赖包和构建产物

项目依赖通过 `pnpm-lock.yaml` 锁定，依赖包的许可证和版权信息以其各自随包提供的文件为准。安装依赖后，可分别运行 `pnpm --filter @agent/desktop licenses list --prod`、`pnpm --filter @agent/web licenses list --prod` 和 `pnpm --filter @agent/protocol licenses list --prod` 查看生产依赖的许可证元数据。

部分包的元数据可能不完整。例如，`khroma@2.1.0` 未在其 `package.json` 中声明许可证，但其发布包内包含 MIT 许可证文件。公开分发安装包或其他构建产物前，应核对实际包含的依赖，并随产物保留适用的许可证及版权声明。
