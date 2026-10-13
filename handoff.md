# 项目交接

更新日期：2026-10-14。此文件记录当前状态；长期规则见 [AGENTS.md](AGENTS.md)。

## 功能分支快照（v1.7.13.5，2026-10-14）

- 分支：`feature/pixivreader-port`（本轮由开发分支 `feat/pixivreader-novel-library-20261013` 快进合入）；基线 `abfaae4`，已吸收 v1.7.13.4 的跨篇归属与导出完整性修复。
- 版本：源码、`script.json`、`src/config.ts` 回退版本、README 与包内元数据均为 `1.7.13.5`；包内 `remoteResource.url` 指向 `feature/pixivreader-port`，不会被上游或其它分支自动更新覆盖。
- 新增实现：目录/正文检索面板与「返回原位置」锚点（`novelAnchor`/`novelOutline`/`novelSearch`/`NovelOutlineSearchSheet`/`novelReaderRuntime`）；离线书库（`novelOfflineLibrary`）与正文插图字节落盘（`novelOfflineImages`/`novelOfflineCapture`）；系列离线保存（`novelSeriesOffline` + `seriesView` 入口）；译文台账（`novelTranslationLedger`）与失效段落不复用导出；译文状态面板显示术语与供应商发送范围。
- 关键行为：插图字节复制进书库（不是记录缓存路径），按账号隔离，断网/重启后仍可读；保存时未取到字节的插图记为 `missing`/`pending`，阅读时补全，UI 不谎称完整；容量淘汰只删书库正文与插图，进度与批注保留；详情或换篇网络失败时按离线优先回退并标注来源；存在 `stale` 段落时导出被拒。
- 修复：沉浸阅读器换篇失败提示此前会被 `finally` 立即清除，现改为成功后收起、失败时保留。

## 本次验证

- 逐文件运行测试共 **154** 项，全部通过、0 失败（`novel-translation` 26、`novel-series-reader-regression` 21、`novel-translation-ledger` 15、`novel-offline-library` 11、`novel-anchor` 9、`novel-outline-search` 9、`novel-reader-runtime` 9、`novel-offline-images` 9、`novel-translation-ui-wiring` 8、`novel-export-integrity` 6、`novel-progress` 6、`novel-series-integrity` 6、`feed-columns` 4、`novel-export` 4、`novel-immersive-episode-guard` 4、`search-advanced-date-range` 4、`novel-offline-wiring` 3）。`npm test` 在 iSH 下 node 测试运行器无法稳定创建 worker 线程，聚合计数会波动，因此以逐文件结果为准。
- 新测试使用真实实现，只替换宿主与网络边界：宿主 `FileManager` 用真实文件系统，网络用注入的 `loadBytes`/`resolveIllustUrl`/`novelDetail`/`novelViewerData` 替身。离线字节、路径表、补全判定、容量淘汰、目录/检索、锚点、台账与导出闸门均为真实代码路径。
- 逐文件语法诊断：`node scripts/syntax-check.cjs` 检查 `Pix-Scripting/` 全部 197 个 `.ts/.tsx`，语法错误 0。仓库无 `tsconfig.json`，因此这不是类型检查。
- 打包：`bash scripts/build-release.sh --target-branch feature/pixivreader-port` 通过（198 个文件逐字节一致、包内元数据校验通过）；负向验证：`--target-branch main` 报「与目标分支 main 不一致」并退出码 1；人为篡改包内 `index.tsx` 后校验报「内容不一致」并退出码 1。

## 发布

- 开发分支 `feat/pixivreader-novel-library-20261013` 已提交并推送：`45dba4a`（实现）、`cb14bd4`（测试）、`8155e8b`（发版与校验脚本）、handoff 提交；随后普通快进合并进 `feature/pixivreader-port`。
- 标签 `v1.7.13.5-pixivreader` 打在 `feature/pixivreader-port` 的功能提交上，Release（prerelease）附 `Pix-Scripting.1.7.13.5.scripting` 与同名 `.sha256`。
- **实际结果（版本 / tag / hash / 合并 / Release 链接 / 安装包路径 / 测试 / 限制）以本轮任务回传为准**，本文不预写未完成的值；如与回传不一致，以回传为准并修订单行。
- 未合入 `main`，未 force push，未改动上游仓库。

## 未验证（需要真机）

- 无 iOS/iPadOS 真机与 Scripting App 宿主验收：目录/检索面板的跳转与命中高亮实际效果、返回原位置的手势与滚动位置、离线插图在 WebView 中的显示与断网重启后的可读性、系列离线保存长时间运行的进度与停止行为、系统回收后的继续、EPUB 在第三方阅读器中的实际打开与分享、小组件与灵动岛。
- 未做真实网络下的失败回退端到端复现（仅在测试里注入网络失败），未验证不同账号切换时的实际目录隔离表现。
- 未运行 `npx tsc --noEmit`（仓库无 tsconfig，不构成有效类型检查）。
- 离线书库不承诺 iOS 后台常驻：页面被系统回收后需重新进入继续。

## 下一步

1. 有设备条件时按上面「未验证」清单逐项验收，记录宿主版本、路径、结果与失败现象。
2. 真机确认无误后，再决定是否将 `feature/pixivreader-port` 合入 `main`（当前未授权）。
3. 若离线书库占用或性能在真机上有问题，优先检查 `images/` 目录体积与 `offlineImagePathMap` 的读取频率（当前在阅读器挂载与换篇时各读一次）。
