# 项目交接

## 当前发布：v1.7.13.8（2026-10-18）

- 分支 `feature/pixivreader-port`；本版包含两项功能：正文行内标记本地渲染、翻译失败后三分重试补强（参考 pixivReader 提交 `6cf04ee`）。
- 版本一致性：`Pix-Scripting/script.json`、`src/config.ts`、README 与包内元数据均为 `1.7.13.8`；`remoteResource.url` 指向本分支。
- 测试（设备 Node 无 `node:test`/`node:assert/strict`，用本地替身运行）：`novel-translation` 28、`novel-inline-markup` 15、`novel-translation-ledger` 15、`novel-translation-ui-wiring` 8 全过；`pixivreader-novel-render` 6 项中 1 项因设备 `vm.runInNewContext` 限制失败，属环境限制。桌面/iSH `npm test` 仍需复跑。
- 全量语法检查：198 个 TS/TSX 文件，0 错误（非类型检查）。
- 设备无 `bash`/`zip`，本轮用等价 Node ZIP 构建脚本生成发布包；逐条解压与工作树比对 199 个文件字节一致，包内版本与更新地址校验通过。
- 包：`Release/Pix-Scripting.scripting`，812,564 字节，SHA-256 `a5619aab183f136b9ee1d0a6af2ce81d78bf28d9fbe5f141e3622c2f85e265f2`。
- 未做真机验收：行内标记横排/竖排显示、译文渲染、真实超时后的自动恢复仍需设备确认。

## 翻译失败拆分重试（2026-10-18，已包含在 v1.7.13.8）

- 背景：参考项目最新提交 `6cf04ee`（Retry failed translation chunks in smaller parts）要求块翻译失败后拆成三段再次提交。移植版的 `splitNovelPassageIntoThree` 与 `novelTranslation.start()` 单次重试此前已实现该结构，但把 `timeout`/`超时` 排除在可重试错误之外，长块超时时不会拆分。
- 本次：允许超时触发三分重试（长块超时是拆分最可能生效的场景）；继续跳过鉴权/限流/取消，保留原块 ≥60 字的门槛，避免把过短文本拆成无意义碎片。子段仍直接调用单块翻译，不递归拆分。
- 测试：`tests/novel-translation.test.cjs` 新增「超时触发拆分、过短块不拆」与「鉴权失败不拆」两项，共 28 项全过。设备 Node 缺 `node:test` 与 `node:assert/strict`，本轮用本地替身运行；桌面 `npm test` 仍需复跑。
- 同步：修改已写入仓库 `Pix-Scripting/src/store/novelTranslation.ts`，并复制到实际脚本工程 `Documents/scripts/Pix-Scripting`；未改版本号、未打包、未发版，`script.json` 未改。
- 未验证：真机上真实超时后的自动恢复；需要重新导入/运行脚本后验收。

## 行内标记本地渲染（2026-10-18，已包含在 v1.7.13.8）

- 背景：正文里的 pixiv 小説記法 `[b:]`、`[i:]`、`[[emphasismark:文字>﹅]]` 之前原样显示。官方语法见 [小説作品の本文内に使えるpixiv小説記法の特殊タグとは？](https://www.pixiv.help/hc/ja/articles/235584168)；`《 》` / `《《 》》` 只是投稿时的记法转换，发布后只剩官方标签（[记法转换说明](https://www.pixiv.help/hc/ja/articles/39197091470105)）。
- 新增 `Pix-Scripting/src/ui/novelInlineMarkup.ts`：纯函数解析行内标记，提供 `formatNovelInlineHtml`（WebView）、`formatNovelInlineText`（纯文本，注音转 `汉字(假名)`）、`buildNovelStyledContent`（原生 `Text` 的 `styledText` 分段）、`hasNovelInlineMarkup`。
- 官方行内标签只有 `[b:]`、`[i:]`、`[[rb:]]`、`[[emphasismark:]]`、`[[jumpuri:]]`；`[u:]`、`[s:]`、`[big:]`、`[small:]` 不是官方语法，按普通文本原样输出，避免误吃正文。
- 接入：`NovelReader.tsx` 的 `escapeHtml` / `formatPixivRubyText` / `formatPixivRubyToHtml` 委托新模块；横向原生排版走 `styledText`（粗体/斜体），竖向 WebView 与 `NovelImmersiveReader` 输出 `<strong>` / `<em>` / `<ruby>` / `.novel-emphasis`；两套 WebView CSS 补 `strong`、`em`、`.novel-emphasis`（字符型标记不支持时回退 `filled sesame`）。
- 着重号：`[[emphasismark:文字>﹅]]` 的 mark 可为任意单字符；横排显示在文字上方、竖排右侧，与官方文档一致。原生 Text 无 text-emphasis，仅保留文字。
- 新增 `tests/novel-inline-markup.test.cjs` 15 项。设备 Node 缺少 `node:test`，本轮用等价断言脚本 `verify-inline.cjs` 跑 23 项全过（含两个阅读器 TSX 的转译语法检查）；仓库测试尚需在 iSH/桌面 `node --test` 复跑。
- 未验证：真机上横排/竖排的实际显示、简体中文着重号位置、译文与译文补丁路径的实际渲染。
- 版本已随本版升为 1.7.13.8 并打包发布。

## 当前发布：v1.7.13.7（2026-10-14）

- 从远端 feature/pixivreader-port 的 131107a 创建 fix/pixivreader-menu-text-1.7.13.7；正常快进合入并推送功能分支，不改 main，不 force push，不移动旧 tag；.diagnostics/ 保留且不提交。
- 运行源码只修改 NovelDetail.tsx:2143：删除嵌套 Menu 后的一个逗号；2186 工具栏数组分隔逗号保留。全部实际 TSX 的 Menu children AST 扫描未发现其它非空 JsxText。
- 新增 scripting-menu-text 回归 4 项（实际源码、旧提交失败/新通过、标点/空白/数组对照、合法分隔保留），真实渲染 harness 拒绝 Menu 非空字符串与数字子节点；现有真实渲染 6 项通过。
- 全量逐文件测试 19 个文件、164 项通过、0 失败；iSH 的聚合运行 worker 创建和统计不可靠，以逐文件 TAP 真实项数为准。197 个 TS/TSX 语法检查通过；无 tsconfig，本轮不是完整类型检查。
- script.json、config.ts、README、包内版本均为 1.7.13.7；remoteResource 指向 feature/pixivreader-port。构建与验证均显式指定该目标分支，198 个包内文件与工作树逐字节一致。
- 包 SHA-256：9aad0c898e2b20fc10a398fa634e2cc358a7af3444925359f4c86d5b9bab48c3。
- 最终发布提交由 annotated tag v1.7.13.7-pixivreader 标识（避免文档自引用提交号）；GitHub prerelease：https://github.com/beckyeeky/Scripting/releases/tag/v1.7.13.7-pixivreader，附件 Pix-Scripting.1.7.13.7.scripting 及其 .sha256；本地副本 /var/minis/workspace/release-1.7.13.7/。
- 本轮未重启真机验收。用户删除逗号后仅确认诊断消失，不能称白屏彻底已验收；仍需导入新包、彻底退出并重开 Scripting、进入小说详情核验。

以下为 v1.7.13.5 历史交接记录，并非当前版本状态。

更新日期：2026-10-14。此文件记录当前状态；长期规则见 [AGENTS.md](AGENTS.md)。

## 功能分支快照（v1.7.13.5，2026-10-14）

- 分支：`feature/pixivreader-port`，本轮由开发分支 `feat/pixivreader-novel-library-20261013` **普通快进合并**（`--ff-only`，无合并提交、无 force push）；合并前基线 `abfaae4`，已吸收 v1.7.13.4 的跨篇归属与导出完整性修复。
- 版本：源码、`script.json`、`src/config.ts` 回退版本、README 与包内元数据均为 `1.7.13.5`；包内 `remoteResource.url` 指向 `feature/pixivreader-port`，不会被上游或其它分支自动更新覆盖。`main` 未改动。
- 新增实现：目录/正文检索面板与「返回原位置」锚点（`novelAnchor`/`novelOutline`/`novelSearch`/`NovelOutlineSearchSheet`/`novelReaderRuntime`）；离线书库（`novelOfflineLibrary`）与正文插图字节落盘（`novelOfflineImages`/`novelOfflineCapture`）；系列离线保存（`novelSeriesOffline` + `seriesView` 入口）；译文台账（`novelTranslationLedger`）与失效段落不复用导出；译文状态面板显示术语与供应商发送范围。
- 关键行为：插图字节**复制**进书库（不是记录缓存路径），按账号隔离，断网/重启后仍可读；保存时未取到字节的插图记为 `missing`（无地址）/`pending`（超上限待补），阅读该篇时补全，UI 不谎称完整；容量淘汰只删书库正文与插图，进度与批注保留；详情或换篇网络失败时按离线优先回退并标注来源；存在 `stale` 段落时导出被拒。
- 修复：沉浸阅读器换篇失败提示此前会被 `finally` 立即清除，现改为成功后收起、失败时保留；`seriesView` 的 `handleExportSeries` 补回 `if (seriesDownloading) return` 并发保护。

## 本次验证（全部在最终树上重跑）

- 逐文件运行测试共 **154** 项通过、0 失败（`novel-translation` 26、`novel-series-reader-regression` 21、`novel-translation-ledger` 15、`novel-offline-library` 11、`novel-anchor` 9、`novel-outline-search` 9、`novel-reader-runtime` 9、`novel-offline-images` 9、`novel-translation-ui-wiring` 8、`novel-export-integrity` 6、`novel-progress` 6、`novel-series-integrity` 6、`feed-columns` 4、`novel-export` 4、`novel-immersive-episode-guard` 4、`search-advanced-date-range` 4、`novel-offline-wiring` 3）。`npm test` 在 iSH 下 node 测试运行器无法稳定创建 worker 线程、聚合计数会波动，因此以逐文件结果为准。
- 新测试使用真实实现，只替换宿主与网络边界：宿主 `FileManager` 用真实文件系统；网络用注入的 `loadBytes`/`resolveIllustUrl`/`novelDetail`/`novelViewerData`/`loadImage` 替身。离线字节落盘、路径表、补全判定、容量淘汰、目录检索、锚点、台账与导出闸门均为真实代码路径；接线断言覆盖单篇/系列离线入口、阅读器离线优先顺序与译文面板真实渲染。
- 逐文件语法诊断：`node scripts/syntax-check.cjs` 检查 `Pix-Scripting/` 全部 197 个 `.ts/.tsx`，语法错误 0。仓库无 `tsconfig.json`，这不是类型检查。
- 打包：`bash scripts/build-release.sh --target-branch feature/pixivreader-port` 通过（198 个文件与工作树逐字节一致、包内元数据校验通过）。负向验证：`--target-branch main` 报「与目标分支 main 不一致」并退出码 1；人为篡改包内 `index.tsx` 后校验报「内容不一致」并退出码 1。

## 发布（已完成）

- 开发分支 `feat/pixivreader-novel-library-20261013`：已推送到 `origin`（尖端 `2a95818`）。
- 功能分支 `feature/pixivreader-port`：已推送。**发布提交为 `c3948fe`**（打包所在提交，标签指向它），其后只有文档/脚本提交；本节所在的 handoff 提交是当前分支尖端（其父提交 `10963b1`）。提交序列：`45dba4a` 实现 → `cb14bd4` 测试 → `8155e8b` 发版与校验脚本 → `2a95818` handoff → `c3948fe` 在功能分支重建发布包 → `e770d34` Release 发布脚本 → 其后为 handoff 校正提交。`main` 未改动，未 force push；不记录 handoff 自身的提交号以免自引用。
- 标签：`v1.7.13.5-pixivreader`（annotated，指向发布包所在的 `c3948fe`；`10963b1` 只增加文档与脚本）。
- Release（prerelease）：https://github.com/beckyeeky/Scripting/releases/tag/v1.7.13.5-pixivreader，附件 `Pix-Scripting.1.7.13.5.scripting`（813,393 字节）与 `Pix-Scripting.1.7.13.5.scripting.sha256`。
- **sha256：`4e56096f68e76969ffa29f41db4dc2e2b035ca7df19085a62b8193128e1eb110`** —— 已核验三者一致：本地构建包、Release 附件下载、`raw.githubusercontent.com/.../feature/pixivreader-port/Release/Pix-Scripting.scripting` 分支 raw 地址；包内 `version=1.7.13.5`、`remoteResource.url` 指向本分支。
- 本地安装包与校验文件另存于 `/var/minis/workspace/release-1.7.13.5/`（`Pix-Scripting.1.7.13.5.scripting`、`Pix-Scripting.1.7.13.5.scripting.sha256`），仓库内只保留 `Release/Pix-Scripting.scripting` 与源码同源的那一份。

## UI 接线实测（本轮补充验证）

- 目录与检索：`novel-outline-search.test.cjs` 覆盖目录构建、检索命中上下文/顺序键、跳转目标与锚点生成；`NovelOutlineSearchSheet.tsx` 的「返回原位置」按钮与 `canReturn` 禁用逻辑由 `NovelDetail.tsx` 的 `canReturnToOutline` 状态驱动（跳转时记录 `outlineReturnAnchorRef`，返回后清空并禁用），源码接线已核对。
- 译文台账失效阻止导出：`novel-translation-ui-wiring.test.cjs` 用真实 `novelExport` 验证存在 `stale` 段落时单语与双语导出都被拒（`buildTranslatedNovelSource`/`buildBilingualNovelSource` 返回 null），并做正向对照（无失效段落时正常导出）；`NovelDetail.tsx` 三处译文导出路径与 `seriesDownloader` 系列译文导出都调用 `novelTranslationExportIssue`。
- 术语/供应商发送范围：`NovelTranslationStatus.tsx` 展开「译名、摘要与术语」后显示术语条数与系列继承条数、发送范围文案（供应商类别 + 标题/简介/章节标题数/正文段落数/术语条数/目标语言，明确不含账号序列号、令牌或本地凭据），由真实渲染测试断言（并断言不出现 `apiKey`/`Bearer` 等凭据痕迹）。
- 未在真机验证的交互手势（列表滑动跳转、高亮动效、输入法下的检索体验）仍属真机验收范围。

## 未验证（需要真机）

- 无 iOS/iPadOS 真机与 Scripting App 宿主验收：目录/检索面板实际跳转与命中高亮、返回原位置手势与滚动恢复、离线插图在 WebView 与断网重启后的显示、系列离线保存长时间运行的进度/停止/被系统回收后继续、EPUB 在第三方阅读器打开与分享、小组件与灵动岛。
- 未做真实网络下的失败回退端到端复现（仅注入网络失败），未验证真实账号切换时的目录隔离表现。
- 未运行 `npx tsc --noEmit`（仓库无 tsconfig，不构成有效类型检查）。
- 离线书库不承诺 iOS 后台常驻：页面被系统回收后需重新进入继续。

## 下一步

1. 有设备条件时按上面「未验证」清单逐项验收，记录宿主版本、路径、结果与失败现象。
2. 真机确认无误后再决定是否将 `feature/pixivreader-port` 合入 `main`（当前未授权）。
3. 若真机上离线书库占用/性能有问题，优先检查 `images/` 目录体积与 `offlineImagePathMap` 的读取频率（阅读器挂载与换篇各读一次）。
