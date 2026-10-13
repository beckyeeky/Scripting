# 长期项目协作规则

## 目标与范围

- 本仓库维护 Scripting App 的 iOS/iPadOS Pixiv 客户端 Pix-Scripting；`feature/pixivreader-port` 在上游客户端基础上移植 PixivReader 的小说翻译、阅读和导出行为。
- 保留插画、漫画、动图、Pixivision、账号、下载、小组件与 iPad 布局等既有能力；小说任务不顺带重写其他模块。
- 运行代码是 TypeScript/TSX，UI 与原生能力由 `scripting` 宿主提供；阅读正文使用内嵌 WebView。不要引入 Next.js/Web/PWA 运行时。
- 当前进度、版本快照、阻碍和待办只写入 [handoff.md](handoff.md)，不写进本文件。

## 目录与文档入口

| 路径 | 用途 |
| --- | --- |
| [README.md](README.md) | 功能、安装、版本和源码发布说明 |
| [handoff.md](handoff.md) | 最近进度、验证结果、阻碍与下一步 |
| [docs/architecture.md](docs/architecture.md) | 模块职责、边界与关键数据流 |
| [docs/decisions.md](docs/decisions.md) | 重要决策、原因及影响 |
| `Pix-Scripting/script.json`、`index.tsx` | 脚本元数据与主入口 |
| `Pix-Scripting/widget.tsx`、`app_intents.tsx`、`live_activity.tsx`、`home_screen_default_ui.tsx` | 各 Scripting 宿主入口 |
| `Pix-Scripting/src/` | `api/`、`store/`、`ui/`、`downloader/`、`image/`、`ugoira/`、`platform/` 等实现 |
| `tests/*.test.cjs` | Node 回归测试；使用 TypeScript 转译与宿主替身 |
| `scripts/build-release.sh`、`Release/Pix-Scripting.scripting` | 打包脚本与可安装产物 |
| `package.json`、`package-lock.json` | 桌面测试依赖及锁定版本 |

## 常用命令

以下命令均在仓库根目录执行。

```bash
# 开始任务：确认分支与用户未提交改动
git status --short
git branch --show-current

# 安装桌面测试依赖（锁文件目前仅包含 TypeScript）
npm ci

# 全部测试 / 指定回归测试
npm test
node --test tests/novel-series-reader-regression.test.cjs

# 检查已跟踪文件的补丁空白错误
git diff --check

# 构建可安装包；需要 node、zip、unzip，会覆盖现有发布包
bash scripts/build-release.sh
unzip -tq Release/Pix-Scripting.scripting
unzip -p Release/Pix-Scripting.scripting Pix-Scripting/script.json
```

- 启动方式：在 iPhone/iPad 的 Scripting App 中导入 `.scripting` 包并运行 Pix-Scripting；源码主入口为 `Pix-Scripting/index.tsx`。
- 仓库没有 `npm start`、`npm run dev` 或 `npm run build`，没有配置桌面启动服务。CLI 同步/调试流程与最低 Node/Scripting/iOS 版本待确定，勿把未配置的命令写成已可用。
- 没有 `tsconfig.json`、lint 或格式化脚本；`npx tsc --noEmit` 不能作为本项目有效类型检查。涉及 TS/TSX 时使用现有测试，必要时用已安装 TypeScript 做针对性语法解析，并说明验证限度。

## 编码、范围与验证

- 遵循相邻文件的风格：通常双空格缩进、双引号、无分号；函数/变量用 camelCase，组件/类型用 PascalCase。避免整文件格式化。
- 修改前读取入口及直接依赖。共享业务逻辑沿现有模块放置，入口负责宿主适配；异步操作使用 `async/await`，错误反馈可见且允许用户恢复。
- 修改 Scripting API 前核对宿主提供的声明或官方文档入口 `https://scriptingapp.github.io/llms.txt`；不能直接套用 React DOM 或 Swift API。
- 保留账号隔离、缓存失效、取消与迟到响应防护；原文、阅读进度与译文分开管理。保留 Pixiv 分页、章节、插图、跳页和链接标记。
- 不在源码、文档、缓存、日志或测试样例新增真实用户令牌、Cookie、模型密钥或私人正文。
- 保留用户改动，只编辑任务所需文件；提交时显式选择文件，不顺带提交无关修改。同步上游与合入功能分支是两个操作；“同步上游”默认仅快进 `main`。
- 逻辑改动运行 `npm test`；行为缺陷补充有意义的路径回归，使用真实实现并只替换必要的宿主/网络边界。文档改动检查事实、链接及补丁格式即可。
- 改源码并交付安装包时，检查版本一致性、构建与 ZIP 完整性；源码、`script.json`、`src/config.ts` 回退版本、README 版本及包内元数据保持一致。
- 桌面回归、语法解析、ZIP 检查和设备验收分别报告；不得把替身测试当作 iPhone/iPad 的 UI、WebView、权限、分享、小组件或灵动岛验收。
- 用户要求本分支正式发版/打包推送时，须完成源码与包提交、分支推送、匹配的 `v<版本>-pixivreader` 标签及含包附件的 GitHub Release。发布时显式指定 `--repo beckyeeky/Scripting`，避免选中上游仓库；文档任务本身不触发发版。

## 协作流程

1. 任务开始读取本文件和 `handoff.md`，检查分支、工作区及相关 README、代码、测试；涉及架构/决策时读取对应文档。
2. 依据当前源码与实际验证推进工作。发现记录过期时更新；不能确认的项标为“待确定”，不补写猜测。
3. 任务结束更新 `handoff.md`：日期、完成内容、实际运行的检查、未验证事项、阻碍、下一步。
4. 模块职责、依赖或数据流变化时同步更新 `docs/architecture.md`；影响长期行为的重要选择追加到 `docs/decisions.md`，注明状态、原因和证据。
5. 对用户说明实际变更、验证结果和剩余事项。未获任务授权时，不自行提交、推送或发布。
