# 开发与构建入口

- 日常开发、启动桌面应用和 UI 验收使用根目录 `pnpm dev`（`pnpm start` 同义）。React/CSS 由 Vite 热更新；Main/Preload 由 tsup watch 重编译并自动重启 Electron。
- 不用 `electron .`、手动执行 Electron 可执行文件、`loadFile(dist)` 或生产预览代替开发启动。不要因为只修改前端而重启桌面进程；构建验证可以单独运行，不影响当前开发窗口。
- `pnpm build` 仅编译，既不启动应用，也不生成安装包。只有用户要求验证静态产物时使用 `pnpm preview`；安装包使用 `pnpm package:win`，解包目录使用 `pnpm package:dir`。
- 复用开发服务前核对 worktree 来源。默认端口被其他 worktree 占用时，不连接那份 Renderer；为本 worktree 使用独立 Vite 端口和匹配的 `ELECTRON_RENDERER_URL`。
- 启动后确认是本 worktree 的 HTTP Renderer，日志说明开发模式。验证热更新时确认 UI 更新且 Electron 主进程 PID 不变。正式安装包独立验证，不依赖 Vite。
- 继续已有功能时复用包含该功能最新改动的活跃 worktree、既有开发窗口和既有数据目录；不要从共享 develop 或独立验收基线启动后当成“最新版本”展示。未经用户明确要求，不为验收另设 ASTER_HOME／AGENT_HOME、复制配置或数据库、另开隔离桌面窗口，避免旧数据迁移带出错误会话和模型配置。对话测试在既有应用内新建验收对话；启动日志的源码路径、分支和提交必须与当前验收目标一致。

编码、Git 和验证遵循 `CONTRIBUTING.md` 及 `doc/06-前后端模块与编码规范.md`、`doc/13-后端编码规范.md`、`doc/18-Git与GitHub协作规范.md`。每个新目标使用独立 worktree 和分支，不混入其他任务的未提交修改。

# 代码组织与规模

- 前端页面私有组件、hook 和纯函数留在所属页面／Feature；跨 Feature 复用放到 `components/<capability>` 或纯函数 `lib`。配色、布局、组件及性能遵循 `doc/07-界面迁移与设计系统规范.md`。
- 同一水平行的图标／头像、状态点、文字、时间和操作控件必须垂直居中，优先使用 `flex`／`inline-flex` 的 `items-center` 或 Grid 的对应对齐；不能用图标上边距、位移或空格补位置。多行说明须明确图标跟随首行还是整块内容，并在浅深主题、不同字号及窄宽度下检查。
- 新增或本次重构形成的手写业务源码必须少于 1,000 行；React 约 250 行、普通 TS 约 400 行即按职责评估拆分。已有超限文件不再追加独立能力，局部修复不夹带整文件重构。不能按行机械拆成相互依赖的片段。
- 后端先搜索并复用所属域的具名方法，保持模型、权限、存储及生命周期的统一入口；不创建万能 Utils、空壳 Package 或无实际变化点的设计模式。
