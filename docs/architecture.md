# 架构与关键数据流

本文描述当前源码实现，非目标架构；进度和验收状态见 [handoff.md](../handoff.md)，协作规则见 [AGENTS.md](../AGENTS.md)。

## 运行边界

- 主程序运行于 Scripting App，使用 TypeScript/TSX 与 `scripting` 原生 UI/API。`scripting` 由宿主提供，不是根目录 npm 运行依赖。
- 根目录 Node 工具链只负责回归测试；唯一开发依赖为 TypeScript `5.9.3`。没有独立后端、Web 服务或项目级 TypeScript 编译配置。
- 阅读器把正文渲染为内嵌 WebView 内容；它是原生脚本的一部分，不是移植来的 Web/PWA 应用。
- 发布脚本将 `Pix-Scripting/` 原样压缩为 `.scripting` ZIP 包，不执行 TS 编译。修改入口和原生 API 时需单独考虑宿主行为。

## 模块职责

下列代码路径均相对 `Pix-Scripting/`。

| 模块/路径 | 职责与边界 |
| --- | --- |
| `script.json`、`src/config.ts` | 元数据、更新地址、版本回退与请求配置 |
| `index.tsx`、`src/bootstrap.ts` | 启动存储/服务、路由种子、前后台与最小化恢复、关闭时资源清理 |
| `home_screen_default_ui.tsx` | Scripting 首页入口，复用根 UI/初始化，有自身 Tab 与恢复事件处理 |
| `widget.tsx`、`app_intents.tsx`、`live_activity.tsx` | 桌面画框小组件、收藏/切图及下载控制意图、下载实时活动 UI |
| `src/ui/` | 根视图、导航与 iPad 双栏、列表、详情、阅读、设置、操作反馈；公共外观在 `components/`，环境光在 `ambient/` |
| `src/api/auth.ts`、`session.ts`、`client.ts`、`pixiv.ts` | PKCE/Keychain 凭证、会话代次与刷新、请求节流/来源控制、Pixiv 业务接口 |
| `src/api/aiService.ts`、`aiAdapters/` | AI 提示词、翻译校验与上下文生成；协议分发、流式解析及模型思考参数适配 |
| `src/store/` | 设置、历史、收藏/屏蔽、缓存、阅读进度、账号状态、翻译会话与安全文件写入 |
| `src/downloader/` | 任务管理、暂停/恢复/取消、进度、文件目录、单篇/系列与 EPUB/CBZ/TXT 等导出 |
| `src/image/`、`src/ugoira/`、`src/platform/` | 图片加载/颜色、动图转换、触觉与 Pro 能力适配 |

现有依赖不是完全单向：`downloader/seriesDownloader.ts` 与 `ui/useNovelTranslation.ts` 都引用 `ui/NovelReader.tsx` 的 `parseNovelToChunks`。`store/novelExport.ts` 负责译文源文本重建与完整性判断，文件输出由 downloader 完成。后续调整解析位置时必须同时检查阅读、翻译和导出调用方。

## 关键数据流

### 启动、浏览与账号

`index.tsx → bootstrapStorage/startBackgroundServices → ui/appRoot.tsx → 登录或主导航`。

页面通过 `session.call → api/pixiv → api/client` 访问 Pixiv；凭证由 `auth.ts` 存放 Keychain，Session 用会话代次隔离 token 刷新。账号变化清理账号状态缓存；主入口在有效 UID 变化或模型配置变化时丢弃小说翻译内存会话。URL/Widget 路由经 `routeNavigation` 分发；后台服务包括历史同步和 Widget 数据池预热。

### 小说翻译与原位显示

`NovelDetail/NovelImmersiveReader/seriesView → useNovelTranslation → NovelReader.parseNovelToChunks → store/novelTranslation → api/aiService → 自定义 AI 协议适配器或 Scripting 原生助手`。

- 保留正文块 ID、章节与结构标记；会话先生成译名/简介/摘要，再整理术语，最后最多两个正文请求并发。
- 摘要/术语失败显示状态并允许继续正文；符合条件的正文失败块仅三分重试一次，子段不递归拆分。
- 订阅快照更新 `NovelTranslationStatus` 和阅读器；译文写回原正文块，可切换原文，原始文本与阅读进度不被译文覆盖。
- 自定义模型可持久化；缓存按 UID、小说/系列、目标语言组织，并校验模型配置、正文、标题、简介与块内容指纹，内存复用还检查块布局。模型密钥不写入译文缓存。
- 原生助手无稳定模型标识，因此只复用当前会话。缓存写入失败保留内存结果并显示提示。
- 主入口在 App 后台或脚本最小化时暂停翻译；回到可见前台恢复先前运行的会话。取消通过 AbortController 和任务代次阻止迟到结果覆盖。

### 单篇与系列导出

单篇通过 `store/novelExport.ts` 判断译文完整性、重建源文本或生成纯文本；再交给 `downloader/epubExporter.ts`、`novelTextExporter.ts` 等输出。

系列三个 UI 入口共用 `ui/novelSeriesDownload.ts → downloader/seriesDownloader.ts → DownloadTaskManager → epubExporter.ts → ShareSheet`。分页收集系列章节并按顺序获取正文；译文模式复用翻译会话/缓存，不自动启动翻译。缺少译名、必需简介或完整正文、正文请求失败、UID 中途变化时拒绝导出，并给出章节错误。原文模式保留既有容错行为：单章获取失败可记录后继续，不保证与译文模式同样严格。

### 持久化与跨进程

- `store/dataDirectory.ts` 集中定义数据路径：本地 Documents 保存缓存、系列映射、译文与按账号隔离的历史/进度。
- 历史与进度由 `historySync.ts` 低频同步到账号专属 iCloud 目录；设置、屏蔽、阅读器配置、Pixivision 收藏使用各自云目录，iCloud 不可用时回退本地。
- Widget 数据池优先使用 App Group 共享目录，意图与主程序共享数据；下载意图通过 `downloader/TaskSignal.ts` 传递控制信号。
- 不应假设所有 store 都按账号隔离或都同步 iCloud；改动需核对具体模块路径与写入逻辑。

## 验证边界

`tests/*.test.cjs` 使用 Node 内置测试器、TypeScript 转译、VM 与宿主/网络替身，覆盖小说链路、日期筛选和列数回归。它们验证选定逻辑与入口调用，不验证真实网络、原生布局、WebView 渲染、系统权限或跨进程宿主集成。构建/ZIP 校验只证明包结构与脚本检查通过；最低宿主版本和完整类型检查方案待确定。

## 修复分支附加说明（`fix/futurereader-novel-integrity-20261013`）

- 沉浸阅读器 `src/ui/NovelImmersiveReader.tsx` 在内部换章时以自身持有的 `activeNovelId`/`currentPage` 为归属：进度写入当前作品、书签读写当前作品、跳页只在仍停留在进入时的作品才回调父级。正文 HTML/JS 带 `owner` 代际标识，`scriptMessageHandler` 一律先校验代际，切篇后旧文档的迟到消息整体丢弃。
- 小说导出链路 `seriesDownloader` → `epubExporter` 传递 `expectedChapters`/`missingChapters`，`epubExporter` 只登记真正落盘的插图，并回传 `NovelExportReport`；`downloadHelper`/`client` 提供失败分类与受控重试。
- 发布包校验：`scripts/verify-release-package.sh` 逐字节比对 `Release/Pix-Scripting.scripting` 与工作树 `Pix-Scripting/`，并校验包内版本与 `remoteResource.url`；`scripts/build-release.sh` 在打包后自动调用它。
