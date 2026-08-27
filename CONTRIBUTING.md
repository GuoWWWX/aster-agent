# 贡献指南

感谢你参与 Aster。此项目是包含 Electron、本地文件与命令能力的桌面应用；所有贡献都必须同时考虑正确性、权限边界、数据持久化和用户可见行为。

## 开始前

1. 阅读 [README](./README.md) 并准备 Node.js 24 与 pnpm 10。
2. 阅读 [Git 与 GitHub 协作规范](./doc/18-Git与GitHub协作规范.md)。
3. 先检查已有 Issue 与 PR；重大功能先在 Issue 或 Discussion 对齐目标、范围和验收方式。
4. 不在公开内容中提交密钥、令牌、真实用户数据或本机绝对路径。

## 开发流程

```powershell
git fetch --prune origin
git worktree add ..\Aster-feature-short-description -b feature/short-description origin/develop
Set-Location ..\Aster-feature-short-description

pnpm install
# 修改、测试
pnpm lint
pnpm typecheck
pnpm test
pnpm build

git diff --check
git add <exact-files>
git diff --cached
git commit -m "feat: describe the change"
git push -u origin feature/short-description
```

然后创建指向 `develop` 的 Pull Request。一个 PR 应解决一个可验证的目标；不要把无关重构、格式化或生成文件混入。

每个需要修改仓库的新目标都必须在独立 Git worktree 中完成，并从最新 `develop` 创建新的功能、修复或文档分支。worktree 内可以直接提交、推送和创建 PR/MR；已合并或已关闭 PR/MR 的分支不再继续提交或修改，也不得作为下一项工作的基线，即使该分支尚未删除。

## 修改要求

- 变更 Protocol、IPC、持久化数据、工具权限或设置语义时，同步更新对应 `doc/` 文档和测试。
- Bug 修复优先加入失败复现；新增行为必须有自动化或可重复的手工验证步骤。
- Renderer 不能绕过 Preload/IPC 访问 Node、本地文件或数据库。
- 不接受降低 Schema 校验、使用 `any`、跳过测试或吞掉异常来换取 CI 通过。
- 只在自己独占的功能分支上使用 rebase 和 `git push --force-with-lease`；不得对公共分支强推。

## 提交信息

使用 Conventional Commits 的简短格式：

```text
<type>(optional scope): imperative summary
```

常用 `type`：`feat`、`fix`、`docs`、`test`、`refactor`、`build`、`ci`、`chore`、`revert`。

示例：

```text
feat(tasks): add task list completion action
fix(storage): keep deletion retry idempotent
docs: describe GitHub release process
```

## Pull Request 要求

- 标题使用同一提交格式，正文说明目标、范围、验证结果和风险。
- 当前不设置 PR 自动 CI 或远端必需检查；合并前由作者按改动范围完成本地验证。需要时维护者可在 Actions 页手动运行完整 CI。恢复自动 CI 后，所有必需检查必须通过。
- 至少一位维护者审批后才能合并；涉及安全、SQLite Migration、Protocol、工具权限或发布时应由对应模块负责人复核。
- 合并方式以仓库设置为准；默认使用 squash merge，让 `develop` 保持一项工作一个可读提交。

## 许可证

项目许可证尚未确定。提交代码即表示你有权提交该内容，并同意在项目确定许可证后按该许可证分发你的贡献；如果你不能接受，请在贡献前联系维护者。
