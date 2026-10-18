# 重要决策

2026-10-13 根据当前源码、测试与 README 补录既有决策；下列日期是记录日期，原始决定日期待确定。工作约定与实现事实分开标注；后续追加状态、选择、原因、影响和证据，已被替代的记录保留并链接新记录。

## D001：保留 Scripting 原生宿主与其他模块

- 状态：已实现；持续工作约定。
- 选择：移植 PixivReader 小说行为，继续使用 Scripting TSX/原生入口与内嵌 WebView，不引入 Web/PWA 运行时。
- 原因：现有客户端包含账号、图片、下载、系统集成和 iPad 导航；沿现有边界扩展能保留这些能力。
- 影响：UI 和生命周期需要真实宿主验证，Node 测试不能代替设备验收。
- 依据：`Pix-Scripting/index.tsx`、`src/ui/appRoot.tsx`、`src/ui/NovelReader.tsx`、根 `package.json`。

## D002：译文与原文分离，显示位置保持一致

- 状态：已实现。
- 选择：翻译由独立会话和块快照管理，译文更新已有正文块，可切回原文；导出时重建源文本并保留章节、分页、插图、跳页与链接结构。
- 原因：避免改写原始正文、阅读进度或破坏导航，也让阅读与导出复用同一份译文。
- 影响：块 ID/解析规则是阅读、缓存与导出的共同契约，修改必须覆盖这些调用方。
- 依据：`src/store/novelTranslation.ts`、`novelExport.ts`、`src/ui/NovelReader.tsx`、`tests/novel-export.test.cjs`。

## D003：译文缓存按账号、语言和内容校验

- 状态：已实现。
- 选择：自定义模型译文保存本地账号专属目录，以内容/配置指纹判断复用；密钥不参与指纹。Scripting 原生助手译文只保留当前会话。
- 原因：阻止跨账号、目标语言、正文或模型配置串用；原生助手无法提供可靠的模型标识。
- 影响：内容/配置变化可能需重译；文件写入失败保留当前内存结果并提示，不能声称已经落盘。
- 依据：`src/store/novelTranslation.ts` 的 `modelIdentity`、会话初始化、`persist`，以及 `tests/novel-translation.test.cjs`。

## D004：翻译并发受限，失败恢复保留成功结果

- 状态：已实现。
- 选择：先摘要后术语，正文最多两个请求并发；失败正文块仅三分重试一次，超时也触发，鉴权、限流、取消与过短块不拆。支持暂停、继续与单块重试，使用取消信号和任务代次隔离迟到结果。
- 原因：减少长文上下文与请求压力，控制失败重试成本，并防止后台恢复时旧结果覆盖新任务。
- 影响：上下文失败可继续正文；失败块可单独恢复。关闭思考参数由适配器按当前实现的模型规则发送，新增/更新规则须核对服务商官方文档。
- 依据：`src/store/novelTranslation.ts`、`src/api/aiService.ts`、`src/api/aiAdapters/translationThinking.ts`、翻译回归测试。

## D005：系列译文导出必须完整，下载入口共用流程

- 状态：已实现。
- 选择：系列页工具栏、底部栏与追更菜单共用原文/译文选择；译文导出复用已完成缓存，缺章、正文失败或账号切换即停止，不自动开始翻译。
- 原因：避免入口行为分歧、混合原译文、漏章或跨账号导出；不让导出动作隐式产生翻译费用。
- 影响：用户需先完成全系列各话译名、必需简介与正文；原文下载保留原有逐章容错，与译文严格性不同。
- 依据：`src/ui/novelSeriesDownload.ts`、`src/downloader/seriesDownloader.ts`、`tests/novel-series-reader-regression.test.cjs`。

## D006：源码为准，发布包可重建

- 状态：打包机制已实现；完整发版为持续工作约定。
- 选择：编辑 `Pix-Scripting/` 源码，由 `scripts/build-release.sh` 打包；采用上游三段版本加移植小版本，更新地址保留功能分支。正式发布同时交付分支、标签和含包的 GitHub Release。
- 原因：避免直接修改压缩包造成源码/产物不一致，避免设备更新到不含本分支功能的上游包。
- 影响：版本需同步元数据、配置回退、README 和包；构建只检查部分约束，仍需人工核对。仅推送分支不代表完整发版。
- 依据：README「修改源码与重新发布」、`Pix-Scripting/script.json`、`src/config.ts`、`scripts/build-release.sh`；流程要求见 [AGENTS.md](../AGENTS.md)。

## D007：长期规则、进度、架构与决策分开维护

- 状态：本次建立的工作约定。
- 选择：`AGENTS.md` 保存稳定规则，`handoff.md` 保存当前进度，架构变化更新 `architecture.md`，重要选择追加此文件。
- 原因：使后续任务能快速接手，避免临时状态混入长期约束或把猜测当作项目事实。
- 影响：任务开始读规则与交接，结束更新交接；未知项明确标记“待确定”。
- 依据：本次用户要求。

## D008：跨篇阅读状态必须显式绑定「当前作品 + 当前页」

- 状态：已实现（修复分支 `fix/futurereader-novel-integrity-20261013`）。
- 选择：沉浸阅读器内部换章后，阅读进度、跳页与书签一律按内部持有的当前作品 ID 写入；切入的作品书签改为读取该作品自己的书签并直接调用其书签接口；正文文档带代际标识，切章后旧文档迟到的滚动进度/跳页/系列翻页按代际丢弃；关闭全屏仍回传最终作品、页码与锚点。父级回调（普通阅读器）保留原签名，仅在内部换章时改写为当前作品归属。
- 原因：进入阅读器时传入的 `novelId` 与父级 `currentPage`/`markerPage` 绑定原作品，内部换章后继续使用会把新作品页码写到原作品、把原作品书签状态显示到新作品，旧 DOM 的迟到进度也会污染新作品。
- 影响：新增可选属性 `onToggleMarkerAtPage`（按页码切换书签，避免父级页码滞后）与正文代际参数；不破坏既有调用方。
- 依据：`src/ui/NovelImmersiveReader.tsx`、`src/ui/NovelDetail.tsx`、`src/store/novelProgress.ts`、`src/store/bookmarkSync.ts`、`tests/novel-immersive-episode-guard.test.cjs`。

## D009：导出必须报告完整性，失败图片不得留下悬空引用

- 状态：已实现（修复分支 `fix/futurereader-novel-integrity-20261013`）。
- 选择：原文系列导出逐章记录失败（序号、标题、原因），仍导出其余章节，并在书内首页、文件名（`_缺N章`/`_缺N图`）与任务摘要中明确「成功 x/y 章」；只有真正落盘成功的插图才进入正文引用与 EPUB manifest，缺失插图在书内标注；导出结束时通过 `onIntegrityReport` 回报预期/成功/失败数量。
- 原因：原先单章异常仅写日志并继续，图片下载失败不落盘但 manifest 与正文仍引用，最终给出「整本导出成功」的错误提示，用户无法判断缺章缺图。
- 影响：`exportNovelToEpub` 新增可选 `expectedChapters`、`missingChapters`、`onIntegrityReport`；发布文件名可能带缺失后缀；译文导出仍保持「缺章即失败」。
- 依据：`src/downloader/seriesDownloader.ts`、`src/downloader/epubExporter.ts`、`tests/novel-series-integrity.test.cjs`、`tests/novel-export-integrity.test.cjs`。

## D010：重试必须区分瞬时故障与确定失败

- 状态：已实现（修复分支 `fix/futurereader-novel-integrity-20261013`）。
- 选择：新增二进制下载明细结果与失败分类（`auth`/`permission`/`notFound`/`rateLimited`/`server`/`network`/`empty`/`canceled`）；仅瞬时故障有限重试（最多 2 次尝试），401/403/404/410、账号切换与取消立即失败；取消/暂停沿任务令牌向上传播。
- 原因：对无效凭据或受限内容反复重试会放大请求、延长失败等待，并可能把取消误当成缺章继续导出。
- 影响：`downloadBinary` 语义不变（仍返回数据或 null）；新增 `downloadBinaryDetailed`、`fetchImageBinaryWithResult`、`runWithLimitedRetry`、`classifyDownloadError`、`classifyHttpStatus`。
- 依据：`src/api/client.ts`、`src/downloader/downloadHelper.ts`、`tests/novel-export-integrity.test.cjs`。

## D011：离线阅读必须是「字节真实落盘」，并按账号隔离

- 状态：已实现（功能分支 `feature/pixivreader-port`，v1.7.13.5）。
- 选择：保存离线时把阅读器缓存中的插图字节**复制**进书库目录（`images/<novelId>/<stableHash(chunkId)>.<ext>`），而不是记录缓存路径；书架路径与读取都不依赖阅读器缓存是否还在。读取只走磁盘（`offlineImagePathMap` 只返回状态为 ok 且文件存在的块），断网或进程重启后仍可读；保存时没拿到字节的插图记为 `missing`（未解析到地址）或 `pending`（超出本次上限/待补），阅读该篇时用真实拿到的字节补全，UI 不得把二者说成完整。
- 原因：只统计「有 URL」或只记缓存路径时，阅读器 LRU 清理或换设备后会声称图片完整却显示缺图；跨账号混用同一目录又会串数据。
- 影响：书库目录按 `resolveEffectiveUID` 分账号；`offlineLibraryUsage` 计入插图字节；容量淘汰同时删除正文与插图字节，但绝不触碰 `History/` 下的进度与批注。
- 依据：`src/store/novelOfflineLibrary.ts`、`src/store/novelOfflineImages.ts`、`src/ui/novelOfflineCapture.ts`、`tests/novel-offline-images.test.cjs`、`tests/novel-offline-library.test.cjs`。

## D012：网络失败必须按「离线优先」回退，并如实标注来源

- 状态：已实现（功能分支 `feature/pixivreader-port`，v1.7.13.5）。
- 选择：详情接口失败时用离线记录合成最小作品元数据（`synthesizeOfflineNovelDetail`）继续阅读并显示「离线阅读」横幅；沉浸阅读器内部换篇在网络失败且目标话已离线时载入离线正文与插图，并在顶部标注「离线阅读：本话正文来自离线书库」；没有任何离线记录时保持失败并显示可见提示（换篇失败提示不再被立即清除）。
- 原因：断网时磁盘上正文完整却因缺少元数据落到错误页、或换篇失败提示被 finally 立刻覆盖，用户会以为内容丢失或操作无效。
- 影响：`NovelImmersiveReaderView` 新增离线标注状态；换篇失败路径修复提示可见性；不改变在线成功路径。
- 依据：`src/ui/NovelDetail.tsx`、`src/ui/NovelImmersiveReader.tsx`、`tests/novel-offline-wiring.test.cjs`。

## D013：失效译文不得静默复用，发送范围必须在 UI 可见

- 状态：已实现（功能分支 `feature/pixivreader-port`，v1.7.13.5）。
- 选择：译文段落状态由「原文块指纹 + 整篇指纹 + 不含密钥的模型/提示词配置指纹」决定；存在 `stale` 段落时单语/双语/系列导出一律拒答并要求重译，`buildTranslatedNovelSource` 也只在块状态为 `done` 时输出，形成双重保险。术语表可编辑并锁定；状态面板展开时显示术语条数、系列继承条数与发送范围（供应商类别、标题/简介、章节标题数、正文段落数、术语条数、目标语言），并明确不含账号序列号、令牌或本地凭据。
- 原因：源文或模型配置变化后复用旧译文会输出与原文不符的内容；用户也无法判断会向哪个服务商发送哪些内容。
- 影响：新增 `store/novelTranslationLedger.ts`；`NovelTranslationStatus` 详情区新增发送范围与对齐警告；供应商判定只返回类别（`assistant`/`openai`/`anthropic`/`gemini`/`unknown`）。
- 依据：`src/store/novelTranslationLedger.ts`、`src/store/novelExport.ts`、`src/ui/NovelTranslationStatus.tsx`、`tests/novel-translation-ui-wiring.test.cjs`、`tests/novel-translation-ledger.test.cjs`。

## D014：发布包校验必须显式声明目标分支

- 状态：已实现（功能分支 `feature/pixivreader-port`，v1.7.13.5）。
- 选择：`scripts/build-release.sh` 与 `scripts/verify-release-package.sh` 支持 `--target-branch <分支>`（等价环境变量 `RELEASE_TARGET_BRANCH`）。未显式给出时构建脚本取当前分支；两者都要求 `remoteResource.url` 指向的目标分支等于声明值，否则失败。这样可在开发分支构建、合并到目标分支后发布，同时保证包内更新地址指向真正的发布分支。
- 原因：功能开发分支与最终发布分支不同，原校验只接受「当前分支 == URL 分支」，会阻止在开发分支上完成打包与逐字节校验。
- 影响：`remoteResource.url` 在 v1.7.13.5 指向 `feature/pixivreader-port`；发布流程须显式传入目标分支。
- 依据：`scripts/build-release.sh`、`scripts/verify-release-package.sh`。
