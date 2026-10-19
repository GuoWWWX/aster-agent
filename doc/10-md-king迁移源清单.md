# md-king 迁移源清单

> 文档状态：UI 外壳与 Markdown 编辑器迁移记录
> 最近同步：2026-10-14（历史批次见各节）
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

### 6.1 对话 Markdown 列表标记

| 源文件 | SHA-256 | 目标路径 | 差异理由 |
| --- | --- | --- | --- |
| `src/lib/style-manager-data.ts` | `B59AC27D58DFF59E835866A411481DC2167B9D4147F11A7B63BF21C73C730C94` | `apps/web/src/components/markdown/agent-markdown.css` | 参考 md-king 默认的一级实心圆点、二级空心圆、三级方块层级，在只读对话渲染中用原生 `list-style-type` 恢复被 Tailwind reset 清除的列表符号；圆点与有序编号继承正文颜色，任务列表继续以复选框作为唯一标记，不迁入模板样式配置。 |

验证：`agent-markdown.test.ts` 加载真实 CSS，断言三级无序列表与有序列表的计算样式。

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

### 7.5 侧边 Markdown 编辑器同步到当前 md-king（2026-09-02）

> 源仓库基线：`main` / `d64bcde`。本次只同步侧边 Markdown 查看与编辑中的可见渲染及直接编辑交互；md-king 的文档标签、Word 导出与 Tauri 宿主状态不属于 Aster 侧边栏视觉合同。

| 源文件 | SHA-256 | 目标路径 | 差异理由 |
| --- | --- | --- | --- |
| `src/index.css` | `6B4035B43C3DD4F5DEB304454EC534E5343633392CC54343A8FAD4C2906EBEBA` | `apps/web/src/components/editor/markdown-editor.css` | 继续由提取脚本机械生成；新增 Mermaid 图题的明暗主题规则。脚本目标改为当前 worktree 根目录，避免同步时误写共享 checkout；产物末尾仅追加列表圆点与编号继承正文颜色的 Aster 约定。 |
| `src/components/editor/cm/live-preview.ts` | `678CB5DF1D2B5BA8D539DB363B52B3DB291AD50E0563BF54D3F7B90005CE8A33` | `apps/web/src/components/editor/cm/live-preview.ts` | 同步 Mermaid 围栏/相邻加粗题注、标题 `{-}`/`{.unnumbered}` 隐藏和题注邻接表格边界；仅保留 ESM 相对路径与严格索引检查差异。 |
| `src/components/editor/cm/widgets.ts` | `7099AE313C85E736F42EAAF3B92D5770A91E915992FEFF46B141BC910F805D25` | `apps/web/src/components/editor/cm/widgets.ts` | 同步 Mermaid 图题和表格阅读/编辑态共用的单元格选择、复制交互；图片解析继续走 Aster resolver，媒体查看继续走 Aster Dialog。 |
| `src/components/editor/cm/markdown-table.ts` | `F252A415E6F87D693BCB443AAEC6347BFC97B57E4B11238391F6D690A170B47B` | `apps/web/src/components/editor/cm/markdown-table.ts` | 同步阅读/编辑共用的表格单元格扩选纯函数；保留本项目更严格的数组越界保护。 |
| `src/lib/mermaid.ts` | `B64ADC869B2525DCB1CEF1888536672FE3C0DDD5DFE44BB590160A28C3A066AE` | `apps/web/src/lib/mermaid.ts` | 同步微软雅黑字体、HTML label、换行宽度、节点与层级间距；保留相对导入和严格索引检查。 |
| `src/lib/mermaid-fence.ts` | `8B30C12FB2E38D9CD809DF329BA89CE2225AFC6DEAB2C972CE3722C04BF1AB84` | `apps/web/src/lib/mermaid-fence.ts` | 只提取实时预览使用的 Mermaid caption 与整行加粗题注解析；不迁入仅服务 Word 转换的图题样式块及前后文本重写函数。 |

样式策略：侧边栏外壳仍使用 Tailwind；`markdown-editor.css` 仅承载 CodeMirror 动态 `mk-cm-*` 类、组合选择器和 md-king 机械迁移规则，属于 CSS 触发条件 1、2、5、6，不新增手写平行样式系统。

## 8. Markdown 更新同步（2026-10-14）

源快照：`D:\Code\Project\AI\md-king`，`726cf666d79a6f8a36ea6c593646ab247706cf7a`（v1.1.13），工作区干净。对比 §7.5 的 `d64bcde` 基线；源仓库只读。本批先合并已有主题/定时任务 PR #38，再从 `develop@ccdfbcb` 创建独立分支 `codex/markdown-upstream-sync`。

### 8.1 范围与行为

- 同步编辑器的公式容错、引用内公式和代码块、光标绘制、受控 HTML 排版、紧贴中文的斜体、短分隔线与公式竖线表格解析、列宽权重、题注和带文字分隔线。
- 同步 Mermaid 的方向容错、节点/子图排版、类图与时序图对比度、SVG 尺寸解析、主题缓存和原位重绘。对话展示也使用此渲染服务，支持查看源码、复制和现有媒体放大查看器。
- 对话中的数学、表格、HTML、强调、标题属性和题注复用共享解析器；Aster 自有的代码复制、终端颜色、文件类型图标和媒体查看入口继续由本项目持有。
- 未迁入 MDKing 的 Tauri、Word/DOCX 导出、窗口外壳、Outline 和调试接口；Aster 的 IPC、文件解析、草稿与保存契约保留。

### 8.2 源文件身份

以下哈希均为源文件 SHA256。`cm/*` 目标位于 `apps/web/src/components/editor/cm/`；`lib/*` 目标位于 `apps/web/src/lib/`。

| 源文件 | SHA256 | 目标与差异 |
| --- | --- | --- |
| `src/components/editor/cm/live-preview.ts` | `45F7FD6A665EA993A1C43C3B03DEC5CC2F9172FB5DE628536DAF4C6B090189A3` | `cm/live-preview.ts`；相对 ESM 导入、严格数组边界与可选属性检查。 |
| `src/components/editor/cm/widgets.ts` | `94B7DBD8BF986EBD1D66F200FE01C9825F852DEBE5865267485065909C2DEEA0` | `cm/widgets.ts`；Aster 图片 resolver、`data-theme`、Widget override、短分隔线显示宽度与显式 KaTeX `trust: false`。 |
| `src/components/editor/cm/markdown-table.ts` | `3F7FA1CAB693D0AE74CE5024B2E6FAD83120D75715593A0B1272F149FE2AD68E` | `cm/markdown-table.ts`；保留分隔线权重、序列化及行列操作；严格边界检查。 |
| `src/components/editor/cm/source-indent.ts` | `4134B09B124AF5F04BBDFBD76684CA04DC05D48549E352070ED171EBBFB62FB3` | `cm/source-indent.ts`；引用内列表前缀；数组访问保护。 |
| `src/components/editor/cm/markdown-language.ts` | `4C2DE817C86DA54CB8CA13CD0C60297ECAEA4FD540EF15D2282295766B9ADAF8` | `cm/markdown-language.ts`；恢复 HTMLTag 语法节点，仍禁用 HTMLBlock/IndentedCode。 |
| `src/components/editor/cm/table-inline-renderer.ts` | `78D15BC1E2A4C0119E64618FD18D787587E7F3197DA0EF8E6B2B50A07E4E2217` | `cm/table-inline-renderer.ts`；类型适配，结构化 DOM，HTML 属性白名单，显式 KaTeX `trust: false`。 |
| `src/components/editor/cm/cursor.ts` | `248868A6D1C2422F764F1D7DDFE33218CBEC8E7114C88AE95FBBC16B6A62A249` | `cm/cursor.ts`；单独绘制光标，保留原生选区。 |
| `src/components/editor/cm/theme.ts` | `8F228BBC8C643B5DD58851552E4C96EFC225CBB1C1D70E51C6AE30A9C6F0E09A` | `apps/web/src/components/editor/markdown-editor-theme.ts`；同步光标、正文色与横向溢出约束，保留 Aster 选区令牌。 |
| `src/components/editor/live-markdown-editor.tsx` | `6884110DCD49C95A117371AB24613D630F93F7918AD6F2575C1DDDFAF638B34A` | 同路径加 `apps/web/`；仅取光标、块公式、原位主题刷新与换文件滚动重置，保留 Aster 保存正文参数、contentRevision、图片导入等宿主契约。 |
| `src/lib/mermaid.ts` | `2BE73A246220BE9705AF1A121BC03BF2D0A3E21C9641BA8125F25688BCD3D503` | `lib/mermaid.ts`；相对导入、严格类型适配，串行化全局配置与异步绘制，保持 `securityLevel: strict`。 |
| `src/lib/markdown-math.ts` | `249CE961BCCEA74908E64D56600723B993AAC2B94B27313C10E3BA5723F1E8E6` | `lib/markdown-math.ts`；共享公式范围和容错，严格边界检查。 |
| `src/lib/markdown-inline-html.ts` | `7D9C28C71F1EE7812F8EB63C82A2D9D0CFCF04A21038275528FFAF14284FE066` | `lib/markdown-inline-html.ts`；白名单语法解析；对话另加安全输出层。 |
| `src/lib/relaxed-emphasis.ts` | `4ED7C8A8ECE1BF2C11B395290375CAD5F777D793E79C52820782C8C7D6F8C0DA` | `lib/relaxed-emphasis.ts`；与已有宽松粗体解析共同使用。 |
| `src/lib/horizontal-rule-text.ts` | `3D056338DAF2BA83D2F29B96E7325F04ACE1F562936F13ADF60BB06C513D75E8` | `lib/horizontal-rule-text.ts`；对话和编辑器共享带文字分隔线语法。 |
| `src/lib/markdown-heading-attributes.ts` | `37084CE1263F5C4EFEDA6AF98C9CDD5F4BC8844AA51053CF647B89D8A9C171B1` | `lib/markdown-heading-attributes.ts`；阅读态隐藏不编号控制标记。 |
| `src/lib/markdown-block-caption.ts` | `9CBB48271219449DCB8CD9116FBDA61DD0A84B03AFB20050C65BA944C8E0FB55` | `lib/markdown-block-caption.ts`；兼容紧邻表格的加粗题注。 |
| `src/lib/markdown-image-caption.ts` | `4F9F44A3CC547F685DBF2EECD3890982FEFE86A2729C11A87374A0FCAD5582AD` | `lib/markdown-image-caption.ts`；相邻图片题注/旧 custom-style Div 提取，严格边界检查。 |
| `src/index.css` | `B1239F9FB5EDB30648D4705ED34BD60D672190C9C79330A4712A2B8D74EEE645` | `apps/web/src/components/editor/markdown-editor.css`；脚本重提取 324 条规则，沿用外壳排除名单和 `.dark` 改写。 |

### 8.3 Aster 接入差异

1. 新增 `lib/markdown-math-plugin.ts` 和 `components/markdown/markdown-rendering-plugins.ts` 接入对话。HTML 仅输出受控标签；脚本/iframe/SVG 源标签按文字显示，过滤事件、样式和危险地址。受控任务复选框使用独立 token，不绕过用户 HTML 过滤。
2. 对话表格继续遵循已有的表头居中、正文左对齐约定。编辑器保留上游对齐和长分隔线列宽权重；一/二横线仅按最小三横线的视觉宽度显示，保存仍保留原分隔线。
3. Mermaid 配置为全局状态；不同消费者的初始化与异步渲染串行执行，同源同主题请求合并，错误不阻断下一张图。切换主题保留两套缓存，并保留旧 SVG 高度直至新图完成。
4. 对话 memo 化 HTML 挂载对象；仅主题变化时不重建原生 details、源码区域和图表容器。编辑器主题只重配颜色/光标，不重建块 StateField、内容、选区和历史。
5. 对话仅将完整闭合的 Mermaid 围栏替换为图表，流式未完成代码继续显示源码。题注只吸收紧邻行，原生 caption 优先；行内/引用内图片不打乱独立图片题注索引。
6. `markdown-token-bridge.css` 为上游固定浅色的键盘标签桥接主题色。`agent-markdown.css` 的新增规则属于 CSS 触发条件 1/2/3；生成编辑器 CSS 仍只由提取脚本修改。
7. 上游六组 lib 测试迁入 Vitest，保留有意义的纯解析用例；引用代码/公式/HTML 行为直接测试实际 CodeMirror 装饰，避免复制实现算法作为测试。Aster 媒体查看器已有滚轮定点缩放、拖动、适应窗口和图库导航，继续复用它。

### 8.4 验证

- 全仓 lint、typecheck、生产 build 通过；生成 CSS 重跑幂等，无外壳选择器泄漏。
- 脚本 6 项、协议 119 项、Desktop 859 项通过；Desktop 默认并发在本机曾出现超时和 Windows 临时目录占用，使用 `--maxWorkers=2` 完整重跑通过。
- Web 104 个测试文件、661 项测试全部通过，覆盖 HTML 过滤、数学、引用代码、短表格、题注、Mermaid 并发、源码复制与编辑器保存/主题/文档切换。
- 实际组件在 1440×900、1024×680 明暗主题检查；页面/编辑器无整体横向溢出，图表源码、放大及缩放交互可用。
- 从本 worktree 根目录 `pnpm dev` 启动 HTTP Renderer；React/CSS 修改经 HMR 生效，Electron 主 PID 保持不变。

### 8.5 Aster 内部分模块（2026-10-19）

Mermaid 的静态字体、主题 CSS 与引擎配置归入 `apps/web/src/lib/mermaid-theme.ts`；`mermaid.ts` 继续拥有动态加载、串行渲染、并发去重和主题缓存。迁出函数体及 CSS 字面量保持一致，仍使用 `securityLevel: strict`，不修改上游源目录或生成的编辑器 CSS。Mermaid、围栏及 CodeMirror 预览原有 14 项回归、Web 类型检查与定向 lint 通过。

CodeMirror Widget 的公式／列表、图表、图片和行内内容分别归入 `text-widgets.ts`、`mermaid-widget.ts`、`image-widget.ts`、`inline-widgets.ts`；共享的 DOM 呈现与 StateEffect 分别归 `widget-dom.ts`、`widget-effects.ts`。原 `widgets.ts` 保留表格 Widget 与兼容导出，原调用方继续引用同一个类和 Effect 实例。27 个声明／函数体保持一致；编辑器和 Markdown 共 19 文件 133 项回归、Web 类型检查与定向 lint 通过。

表格阅读态的 DOM、选区和事件监听归 `table-readonly-view.ts`；返回的 disposer 由原 Widget 在 `destroy` 中执行，`updateDOM` 继续转移原清理归属。表格编辑态、草稿、提交与 CodeMirror 状态仍归原 Widget，主题、DOM 类名和键盘／复制行为不变，原有 133 项回归再次通过。
