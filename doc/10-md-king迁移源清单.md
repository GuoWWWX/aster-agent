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

## 7. Markdown 实时预览编辑器迁移

> 记录时间：2026-08-22
> 源仓库基线：`main` / `90aee0873bdd54653247f53b418d1ce97a967df1`，源工作区变更数 5
> 第一阶段完成样式、主题和纯函数；第二阶段完成 CodeMirror 实时预览引擎、媒体查看器、宿主组件及右侧栏文件编辑保存。

| 源文件 | SHA-256 | 目标路径 | 差异理由 |
| --- | --- | --- | --- |
| `src/index.css` | `A904F1FDE630ABB231E38F775BA56069B4F9C660E0198E1EC6A5885DEEFDD6D6` | `apps/web/src/components/editor/markdown-editor.css` | 由 `scripts/extract-md-king-editor-css.mjs` 机械提取 231 条编辑器规则，非全文复制。唯一改写：`.dark` → `[data-theme="dark"]`，因为两个项目主题挂载方式不同。脚本带排除名单，阻止 `[data-slot=`、`.mk-app-window` 等外壳规则进入本项目 |
| `src/components/editor/cm/theme.ts` | `90B5E92774F9C52166CF346D29FD2EB7A25DF54038BE04F76252A44ABD8CE34B` | `apps/web/src/components/editor/markdown-editor-theme.ts` | 逐字复制，仅改 import 路径为相对路径 |
| `src/lib/syntax-palette.ts` | `BB21B48E54905B17BBAD8BB5CB2159A9082D23A184ED41D3A1EAD4CA979226D3` | `apps/web/src/lib/syntax-palette.ts` | 逐字复制，无差异 |
| `src/lib/markdown-callout.ts` | `399893EFDFCD6697D50F924F0B2D2B40C44FEF777959F4B44DE665F285BF6E19` | `apps/web/src/lib/markdown-callout.ts` | 逐字复制，`parseMarkdownCalloutHeader` 中 `match[1]`/`match[2]` 改为带默认值解构。本项目开启了更严格的索引访问检查；两者都是必选捕获组，运行时语义不变 |
| `src/components/markdown-callout-icon.tsx` | `CC97C7A659D7415CA6C7D30AFA4066035EA40BD2CA2190015A5BE58EE1F79E58` | `apps/web/src/components/markdown/markdown-callout-icon.tsx` | 逐字复制，`<Icon />` 改为 `createElement`。本项目 ESLint 的 React Compiler 规则把"查表结果赋给大写变量再当 JSX 标签"判定为在 render 中创建组件 |

新增文件（无对应源文件）：

| 目标路径 | 用途 |
| --- | --- |
| `apps/web/src/components/editor/markdown-token-bridge.css` | 令牌桥接层。md-king 引用 shadcn 语义变量（`--foreground`/`--primary`/`--border`...），本项目令牌是 `--app-*`。在 `.mk-cm-host` 上补齐前者并指向后者，使提取的 CSS 保持与源文件逐字一致 |
| `scripts/extract-md-king-editor-css.mjs` | 可重跑提取脚本。源项目更新后重跑同步，不手工补丁 |
| `scripts/analyze-editor-css.mjs` | 分析提取产物中各类规则占比，用于验证"必须 CSS"的判断 |

### 7.1 样式方案取舍

按[界面迁移与设计系统规范 §12](./07-界面迁移与设计系统规范.md#12-css-治理)的 Tailwind 优先判据核对，231 条规则的分布：

| 分类 | 条数 | 占比 |
| --- | ---: | ---: |
| 组合/伪类/属性选择器（判据 2） | 121 | 54% |
| 运行时动态拼接类名（判据 1） | 45 | 20% |
| 定义 CSS 变量供后代级联（判据 3） | 20 | 9% |
| `@keyframes`（判据 4） | 2 | 1% |
| **小计：必须 CSS** | **188** | **83%** |
| 可用 Tailwind 表达 | 38 | 17% |

判据 1 是决定性的：`cm/*.ts` 中有 16 处模板字符串拼接类名（`` `mk-cm-h${level}` ``、`` `mk-cm-source-indent-${level}` ``、`` `mk-cm-callout-line--${tone}` ``），Tailwind JIT 无法静态扫描，改用 Tailwind 需 safelist 穷举 6 级标题 × 6 级缩进 × 7 种 tone × 首尾/折叠状态的全部组合。

剩余 17% 主要是 CodeMirror Widget 在 `toDOM()` 中用 `document.createElement` 构建的 DOM（`.mk-cm-image-*`、`.mk-cm-table-*`、`.mk-cm-mermaid-*`），按判据 1 同等处理。真正可迁往 Tailwind 的是 `.mk-cm-host` 等容器类，在下一阶段迁移组件时于 JSX 内处理。

不加祖先选择器限定作用域：会抬高特异性并改变与 CodeMirror 注入样式的覆盖关系，破坏迁移要保住的视觉一致性。`mk-cm-` 前缀即命名空间。

64 处 `!important` 主体是 `padding-left/right` 覆盖 CodeMirror 注入的 `.cm-line` 内联 padding，属于框架对抗而非样式补丁。

### 7.2 验证结果

- `pnpm --filter @agent/web typecheck` 通过。
- `pnpm --filter @agent/web lint` 为既有基线 3 error、2 warning（位于 `settings-workspace.tsx` 和 `configuration-workspace-tree-panel.tsx`），本批未新增。
- 生成 CSS 括号配平校验通过，无 `[data-slot=` 等全局副作用规则。
- 第一阶段本身不产生可见变化；可见实时预览由 §7.4 的引擎和宿主接入提供。

### 7.3 提取脚本修复（2026-08-21）

首次提取遗漏了 `mk-table-` 族（表格拖拽把手、上下文菜单、工具栏、宽度模式按钮等表格可视化编辑控件）：源文件 69 处，只提取到 7 处，因为 `SELECTOR_PATTERN` 未包含该前缀。

修复：在 `SELECTOR_PATTERN` 加入 `mk-table-`，重跑后 69/69 全覆盖。`SHELL_SELECTOR_PATTERN` 排除名单无需变化——`mk-table-*` 选择器不与外壳选择器共享同一条规则。重跑后 typecheck 通过，无全局副作用规则，括号配平。

### 7.4 第二阶段：实时预览引擎与右侧栏接入（2026-08-21）

以下源文件按迁移时源工作区内容记录 SHA-256；目标文件只改写 ESM 相对导入、宿主 IPC 适配和本项目令牌，不改变 Markdown 语义：

| 源文件 | SHA-256 | 目标路径 | 差异理由 |
| --- | --- | --- | --- |
| `src/components/editor/live-markdown-editor.tsx` | `76992F498A42F75DF78B042A14FC1BDBFD42C7D981C8260357C21E31DC182435` | `apps/web/src/components/editor/live-markdown-editor.tsx` | 移除 Tauri 重命名宿主的必需依赖；改相对 ESM 导入；保留文档键、只读热切换、Ctrl+S、表格/Mermaid/图片扩展。 |
| `src/components/editor/cm/live-preview.ts` | `57B7BB236F4CA36046ACEFFAFDAECE691E6A3BD938630A2BE9175718DF5382B0` | `apps/web/src/components/editor/cm/live-preview.ts` | 仅改导入路径；图片解析通过可替换 resolver，项目 IPC 由 React 宿主注入。 |
| `src/components/editor/cm/widgets.ts` | `91AC4A8383CC4BDAA133ECFD83620A9E4BA7997CFCA88C94643ACFFA76E99CC5` | `apps/web/src/components/editor/cm/widgets.ts` | 图片源从 Tauri invoke 改为模块级 resolver；其余 Widget DOM/CSS 合同保持不变。 |
| `src/components/editor/cm/link-interactions.ts` | `7A99BF2951E57E6945B41BC50CEBC04B28DB3C9F992FA4FC9599FAD8A3DDC6CA` | `apps/web/src/components/editor/cm/link-interactions.ts` | 相对 ESM 导入。 |
| `src/components/editor/cm/formatting-keymap.ts` | `0B87EFF61853ABBC0DA64BDA6E75A671106564F6FAF208A19E26B9D16D91EE63` | `apps/web/src/components/editor/cm/formatting-keymap.ts` | 相对 ESM 导入。 |
| `src/components/editor/cm/document-title.ts` | `4A717CBE95CDA48A02027FB48DF44F52DABE3475FDAF299E14DADADC9C4B2BA8` | `apps/web/src/components/editor/cm/document-title.ts` | 保留可选能力；本项目不接未实现的文件重命名回调。 |
| `src/components/editor/table-width-mode-icon.tsx` | `AEF370054DB2DD3126D452F985E6BB5A5537AE966E56CCFE947CA8CF08E31AB7` | `apps/web/src/components/editor/table-width-mode-icon.tsx` | 相对 ESM 导入。 |
| `src/components/media/image-viewer.tsx` | `3A3E1BDE727DE0DDD938081112324630FCDA7557B9138237B0319C475671FFF1` | `apps/web/src/components/media/image-viewer.tsx` | `radix-ui` 整包改为 `@radix-ui/react-dialog`；通过项目 Dialog 和 data URL IPC 显示图片。 |
| `src/lib/mermaid.ts` | `F8DB14FC9221E56EA5758B3BA4401877C614A62577EC3B55F43C538F622E7BF9` | `apps/web/src/lib/mermaid.ts` | 保留动态 import，生产构建生成独立 Mermaid chunk。 |

新增宿主适配：`image-source-resolver.ts`、`components/ui/dialog.tsx`、`FilePreview` 保存队列和 `right-sidebar-workspace` 分流。项目文件写入使用 `ProjectToolRegistry` 同一操作锁及 `expectedContent`，截断文件保持只读；锁冲突与外部变更冲突分别呈现。实时编辑器在 Ctrl+S、切换和关闭标签时都以当前正文 flush，外部重载不会覆盖同标签草稿；重复点击已打开文件不会重新读取覆盖草稿。

新增引擎回归：`apps/web/src/components/editor/cm/live-preview.test.ts` 使用逐文件 `jsdom` 环境和真实 `EditorView`，断言标题、Callout、表格、Mermaid 与 frontmatter 块级/行级装饰。

验证：Web typecheck/lint/test（30/139）、Desktop typecheck/lint/test（40/308）、Protocol test（5/38）和生产 build 通过；Vite 产物包含独立 Mermaid chunk。Electron/浏览器手工视觉验收尚未完成：Browser 插件初始化报“系统找不到指定的路径”。
