# 项目交接

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
- 功能分支 `feature/pixivreader-port`：已推送，当前尖端 **`10963b1`**（提交序列：`45dba4a` 实现 → `cb14bd4` 测试 → `8155e8b` 发版与校验脚本 → `2a95818` handoff → `c3948fe` 在功能分支重建发布包 → `e770d34` Release 发布脚本 → `10963b1` 最终 handoff）。`main` 未改动，未 force push。
- 标签：`v1.7.13.5-pixivreader`（annotated，指向发布包所在的 `c3948fe`；`10963b1` 只增加文档与脚本）。
- Release（prerelease）：https://github.com/beckyeeky/Scripting/releases/tag/v1.7.13.5-pixivreader，附件 `Pix-Scripting.1.7.13.5.scripting`（813,393 字节）与 `Pix-Scripting.1.7.13.5.scripting.sha256`。
- **sha256：`4e56096f68e76969ffa29f41db4dc2e2b035ca7df19085a62b8193128e1eb110`** —— 已核验三者一致：本地构建包、Release 附件下载、`raw.githubusercontent.com/.../feature/pixivreader-port/Release/Pix-Scripting.scripting` 分支 raw 地址；包内 `version=1.7.13.5`、`remoteResource.url` 指向本分支。
- 本地安装包与校验文件另存于 `/var/minis/workspace/release-1.7.13.5/`（`Pix-Scripting.1.7.13.5.scripting`、`Pix-Scripting.1.7.13.5.scripting.sha256`），仓库内只保留 `Release/Pix-Scripting.scripting` 与源码同源的那一份。

## 未验证（需要真机）

- 无 iOS/iPadOS 真机与 Scripting App 宿主验收：目录/检索面板实际跳转与命中高亮、返回原位置手势与滚动恢复、离线插图在 WebView 与断网重启后的显示、系列离线保存长时间运行的进度/停止/被系统回收后继续、EPUB 在第三方阅读器打开与分享、小组件与灵动岛。
- 未做真实网络下的失败回退端到端复现（仅注入网络失败），未验证真实账号切换时的目录隔离表现。
- 未运行 `npx tsc --noEmit`（仓库无 tsconfig，不构成有效类型检查）。
- 离线书库不承诺 iOS 后台常驻：页面被系统回收后需重新进入继续。

## 下一步

1. 有设备条件时按上面「未验证」清单逐项验收，记录宿主版本、路径、结果与失败现象。
2. 真机确认无误后再决定是否将 `feature/pixivreader-port` 合入 `main`（当前未授权）。
3. 若真机上离线书库占用/性能有问题，优先检查 `images/` 目录体积与 `offlineImagePathMap` 的读取频率（阅读器挂载与换篇各读一次）。
