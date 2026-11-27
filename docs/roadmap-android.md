# Pix-Scripting Android 路线图（ACP 咨询 Antigravity）

> 来源：2026-11-27 通过 `agy acp` 以只读会话咨询 Antigravity（基线 `55d9791`，alpha.4 已发布）。
> 本文为对方输出的原始分析与建议，未做功能裁剪；路径已改为仓库相对路径。

以下基于当前工作区 `feat/android-app` 分支的只读核对结果输出分析与建议（未修改任何文件）。

> **基线核对**：当前 `HEAD` 为 `55d9791`（已推送至 `origin/feat/android-app`，位于标签 `android-v1.8.14.4-alpha.4` `abec8de` 之后 1 个提交），[version.properties](apps/android/version.properties) 仍为 `1.8.14.4-alpha.4`（`versionCode=4`）。顺便提示：[handoff.md](handoff.md#L7) 仍将 `55d9791` 记为「未提交/未发版」，后续更新文档时可顺手修正为「已提交未发版」。

---

## 1. 目前缺失、已知有问题或明显未验证的功能点清单

### A. 源码已坐实的已知问题 / 空转逻辑

| 类别 | 具体问题 | 涉及文件与位置 |
| --- | --- | --- |
| **动图 MP4 编码** | `encodeUgoiraMp4` 在同一帧内先调 `codec.getInputImage(inIndex)` 又立即调 `codec.getInputBuffer(inIndex)`；按 Android `MediaCodec` 契约，后者会使前者返回的 `Image` 立即失效，后续访问 `img.planes` 极易抛 `IllegalStateException`。且未校验硬件编码器分辨率上限与 16 像素对齐。 | [PixImageMediaModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixImageMediaModule.kt#L406-L536) |
| **小说阅读器（竖排/分页/沉浸/崩溃）** | 1. `pageDisplayMode === "paged"` 仅挂了 `.paged-break` 类，CSS 中无任何定义，**「分页分隔」实际无效**。<br>2. 竖排同时给 `html, body` 设 `height: 100vh; overflow-x: auto`，Chromium WebView 易产生双滚动容器导致 `window.scrollX`/进度上报失效，且 `NovelReaderRuntime.computeAnchor` 仍按 `rect.top` 计算。<br>3. `showHud` 硬编码 `useState(true)`，未读取设置项 `novelImmersiveReaderEnabled`（设置页开关空转）。<br>4. `onLoadComplete` 忽略 `crashed: true`，WebView 渲染进程被系统回收后页面直接白屏无恢复。 | [novelHtmlBuilder.ts](apps/android/src/app/features/novel/novelHtmlBuilder.ts#L406-L450), [novelHtmlBuilder.ts](apps/android/src/app/features/novel/novelHtmlBuilder.ts#L535-L551), [NovelReaderScreen.tsx](apps/android/src/app/features/novel/NovelReaderScreen.tsx#L107), [NovelReaderScreen.tsx](apps/android/src/app/features/novel/NovelReaderScreen.tsx#L718-L720), [SettingsScreen.tsx](apps/android/src/app/features/account/SettingsScreen.tsx#L803-L808) |
| **插画 AI 助手** | 1. 使用普通对象 `{ aborted: false }` 而非 `PolyfillAbortController` 作为 `signal`，`fetchAndHttp.ts` 无法注册 `abort` 回调，点「停止」不会断开底层 `PixHttp` 连接，继续消耗模型额度。<br>2. OCR 预览容器将 `aspectRatio` 夹在 `[0.45, 2.2]` 并用 `resizeMode="contain"`，竖条长漫左右会出现黑边，但气泡坐标按整框 `imageBox.width` 计算，导致覆盖层错位。 | [IllustAISheet.tsx](apps/android/src/app/features/media/IllustAISheet.tsx#L88-L192), [IllustAISheet.tsx](apps/android/src/app/features/media/IllustAISheet.tsx#L305), [IllustAISheet.tsx](apps/android/src/app/features/media/IllustAISheet.tsx#L440-L472) |
| **Web Cookie 同步** | 设置页「网页登录同步 Web Cookie」用永不匹配的 `redirectPrefix` 打开 `presentOAuthWebView`；用户登录完点「关闭」走 `onDismiss`，原生仅返回 `{ cancelled: true }` 不带 `cookieHeader`，只能回退到单域 `syncWebCookies()`（反代域 Cookie 会丢）。 | [SettingsScreen.tsx](apps/android/src/app/features/account/SettingsScreen.tsx#L222-L256), [PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt#L623-L637) |
| **系统分享图片入口** | `AndroidManifest.xml` 声明接收 `ACTION_SEND` `image/*`，但 `App.tsx` 只处理 `.zip`/`.json`/`text/*` 与链接；用户从相册分享图片进来后**静默无任何反应**。 | [AndroidManifest.xml](apps/android/android/app/src/main/AndroidManifest.xml#L60-L64), [App.tsx](apps/android/App.tsx#L164-L210) |
| **相册保存文件名与延迟** | `ScriptingPhotos.savePhoto/saveVideo` 未透传 `opts.fileName`（缓存图存相册变成哈希文件名）且相册名写死 `"Pix-Scripting"`；同时 `photoAlbum.ts` 保存后会调用恒返回 `[]` 的 `Photos.fetchAssets` 轮询 4 次，每次白等 600ms。 | [hostGlobals.ts](apps/android/src/scripting/hostGlobals.ts#L773-L805), [photoAlbum.ts](Pix-Scripting/src/downloader/photoAlbum.ts#L98-L136) |
| **小说详情/导出元数据不一致** | 1. `NovelDetailScreen` 点离线保存只写正文，不调用 `persistOfflineImages` 保存插图（与阅读器内离线不一致）。<br>2. `NovelReaderScreen` 导出 TXT/EPUB 作者硬编码 `"Pixiv"`（`novelReader` 路由未携带 `author`/`tags`/`isR18`）。 | [NovelDetailScreen.tsx](apps/android/src/app/features/novel/NovelDetailScreen.tsx#L267-L289), [NovelReaderScreen.tsx](apps/android/src/app/features/novel/NovelReaderScreen.tsx#L578-L616), [types.ts](apps/android/src/app/navigation/types.ts#L42-L57) |
| **空转开关与失真元信息** | 1. 设置页「首图大卡片模式」`heroFirstFeedCard` 在所有列表组件中未被读取。<br>2. `AboutScreen` 硬编码包名 `com.pixscripting.android` 与版本号 `SCRIPT_VERSION`（实际为 `com.pixscripting.preview` / `1.8.14.4-alpha.4`）。<br>3. Android 13+ 未动态申请 `POST_NOTIFICATIONS` 权限，下载进度通知会被系统静默丢弃。 | [SettingsScreen.tsx](apps/android/src/app/features/account/SettingsScreen.tsx#L496-L502), [AboutScreen.tsx](apps/android/src/app/features/account/AboutScreen.tsx#L16-L17), [PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt#L790-L813) |

### B. 相对 iOS 版仍缺失的功能
- **小说详情页翻译工作台**：[NovelDetailScreen.tsx](apps/android/src/app/features/novel/NovelDetailScreen.tsx) 缺少翻译状态面板与译文/双语导出入口；[NovelTranslationSheet.tsx](apps/android/src/app/features/novel/NovelTranslationSheet.tsx) 未展示 `summaryError`、`glossaryError` 与 `alignmentWarnings`。
- **小说 `≥ 8,000 字` 过滤不完整**：[TagFeedScreen.tsx](apps/android/src/app/features/media/TagFeedScreen.tsx) 缺少 iOS v1.8.14.3 的长篇字数开关；[SearchScreen.tsx](apps/android/src/app/features/feeds/SearchScreen.tsx#L733-L799) 顶部筛选胶囊栏未展示 `≥8,000 字` 状态。
- **后台下载保活**：`ScriptingBackgroundKeeper` 在 [hostGlobals.ts](apps/android/src/scripting/hostGlobals.ts#L1044-L1049) 为空实现，[build.gradle](apps/android/android/app/build.gradle#L48) 虽引入 `androidx.work:work-runtime:2.9.1` 但未启用前台服务/WorkManager，退后台批量导出系列易被系统冻结。
- **隐私后台遮罩（PrivacyShield）与自定义 SAF 下载目录**：无切后台防窥遮罩 / `FLAG_SECURE` 选项；[PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt#L351) 的 `pickDirectory` 返回 `content://` Tree URI，但 [PixFileSystemModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixFileSystemModule.kt) 仅支持 `java.io.File`，因此目前被 [hostGlobals.ts](apps/android/src/scripting/hostGlobals.ts#L738-L744) 禁用。
- **非核心 / 平台专属**：氛围光背景（Ambient）、桌面小组件、应用内日志诊断面板与 Release 包体瘦身（当前 `minifyEnabled false`，APK ~49 MB）。

### C. 明显未验证的高风险真机项（目前仅桌面替身测试通过）
1. **登录与网络**：PKCE WebView 登录、人机验证（Cloudflare/reCAPTCHA）、自定义反代回调拦截、Grok OAuth 跳外部浏览器返回轮询、Android Keystore 锁屏变化自愈。
2. **信息流与媒体**：`MasonryFlashList` 滚动回收与 `PixImage` 缓存/损坏自愈；`IllustGalleryScreen` 双指捏合缩放与横向 `FlatList` 翻页手势抢占；`UgoiraPlayer` 逐帧播放内存与帧率。
3. **小说阅读器与 AI**：横/竖排 `PixNativeWebView` 排版、点击正文切换 HUD、翻译原位替换不漂移、离线插图回填、`NovelAISheet`（含 `55d9791`）真实 SSE 流式与停止重发。
4. **系统交互与文件**：Edge-to-Edge 安全区（刘海/挖孔、手势条 vs 三键导航、软键盘 `imeBottom`）、单根 `BackHandler` 退栈、SAF 选择大 `.zip` 备份、系统分享导入、`FileProvider` 分享导出文件（EPUB/CBZ/ZIP/TXT/JSON）与 `MediaStore` 相册落盘。

---

## 2. 建议接下来要改的内容（按 P0 / P1 / P2 排序）

### P0（发 `alpha.5` 前必改，阻塞真机核心链路）

1. **修复 Ugoira MP4 硬件编码 `MediaCodec` 缓冲区冲突与分辨率兼容**
   - **问题**：`encodeUgoiraMp4` 同循环调用 `getInputImage` + `getInputBuffer` 导致 `Image` 失效，且未对超大/非对齐尺寸做安全缩放或回退。
   - **理由**：动图存 MP4 是默认格式，真机触发大概率直接抛异常失败。
   - **涉及文件**：[PixImageMediaModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixImageMediaModule.kt#L394-L606)
   - **验收方式**：单测/真机分别用常规尺寸（如 600×800）、奇数宽高及 >1080p 的 Ugoira 导出 MP4，系统相册可正常播放、时长与原帧一致、无绿边花屏。

2. **修复小说阅读器竖排滚动、崩溃自愈与沉浸开关**
   - **问题**：竖排双滚动容器风险、分页模式无样式、WebView 渲染进程崩溃白屏、`novelImmersiveReaderEnabled` 未接线。
   - **理由**：小说阅读与翻译是本分支核心卖点，以上缺陷会在真机直接表现为进度卡死、开关无效或切后台白屏。
   - **涉及文件**：[novelHtmlBuilder.ts](apps/android/src/app/features/novel/novelHtmlBuilder.ts)、[NovelReaderScreen.tsx](apps/android/src/app/features/novel/NovelReaderScreen.tsx)、[PixNativeWebView.tsx](apps/android/src/app/features/novel/PixNativeWebView.tsx)、[NovelTypographySheet.tsx](apps/android/src/app/features/novel/NovelTypographySheet.tsx)
   - **验收方式**：补充 `android-novel-html.test.cjs` 断言；真机验证横/竖排滚动百分比实时变化、退出重进定位准确、开启沉浸默认隐藏 HUD、模拟 `onRenderProcessGone` 可自动重载并回到原锚点。

3. **加固 `IllustAISheet` 流式中止与长图 OCR 气泡坐标**
   - **问题**：`signal` 用纯对象无法触发原生 `PixHttp.abortRequest`；长竖漫 OCR 预览黑边导致气泡偏位。
   - **理由**：与 `55d9791` 同类的并发与流量/额度浪费缺陷，且长漫是 Pixiv 高频场景。
   - **涉及文件**：[IllustAISheet.tsx](apps/android/src/app/features/media/IllustAISheet.tsx)
   - **验收方式**：新增回归测试验证点停止后触发 `signal.abort()` 与迟到分片不覆写；真机用 800×3000 竖条漫跑 OCR，气泡遮罩与原文对齐且导出渲染图一致。

4. **修复 Web Cookie 网页登录关闭丢 Cookie**
   - **问题**：用户完成网页登录后点「关闭」走 `cancelled: true`，原生不回传 `cookieHeader`。
   - **理由**：导致无法通过内置浏览器给反代或标准域名同步 `PHPSESSID`，影响依赖 Web Cookie 的接口。
   - **涉及文件**：[PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt#L623-L637)、[SettingsScreen.tsx](apps/android/src/app/features/account/SettingsScreen.tsx#L222-L256)
   - **验收方式**：在 `onDismiss` 前调用 `cookieManager.flush()` 并在结果中一并附带 `cookieHeader`（或提供「完成同步」按钮）；真机登录后关闭，设置页状态立即变为「已同步」且重启保留。

5. **补齐接收系统分享图片（`image/*`）或收敛 Manifest 声明**
   - **问题**：Manifest 接受 `image/*` 分享，但 `App.tsx` 未分发给以图搜图。
   - **理由**：系统分享面板列出 Pix-Scripting 后点击无响应，属于明显坏入口。
   - **涉及文件**：[App.tsx](apps/android/App.tsx#L164-L210)、[ReverseImageSearchSheet.tsx](apps/android/src/app/features/account/ReverseImageSearchSheet.tsx)（或 [AndroidManifest.xml](apps/android/android/app/src/main/AndroidManifest.xml#L60-L64)）
   - **验收方式**：真机从系统相册「分享 → Pix-Scripting」，自动打开以图搜图并预填图片触发检索（若暂不做则先移除 `image/*` filter）。

---

### P1（面向 `beta` 必改，体验对齐与稳定性加固）

1. **相册保存透传正确文件名与相册名、消除 600ms 空轮询**
   - **问题**：保存图片落盘名为哈希串、忽略自定义相册名、每次单图保存空等 600ms。
   - **理由**：高频保存/批量保存体验差且文件不可辨识。
   - **涉及文件**：[PixImageMediaModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixImageMediaModule.kt#L213-L276)、[hostGlobals.ts](apps/android/src/scripting/hostGlobals.ts#L773-L805)
   - **验收方式**：单图与 10P 多图保存至系统相册，检查 `Pictures/<相册名>/pixiv_<id>_p1.jpg` 命名正确且无明显卡顿。

2. **补齐小说详情页离线插图、翻译状态入口与导出元数据**
   - **问题**：详情页离线保存丢插图、无译文状态/导出入口；阅读器导出硬编码作者 `"Pixiv"`；`NovelTranslationSheet` 未显示摘要/术语独立报错与对齐警告；`TagFeedScreen`/`SearchScreen` 缺 `≥8,000 字` 交互对齐。
   - **理由**：缩小与 iOS v1.8.14.4 核心阅读/翻译能力差距，避免离线后断网缺图。
   - **涉及文件**：[NovelDetailScreen.tsx](apps/android/src/app/features/novel/NovelDetailScreen.tsx)、[NovelReaderScreen.tsx](apps/android/src/app/features/novel/NovelReaderScreen.tsx)、[NovelTranslationSheet.tsx](apps/android/src/app/features/novel/NovelTranslationSheet.tsx)、[types.ts](apps/android/src/app/navigation/types.ts)、[TagFeedScreen.tsx](apps/android/src/app/features/media/TagFeedScreen.tsx)、[SearchScreen.tsx](apps/android/src/app/features/feeds/SearchScreen.tsx)
   - **验收方式**：从详情页离线一篇带插图小说后开飞行模式打开，插图完整显示；阅读器导出 EPUB 用第三方阅读器打开，作者/标签元数据正确；标签页可切换 `≥8,000 字` 过滤。

3. **Android 13+ 通知权限申请与后台下载前台服务保活**
   - **问题**：API 33+ 未申请 `POST_NOTIFICATIONS` 导致下载进度条不可见；无 Foreground Service 导致退后台导出长系列易中断。
   - **理由**：长系列漫画/小说导出动辄 1-3 分钟，用户切回桌面极常见。
   - **涉及文件**：[AndroidManifest.xml](apps/android/android/app/src/main/AndroidManifest.xml)、[PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt)、[hostGlobals.ts](apps/android/src/scripting/hostGlobals.ts#L1044-L1112)
   - **验收方式**：Android 13/14 真机首次下载弹出通知权限授权，状态栏可见实时进度条；导出 20+ 话小说系列期间切后台 2 分钟，回来任务正常完成。

4. **清理空转开关与真实构建元信息展示**
   - **问题**：`heroFirstFeedCard` 空转；`AboutScreen` 包名/版本硬编码错误；`handoff.md` 状态略滞后。
   - **理由**：消除误导用户的假设置与错误诊断信息。
   - **涉及文件**：[SettingsScreen.tsx](apps/android/src/app/features/account/SettingsScreen.tsx)、[AboutScreen.tsx](apps/android/src/app/features/account/AboutScreen.tsx)、[PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt)（暴露 `BuildConfig.APPLICATION_ID` / `VERSION_NAME` / `VERSION_CODE`）
   - **验收方式**：关于页显示 `com.pixscripting.preview` 与 `1.8.14.4-alpha.5 (5)`，且复制诊断信息一致；设置页无无效果开关。

---

### P2（`beta` 后期 / 体验打磨与工程优化）

1. **隐私遮罩（后台模糊 / `FLAG_SECURE` 防截屏开关）**
   - **问题**：缺少 iOS 版 `PrivacyShield` 对应保护。
   - **理由**：公共场合切任务管理器时防社死，Android 原生 `WindowManager.LayoutParams.FLAG_SECURE` 改动小、效果彻底。
   - **涉及文件**：[MainActivity.kt](apps/android/android/app/src/main/java/com/pixscripting/MainActivity.kt)、[PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt)、[SettingsScreen.tsx](apps/android/src/app/features/account/SettingsScreen.tsx)
   - **验收方式**：开启隐私保护后切多任务视图显示空白/黑屏保护，关闭后恢复正常。

2. **内建轻量诊断日志导出（环形内存日志）**
   - **问题**：无真机内日志出口，非开发机用户翻车难以排查。
   - **理由**：预览/Beta 阶段快速收拢网络、WebView 与 MediaCodec 故障现场（严格脱敏不记录 Token/Cookie/Key/正文）。
   - **涉及文件**：[AboutScreen.tsx](apps/android/src/app/features/account/AboutScreen.tsx)、[fetchAndHttp.ts](apps/android/src/scripting/fetchAndHttp.ts)
   - **验收方式**：关于页一键复制最近 50 条脱敏错误摘要，确认不含 Bearer/Refresh Token/API Key。

3. **清理或打通 SAF 自定义目录 & Release 包体瘦身**
   - **问题**：`PixSystemBridgeModule.pickDirectory` 处于未接入状态；全 ABI + 未开启 R8 使 APK 约 49 MB。
   - **理由**：减少死代码与下载更新流量。
   - **涉及文件**：[PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt#L350-L355)、[build.gradle](apps/android/android/app/build.gradle)
   - **验收方式**：若评估启用 R8/ABI 分包，需在真机全量复测反射/JNI/ReactMethod 不被误裁剪。

---

## 3. 到 `alpha.5` / `beta` 的分阶段路线图

### 阶段 0：真机基线摸底（先测再改）
- **内容**：在 1 台主力 Android 真机安装当前 `alpha.4`（或基于 `55d9791` 本地打 Debug 包），按核心链路跑一遍真机冒烟并收集 `logcat`，确认除源码发现的问题外是否还有机型/系统 WebView 特有缺陷。
- **出口条件**：产出明确的分项真机测试记录（登录、信息流、画廊缩放、小说横竖排、AI 流式、Ugoira、SAF 导入分享），每个失败项均附 `logcat` 或复现步骤。

### 阶段 1：`v1.8.14.4-alpha.5`（P0 清零 + 核心真机闭环）
- **内容**：连同 `55d9791` 一起落地全部 P0 修复 + 阶段 0 发现的真机阻塞项，补充对应桌面单测，升级 `versionCode=5` / `versionName=1.8.14.4-alpha.5` 并发布 Prerelease。
- **出口条件**：
  1. 桌面与 CI/CD 门禁全绿：根 `npm test`（235+）、`syntax-check`、`apps/android` `typecheck`、Android 测试全通过、Metro bundle 与签名 APK 校验通过。
  2. 单台真机完成核心链路 100% 实测通过：PKCE 或 Token 登录 → 瀑布流加载与收藏 → 多页画廊双指缩放 → Ugoira 播放 + MP4/GIF 导出相册 → 小说横/竖排阅读 + 翻译原位替换 + AI 导读流式/停止 → SAF 导入 iOS 同步包 + 导出 EPUB 分享。

### 阶段 2：`v1.8.14.4-beta.1`（P1 体验对齐 + 多机稳态）
- **内容**：完成全部 P1（相册文件名与提速、小说详情离线插图与翻译工作台、`≥8,000 字` 过滤对齐、Android 13+ 通知权限与后台下载保活、空转开关清理与真实版本/包名展示）。
- **出口条件**：
  1. 至少覆盖 **2 类机型/系统环境**（如 Android 10–12 + Android 14/15，覆盖手势导航与三键导航、深浅色与横竖屏切换）。
  2. 完成 30 分钟连续压力验收：快速刷 200+ 瀑布流卡片无 OOM/图片串图；后台切出 2 分钟长篇翻译与系列导出不中断；多账号切换无数据串库；iOS ↔ Android 跨设备同步 JSON 双向导入无报错。
  3. 从 `alpha.5` 通过 Obtainium 覆盖升级到 `beta.1`，登录态、Keystore 凭据、离线书库与译文缓存零丢失。

### 阶段 3：`v1.8.14.4-beta.2` / 候选稳定版（P2 收口）
- **内容**：按反馈补齐隐私防窥、脱敏诊断日志与包体优化评估，收敛剩余边缘缺陷与文档。
- **出口条件**：0 个 P0/P1 遗留缺陷；覆盖升级路径稳定；[apps/android/README.md](apps/android/README.md)、[handoff.md](handoff.md) 与 Release Notes 与包内元数据完全一致。

---

## 4. 最可能在真机上翻车的 3 个点及快速定位办法

### 翻车点 1：Ugoira 导出 MP4 硬件编码崩溃 / 黑屏 / 超时
- **翻车原因**：[PixImageMediaModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixImageMediaModule.kt#L476-L477) 在同一输入缓冲周期先后调用 `getInputImage(inIndex)` 和 `getInputBuffer(inIndex)`，按 Android `MediaCodec` 实现会令 `Image` 失效；此外未检查硬件 AVC 编码器对高分辨率/非 16 对齐尺寸的支持，在联发科/高通/三星不同 SoC 上容易直接 `configure()` 异常或花屏。
- **快速定位办法**：
  - **日志**：`adb logcat -v time | grep -iE "E_UGOIRA|MediaCodec|ACodec|CCodec|OMXClient|ReactNativeJS"`，重点看是否出现 `IllegalStateException`（Image 失效）、`CodecException`（configure 失败）或 `timed out waiting for EOS`。
  - **开关/对照**：在同一个动图上先点「原帧 ZIP」和「存 GIF」——若二者成功仅「存 MP4」失败，即可 100% 锁定在 `encodeUgoiraMp4`，排除网络/解压/相册权限问题。
  - **最小复现**：挑一个帧数 20–40 帧、宽高 > 1080px 或非 16 倍数的 Ugoira，进入详情页直接点「存 MP4」。

### 翻车点 2：小说阅读器竖排（`vertical-rl`）滚不动 / 进度恒为 0% / 切后台白屏
- **翻车原因**：
  1. [novelHtmlBuilder.ts](apps/android/src/app/features/novel/novelHtmlBuilder.ts#L537-L545) 同时给 `html` 和 `body` 设 `height: 100vh; overflow-x: auto`，在 Android System WebView 中经常导致滚动容器落在 `body` 而非 `window`，从而 `window.addEventListener("scroll")` 不触发或 `window.scrollX` 恒为 0，续读锚点与页码全部失效。
  2. 系统低内存回收 WebView 渲染进程触发 `onRenderProcessGone` 时，[NovelReaderScreen.tsx](apps/android/src/app/features/novel/NovelReaderScreen.tsx#L718) 未针对 `crashed: true` 重建文档，直接白屏。
  3. 竖排+翻译动态补丁后，Android 系统字体回退和 `window.scrollBy` 负方向坐标容易导致视野跳回文首。
- **快速定位办法**：
  - **日志/远程调试**：用 Debug 包连接桌面 Chrome 打开 `chrome://inspect/#devices` 审查 `PixManagedWebView`，在 Console 检查 `document.scrollingElement.scrollLeft`、`window.scrollX`、`document.body.scrollLeft` 哪个在变；同时抓 `adb logcat | grep -iE "chromium|cr_AwContents|RenderProcessGone|PixWebView"`。
  - **开关/对照**：同一篇小说在「横向阅读」与「竖排文库」间切换，观察顶栏 `第 X/Y 页 · Z%` 是否随滑动更新；开启翻译后切「原文 ↔ 译文」观察是否漂移。
  - **最小复现**：打开一篇含 `[newpage]`、`[chapter:]` 和 `[uploadedimage:]` 的长篇小说，切到「竖排文库」向左滑 3 屏，记下顶栏百分比后退出重进，检查是否停留在原位；再切后台打开相机或大型游戏后切回检查是否白屏。

### 翻车点 3：PKCE WebView 登录被拦截 / 反代网关与 Web Cookie 同步失败
- **翻车原因**：
  1. [PixSystemBridgeModule.kt](apps/android/android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt#L503-L508) 的登录 WebView 使用 Android 默认 UA（包含 `; wv`），Pixiv 登录链路中的人机验证（Cloudflare/reCAPTCHA）或 Google 第三方登录经常对 `; wv` 直接拒绝或死循环。
  2. 配置自定义反代时，如果只反代了 `app-api` 而 `accounts.pixiv.net` 仍走直连，或者回调域名与 `extractAuthCode` 允许列表不匹配，会在换码环节卡死；另加上面已发现的设置页「网页登录同步 Web Cookie」关闭弹窗不返回 `cookieHeader`。
  3. 若直连网络受限且图片源未切代理，`PixImage` 并发拉图超时/被墙时易出现大面积灰块。
- **快速定位办法**：
  - **日志**：`adb logcat -v time | grep -iE "PixHttp|PixSystemBridge|ReactNativeJS|chromium|SSL|WebView"`，关注重定向 URL、HTTP 状态码（400/403/52x）以及 `extractAuthCode` 报错文本。
  - **开关/对照**：先用登录页「导入 iOS 配置 / Refresh Token 登录」——若 Token 能直接进首页拉通信息流，即可把故障精准隔离在「OAuth WebView 登录/人机验证」而非 API 网关；同理在设置页切换图片源 `官方 ↔ pixiv.re ↔ 自定义` 可秒判图床链路问题。
  - **最小复现**：清除应用存储后冷启动，分别测试「点登录 Pixiv 账号完成 PKCE 跳转」与「登录后在设置页点网页登录同步 Web Cookie → 登录完成点关闭」，确认状态是否从「未设置」变为「已同步」。
