# md-king 迁移与开发计划

> 文档状态：开工基线  
> 更新时间：2026-08-15  
> 源项目：`D:\Code\Project\AI\md-king`  
> 目标项目：`D:\Code\Project\202608\Agent`

## 1. 目标

在不破坏原 `md-king` 项目的前提下，将其已经完成的 React UI、Markdown 编辑器和预览能力迁入 Agent 的 `apps/web`，再逐步接入 Electron、本地工具、会话存储和 Agent Runtime。

迁移不是一次性复制整个仓库，也不直接在 `md-king` 上改造成 Agent。每个阶段都必须保持目标项目可构建、可运行和可验证。

## 2. 当前环境基线

本机实测工具链：

```text
Node.js  v24.14.1
pnpm     10.15.1
Git      2.47.1.windows.2
Rust     1.97.0
Cargo    1.97.0
```

第一阶段要求：

- 根 `package.json` 使用 `packageManager` 固定 pnpm 版本。
- 使用 `.nvmrc` 或 `.node-version` 固定 Node 24 主版本。
- 所有实际依赖版本进入 `pnpm-lock.yaml`，文档不使用“最新版”代替锁文件。
- Rust 只用于未来可能保留的 DOCX sidecar，不是默认构建前置条件。

## 3. md-king 前端基线

迁移初期保持源项目主要前端版本，避免迁移与升级同时发生：

```text
React 19.1
Vite 7.0
TypeScript 5.8
Tailwind CSS 4.3
Zustand 5.0
CodeMirror 6
markdown-it 14
Mermaid 11
shadcn/ui `radix-nova` / Radix UI
Lucide React
```

源项目当前约包含：

```text
72 个 TypeScript 文件
55 个 TSX 文件
20 个测试文件
2 个 CSS 文件
```

这些数字只用于迁移规模估计，不是要求全部复制。

## 4. 工程工具决定

| 领域 | 第一阶段选择 |
| --- | --- |
| Workspace | pnpm workspace |
| Web 构建 | Vite |
| Electron Main/Preload 构建 | tsup |
| 桌面打包 | electron-builder |
| 类型检查 | TypeScript project references |
| Unit/Integration | 继续使用 Node `node:test`，不在迁移同时改写现有测试 |
| E2E | Playwright |
| Lint | ESLint，只检查目标项目，不批量格式化迁移源码 |
| SQLite | better-sqlite3 + Drizzle |
| 密钥 | Electron `safeStorage` |
| 模型 | Vercel AI SDK + `ModelProviderAdapter`；兼容协议和原生 Provider 均在 Adapter 内 |
| 日志 | pino，统一敏感字段脱敏 |

`better-sqlite3` 和未来的 `node-pty` 都包含原生模块。桌面构建必须配置 Electron ABI rebuild，并在最终安装包中做真实启动测试。第一阶段命令工具使用 Node `child_process.spawn`；交互式 PTY 后续再引入 `node-pty`。

## 5. 迁移内容分类

### 5.1 视觉重建与行为迁移

按两类处理，不能整目录原样复制：

**按视觉合同重新实现：**

- `AppShell`、`AppTitlebar`、`ActivityBar` 和可调整面板布局。
- shadcn/ui `radix-nova` 基础组件、主题 Token、字体和应用外壳样式。
- 文件树、文档标签和侧栏的页面组合。

这部分保留用户认可的尺寸、密度、圆角、主题和交互习惯，但按新项目的 Layout/Feature/Runtime 分层重新组织，不继承 Tauri 调用和旧页面业务状态。

**按最小闭包迁移并保留行为：**

- `src/components/editor/` 中 CodeMirror 和 Markdown 实时渲染能力。
- `src/components/templates/word-preview-page.tsx` 的纯前端预览能力。
- 编辑器和预览依赖的纯函数、测试与固定夹具。
- 长文档保护、可见区渲染、debounce 和分页策略。

复杂编辑器逻辑先用既有测试和截图保证行为，再单独拆分。不得把 `src/index.css`、超过千行的页面或整个 `src/stores` 直接作为目标架构基线。具体规则见[界面迁移与设计系统规范](./07-界面迁移与设计系统规范.md)。

### 5.2 需要适配宿主接口

源项目至少有以下前端文件直接接触 Tauri：

```text
src/App.tsx
src/components/floating/floating-converter.tsx
src/components/floating/system-floating-window-manager.tsx
src/components/layout/app-titlebar.tsx
src/components/vault/file-tree-panel.tsx
src/hooks/use-tauri-file-drop.ts
src/lib/mermaid-export.ts
src/lib/tauri.ts
src/lib/vault-window.ts
src/lib/vault.ts
src/pages/convert/convert-page.tsx
```

处理规则：

- 不在迁移后的组件中保留 `@tauri-apps/*` import。
- 不使用散落的 `isTauriEnvironment()` 分支。
- 文件、窗口、剪贴板和配置能力统一经过 `AgentClient` 或更小的宿主服务接口。
- 浏览器 Mock 模式返回真实的 capability 状态，不伪造成功的系统操作。
- Tauri 专用浮窗、托盘和系统快捷键先不迁移，除非 MVP 明确需要。

### 5.3 第一阶段不迁移

- `src-tauri` 完整 Rust 应用壳。
- DOCX 转换、Pandoc 管理和 Word/WPS COM 快捷粘贴。
- Tauri 更新器、系统托盘、右键菜单和全局快捷键。
- 与 Agent MVP 无关的模板管理和转换历史页面。

不迁移不等于删除源项目能力；这些功能继续保留在原 `md-king` 仓库，后续按产品需求决定是否以 sidecar 接入。

## 6. 迁移原则

1. 原 `md-king` 仓库只读作为来源，本任务不在其中做迁移性重构。
2. UI 外壳以视觉/交互合同重新实现；行为复杂模块只迁移最小闭包，不整仓复制后删除。
3. 迁移与 Electron 接入分开提交，便于判断问题来自 UI 还是宿主。
4. 迁移与依赖大版本升级分开进行。
5. 迁移前先建立 characterization test 和截图；只有真实合同变化才调整断言。
6. 视觉差异使用浏览器截图核对，不以“能编译”代替渲染一致。
7. 长文档保护、可见区渲染和 debounce 不得在搬迁时丢失。
8. 新代码遵守[前后端模块与编码规范](./06-前后端模块与编码规范.md)，通过 ESLint 受限导入固化模块边界。
9. 新 Feature 不使用 `mk-*` Token，不向全局 CSS 追加补丁；迁移兼容样式集中管理。
10. 每个迁移项记录源路径、SHA-256、目标路径、差异理由和验证结果。

## 7. 分阶段实施

### 阶段 A：仓库与 Workspace

实施：

- 初始化 Git 仓库。
- 创建根 `package.json`、`pnpm-workspace.yaml`、TypeScript、ESLint 和 EditorConfig 基础配置。
- 创建 `apps/web`、`apps/desktop` 和 `packages/protocol`。
- 建立统一的 `typecheck`、`test` 和 `build` 根脚本。

验证：

- `pnpm install` 成功并生成锁文件。
- 根目录命令可以分别调用各 workspace。
- 依赖方向违反受限导入规则时 `pnpm lint` 失败。
- 空 Web 页面和最小 Electron 窗口可启动。

### 阶段 B：md-king UI 迁移

实施：

- 先提取语义 Token，并按视觉合同重建 AppShell 和基础布局，不复制完整全局 CSS。
- 再迁移文件树、标签页、Markdown 编辑器和 Word 预览。
- 建立 `MockAgentClient`，为文件树和文档页面提供固定夹具。
- 暂不接 SQLite、模型和真实本机文件。

验证：

- `apps/web` 在普通浏览器中可运行。
- 编辑器现有定向测试通过。
- 使用相同 Markdown、视口和主题夹具对比迁移前后截图。
- 长文档不会全量生成 Word 预览。

### 阶段 C：Electron 宿主

实施：

- Electron Main 在开发态加载 Vite URL，发布态加载 `apps/web/dist`。
- Preload 只暴露版本、能力和最小窗口 API。
- 启用 `contextIsolation`，关闭 `nodeIntegration`。
- 将标题栏窗口按钮从 Tauri API 切到 Preload API。

验证：

- 同一 `apps/web` 分别在浏览器和 Electron 中运行。
- 浏览器没有 Electron API 时正常降级。
- Renderer 中直接访问 `require`、`process` 和 Node 文件系统失败。

### 阶段 D：浏览器技术原型

实施：

- 验证 Electron `WebContentsView`、CDP 和 Playwright 的组合方式。
- 使用独立 Profile 打开本地固定测试站点。
- 实现导航、快照、点击、输入和截图最小工具。
- 先用固定脚本驱动，不依赖真实模型和 Agent Loop。

验证：

- 自动化控制的页面与用户看到的是同一页面状态。
- Profile 与用户日常浏览器隔离。
- 关闭页面和应用后浏览器进程被清理。

该阶段验证失败时，必须在 Electron CDP 直控与独立 Playwright Chromium 之间选择一种，不继续维护双份页面状态。方案决定写回总览后再继续主体实现。

### 阶段 E：协议与存储

实施：

- 实现 `packages/protocol` 的命令、事件、错误和审批 Schema。
- 建立 SQLite Migration 和 Repository。
- 实现 Team、Project、WorkItem、Task、Agent Thread、Session、Run、Message、Event 和 Artifact 最小存储。
- 实现事件序号、事务和中断恢复。

验证：

- Migration 在空数据库和旧测试数据库上通过。
- 创建会话、追加事件、重启和恢复集成测试通过。
- 模拟写入中断后数据库保持可读。

### 阶段 F：只读本地工具

实施：

- 选择并授权工作区。
- 实现 `list_files`、`read_file`、`search_text`。
- 打包或定位 `ripgrep`。
- 实现 Git status 和 diff 读取。

验证：

- 临时工作区读写边界测试通过。
- `..`、绝对路径和符号链接逃逸被拒绝。
- 大目录搜索结果有数量和大小限制。

### 阶段 G：写入、命令与审批

实施：

- 实现 `apply_patch` 和受控文件写入。
- 实现 PowerShell 非交互进程、流式输出、超时和取消。
- 实现审批卡和审批事件。
- 实现文件版本冲突检查。

验证：

- 审批前无磁盘和进程副作用。
- 拒绝、批准、超时、取消和外部文件冲突测试通过。
- Windows 进程树在取消后无残留。

### 阶段 H：单 Agent Loop

实施：

- 先使用 `MockModelAdapter` 实现确定性的工具循环。
- 建立 `ModelProviderAdapter`、能力矩阵和统一流式事件，先接一个真实 Provider 完成闭环。
- 实现上下文预算、Artifact 摘要和增量压缩。
- 实现 Run 循环上限、取消和最终状态。

验证：

- 模拟模型完整通过“读 -> 搜 -> 改 -> 测 -> 完成”。
- 真实模型完成至少一个预置缺陷修复任务。
- 长对话压缩后关键约束和当前任务仍存在。

### 阶段 I：模型、MCP 与 Skill

实施：

- 实现模型中心、多个 Provider/Profile、协议 Adapter、可配置请求地址/上下文窗口、凭据引用和连接测试。
- 至少验证 OpenAI-compatible 与另一类真实 Provider Adapter。
- 实现 Agent 模型 `inherit/fixed/auto` 策略、对话指定、动态切换和 Run 快照。
- 实现 MCP `stdio` 与 Streamable HTTP、能力发现和统一权限映射。
- 实现本地 Skill 发现、依赖检查、按需加载和版本快照。

验证：

- 不同 Provider 通过同一合同完成流式输出、Tool Calling、取消和错误映射。
- 新 Agent 正确继承父对话模型，用户切换后仅下一次模型调用生效且历史 Thread 不变。
- MCP Server 崩溃不导致 Runtime 退出，Skill 不能提升工具权限。

### 阶段 J：多 Agent 团队调度

实施：

- 实现长期 Team Lead、持续 WorkItem 收件箱和 Task 状态机。
- 实现单 Agent/Team Lead 主动拆解 Task 列表、依赖、修订理由和逐项完成，不把建表等同于组队。
- 先使用 `MockModelAdapter` 验证直接执行、轻量委派和团队模式选择。
- 实现 Agent Profile、临时/常驻 Agent、候选过滤、分配理由和任务租约。
- 实现最多三个并发 Worker、任务依赖、结果回收、失败替补和资源回收。
- 实现多个 Project 注册、Task 单项目绑定和跨项目拆分。

验证：

- 简单任务不创建 Subagent。
- 单步骤任务不生成形式化 Todo；多阶段顺序任务由同一 Agent 建表并按依赖完成。
- 可并行任务由至少两个 Worker 完成并由 Team Lead 汇总。
- 连续投递、排队、优先级、依赖、并发上限和重启恢复测试通过。
- 两个临时项目之间的文件、命令、消息、审批和 Diff 完全隔离。
- Worker 不能递归组队、转授审批或并发覆盖同一文件。
- Team Lead、常驻 Agent 和临时 Agent 的独立 Thread 均可查看、继续和恢复。

### 阶段 K：打包与端到端验收

实施：

- 配置 electron-builder 和原生模块 rebuild。
- 打包 Web 资源、SQLite Migration、ripgrep 和必要运行文件。
- 建立 Playwright Electron E2E 和发布版演示夹具。

验证：

- 在干净的 Windows 用户目录安装并启动。
- 完成《第一阶段需求与验收标准》第 7 节演示。
- 卸载不删除用户明确保留的数据，数据删除策略与 UI 一致。

## 8. 首个代码批次

第一次开始写代码只完成以下内容：

1. 初始化 Git 和 pnpm workspace。
2. 创建 `apps/web`、`apps/desktop`、`packages/protocol`。
3. 在 `apps/web` 建立 `AgentClient` 和 `MockAgentClient`。
4. 按 `md-king` 的视觉合同重新实现主题、AppShell、标题栏和最小工作台布局。
5. Electron 同时加载这一 Web UI。
6. 增加浏览器与 Electron 两个启动验证。

首个批次不接模型、不建 SQLite、不执行 Shell，也不迁移完整编辑器。这样可以先验证仓库、双宿主 UI 和安全 IPC 的基础方向。

## 9. 后续代码批次

```text
批次 1：Workspace + Web UI + Electron 壳
批次 2：受管浏览器 PoC，锁定可见页面控制方案
批次 3：完整 md-king 编辑器和预览迁移
批次 4：Protocol + SQLite 会话
批次 5：只读工作区与 Git 工具
批次 6：Patch、命令和审批
批次 7：Mock 单 Agent Loop
批次 8：模型中心、至少两类 Provider Adapter、动态切换与上下文压缩
批次 9：MCP Client、Skill 管理与权限合同
批次 10：Team + Project + WorkItem + Task 持久状态机
批次 11：临时 Subagent、全 Agent 独立 Thread、结果回收和持续对话
批次 12：自动扩容、并发 Worker、任务依赖和多项目隔离
批次 13：打包、性能和端到端验收
```

每个批次独立验证并提交，不把 UI 迁移、Agent Runtime 和浏览器实验混在一个无法审查的大改动中。

## 10. 主要风险

| 风险 | 当前处理 |
| --- | --- |
| 迁移后 Markdown 效果退化 | 保留原测试和固定截图夹具，迁移期不升级主要依赖 |
| Tauri 调用散落在组件中 | 统一收口到 AgentClient，禁止组件直接判断宿主 |
| Electron 原生模块打包失败 | 尽早做 better-sqlite3 安装包冒烟，不等最终阶段首次打包 |
| 模型供应商 Tool Calling 差异 | ModelProviderAdapter 隔离；至少用两类真实 Provider 做合同测试，不靠供应商名称分支 |
| 模型切换导致上下文或能力错误 | 每个 Run 固化模型快照，切换后按新模型能力重新构建上下文 |
| Agent 数量耗尽系统线程 | Agent Thread 仅为逻辑对话；Run 使用异步调度和固定 Worker/进程池，空闲 Agent 不持有运行资源 |
| MCP/Skill 绕过权限 | 所有能力统一进入 ToolRegistry 和 PermissionPolicy，Skill 不直接获得执行权限 |
| 长会话和工具输出膨胀 | SQLite 事件、Artifact、输出上限和上下文压缩共同控制 |
| 工作区路径逃逸 | 所有本地工具共用规范化路径校验并做 Windows 边界测试 |
| 浏览器页面与自动化状态不同步 | 浏览器 PoC 必须验证同一页面，失败则收敛到单一执行方案 |
| 两个仓库 UI 后续漂移 | MVP 先迁移快照，产品稳定后再决定是否抽共享包 |
| 简单任务被过度拆分 | 默认直接模式，只有独立支线或并行收益明确时才委派 |
| 任务列表变成形式主义或重复状态 | 只拆可独立验收步骤；列表直接投影 tasks/依赖/事件，不另建 Todo Store |
| 自动扩容失控 | 仅 Team Lead 可创建 Worker，限制委派深度、并发、实例数、时间和 Token |
| 多 Agent 同时覆盖文件 | 写任务使用隔离 worktree 和文件所有权，冲突任务阻塞或重新排程 |
| 多项目上下文或权限串扰 | 每个 Task 强制绑定一个 Project，工具调用携带并校验 projectId |

## 11. 开工前检查

- [x] 用户确认本文档中的开工默认假设。
- [x] 已检查 `md-king` 源仓库状态，并在[开工准备与首批任务清单](./04-开工准备与首批任务清单.md)记录迁移基线规则。
- [x] Agent 目录初始化分支默认使用 `main`，提交标题采用“类型前缀 + 中文说明”。
- [x] DOCX、Word/WPS、WSL、SSH、交互式 PTY 和完整 Web Server 不进入 MVP。
- [x] 首个代码批次的范围、验证命令和完成定义已经固定。
- [ ] 在接入真实模型的代码批次开始前，确认两类测试 Provider、模型和能力；密钥不写入仓库或文档。

未完成项不阻塞首个代码批次。开始实现时按[开工准备与首批任务清单](./04-开工准备与首批任务清单.md)执行，不提前创建后续空包。
