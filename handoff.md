# 项目交接

## 当前发布：Android 预览版 v1.8.14.4-alpha.5（2026-11-27，已发布）

- Tag `android-v1.8.14.4-alpha.5` → `9138209`；CD run `46011848461` success，`isPrerelease=true`、`isDraft=false`、`--latest=false`，iOS `v1.8.14.4-pixivreader` 仍是 Latest。
- 内容：第一轮 P0 五项 + 第二轮 P1 五项，详见 `docs/releases/android-1.8.14.4-alpha.5.md`。
- APK `Pix-Scripting-Android.apk` 49,406,815 字节，SHA-256 `e6e255f50d1d523ee67d0e074e89d3ed1948fae6346bf0df1edfa116cf3d69ce`，`SHA256SUMS` 校验通过，`unzip -t` 无错；包名 `com.pixscripting.preview`，`versionCode=5`。
- 安装：https://github.com/beckyeeky/Scripting/releases/tag/android-v1.8.14.4-alpha.5
- 真机未验收；若设备仍装 alpha.2 或更早，建议覆盖安装后自查「登录 → 信息流 → 阅读器 → 下载导出」。

## 第二轮：P1 与 P0 收尾（2026-11-27，已合并，未发版）

基线 `8d0a5af`，5 个独立 worktree 并行；4 项由 subagent 完成、2 个被中断的任务（WebView 恢复、通知保活）由 Hermes 接手补完：

1. **WebView 渲染进程回收自愈**：`PixNativeWebView` 在 `crashed` 时立刻失败所有挂起 load/eval 并清空回退队列；`NovelReaderScreen` 用 `novelReaderRecovery.ts` 的 `shouldRebuildAfterCrash` 控制重试（60s 窗口内最多 2 次自动重建），重建前同步落盘锚点、换 generation、remount WebView（key=epoch），恢复中显示提示、失败给重试卡片，手动重试重置预算。
2. **相册保存**：`savePhoto/saveVideo` 透传清洗后的 `fileName`（路径穿越/非法字符/长度 60/扩展名补全）与设置项 `downloadPhotoAlbumName`；原生 MediaStore 写 DISPLAY_NAME 与 RELATIVE_PATH；共享层按 `supportsAssetLookup` 能力标记跳过恒空的 fetchAssets 轮询（省 ~600ms），iOS 行为不变。
3. **小说详情/导出对齐 iOS**：详情页离线保存改为正文 + 插图（复用 `buildOfflineImageTasks`/`persistOfflineImages`，按 ok/failed/missing 如实汇总）；`novelReader` 路由新增 `author/tags/isR18`，首章/系列切章/书库均传入；新增 `novelExportMetadata.ts` 统一「详情 → 路由 → 占位」回退与 R-18 判定，EPUB/TXT 不再硬编码作者；翻译面板折叠展示 `summaryError/glossaryError/alignmentWarnings`。
4. **设置/关于/筛选**：`heroFirstFeedCard` 真正生效（`IllustMasonryFeed` 首条全宽大卡，接入探索与排行）；About 通过 `getAppMetadataSync()` 读 BuildConfig 真实包名/版本/构建号；新增 `novelLengthFilter.ts`，TagFeed 小说页与搜索胶囊栏接入「≥8,000 字」过滤。
5. **通知与保活**：新增 `PixDownloadService`（`dataSync` 前台服务，仅下载/导出期间存活，`START_NOT_STICKY`，启动失败自停）；Manifest 声明 `FOREGROUND_SERVICE`/`FOREGROUND_SERVICE_DATA_SYNC` 与 service；`PixSystemBridge` 新增 `requestNotificationPermission`（Android 13+，经 `PermissionAwareActivity`）、`startDownloadService`、`stopDownloadService`；`BackgroundKeeper.keepAlive/stopKeepAlive` 接到服务，`Notification.schedule` 前先请求权限。

**门禁**：根 `npm test` 235/235；Android 测试 99/99；`syntax-check` 203 文件 0 错；CI `Build Android APK` 两轮均 success（`46006928518`、`46010654919`），Kotlin 编译通过；Metro bundle 通过（真实工作区 2.7 MB）。CI 第一次 Kotlin 编译在 `ServiceCompat.startForeground` 上报 unresolved（androidx.core 版本过旧），已改用原生 `startForeground` 并在 `bb7464c` 修复。

**未验证**：所有真机行为——WebView 进程回收恢复、相册文件名/相册归类、离线插图与 EPUB 内容、≥8,000 过滤交互、Android 13+ 权限弹窗与后台保活——均未上设备；Kotlin 仅经 CI 编译，未跑仪器测试。

**下一轮**：P2（`FLAG_SECURE` 隐私遮罩、脱敏诊断日志导出、SAF 自定义目录、R8/ABI 瘦身），之后可考虑发 alpha.5（版本号仍是 alpha.4，按用户要求攒改动）。

## 进行中：P0 修复轮（2026-11-27，5 个 subagent 并行，未发版）

基线 `a891da6`，5 个独立 worktree 分支并行开发后按序合并（无冲突）：

1. **Ugoira 导出 MP4**（`fix/ugoira-mp4`，`47f113c`）：`encodeUgoiraMp4` 改为只走 `getInputImage` 的 Image plane 路径，移除同帧 `getInputBuffer`；按 `VideoCapabilities.supportedWidths/Heights` 与对齐要求等比规整尺寸；AVC 编码器硬件优先，configure/start 失败回退软编。`PixImageMediaModule.kt` +241/−104。
2. **小说阅读器排版**（`fix/novel-reader-layout`，`0c558f3`）：竖排改为 html 单一滚动容器（body `overflow: visible`），进度/锚点按排版方向取 scrollX/rect.right，兼容 vertical-rl 负值；补 `.page-divider.paged-break` 分页样式（虚线页界 + 页码胶囊）；`showHud` 读取 `AppSettings.novelImmersiveReaderEnabled` 并订阅设置变化。
3. **插画 AI 面板**（`fix/illust-ai-abort-ocr`，`766f0d3`）：三处 AI 调用改用 `PolyfillAbortController`，停止能真正触发 `PixHttp.abortRequest`，迟到分片不再覆写；新增 `ocrLayout.ts`（`computeContainedRect`/`mapBubbleBoxToRect`），OCR 预览按 contain 实际绘制区域换算气泡坐标，不再夹 [0.45, 2.2] 比例。
4. **Web Cookie 同步**（`fix/web-cookie-sync`，`4a3d166`）：原生弹窗新增 `cookieSyncOnly` 与「完成同步」，移除永不匹配的 `pix-scripting://never-auto-close`；关闭/返回/系统 dismiss 先 `CookieManager.flush()` 并回传 `cookieHeader` 与逐域 cookies，JS 新增 `webCookieSync.ts` 做逐域归并与 PHPSESSID 校验。
5. **系统分享 image/***（`fix/share-image-entry`，`5537544`）：`MainActivity` 把 `ACTION_SEND content://` 图片落为缓存文件，新增 `shareIntent.ts` 分类器与 `reverseImageSearchEntry.tsx`，接现有 SauceNAO 面板并可预填/自动检索；URI 读取失败有可见提示。

**合并与门禁（`feat/android-app` @ merge `f685ceb`）**：根 `npm test` 235/235；`node scripts/syntax-check.cjs` 203 文件 0 语法错误；`apps/android` `tsc --noEmit` 0 错误；Android 测试 53/53（新增 novel-reader 6、illust-ai 3、share-intent 8、web-cookie 14 等）；`git diff --check` 通过。

**未验证**：Kotlin 改动未本地编译（无 JDK/Android SDK），需 CI Gradle 构建；Metro bundle 在 root worktree 因 node_modules 软链 realpath 失败，非代码问题，已在真实工作区复跑；全部真机行为（Ugoira MP4、竖排滚动、停止中断、Cookie 回传、分享图片）仍需设备验收。

**下一轮**：WebView `onRenderProcessGone` 崩溃自愈 + P1 四项（相册文件名/空轮询、小说详情离线插图与翻译入口、通知权限与前台保活、空转开关与 About 元信息）。

## 历史发布：Android 预览版 v1.8.14.4-alpha.4（2026-11-27，分支 `feat/android-app`，已发布；后续加固 `55d9791` 未发版）

- **修复小说 AI 导读正文反复刷屏**：`apps/android/src/app/features/novel/NovelAISheet.tsx` 的 `onChunk` 把累计正文快照当成增量分片用 `prev + chunk` 拼接，导致每个分片都把当前全文追加一遍，表现为正文不断从头重来、越刷越长（看起来像无限循环提交）。改为整体替换为最新累计快照，导读总结与 AI 续写两条链路同时修正；与 iOS `aiSheet` 的 `throttler.flush` 语义保持一致。
- **发布结果（`alpha.4`）**：提交 `abec8deca3295c17e0fe188ad392403c7673c7f4`，标签 `android-v1.8.14.4-alpha.4`，Prerelease `https://github.com/beckyeeky/Scripting/releases/tag/android-v1.8.14.4-alpha.4`（`isPrerelease=true`、`isDraft=false`、`--latest=false`，iOS `v1.8.14.4-pixivreader` 仍为 Latest）。CI Run `45931388852` 与 CD Run `45931391963` 均为 `success`；`Pix-Scripting-Android.apk` 大小 `49,369,951` 字节，SHA-256 `be72232cc2188df78d69018caa9fce5a6d33ecd1349d20f45e1f9a1bfa4e7764`。
- **后续加固（已提交未发版，`55d9791`）**：为 `NovelAISheet.tsx` 的两处 `onChunk` 补充 `!ctrl.signal.aborted` 守卫，并将 `finally` 中的 `setRunning(false)` 移入 `if (abortRef.current === ctrl)` 保护，防止中止后迟到分片覆写正文或旧请求误清后续请求的 `running` 状态；在 `apps/android/tests/novel-ai-sheet-streaming.test.cjs` 新增相应回归用例（Android 测试 25 项）。
- **门禁**：`npm test` 235/235；`node scripts/syntax-check.cjs` 203 文件 0 语法错误；`npm --prefix apps/android run typecheck` 0 错误；Android 测试 25/25；Metro bundle 通过（2.6 MB，alpha.4 发布时运行）。
- **版本**：`apps/android/version.properties` 为 `1.8.14.4-alpha.4`（`versionCode=4`），`docs/releases/android-1.8.14.4-alpha.4.md`。
- **未验证**：真机上的流式观感、停止按钮、全文/单页切换与缓存行为，以及 `alpha.3` 原生 RN UI / WebView / Ugoira / SAF 全量真机验收。

## Android 路线图（2026-11-27，ACP 咨询 Antigravity）

完整分析见 [`docs/roadmap-android.md`](docs/roadmap-android.md)。摘要：

**P0（alpha.5 前必须修，阻塞真机核心链路）**
1. Ugoira MP4 编码：`encodeUgoiraMp4` 同循环先 `getInputImage` 再 `getInputBuffer`，会让 `Image` 失效；缺分辨率/16 对齐校验 → 真机大概率直接抛异常。
2. 小说阅读器：竖排 `html/body` 双滚动容器导致进度失效；`paged` 模式 `.paged-break` 无 CSS；`novelImmersiveReaderEnabled` 开关空转；WebView `onRenderProcessGone` 后白屏不重建。
3. `IllustAISheet`：signal 用纯对象 `{aborted:false}`，停止不断开原生请求；长条漫 OCR 预览 `contain` 黑边导致气泡坐标错位。
4. Web Cookie 同步：网页登录点「关闭」走 `cancelled:true`，不回传 `cookieHeader`，反代域 Cookie 丢失。
5. 系统分享 `image/*`：Manifest 声明了但 `App.tsx` 不分发，点分享静默无反应（或以图搜图接入）。

**P1（beta 前）**：相册保存文件名/相册名与 600ms 空轮询；小说详情离线插图 + 翻译状态/导出元数据 + `≥8,000 字` 过滤；Android 13+ 通知权限与前台服务保活；空转开关与 `AboutScreen` 假包名/版本。

**P2（beta 后期）**：隐私遮罩 `FLAG_SECURE`；脱敏诊断日志导出；SAF 自定义目录接通与 R8/ABI 瘦身。

**阶段**：0 真机基线摸底（logcat 记录）→ 1 `alpha.5`（P0 清零 + 核心链路真机通过）→ 2 `beta.1`（P1 + 双机型/压力/覆盖升级）→ 3 `beta.2`（P2 + 文档收口）。

**最可能翻车的 3 处**：Ugoira MP4（MediaCodec 缓冲/尺寸）、竖排阅读器（滚动容器 + 渲染进程回收）、PKCE 登录 WebView（`; wv` UA 被人机验证拦截 / 反代回调不匹配）。

## 上一发布：Android 原生 RN 界面架构重构 v1.8.14.4-alpha.3（2026-11-27，分支 `feat/android-app`，已发布）

- **发布结果**：提交 `beea15bb8d46778806ebb762faaeafc0dce5313d`，标签 `android-v1.8.14.4-alpha.3`，Prerelease `https://github.com/beckyeeky/Scripting/releases/tag/android-v1.8.14.4-alpha.3`（`isPrerelease=true`、`isDraft=false`、`--latest=false`，iOS `v1.8.14.4-pixivreader` 仍为 Latest）。
- **门禁结果**：`npm test` 235/235；`node scripts/syntax-check.cjs` 203 个文件 0 语法错误；`npm --prefix apps/android run typecheck` 0 错误；`node --test apps/android/tests/*.test.cjs` 23/23；Metro `bundle` 打包成功（2.6 MB）。GitHub CI Run `45927356547` 与 CD Run `45928022714` 均 `success`。
- **产物校验**：`Pix-Scripting-Android.apk` 49,369,951 字节，SHA-256 `78f7a094e291d8e2ea2d318bcc4a371253f81c4440a7d4f4800037fc6c00170a`；回下载 `SHA256SUMS` 校验 `OK`，`unzip -t` 无错误。
- **未验证**：Android 真机安装启动、登录/导入后渲染、信息流与阅读器、Ugoira/SAF 等全部交互仍需实机验收。
- **接手说明（2026-11-27）**：本轮由 Hermes 接手 Antigravity 未完成的门禁与发布，代码内容与 alpha.3 交接记录一致，未新增功能改动。

## 上一进度：Android 原生 RN 界面架构重构 v1.8.14.4-alpha.3（2026-11-27，分支 `feat/android-app`）

- **架构重构（参见 `docs/decisions.md` D016）**：
  - 将 `apps/android/` 从 SwiftUI-in-RN 映射壳全面重构为 Android 原生 React Native 界面层 `apps/android/src/app/`，保留无头 `apps/android/src/scripting/` 宿主运行时，零改动 `Pix-Scripting/`、`Release/Pix-Scripting.scripting` 及既有桌面启动图标。
  - **基础外壳与系统适配**：`src/app/theme/{insets.ts,colors.ts,ThemeProvider.tsx}`（Edge-to-Edge `PixInsetsChanged` + `effectiveBottomInset(insets) = bottom + imeBottom` + 状态栏极性）、`src/app/navigation/{types.ts,routeParser.ts,NavContext.tsx,AppShell.tsx}`（5 Tab 独立栈与单根 `BackHandler`）、`src/app/overlay/{OverlayHost.tsx,BookmarkDetailSheet.tsx,CommentsSheet.tsx,BlockWorkSheet.tsx}`（单一根级弹层宿主，全量零 RN `<Modal>` / `<SafeAreaView>`）、`src/app/components/`（URL 键控 `PixImage`、`MasonryFlashList` / `FlashList` 瀑布流与列表、`usePixivFeed`）、`src/app/screens/{LoginScreen.tsx,LoginNetworkSheet.tsx}` 与 `App.tsx`。
  - **全功能原生业务页面**：`features/feeds/`（探索/排行/历史榜/关注/追更/搜索/高级搜索）、`features/media/`（插画详情/双指缩放图库/Ugoira 播放与导出/Manga OCR/画师/特辑/系列/标签）、`features/novel/`（小说详情/横竖排文库本 `PixNativeWebView` 阅读器/翻译与离线书库/EPUB 与 TXT 导出）、`features/account/`（我的/多账号/收藏/历史统计/下载管理/设置/AI 与 Grok OAuth/屏蔽/SauceNAO）。
  - **Kotlin 原生桥接与无头运行时加固**：Edge-to-Edge Insets、`FORCE_DARK_OFF` + 命令式 `evaluateJS` + `onRenderProcessGone`、PKCE OAuth 回调拦截（含自定义反代）与异步 Cookie 清理、`gzip`/`deflate` + RFC 7578 `FormData` + 无竞态 SSE + 多字节 UTF-8 流式解码、Android Keystore 密钥失效自愈、目录级 `hotTextCache` 失效、iOS `.zip`/JSON 导入后即时内存缓存刷新与 `file://` 分享规范化。
  - **版本与文档**：`apps/android/version.properties` 升级至 `versionName=1.8.14.4-alpha.3`（`versionCode=3`），新增 `docs/releases/android-1.8.14.4-alpha.3.md`，同步更新 `apps/android/README.md`、`docs/architecture.md`、`docs/decisions.md`。
  - **测试覆盖**：新增 `apps/android/tests/{android-app-shell,android-novel-html,native-runtime-hardening}.test.cjs`，包含 25 个 Android 原生核心页面渲染烟测与无 `<Modal>` / `<SafeAreaView>` 静态约束扫描。
  - **验证与发布（2026-11-27 完成）**：全量桌面回归（`npm test`、`syntax-check`、`typecheck`、Android 单元/渲染测试、Metro bundle）与 GitHub CI/CD 签名构建均通过，已发布 `android-v1.8.14.4-alpha.3` 预发布；Android 真机覆盖安装验收待进行。

## 上一预览版：Android 完整移植预览版 v1.8.14.4-alpha.2（2026-11-26，分支 `feat/android-app`）

- **v1.8.14.4-alpha.2 白屏修复（2026-11-26）**：
  - 针对实机导入 iOS 配置与 Token 登录后出现白屏完成全链路排查与修复：
    1. `apps/android/src/scripting/hostGlobals.ts` 补齐 `UIGlass.regular()` / `UIGlass.clear()` 的 `.tint()` 与 `.interactive()` 链式方法，修复开启自定义玻璃色调/交互及加载 `IllustCard` `BookmarkButton` 时的未捕获 `TypeError`，并在 `apps/android/src/scripting/modifiers.tsx` 提取 `glass.tintColor`。
    2. `apps/android/android/app/src/main/java/com/pixscripting/PixGradientViewManager.kt` 移除 `@ReactProp(name = "colors")` 的 `customType = "ColorArray"` 并按 `ReadableType` 兼容数字/字符串颜色；`apps/android/src/scripting/gradients.tsx` 对 `processColor` 结果兜底数值化，消除不透明渐变在 Android UI 线程的 `UnexpectedNativeTypeException`。
    3. `apps/android/src/scripting/components.tsx` 修复 `ZStack` 使用 `StyleSheet.absoluteFillObject` 叠放次级图层与 `ignoresSafeArea` 全屏拉伸。
    4. `apps/android/App.tsx` 增加 `RootErrorBoundary` 异常兜底与恢复按钮，并在 Token 登录成功后自动关闭导入弹窗，避免与首页引导 `Modal` 冲突。
  - `apps/android/tests/scripting-runtime-render.test.cjs` 新增登录后完整 `RootView` + 5 Tab + `IllustFlowFeed` + `NovelCard` + `SplitShell` + 6 种氛围光渲染回归。
  - 合入 `pixiv_refined_v2_android` 桌面启动图标资源包（替换 `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png`、`play_store_512.png` 并移除旧 `ic_launcher_round.png` 与 `AndroidManifest.xml` 中的 `android:roundIcon`）。
  - 升级 `apps/android/version.properties` 至 `versionName=1.8.14.4-alpha.2`（`versionCode=2`）及新增 `docs/releases/android-1.8.14.4-alpha.2.md`。
  - **发布与 CI/CD 校验**：发布提交 `ae9b69b4bb0ead9ad03216305a3d1a763afa421e`，标签 `android-v1.8.14.4-alpha.2`，Prerelease `https://github.com/beckyeeky/Scripting/releases/tag/android-v1.8.14.4-alpha.2`；CI Run [`45833904995`](https://github.com/beckyeeky/Scripting/actions/runs/45833904995) 与 CD Run [`45833911897`](https://github.com/beckyeeky/Scripting/actions/runs/45833911897) 均为 `success`；本地与回下载 `Pix-Scripting-Android.apk`（`49,382,239` 字节，`versionCode=2`）SHA-256 均为 `73e2d2e039f82a813736e83f15d8262cbbc0fd55a5bde93cdbded3f0dcc0c52d`（`CN=Mirror Isle Android Preview`，`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`）。
  - **已验证（全量回归 + 渲染测试 + 签名构建）**：`npm test` 235/235 通过、`node scripts/syntax-check.cjs` 通过、`npm --prefix apps/android run typecheck` 0 错误、`node --test apps/android/tests/*.test.cjs` 9/9 通过、`npm --prefix apps/android run bundle:check` 与 `bash apps/android/build-preview.sh` 通过、`aapt dump badging` 确认 `com.pixscripting.preview`（`versionCode='2'`）及五档密度启动图标打包完整。
  - **待真机验证**：覆盖安装 `alpha.2` 后验证导入数据/Token 自动跳转首页、信息流/阅读器渲染、全屏异常兜底与新桌面图标显示。

- **Android 独立工程（`apps/android/`）**：
  - 参照 `mirror-isle` Android 架构搭建 React Native `0.76.7` + Hermes + Kotlin（compileSdk 35 / targetSdk 34 / minSdk 24，Gradle `8.10.2`）工程；通过 `apps/android/metro.config.js` 的 `watchFolders` 与 `extraNodeModules` 将 `"scripting"` 直接映射至 `apps/android/src/scripting/index.ts`，零修改完整复用 `Pix-Scripting/src/` 全部业务逻辑、UI 树、小说文库本 WebView 引擎、AI 翻译与离线书库（`Pix-Scripting/` 与 `Release/Pix-Scripting.scripting` 保持未改动）。
  - **JS 宿主运行时（`apps/android/src/scripting/`）**：实现 spec-compliant `URL`/`URLSearchParams`、`TextEncoder`/`TextDecoder`、`AbortController`、`Data` 与 MD5/SHA-256 `Crypto`、`fetch` + SSE 流式 `Response.body.getReader()`、185 个 SF Symbols 映射（`sfSymbols.tsx`）、iOS 语义色板与字体（`theme.ts`）、`NavigationStack` / `TabView`（底栏 + `tabViewBottomAccessory` + 分页模式）/ `List` / `Menu` / `Picker` / `WebView` / `TimelineCanvas` / `Dialog` / `DocumentPicker` / `ShareSheet` / `Photos` 等完整组件与宿主全局 API。
  - **Kotlin 原生模块（`apps/android/android/app/src/main/java/com/pixscripting/`）**：
    - `PixCredentialStore`：Android Keystore `AES/GCM/NoPadding` 256 位加密存储（本地与同步命名空间，写入回读校验与失败回滚）。
    - `PixFileSystemModule`：同步沙盒文件系统、递归列目录、ZIP 解压与 EPUB 规范打包（`mimetype` `STORED` 首位写入）。
    - `PixHttpModule`：并发 `HttpURLConnection`、自定义请求头、超时/中止、大文件响应（`> 128 KB`）临时落盘与实时 SSE 分片推送。
    - `PixWebViewManager` / `PixSystemBridgeModule`：内嵌阅读器 WebView（注入 `window.webkit.messageHandlers` Proxy）、PKCE OAuth 登录弹窗 WebView（拦截 `pixiv://account/login` 与 Cookie 提取）、离屏封面合成 WebView、SAF 文件选取、`FileProvider` 分享与通知进度。
    - `PixImageMediaModule`：同步图片尺寸与 `0..1` 氛围色盘采样、`MediaStore` 相册保存、OCR 气泡渲染、`MediaCodec` `YUV420Flexible` 硬件编码 MP4 与 GIF89a 编码。
- **原 iOS 版配置导入（`apps/android/src/import/`）**：
  - 登录页底部提供「导入 iOS 配置 / Token」入口，支持 Android 系统「分享」（`.json`/`.zip`/链接），并挂接「设置 → 跨设备同步 → 从文件导入同步数据」：支持 `Pix-Scripting-Sync-*.json`、iCloud 原始 `settings.json` / `novel_reader_settings.json` / `blocklist.json`、`CustomAIProfile`、SauceNAO 密钥数组、整包 `Pix-Scripting.zip` 目录备份及 Pixiv Refresh Token 登录，自动剥离 iOS 目录书签。
- **签名与构建产物**：
  - 新增 `apps/android/build-preview.sh`（使用 `MIRROR_ISLE_ANDROID_SIGNING_DIR` 默认 `/home/beck/.local/share/mirror-isle-android-signing/preview.p12` 与 `preview.pass`，校验 `preview-cert.sha256`）、CI 工作流 `.github/workflows/android-apk.yml`（Debug APK + 全量校验）、CD 工作流 `.github/workflows/android-release.yml`（`android-v*` 标签自动签名发布 `--prerelease --latest=false`）及发布说明 `docs/releases/android-1.8.14.4-alpha.1.md`。
  - 已生成 Debug 包 `apps/android/dist/Pix-Scripting-debug.apk`（`110,073,680` 字节）与签名预览包 `apps/android/dist/android-v1.8.14.4-alpha.1/Pix-Scripting-Android.apk`（`49,366,135` 字节，包名 `com.pixscripting.preview`，`versionCode=1`，`versionName=1.8.14.4-alpha.1`），SHA-256 `a045b942bed51ca60a377007692dceba5545803735f7ca3ac4edd5afe88393c9`。
- **正式发布与 GitHub Actions CI/CD（`beckyeeky/Scripting`）**：
  - 已推送分支 `feat/android-app`（发布提交 `7fab0efbd239d94335d9efab3307c26a4e9acd38`）及匹配标签 `android-v1.8.14.4-alpha.1`（指向该提交；发布后本交接记录单独提交，不移动标签）。
  - **GitHub Prerelease**：`https://github.com/beckyeeky/Scripting/releases/tag/android-v1.8.14.4-alpha.1`（`isPrerelease: true`，`isDraft: false`，`--latest=false` 保留 iOS `v1.8.14.4-pixivreader` 为 `Latest`）。
  - **CI (`Build Android APK`)**：Run [`45820729160`](https://github.com/beckyeeky/Scripting/actions/runs/45820729160)（attempt 2，修复根 `package-lock.json` 内网镜像替换与 `fetch-depth: 0` 后，并重跑越过 Maven Central 偶发 429 限流）结论 `success`。
  - **CD (`Release Android APK`)**：Run [`45820733703`](https://github.com/beckyeeky/Scripting/actions/runs/45820733703) 使用仓库 Secrets `ANDROID_SIGNING_P12_BASE64` / `ANDROID_SIGNING_PASSWORD` 自动签名并发布产物，结论 `success`。
  - **Release 产物回下载校验**：下载 `Pix-Scripting-Android.apk`（`49,366,135` 字节）与 `SHA256SUMS`（`92` 字节）通过 `sha256sum -c SHA256SUMS`（`a045b942bed51ca60a377007692dceba5545803735f7ca3ac4edd5afe88393c9`）及 `apksigner verify --print-certs`（`CN=Mirror Isle Android Preview`，证书 SHA-256 `17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`）。
- **已验证（桌面 Node + TypeScript + Metro + Gradle + APK 校验 + 云端 CI/CD）**：
  - `npm --prefix apps/android run typecheck`：0 错误。
  - `node --test apps/android/tests/*.test.cjs`：8/8 通过（WHATWG `URL`、MD5/SHA-256、4 种 iOS 配置导入、185 个 SF Symbols 与 `scripting` 导出全覆盖）。
  - `npm --prefix apps/android run bundle:check`：Metro 离线打包通过。
  - `npm test`：既有 iOS 回归 235/235 通过；`node scripts/syntax-check.cjs`：203 个 TS/TSX 文件 0 语法错误。
  - `(cd apps/android/android && bash ./gradlew :app:assembleDebug --no-daemon)`、`bash apps/android/build-preview.sh` 与 GitHub Actions Linux 构建全部通过；`zipalign -c`、`unzip -tq`、`aapt dump badging`、`sha256sum -c` 及 `apksigner verify` 全部通过。
  - `git diff --check`（非 `.bat` 文本）无空白错误。
- **未验证（需 Android 真机验收）**：
  - APK 在 Android 真机安装启动、PKCE WebView 登录与 Cookie 提取、Refresh Token 与自定义网关配置；
  - 瀑布流/详情大图/环境光渲染、小说横排与竖排 WebView 排版/翻译原位替换/目录高亮、Ugoira 逐帧播放与 MP4/GIF 导出、`MediaStore` 相册保存、`SAF` 导入 iOS `.json`/`.zip` 备份、`FileProvider` 分享及硬件返回键导航。

## 当前发布：v1.8.14.4（2026-11-24）

- **跨设备同步统一模块（`Pix-Scripting/src/store/crossDeviceSync.ts`）**：
  - 统一协调 iCloud 同步与无 iCloud 跨设备迁移，覆盖：程序设置（`AppSettings`）、小说阅读器设置（`NovelReaderSettings`）、插画/漫画/小说浏览历史、搜索历史、小说阅读进度、屏蔽列表（标签与画师）及 Pixivision 特辑收藏。
  - 为 `settings.ts`、`novelReaderSettings.ts`、`blocklist.ts`、`pixivisionBookmarks.ts` 补充云端热重载（`sync*FromCloud`）与合并/替换接口（`replaceNovelReaderSettings`、`mergeBlocklistData`、`mergePixivisionBookmarks`），解决运行时内存缓存不感知他端 iCloud 更新的问题；`historySync.ts` 导出 `getHistoryLastSyncTime`/`getHistorySyncState`。
  - 在 `Pix-Scripting/index.tsx`（`scenePhase === "active"` 与 `Script.onResume`）和 `Pix-Scripting/home_screen_default_ui.tsx` 接入 `triggerFullResumeSync()`。
  - 提供版本化 JSON 同步数据包导出（`exportCrossDeviceSnapshotJson`）与合并导入（`importCrossDeviceSnapshot`）：导出时剔除设备本地目录书签 `downloadCustomDirectoryBookmark`/`downloadCustomDirectoryPath`，不含登录令牌与 AI 密钥；导入时保留本机目录书签、按时间戳合并历史/进度/搜索历史并尊重删除标记与清空水位线。
- **设置页「跨设备同步」面板（`Pix-Scripting/src/ui/settings.tsx`）**：
  - 新增「跨设备同步」折叠区，展示 iCloud 同步状态、上次同步时间与同步范围概览，提供「立即与 iCloud 同步」、「导出同步数据包（文件）」、「复制同步数据到剪贴板」、「从文件导入同步数据」与「从剪贴板导入同步数据」入口。
- **版本与发布包校验**：`Pix-Scripting/script.json`、`Pix-Scripting/src/config.ts`、`README.md` 与包内元数据均为 `1.8.14.4`，`remoteResource.url` 指向 `feature/pixivreader-port`；`Release/Pix-Scripting.scripting` 大小 861350 字节，SHA-256 `0b36dfa44891b2469b0434893b825d586bf5ce27d7427906e50fd2f2a6eec2fe`，包内 204 个文件与工作树 `Pix-Scripting/` 逐字节一致，ZIP 完整性通过（Windows 无 `zip`/`unzip`，使用等价 Python `zipfile` 压缩与逐字节校验构建）。
- **测试与验证（桌面 Node + TS 转译 + 宿主替身）**：
  - 新增 `tests/cross-device-sync.test.cjs` 3 项回归，覆盖跨设备 JSON 导出/导入合并与本地书签保留、iCloud 多端热重载通知及异常包校验；更新 `tests/novel-translation.test.cjs` 中 `index.tsx` 入口替身。
  - `npm test` 235/235 通过（0 失败，0 跳过）；`node scripts/syntax-check.cjs` 检查 203 个 TS/TSX 文件，0 语法错误（非全量类型检查）；`git diff --check` 无空白错误。
- **未验证（需 iPhone/iPad 真机 Scripting 宿主验收）**：真机 iCloud Drive 跨设备实时拉取与热更新、「导出同步数据包（文件）」的 `ShareSheet` 分享与「从文件导入同步数据」的 `DocumentPicker` 选择交互。

## 当前发布：v1.8.14.3（2026-11-24）

- **撤回误发至 `main` 的 `1.8.15`**：已删除误发布至 `main` 的 `v1.8.15` GitHub Release 与远端/本地标签，并将本地 `main` 与 `origin/main` 恢复至 `754d8da`（与 `upstream/main` 一致）。所有新功能改在 `feature/pixivreader-port` 按四段版本号 `1.8.14.3` 发布。
- **小说按字数过滤（8,000 字以上开关）**：
  - `Pix-Scripting/src/types.ts` 新增 `NOVEL_MIN_TEXT_LENGTH_THRESHOLD = 8000` 及 `AdvancedSearchParams.minTextLength`。
  - `Pix-Scripting/src/ui/searchAdvancedSheet.tsx` 在「小说」范围下新增「字数筛选 / 仅看 8,000 字以上」开关，切换非小说范围或重置时自动清零。
  - `Pix-Scripting/src/ui/search.tsx` 与 `Pix-Scripting/src/ui/TagFeedPage.tsx` 依据 Pixiv 小说接口自带的 `text_length` 过滤短于阈值的小说（配合 `usePagedList` 自动多页探测），并在搜索结果页顶部筛选胶囊、重置按钮及工具栏高亮接入 `≥8,000 字` 状态。
- **Grok OAuth 登录接入（仅走 OAuth）**：
  - 新增 `Pix-Scripting/src/api/grokOAuth.ts`，实现 xAI OIDC Discovery（`https://auth.x.ai/.well-known/openid-configuration`）+ RFC 8628 Device Authorization Grant 设备码授权轮询 + single-flight `refresh_token` 自动续期。
  - `Pix-Scripting/src/store/customAI.ts` 在 `AI_PRESETS` 新增 `grok-oauth`（`Grok (OAuth)`，`authMode: "oauth"`，默认端点 `https://api.x.ai`，默认模型 `grok-4`），在配置与预设隔离中保存 `oauthRefreshToken`/`oauthExpiresAt`/`oauthAccountEmail`。
  - `Pix-Scripting/src/api/aiAdapters/index.ts` 在 `streamCustomChat` 前自动调用 `ensureFreshGrokAccessToken`，并适配 `testCustomAIConnection` 的 OAuth 登录态校验。
  - `Pix-Scripting/src/ui/customAISettings.tsx` 为 `grok-oauth` 隐藏 API Key 输入框、「无需密钥」开关与控制台链接，提供设备码一键复制、Safari 授权跳转、轮询取消、手动刷新令牌与退出登录交互。
- **版本与发布包校验**：`Pix-Scripting/script.json`、`Pix-Scripting/src/config.ts`、`README.md` 与包内元数据均为 `1.8.14.3`，`remoteResource.url` 指向 `feature/pixivreader-port`；`Release/Pix-Scripting.scripting` 大小 852778 字节，SHA-256 `3e541aaa58f35e2803e5c8ca615442d63d91f978ef863e181270c8e1005dfbd4`，包内 203 个文件与工作树 `Pix-Scripting/` 逐字节一致，ZIP 完整性通过（Windows 无 `zip`/`unzip`/`rg`，使用等价 Python `zipfile` 压缩与逐字节校验构建）。
- **已验证（桌面 Node + TS 转译 + 宿主替身）**：`npm test` 232/232 通过（含新增 `tests/grok-oauth.test.cjs` 2 项及 `tests/search-advanced-date-range.test.cjs` 8,000 字以上开关回归 1 项，0 失败，0 跳过）；`node scripts/syntax-check.cjs` 检查 202 个 TS/TSX 文件，0 语法错误（非全量类型检查）；`git diff --check` 无空白错误。
- **未验证（需 iPhone/iPad 真机 Scripting 宿主验收）**：搜索/标签页开启「仅看 8,000 字以上」后的实际多页探测与卡片表现；Grok OAuth 在 iOS Safari 弹窗授权、剪贴板自动复制、`accounts.x.ai` 实际换取 Token 与模型拉取/对话表现（且具体推理权限受 xAI 服务端账号订阅权益约束）；以及 1.8.14.2 遗留的阅读器/下载真机验收项。

## 历史发布：v1.8.14.2（2026-11-19）

- **Fork 清理与上游同步核对**：将本地 `main` 与 `origin/main` 从 `0a3eb31` 快进至 `upstream/main`（`754d8da`，Pix-Scripting 1.8.14）；确认当前工作分支 `feature/pixivreader-port` 已在 `ff47c27` 合入 `754d8da`（相对于上游 0 落后）。清理 `beckyeeky/Scripting` 仓库 24 个陈旧 GitHub Release（仅保留 `v1.8.14.1-pixivreader` 与 `v1.8.10.1-pixivreader`，不删除 git tag）。
- **行内标记与 EPUB 文本渲染统一**：
  - `Pix-Scripting/src/ui/novelInlineMarkup.ts` 扩展半角/全角单双方括号与冒号兼容（`[b:]`、`[i:]`、`［b：］`、`[[b:]]`、`［［i：］］`），重做闭合栈以跳过内部闭合的 `[[rb:]]`/`[[emphasismark:]]`/`[[jumpuri:]]`，并新增输出标准 `<a href="...">` 的 `formatNovelInlineXHtml`；保留 `buildNovelStyledContent` 原生富文本兼容（未采纳上游 1.8.14 移除方案）。
  - `Pix-Scripting/src/downloader/epubExporter.ts` 改为将 `[ruby text=...]...[/ruby]` 归一化为 `[[rb:...]]` 后复用 `formatNovelInlineXHtml`，在 `NOVEL_CSS` 补充 `strong`/`em`/`.novel-emphasis` 样式，消除阅读器与导出格式差异。
- **小说翻译链路与质量修复**：
  - `Pix-Scripting/src/store/novelTranslation.ts` 为段落块增加 `stale` 状态并在重译完成后清除（同步刷新 `stale` 计数），区块落盘与异常记录均写入当前 `model` 指纹，消除同会话重新翻译后仍被导出闸门拦截的问题；修复 `currentSeriesGlossary()` 冷磁盘回读；新增 `resolveMergedGlossary()` 并修正 `setGlossary()` 参数顺序，保证已锁定术语优先于系列词表，未锁定术语继续继承系列既有译名；新增独立 `summaryError`/`glossaryError` 字段记录摘要/术语失败原因而不覆盖总 `message`，并在 `Pix-Scripting/src/ui/NovelTranslationStatus.tsx` 展开详情中展示。
  - `Pix-Scripting/src/api/aiService.ts` 在 `cleanNovelTextForAI` 中清除 `[[emphasismark:]]` 并多轮剥离嵌套 `[b:]`/`[i:]`（含全角）；在 `tokenizeNovelPassageForSplit` 与三分点保护中纳入 `[[emphasismark:]]`；`translateNovelPassage` 兼容 `[[rb:... &gt; ...]]`、剥离着重号标记并在系统提示词约束禁止 Markdown 输出；`validateNovelTranslation` 新增基于假名/非拉丁字符占比（`>= 0.65`）的长段大比例未译拦截，避免放过半截原文结果。
  - `Pix-Scripting/src/ui/NovelReader.tsx` 的 `buildNovelTranslationPatchScript` 在支持 `innerHTML` 的 DOM 上使用 `formatPixivRubyToHtml` 渲染译文 `.chapter-title`（保留行内样式），在纯 `textContent` 测试替身上自动回退。
- **阅读器排版、安全、交互与基线类型修复**：
  - 横排沉浸阅读 CSS 增加 `max-width: 760px; margin: 0 auto` 与 `white-space: pre-wrap`；两阅读器竖排 CSS 改用 `text-orientation: mixed` 与 `overflow-wrap: break-word; word-break: normal`（替换导致字距/断词异常的 `upright` 与 `break-all`）。
  - 横排与竖排沉浸阅读器以及竖排阅读器 `buildVerticalHtml` 均接入 `escapeInlineHtml`，对图片 `dataUrl`/`title`/`author` 做 HTML 转义并校验正整数 `illustId`，同时通过 `window.pendingImages` / `flushPendingImages` 缓冲 DOM 就绪前的更新。
  - `NovelVerticalReaderView` 增加 `replayLoadedImages()` 在 `loadHTML` 就绪后重放缓存/离线插图，切换 `novelId` 时重置 `imageCacheRef` 与状态防止跨话串图，清理回调安全缩窄 `controllerSink`；两阅读器的 `translation` 副作用统一受 `readyGenerationRef` 守卫并允许置 `null` 恢复原文。
  - `NovelImmersiveReaderView` 手动重试失败段落传入 `forceSplit = true`；底栏页码容器随 `controlsVisible` 设置 `allowsHitTesting`；离线提示横幅设置 `allowsHitTesting={false}` 与 `padding={{ top: topInset + 52, horizontal }}` 避让顶部自绘栏。
  - `store/novelSearch.ts`、`ui/NovelOutlineSearchSheet.tsx`、`ui/NovelDetail.tsx` 与 `ui/NovelImmersiveReader.tsx` 接入 `resolveSearchableChunks` 与 `resolveOutlineTitle` 使译文模式下目录与正文检索匹配译文，并将命中高亮从嵌套 `<Text>` 改为原生 `styledText`。
  - `store/novelOfflineLibrary.ts` 放宽 `synthesizeOfflineNovelDetail` 的 `fallback` 参数为 `PixivNovelDetail | PixivNovel | null` 并按类型收窄字段访问。
  - 原 `REVIEW.md` 所列 `#2`（WebView 完成后重放插图）与 4 项基线 TypeScript 诊断（`PixivNovel`/`PixivNovelDetail`、`NovelOutlineSearchSheet` 嵌套 `<Text>`、`NovelReader` `controllerSink`）均已在本轮解决。
- **包内测试清理与桌面回归迁移**：将 `Pix-Scripting/src/downloader/downloadTaskManager.pauseResume.isolated.test.ts` 与 `Pix-Scripting/src/image/colorExtractor.renderCache.regression.tsx` 迁移到 `tests/download-pause-resume.test.cjs` 与 `tests/color-extractor-render-cache.test.cjs`，并删除 `Pix-Scripting/REVIEW.md`、前述两份包内临时脚本及已过时的 `scripts/publish-release.py`。
- **正式发布（v1.8.14.2）**：`https://github.com/beckyeeky/Scripting/releases/tag/v1.8.14.2-pixivreader`（非草稿、非 prerelease、Latest）；发布提交 `2cd1a630319bca45a75fe2cd4687510e70fe71ca`，匹配标签 `v1.8.14.2-pixivreader` 指向该提交；发布后交接文档单独提交，不移动标签。
- **发布包与校验**：`Release/Pix-Scripting.scripting` 大小 843181 字节，SHA-256 `4258f63c39a8e92e62fd50916190c87dc489a6190cf384bd51f442136a9d5f97`；`scripts/verify-release-package.sh --target-branch feature/pixivreader-port` 校验工作树与包内 202 个文件逐字节一致，ZIP 完整性通过，版本 `1.8.14.2` 与 fork 功能分支 `remoteResource.url` 一致；Release 附件回下载校验与本地包及 `.sha256` 逐字节一致。
- **已验证（桌面 Node + TS 转译 + 宿主替身）**：`npm test` 229/229 通过（0 失败，0 跳过）；`node scripts/syntax-check.cjs` 检查 201 个 TS/TSX 文件，0 语法错误（非全量类型检查）；`git diff --check` 无空白错误；针对改动涉及源码运行无 `scripting` 依赖的定向 TS 语义诊断均无新错。
- **未验证（需 iPhone/iPad 真机 Scripting 宿主验收）**：横/竖排 WebView 实际排版、`[b:]`/`[i:]`/着重号展示、竖排延迟加载后插图重放与连续换话切篇效果、译文模式目录检索与 `styledText` 命中高亮渲染、沉浸阅读隐藏控制条后手势穿透与离线提示横幅布局、真机下载暂停/恢复调度与冷缓存氛围色切换。
- **后续待办（自原 `REVIEW.md` 迁入，本轮未改动）**：
  1. `downloadHelper.ts` / 导出器：区分暂停导致的 abort 与用户取消，避免恢复后把在途图片记作永久失败（需受控下载服务验证）。
  2. `Hooks.tsx`：分页等待动画期间改变过滤条件是否发布旧缓冲，及尾项消费标记提前返回分支是否可靠复位。
  3. `bottomAccessory.tsx`：详情请求返回后是否覆盖用户刚修改的追更状态（需取消守卫及状态版本保护）。
  4. `UserDetailPage.tsx`：标签 effect 与 `loadDetail` 均调用 `fetchUserWorkTags`，用户切换需缓存隔离与旧请求取消。
  5. `search.tsx`：热门标签并发请求需序号保护，防止旧失败覆盖新成功。
  6. `client.ts`：OAuth token 一次性凭证重试策略需独立评估，不能仅凭 5xx 假设可安全重放。
  7. `history.ts`：大历史数组复制与整文件持久化性能测量（保持不可变快照语义，不直接共享数组原地修改）。

## 历史发布：v1.8.14.1（2026-11-14）

- 合并上游 `754d8da`（1.8.11 至 1.8.14）；保留 fork 更新地址、翻译/离线能力及既有行内加粗、斜体和注音解析。
- 合并中发现上游嵌套章节标题在 EPUB 正文与分页目录被截断，已在实际导出路径复现并修复；未闭合章节标记保持正文。补充阅读器和 EPUB 回归；桌面宿主替身补齐上游新增的 DynamicIslandBrandCapsule。
- 修复上游 DynamicIslandBrandCapsule 在横竖屏切换时 Hook 调用顺序改变的问题，增加真实组件渲染回归，确认隐藏及禁用命中测试。
- 最终桌面 `npm test` 210/210 通过；203 个 TS/TSX 文件语法检查通过（非类型检查）；安装包 205 个文件与源码逐字节一致、ZIP 完整性通过，版本与 fork 更新地址一致。SHA-256 `f31a46bb4b320418f95f19167be467a01466877b35f24e4985c848a549aa6e2a`。
- 正式 Release：https://github.com/beckyeeky/Scripting/releases/tag/v1.8.14.1-pixivreader （非草稿、非 prerelease，Latest）；发布提交 `ff47c272073e344c6308605ac0f94630ef61fc13`，匹配标签指向该提交。发布后交接文档单独提交，不移动标签。
- 安装包 848102 字节；Release 附件回下载校验通过，与功能分支 raw 包和本地包逐字节一致。
- iPhone/iPad 的阅读器字体、翻译/目录/EPUB 和上游评论、启动视觉、灵动岛展示待验收。

## 历史发布：v1.8.10.1（2026-11-08）

- 用户附件为 1.8.7.3，附件中 203 个文件的代码与远程功能分支 `1ad2932` 完全一致，仅 `script.json` 的自动更新间隔/哈希元数据不同；本次保留 fork 功能分支更新地址，不沿用附件运行期哈希。原工作区从 `dfc3d47` 快进到 `1ad2932` 后合并上游 `0a3eb31`（1.8.8 至 1.8.10）。
- 解决沉浸阅读器、高级搜索及版本/安装包冲突：自绘顶部栏保留翻译、目录、关闭和版式控制，隐藏时关闭命中测试；搜索同时保留日期边界规范化与上游标签补全；附件的队列恢复、色盘和离线图片三项源码与 `1ad2932` 一致。
- 设备专用下载暂停恢复和色盘回归来自 1.8.7.3 的既有设备报告；本次未在 Scripting 宿主执行，真实网络下载、灵动岛与冷缓存 UI 待验收。跨设备搜索历史同步新增 3 项替身边界回归：删除防复活、重新搜索、按分类清空。
- 验证：全量桌面测试 204/204，随后新增同步合并定向测试 3/3；201 个 TS/TSX 语法检查无错误（非类型检查）；安装包 203 个文件与源码逐字节一致、ZIP 完整性通过，版本和功能分支更新地址一致。
- Release：https://github.com/beckyeeky/Scripting/releases/tag/v1.8.10.1-pixivreader （非草稿、非 prerelease，Latest）；合并发布提交 `d1c71e8a4709ee38db714f22aeb3aaa3f25136ca`，标签指向该提交，功能分支已推送。
- 安装包 843604 字节，SHA-256 `8844b961af543e3e7c6f54258831578e0c851885b80c582defe2c39561ba8c70`；附件已回下载且校验通过，与功能分支 raw 安装包及本地包逐字节一致。发布后交接文档单独提交，不移动标签。
- iPhone/iPad 的搜索、跨设备同步删除、沉浸阅读顶部栏、下载暂停恢复和色盘展示待验收。

## 本次发布准备：v1.8.7.3（2026-11-07）

- 将设备运行项目中已审查的下载暂停恢复、渲染色盘内存 getter 和 OfflineImageTask.deferred 类型补齐同步至 feature/pixivreader-port；附带两项回归脚本及 REVIEW.md。未改 main，不 force push，不移动既有标签。
- 下载隔离回归通过：debounce-queued、queued-pause-resume、queued-resumed-schedulable、debounce-running、running-resume、done，A/B 各启动一次。色盘回归输出 RENDER_CACHE_REGRESSION_OK。
- 安装 TypeScript 5.9.3 后，201 个 TS/TSX 文件语法检查 0 错误；这不是完整类型检查。设备 Node 缺少 node:test，npm test 无法执行，不能声称全量桌面回归通过。设备项目保留 REVIEW.md 所列 4 项既有类型错误。
- 使用 Python 标准 ZIP 等价构建（设备无 bash/zip），包内 203 个文件与仓库源码逐字节一致，ZIP 完整性、版本 1.8.7.3 与功能分支更新地址检查通过。
- 包大小 831948 字节；SHA-256：b23918fae4de35337c28bb0432cddcd8039354494bddba7f5b60366e2c1b7a2b。推送及 Release 结果以本轮交付报告为准。
- 未做真实网络下载、灵动岛按钮和冷缓存 UI 验收；建议按 REVIEW.md 设备回归清单验证，并在桌面补跑 npm test。

## 历史发布：v1.8.7.2（2026-10-28）

- 复现：沉浸阅读器把完整翻译状态卡片悬浮于正文，横排/竖排、翻译中/完成/失败及隐藏工具栏时均存在；卡片包含「看原文」「术语表」等入口，遮挡沉浸阅读内容。
- 修复：移除沉浸阅读器中的常驻翻译卡片；顶部翻译菜单仍提供进度、原文/译文切换、暂停/继续及失败段落重试，小说详情页保留完整翻译状态、术语表与单块重试。README 已更新。
- 验证：新增横/竖排、翻译中/完成/失败、工具栏显示/隐藏及原文/译文双向切换回归；修复前六个场景均失败，修复后定向测试通过。涉及文件语法诊断与补丁空白检查通过；最终版本全量 `npm test` 201/201 通过；安装包 ZIP 完整性和包内 200 个文件与源码逐字节校验通过。SHA-256：`cfe7ef2a6b19d5048f3dd81b642759ce0919e3ee641e757ac4be08ac5ef29108`。
- Release：https://github.com/beckyeeky/Scripting/releases/tag/v1.8.7.2-pixivreader （非草稿、非 prerelease，Latest）；发布提交 `90574292514628deaac6ec603393e83440967d50`，匹配标签指向该提交，功能分支已推送。
- 安装包 `Pix-Scripting.scripting` 829061 字节，附带 `.sha256`；Release 回下载校验通过，附件、功能分支 raw 安装包与本地包逐字节一致。
- 尚未在 iPhone/iPad 上验证；需在沉浸阅读打开和滚动正文，检查卡片不再遮挡，并在顶部菜单测试切换与暂停/重试。版本 1.8.7.2 已正式发布；iPhone/iPad 验收待确定。

## 历史发布：v1.8.7.1（2026-10-28）

- 当前工作区为 `/home/beck/repos/pixivreader-scripting`。按用户指示检查 `/home/beck/repos`，原先不存在，已将前一轮远程克隆并验证的候选副本完整迁入；`/root/repos/pixivreader-scripting` 仍不可访问，未修改该目录或其未提交内容。
- 合并上游 `953094e`（1.8.7，含 1.8.2 至 1.8.6），保留本分支小说翻译、目录检索、离线书库、原文/译文导出、列数设置与下载失败分类重试；版本统一到 1.8.7.1，更新地址继续指向 fork 功能分支。
- 阅读器译文补丁接入上游当前加载代际保护：成功加载后才下发，取消及旧章节迟到的加载完成不下发。瀑布流同时保留上游缓存去重与本分支动态列数设置。新增加载成功、加载取消及旧章节迟到完成的真实路径回归，宿主 loadHTML 替身返回 boolean。
- 检查：最终 `npm test` 193/193 通过；199 个 TS/TSX 文件语法错误 0（非类型检查），1342 项相对模块引用无缺失；补丁空白检查通过。迁移后再次 fetch，无新增上游提交，并重新核对包元数据、版本、更新地址及 200 个包内文件与源码逐字节一致。
- 发布提交 `e72468eff1f088a4670c5e406b50702517cb8ab1`，标签 `v1.8.7.1-pixivreader` 指向该提交；功能分支已推送。`origin/main` 从 `f530fd3` 快进到 `953094e`，与 `upstream/main` 一致，未将功能分支合入 main。发布后的交接文档提交不移动标签。
- 正式 Release（非草稿、非 prerelease，已设为 Latest）：https://github.com/beckyeeky/Scripting/releases/tag/v1.8.7.1-pixivreader 。附件为 `Pix-Scripting.scripting`（829147 字节）及 `.sha256` 校验文件。
- SHA-256：`1bcd82f64347644ea47326ac5543ba4feaff759bdea5adb3ebc84b0478c5414a`。Release 附件已回下载，校验文件验证通过，ZIP 完整性通过；附件、分支 raw 包与本地包逐字节一致。远程标签提交及 Latest 状态已核对。
- 未做 iPhone/iPad 验收；下一步验证横竖排切章、译文显示、环境光切换不重载、目录/离线/导出、关注页及下载反馈。无桌面发布阻碍。

## 历史发布：v1.8.1.1（2026-10-24）

- 基于远程功能分支 `dacdbb6` 合并上游 `f530fd3`（1.8.1，含 1.8.0）；本地 main 已快进，与 origin/main、upstream/main 相同。功能分支的小说翻译、离线、目录检索、导出及 1.7.13.10 后续修复均保留。
- 沉浸阅读器冲突同时保留目录/正文检索 Sheet 和上游 PrivacyShield；保留本 fork 更新地址，清除上游包的 hash，源码/README/包版本统一为 1.8.1.1。
- 更新阅读器/搜索宿主替身，补入真实行内标记依赖；VM 富文本断言先转到同一 realm，数据断言不变。横排与竖排回归明确验证目录检索与隐私遮罩同时存在。
- `npm test`：190/190 通过；`git diff --check` 与暂存补丁检查通过。已完成正式发布（非草稿、非 prerelease）；发布提交 `d4b823a`，标签 `v1.8.1.1-pixivreader` 指向该提交。语法解析 200 个 TS/TSX 文件无错误（非类型检查）。构建、ZIP 完整性、201 个包内文件与源码逐字节一致。
- Release：https://github.com/beckyeeky/Scripting/releases/tag/v1.8.1.1-pixivreader 。附件 `Pix-Scripting.scripting`（821,141 字节）；回下载附件及功能分支 raw 包与本地 SHA-256 一致。
- 包 SHA-256：`6a7e5e8e01e1155cbac64317957fb451c0008a951a64ce667bf8a2312c723c16`。
- 开始任务时原工作区未提交的同步脚本、测试和文档修改隔离保留，不包含在此次发布提交。
- 未做 iPhone/iPad 验收；下一步验证首页主题切换、关注状态同步、沉浸阅读器/大图/Sheet 切后台遮罩、小说翻译/目录/离线/导出。fork 新增的小说面板尚未统一迁移 SheetScaffold，不声称所有弹窗均已覆盖隐私遮罩。

以下均为历史记录；旧版本的“当前发布”“未发版”描述只适用于其记录日期。

## 翻译运行实证排查（2026-10-18，本地修改，未发版）

- 真实数据：只读检查 29031897 的现有译文缓存，共20个正文块、18个有译文，chunk-16/19 的错误均为「检测到连续重复内容（已拆分重试）」。因此「未拆分」或「403是本例根因」均不符合现有证据；之前403归因只是推测。
- 公开原文 API 可读，正文24032字符；按真实 parseNovelToChunks 解析，全部20块源文指纹与缓存一致。chunk-16为1510字符：删除短行后看似连续重复3次，实际相邻重复最长1次；chunk-19为1533字符：原文本身确实连续重复3次。
- 根因：旧 validateNovelTranslation 先删掉不足12字符的行，再不对照原文拒绝译文的三连重复。修复保留短行作为分隔，并按源文重复组次数预算匹配译文；原文已有重复允许保留，新增组或增加次数仍拒绝。该检查为保守结构匹配，不能证明逐句语义对齐。
- 可观测性：块新增本轮 attempt 阶段，状态面板折叠时也显示子请求1/3、2/3、3/3和合并校验；失败信息区分「第N/3段失败、完成M/3」与「三段完成，合并校验失败」。不记录正文、密钥、供应商原始响应。
- 拒绝输出：保守识别开头明确针对翻译任务的拒绝，避免把拒绝说明当译文；Chat content_filter 不因已有正文而成功，Responses refusal内容块（含不重复终态正文路径）、Anthropic refusal停止原因都明确报错。cleanError 不再把这类错误洗成网络/鉴权失败。
- 验证：设备替身运行 novel-translation 36/36、novel-translation-ui-wiring 9/9、ledger 15/15；一次无敏感内容的真实原生助手请求，将重复3次的日文句翻译为3行相同中文并通过新质量检查（约2.9秒）。此请求不是用户自定义模型，也不是该小说失败块的重译。
- 限制：调试执行器读不到运行中脚本的Pixiv登录和自定义AI配置；没有在用户同一供应商重跑失败块，不能声称该篇已完整翻译成功。未改用户原文/译文缓存，18个成功块保持不变。版本仍1.7.13.10，未打包/推送。

## 当前发布：v1.7.13.10（2026-10-18）

- 修复内容审查类失败不拆分：不少服务商以 HTTP 403 返回内容策略拦截，1.7.13.8/1.7.13.9 把 403 归为鉴权失败而跳过拆分。现仅对明确的 401/unauthorized/api key 与 429/限流跳过，403 会正常三分重试。
- 「重试」与「重试全部失败段落」改为强制拆分：正文块 ≥60 字时即使上次为鉴权/限流错误，手动重试也会拆一次。
- 失败文案标注原因：`（已拆分重试）`、`（未拆分：鉴权或限流）`、`（未拆分：原文过短）`，便于判断是否真的拆分。
- 测试：`novel-translation` 31 项全过（新增 403 审查拆分、手动强制拆分）；198 个 TS/TSX 语法检查 0 错误。
- 版本一致性：`script.json`、`src/config.ts`、README 与包内元数据均为 `1.7.13.10`；打包后逐条解压比对 199 个文件、213 个条目字节一致。
- 包：`Release/Pix-Scripting.scripting`，812,984 字节，SHA-256 `247461d01b5694fefc698bad95c86fbf56eddd290729b0671029786c17a3f270`。
- 发布：提交 `a54f913`，标签 `v1.7.13.10-pixivreader`，Release（prerelease）https://github.com/beckyeeky/Scripting/releases/tag/v1.7.13.10-pixivreader ；附件包与 `.sha256` 已上传，回下载校验哈希一致，分支 raw 已返回 1.7.13.10。
- 未做真机验收：需用内容审查受限的篇目确认 403 会拆成三段，以及手动重试会强制拆分。

### 同版本重建（2026-10-18 21:0x，未改版本号）

- 修复 `validateNovelTranslation` 对源文自带重复的误判（源码证据见下节「翻译运行实证排查」）。
- 补齐子段实时阶段、拒绝状态解析与错误分类；`novel-translation` 36 项、UI 接线 9 项、台账 15 项均通过，198 个文件语法 0 错误。
- 包重建：`Release/Pix-Scripting.scripting`，814,385 字节，SHA-256 `e6f03833d764843bde070593d9d8df042a8472d843b8a95851611d287f057321`；发布资产已替换并回下载校验。代码提交 `9a33978`，标签仍为 `v1.7.13.10-pixivreader`（未移动标签）。

## 上一版：v1.7.13.9（2026-10-18）

- 修复 1.7.13.8 的拆分重试在超时场景失效：Scripting 的请求超时以 `AbortError` 结束，旧正则把 `abort` 当作取消而跳过拆分。用户暂停/取消在进入拆分前已由外层 signal 返回，故现在只跳过鉴权、限流与 <60 字的块；请求自身超时会正常三分重试（子段仍不递归）。
- 失败块错误文案追加「（已拆分重试）」：出现该后缀说明确已三分且子段仍失败；没有则说明未进入拆分。
- 测试：`novel-translation` 29 项全过（新增 AbortError 拆分与错误标注）；198 个 TS/TSX 语法检查 0 错误。
- 版本一致性：`script.json`、`src/config.ts`、README 与包内元数据均为 `1.7.13.9`；打包后逐条解压比对 199 个文件、213 个条目字节一致。
- 包：`Release/Pix-Scripting.scripting`，812,742 字节，SHA-256 `c717c71a5dd65992b525c05e4cba8d78f1b029678e6b078b011108801cf28fde`。
- 发布：提交 `8a7c8c9`，标签 `v1.7.13.9-pixivreader`，Release（prerelease）https://github.com/beckyeeky/Scripting/releases/tag/v1.7.13.9-pixivreader ；附件包与 `.sha256` 已上传，回下载校验哈希一致，分支 raw 已返回 1.7.13.9。
- 标签为推送后由 isomorphic-git 推送的轻量标签，指向发布提交；不影响安装与更新地址。
- 未做真机验收：需确认升级后超时段落会重新拆分，且失败文案带「（已拆分重试）」。

## 上一版：v1.7.13.8（2026-10-18）

- 分支 `feature/pixivreader-port`；本版包含两项功能：正文行内标记本地渲染、翻译失败后三分重试补强（参考 pixivReader 提交 `6cf04ee`）。
- 版本一致性：`Pix-Scripting/script.json`、`src/config.ts`、README 与包内元数据均为 `1.7.13.8`；`remoteResource.url` 指向本分支。
- 测试（设备 Node 无 `node:test`/`node:assert/strict`，用本地替身运行）：`novel-translation` 28、`novel-inline-markup` 15、`novel-translation-ledger` 15、`novel-translation-ui-wiring` 8 全过；`pixivreader-novel-render` 6 项中 1 项因设备 `vm.runInNewContext` 限制失败，属环境限制。桌面/iSH `npm test` 仍需复跑。
- 全量语法检查：198 个 TS/TSX 文件，0 错误（非类型检查）。
- 设备无 `bash`/`zip`，本轮用等价 Node ZIP 构建脚本生成发布包；逐条解压与工作树比对 199 个文件字节一致，包内版本与更新地址校验通过。
- 包：`Release/Pix-Scripting.scripting`，812,564 字节，SHA-256 `a5619aab183f136b9ee1d0a6af2ce81d78bf28d9fbe5f141e3622c2f85e265f2`。
- 发布：提交 `51f8a95`，标签 `v1.7.13.8-pixivreader`，Release（prerelease）https://github.com/beckyeeky/Scripting/releases/tag/v1.7.13.8-pixivreader ，附件包与 `.sha256` 均已上传并核验（附件 SHA-256 与本地一致；分支 raw 地址已返回 1.7.13.8）。
- 环境记录：本机无 `bash`/`zip`，`build-release.sh` 不可直接执行；本次用等价 Node ZIP 构建并逐条校验。isomorphic-git 技能自身 Keychain 中是旧的 40 位令牌（无写权限），推送 401；改用脚本工程 Keychain 的 93 位 fine-grained PAT 完成分支与标签推送（临时令牌文件已删除）。
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
