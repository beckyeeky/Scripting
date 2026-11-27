# Pix-Scripting Android 1.8.14.4-alpha.5

> [!NOTE]
> 本发布为 Android 预览频道累计修复版（`--prerelease`，`--latest=false`），可直接在 `alpha.3` / `alpha.4` 上覆盖升级，保留已导入的配置与登录态，不会覆盖 iOS `Latest` 发布（`v1.8.14.4-pixivreader`）。

## 新功能与修复（两轮并行，共 10 项）

### 下载与导出

- **Ugoira 导出 MP4 不再失败**：`encodeUgoiraMp4` 去掉同一帧里 `getInputImage` 之后又调 `getInputBuffer` 的写法（后者会让前者的 `Image` 立即失效），改为只走 Image plane 拷贝；输入尺寸按编码器 `VideoCapabilities` 规整为偶数并等比缩放；硬件 AVC 编码器 configure/start 失败时自动回退软件编码器。
- **相册保存文件名与相册名**：保存插画/视频时透传清洗后的文件名（防路径穿越、非法字符、限长 60、自动补扩展名），相册名取自设置项 `downloadPhotoAlbumName`；Android 宿主不再用哈希文件名写入相册。
- **去掉相册保存前的空轮询**：Android 的 `fetchAssets` 恒为空，原实现仍会轮询 4 次、每次白等 600ms；现在按宿主能力标记跳过，iOS 行为不变。

### 通知与后台任务

- **Android 13+ 通知权限**：首次显示下载/导出通知时动态申请 `POST_NOTIFICATIONS`，不再被系统静默丢弃。
- **下载/导出前台服务保活**：新增 `PixDownloadService`（`dataSync` 类型，`START_NOT_STICKY`，只在任务进行期间存活），`BackgroundKeeper.keepAlive/stopKeepAlive` 接入引用计数；退到后台的长任务不再被轻易冻结。

### 小说

- **AI 导读/续写刷屏修复（alpha.4 延续）**：`onChunk` 按累计快照整体替换，不再 `prev + chunk`；abort 守卫与请求身份判断保留。
- **竖排阅读器**：改为 html 单一滚动容器，解决 html/body 双滚动导致的进度失效；进度与锚点按排版方向取 `scrollX`/`rect.right`（兼容 vertical-rl 负值），退出重进可回到原位。
- **paged 分页模式**：补齐 `.paged-break` 页界样式与页码，分页不再是无样式的空类名。
- **沉浸阅读开关**：`showHud` 初始值读取 `novelImmersiveReaderEnabled`，设置变化即时生效。
- **渲染进程回收自愈**：WebView `onRenderProcessGone` 后自动重建文档并恢复阅读位置（60 秒内最多自动重试 2 次），恢复中显示提示，失败给「重试恢复」卡片，进度已提前落盘不丢。
- **详情页离线保存带插图**：正文与插图一起落盘，按成功/失败/缺失如实汇总，不再谎称完整。
- **导出元数据**：EPUB/TXT 使用真实作者，EPUB 写入标签与 R-18 标记；`novelReader` 路由新增 `author/tags/isR18`。
- **翻译状态**：折叠面板展示 `summaryError`、`glossaryError` 与 `alignmentWarnings`。
- **`≥8,000 字` 过滤**：TagFeed 小说页与搜索胶囊栏接入长篇过滤，与 iOS 一致。

### 插画与信息流

- **插画 AI 停止真正生效**：三处 AI 调用改用 `PolyfillAbortController`，点停止即断开原生请求，迟到分片不再覆写状态。
- **长条漫 OCR 气泡对齐**：预览按 `contain` 的实际绘制区域换算气泡坐标，不再夹在 [0.45, 2.2] 比例导致左右黑边错位。
- **首图大卡片模式**：`heroFirstFeedCard` 在探索与排行信息流真正生效（首条全宽大卡）。

### 账号、分享与设置

- **网页登录同步 Cookie**：关闭登录 WebView 时先 `CookieManager.flush()` 并回传逐域 Cookie（含反代域），新增「完成同步」按钮，不再只回 `cancelled:true`。
- **系统分享图片**：从相册/其他应用分享 `image/*` 进来，落缓存文件后直接打开 SauceNAO 以图搜图，URI 读取失败有可见提示。
- **关于页**：包名、`versionName`、`versionCode` 改为从 BuildConfig 读取，不再硬编码。
- **设置页清理**：移除无实现的假开关，保留项均接到真实逻辑。

## 回归与门禁

- 根测试 **235/235**；Android 测试 **99/99**（新增流式、恢复、相册、Cookie、分享、过滤、元信息等用例）。
- `node scripts/syntax-check.cjs`：203 个文件 0 语法错误；Metro bundle 通过（约 2.7 MB）。
- CI `Build Android APK`：`46006928518`、`46010654919` 均 success，Kotlin 编译通过。
- 修复过程中 CI 首次在 `ServiceCompat.startForeground` 报 unresolved（androidx.core 版本过旧），已改用原生 `startForeground` 并在 `bb7464c` 修复。

## 签名与 Obtainium 配置

- **包名**：`com.pixscripting.preview`（`versionName = 1.8.14.4-alpha.5`，`versionCode = 5`）
- **签名证书 SHA-256**：`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`
- **Release 附件**：`Pix-Scripting-Android.apk`、`SHA256SUMS`

## 未验证

- 所有真机行为均未在本次发布前上设备验证：Ugoira 导出 MP4、竖排滚动与进度恢复、paged 分页、停止中断、Cookie 回传、系统分享、渲染进程回收自愈、相册文件名/归类、通知权限弹窗与后台保活。
- Kotlin 代码仅经 CI 编译，未跑仪器测试；EPUB/TXT 内容与离线插图字节未逐项核对。
- 若设备仍装 alpha.2 或更早版本，建议先覆盖安装本版后做一次「登录 → 信息流 → 阅读器 → 下载导出」核心链路自查。
