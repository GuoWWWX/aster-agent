# md-king 迁移源清单

> 文档状态：首批 UI 外壳基线  
> 记录时间：2026-08-15  
> 源目录：`D:\Code\Project\AI\md-king`  
> 目标目录：`D:\Code\Project\202608\Agent`

## 1. 基线身份

```text
分支：main
HEAD：eaa5d562dc849b5a2887dc068af8d0df5f947aea
源工作区变更数：62
```

源仓库存在未提交改动。本批次以如下记录时刻的实际文件内容作为视觉参考；不会在源仓库执行编辑、暂存、提交、清理或回退。

## 2. 首批参考文件

| 源文件 | SHA-256 | 本批使用方式 |
| --- | --- | --- |
| `components.json` | `D0ADA54E59710099B766EAE59A1A35D31B717A6EC43D73A8814DE1815DDC1749` | 确认 shadcn/ui `radix-nova`、neutral、CSS Variables 和 Lucide 基线。 |
| `src/components/layout/app-shell.tsx` | `B05AED80D9D3B970692A6E58232622BED8FBB9BA09672E3F3A055DFDE76364D2` | 参考标题栏、活动栏、三栏布局、`5px` 间距和 `8px` 面板圆角。 |
| `src/components/layout/app-titlebar.tsx` | `DD42A7C659EC74F641C94F8100339AB7BAA49C90EE2A81F99A3FD6AFBA33E3A9` | 参考 `36px` 标题栏视觉和窗口控制位置；不迁入 Tauri 调用。 |
| `src/components/layout/activity-bar.tsx` | `7CE66A357F89A91985F599BE8880C5CCA7E1E2F1201A9EE206C9A5F30B658F43` | 参考 `48px` 图标活动栏的密度、选中和悬浮状态。 |
| `src/components/ui/button.tsx` | `586F5A8C5895922D62C5326B7C9D7456281B4B6450BA3B3705CA81B9D0A41576` | 参考 `CVA`、`cn`、`data-slot` 和可访问按钮约定。 |
| `src/index.css` | `6FED7CD74AAC264BC30C37A1BEA779370784F3976AFBE86D215E85FC1A9F0F70` | 仅提取必要的语义 Token、字体和壳层视觉；不复制整个文件。 |

## 3. 迁移边界

- `apps/web` 按视觉与交互合同重新实现 AppShell，不复制旧页面业务状态。
- React 组件只能调用 `AgentClient`，不能导入 Tauri、Electron、Node 或 SQLite。
- Electron 窗口能力只能经过 Preload 和集中 IPC 协议提供。
- CodeMirror、Markdown 渲染、Word 预览、DOCX 转换和 Tauri 页面不属于本批次。

## 4. 变更追踪

后续实际复用或移植的每个源文件，必须继续在本表中补充目标路径、差异理由和验证结果。哈希变更时应新增记录，不覆盖本批基线。

## 5. MCP 配置编辑器迁移

| 源文件 | SHA-256 | 目标与差异 |
| --- | --- | --- |
| `src/components/editor/live-markdown-editor.tsx` | `CE903D43FC70B944543A7367B3CDF6F136D0E31497ABAFB6F8E7AAE5B37B7DA3` | 提取 EditorView 单实例、外部内容同步和编辑回调模式到 `apps/web/src/components/editor/document-code-editor.tsx`。未迁入 Mermaid、图片、表格和 Tauri 调用。 |
| `src/components/editor/cm/theme.ts` | `9B187BD5889EDD13A7DAFB680AC3CE212823BD33FD9CD715DA90474D30912DFD` | 提取 CodeMirror 浅色/深色主题与语法高亮思路到 `apps/web/src/components/editor/document-code-editor-theme.ts`，颜色改用 Agent 的 `--app-*` 语义 Token。 |
| `src/components/editor/document-outline-tree.tsx` | `3722287A9B39361B90C2A83329B808CC746E77B4C4C9038C591DBC3B476C2460` | 参考可折叠层级树交互，在 `apps/web/src/features/settings/settings-workspace.tsx` 中实现当前单个 MCP 的 JSON 层级视图；不迁入文档标题解析和滚动同步。 |

本批迁移同时为 MCP 整组 JSON 和单项 JSON 提供 CodeMirror 编辑器。单项编辑只回填当前表单，仍由原有“保存配置”动作负责持久化。

## 6. Skill Markdown 管理

- Skill 内容以实际 `Skill目录/SKILL.md` 为唯一真源，集成 JSON 仅保留启用状态、作用域、入口路径和 MCP 依赖索引。
- `SKILL.md` 使用 YAML frontmatter 的 `name`、`description` 和 Markdown 指令正文；页面不再暴露整组 Skill JSON 编辑。
- `apps/web/src/components/editor/document-code-editor.tsx` 复用本清单第 5 节记录的 MD King CodeMirror 最小内核，提供 Markdown 编辑、主题热切换和快捷保存。
- `apps/web/src/components/markdown/agent-markdown.tsx` 提供只读预览；不迁入 MD King 的 Mermaid、图片、表格和 Tauri 闭包。
