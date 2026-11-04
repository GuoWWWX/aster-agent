# Aster

Aster 是一个本地优先的桌面 AI Agent 工作台。你可以在项目或临时对话中让 Agent 阅读文件、执行经授权的操作，并查看工具调用、命令输出和文件变更。

[开始使用](#开始使用) · [模型配置](#配置模型) · [开发与构建](#开发与构建) · [贡献指南](./CONTRIBUTING.md) · [MIT 许可证](./LICENSE)

## 主要功能

- **对话与协作**：项目对话、临时对话、Subagent、快速协作和团队群聊，保留任务与执行过程。
- **本地工具**：文件读取与搜索、Patch、命令、终端、Web 搜索和受管浏览器；文件变更与工具结果可以在工作区查看。
- **权限与审批**：支持请求批准、帮我批准和完全访问三种模式。写文件、执行命令等操作遵循当前权限设置。
- **模型与扩展**：配置多个供应商和模型，支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和 Google Gemini 接口格式，以及 MCP 和按需加载的 Skill。
- **文件与预览**：查看和编辑工作区文件，预览 HTML、Vue、React 内容；配置支持的生图模型后可生成和查看图片。
- **本地数据**：对话历史、附件、配置和业务数据保存在本机；模型请求和启用的联网工具仍会连接相应服务。

详细能力和限制见[业务上下文](./doc/14-业务上下文.md)与[工具体系](./doc/11-AI工具体系与生命周期设计.md)。模型出现在列表中不代表账号一定有调用权限。

## 开始使用

当前主要在 Windows 上开发和验证，提供 Windows x64 构建入口。仓库暂未发布安装包，可先从源码运行。`main` 是发布基线；下列命令使用包含当前开发功能的 `develop` 分支。

准备好 Git、Node.js `>=24 <25` 和 pnpm `>=10 <11`，然后在 PowerShell 中运行：

```powershell
git clone --branch develop https://github.com/GuoWWWX/aster-agent.git
cd aster-agent
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 启动 Electron 和本地 Vite 服务。前端修改通过热更新生效，Main 或 Preload 修改会自动重启 Electron。也可以使用等价的 `pnpm start`。

### 配置模型

1. 打开应用的“设置 → 模型配置”，添加供应商。
2. 填写供应商名称、API 格式、请求地址和 API Key，然后添加模型 ID。
3. 使用“测试模型”检查连接，并选择默认模型。

当前 `develop` 分支的供应商配置使用 API Key；ChatGPT 订阅账号登录授权尚未合入该分支。API 调用是否收费、可用模型和额度由相应供应商决定。

供应商 API Key 保存在本机 `<ASTER_HOME>/settings.jsonc` 中，**当前为明文**。默认数据目录是用户主目录下的 `.aster`；请保护该目录，不要提交、分享或上传含密钥的配置文件。目录和备份说明见 [Aster 目录结构与 JSONC 配置](./doc/24-Aster目录结构与JSONC配置.md)。

也可以在仓库根目录创建被 Git 忽略的 `.env.local`，用于首次导入模型配置：

```dotenv
AGENT_MODEL_BASE_URL=https://example.com/v1
AGENT_MODEL_API_KEY=replace-with-your-key
AGENT_MODEL_ID=your-model-id
```

已有供应商配置时，环境变量不会覆盖它。

## 开发与构建

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 日常开发，启动桌面应用和 Vite |
| `pnpm lint` | 检查脚本及工作区代码 |
| `pnpm typecheck` | 检查 TypeScript 类型 |
| `pnpm test` | 运行项目测试 |
| `pnpm build` | 编译生产产物，不启动应用 |
| `pnpm package:dir` | 构建 Windows x64 解包目录 |
| `pnpm package:win` | 构建 Windows x64 NSIS 安装包 |

安装包生成在 `release/`，当前构建不自动上传、不签名，也不提供自动更新。首次公开分发二进制产物前，还需要核对其包含的第三方许可证和版权声明。

开发服务默认使用 `http://127.0.0.1:5173`。多个 worktree 并行开发时，可为当前 worktree 指定独立端口：

```powershell
$env:ELECTRON_RENDERER_URL = "http://127.0.0.1:5174"
pnpm dev
```

开发启动会校验 Renderer 来源，避免连接到其他 worktree。配置、验收和 Git 工作流见 [贡献指南](./CONTRIBUTING.md)；后台控制接口见[本机控制接口与终端调用](./doc/25-本机控制接口与终端调用.md)。

## 项目结构

```text
apps/desktop/       Electron Main、Preload、Agent Runtime 和本地存储
apps/web/           React 工作台
packages/protocol/  跨进程 Schema、DTO 和共享合同
scripts/            开发启动、控制接口和打包校验
doc/                产品、架构、接口与工程文档
```

Renderer 通过 AgentClient 和 Preload 与 Main 通信，Main 负责模型、工具、权限和持久化。对话历史使用 JSONL，SQLite 保存项目、团队等业务事实。更多说明见[文档索引](./doc/文档索引.md)。

## 贡献与安全

欢迎通过 Issue 反馈问题或提交 Pull Request。开发分支、验证要求和贡献约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。当前 CI 由维护者手动触发，推送和 PR 不会自动运行检查。

Aster 可以在用户授权范围内访问文件并执行命令。请根据实际需求选择权限模式，避免在 Issue、日志或截图中公开密钥。安全问题的私下报告方式见 [SECURITY.md](./SECURITY.md)。

## 许可证与第三方内容

Aster 的项目代码按 [MIT License](./LICENSE) 发布。迁入的 `md-king` 代码、依赖包及供应商品牌标识分别保留其原有许可和权利；来源与注意事项见 [第三方声明](./THIRD_PARTY_NOTICES.md)。
