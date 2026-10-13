# Aster

> 一个本地优先的桌面 AI Agent 工作台：让用户在明确授权的项目中与 Agent 协作，并查看、审批和追溯实际执行过程。

Aster 的目标不是把模型回复停留在聊天窗口，而是形成一条受控的本地执行闭环：理解目标、读取项目、调用工具、展示变更与命令结果、持久化过程，并在需要时继续处理任务。

## 当前能力

- 项目对话与临时对话；对话、运行过程和任务清单可持久化。
- 本地文件读取、搜索、Patch、命令执行和 Web 搜索等受控工具能力。
- 文件写入、Patch、命令等副作用遵循权限与用户审批。
- 多模型 Provider 与模型配置；支持 MCP、Skill、Agent、Subagent 和长期团队工作流。
- React 工作台既可在浏览器预览，也可作为 Electron Renderer 运行。

详细产品与架构事实见 [文档索引](./doc/文档索引.md)。规划中的能力会在设计文档中明确标注，不能视为已发布功能。

## 技术栈

- Electron 43 + TypeScript 6：桌面主进程、Preload 与本机能力。
- React 19 + Vite 8：工作台界面。
- LangChain / LangGraph：Agent 执行编排。
- Zod 4：跨进程与外部输入合同校验。
- SQLite：会话、运行和业务事实的本地持久化。
- pnpm 10：Monorepo 工作区管理。

## 仓库结构

```text
apps/
  desktop/       Electron Main、Preload、本地 Runtime 与存储
  web/           React 工作台
packages/
  protocol/      跨进程 Schema、DTO 与共享合同
doc/             产品、架构、接口和工程规范
.github/         GitHub CI 与 PR 模板
```

## 开始开发

### 前置条件

- Node.js `>=24 <25`（见 [`.node-version`](./.node-version)）
- pnpm `>=10 <11`
- Windows 为当前主要开发与验证平台

```powershell
corepack enable
pnpm install
pnpm dev
```

`pnpm dev`（或 `pnpm start`）是日常开发的默认入口：启动 Vite、Main/Preload 编译监听和 Electron。React/CSS 修改由 Vite 热更新，Electron 主进程 PID 保持不变；Main/Preload 修改才自动重启 Electron。Web Renderer 地址为 `http://127.0.0.1:5173`。

开发启动会验证 Vite 来自当前 worktree；端口被其他 worktree 占用时明确失败，不复用另一份页面，也不回退到旧 `dist`。并行 worktree 可在两个终端分别运行：

```powershell
pnpm --filter @agent/web dev -- --port 5174
# 另一个终端，同一个 worktree
$env:ELECTRON_RENDERER_URL = "http://127.0.0.1:5174"
pnpm --filter @agent/desktop dev
```

不要用 `electron .` 或直接执行 Electron 替代开发脚本。

启动日志会显示源码绝对路径、分支和提交。继续尚未合并的功能时，必须在包含该功能最新改动的 worktree 中启动；共享 `develop` 或其他修复分支不包含未合并界面，不能把它们的验收窗口当成最新版本。

### 构建、生产预览与 Windows 打包

| 命令 | 用途 | 热更新／产物 |
| --- | --- | --- |
| `pnpm dev` / `pnpm start` | 日常开发和桌面 UI 验收 | Vite HMR；Main/Preload 自动重启 |
| `pnpm build` | 类型检查及生产编译 | `apps/web/dist`、`apps/desktop/dist`；不启动、不打安装包 |
| `pnpm preview` | 构建后启动本地生产产物 | 静态文件；明确无热更新 |
| `pnpm package:dir` | 构建并生成 Windows x64 解包目录 | `release/win-unpacked/Aster.exe` |
| `pnpm package:win` | 构建并生成 Windows x64 NSIS 安装包 | `release/Aster-<version>-x64-setup.exe` |

打包包含 Renderer、本地运行依赖和 Electron，不要求目标机器安装 Node、pnpm 或运行 Vite。开发服务环境变量不会让安装包加载开发页面。打包默认只产出本地制品，不上传 GitHub Release；正式发布的签名、版本标签与更新链路另行配置。Windows 安装包在 Windows 上构建和验证。

打包前用目标 Electron 验证 `node-pty` 的 Node-API 预编译文件和 ripgrep；打包后自动运行 `pnpm verify:package`，检查包内 Renderer、终端原生模块及搜索可执行文件。ripgrep 使用 `app.asar.unpacked` 的实际路径。配置与依赖版本按 [electron-builder 26 文档](https://www.electron.build/v26/docs/) 固定；目前使用默认 Electron 图标，代码签名和产品图标可在正式发布前补齐。

可选的本地模型环境变量放在仓库根目录 `.env.local`；该文件已被 Git 忽略，绝不提交真实密钥。

```dotenv
AGENT_MODEL_BASE_URL=https://example.com/v1
AGENT_MODEL_API_KEY=replace-with-your-key
AGENT_MODEL_ID=your-model-id
```

## 验证命令

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

提交前还应执行：

```powershell
git diff --check
git status --short
```

## 贡献与协作

本仓库使用 Git Flow：`main` 是已发布基线，`develop` 是下一版本集成线，日常工作从 `feature/*` 或 `fix/*` 分支通过 PR 合入。完整约定见：

- [贡献指南](./CONTRIBUTING.md)
- [Git 与 GitHub 协作规范](./doc/18-Git与GitHub协作规范.md)
- [后端编码规范](./doc/13-后端编码规范.md)
- [界面迁移与设计系统规范](./doc/07-界面迁移与设计系统规范.md)

请不要直接向 `main` 或 `develop` 推送，也不要在公共分支上改写历史。

## 发布状态

当前仓库提供本地 Windows x64 安装包和解包目录构建入口，尚未配置代码签名、自动发布或自动更新。发布与更新方案会以 GitHub Release 为制品来源；标签触发发布和 Stable/Beta 更新通道仍为规划，不能视为已实现。未配置证书的本地安装包未签名。

公开发布前仍需由项目负责人确认：

- GitHub 组织/仓库名与域名。
- 开源许可证或商业许可策略。
- Windows 代码签名证书，以及未来 macOS 的签名与公证账户。
- 首发支持的平台、架构与 Beta 用户范围。

## 安全说明

本软件能够在用户授权范围内访问本地项目并运行命令。使用前请审阅权限设置；不要把 API Key、访问令牌、私钥或包含敏感信息的 `.env` 文件提交到仓库或粘贴到 Issue/PR。

安全问题请勿通过公开 Issue 披露。在安全披露渠道确定前，请直接联系仓库维护者。
