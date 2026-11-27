# Pix-Scripting Android 1.8.14.4-alpha.3

> [!NOTE]
> 本发布为 Android 预览频道架构重构版（`--prerelease`，`--latest=false`），可直接在 `1.8.14.4-alpha.1` / `1.8.14.4-alpha.2` 上覆盖升级，保留已导入的配置与登录态，不会覆盖 iOS `Latest` 发布（`v1.8.14.4-pixivreader`）。

## 重大架构升级

- **全面迁移至 Android 原生 React Native UI（`apps/android/src/app/`）**：
  - 彻底移除旧版 SwiftUI-in-RN 兼容外壳渲染路径，重构为基于 React Native `0.76.7` + Hermes + `@shopify/flash-list` 的原生 Android 界面层；直接复用 `Pix-Scripting/src/` 全部核心业务逻辑（PKCE OAuth、自定义 API/OAuth/图片网关、AI 翻译台账、EPUB/CBZ 导出、离线小说书库、跨设备同步与屏蔽/历史持久化），保证与 iOS 端数据与协议 100% 兼容。
  - **Edge-to-Edge 全面屏与安全区适配**：原生 `MainActivity` 开启 `WindowCompat.setDecorFitsSystemWindows(false)` 并通过 `PixSystemBridge.getWindowInsetsSync()` + `PixInsetsChanged` 实时同步状态栏、导航栏与软键盘 `imeBottom`；所有表单/评论/弹层统一使用 `effectiveBottomInset(insets)`（`bottom + imeBottom`）避让三键导航栏与输入法。
  - **单一根级 OverlayHost 与单根硬件返回键**：全应用零原生 `<Modal>` 叠层冲突，所有 Sheet / ActionSheet / Dialog / Toast 统一挂载于根部 `OverlayHost`；单个 `BackHandler` 严格按「关闭顶层弹层 → 仅弹出当前激活 Tab 栈 → 切回启动 Tab → 退出」执行。
  - **高性能信息流与图片加载**：`MasonryFlashList` / `FlashList` 瀑布流与列表配合 URL 键控 `PixImage`（消除回收单元旧图闪烁、损坏缓存重试自动剔除），支持深浅主题与自定义玻璃强调色。
- **全功能原生页面覆盖**：
  - **登录与 iOS 导入**：PKCE OAuth（修复官方与自定义网关 `/web/v1/users/auth/pixiv/callback` 及 `pixiv://` 拦截）、网络/反代配置面板、iOS 同步 JSON / 原始配置 / 整包 `.zip` / Refresh Token 导入（导入后即时刷新内存缓存）。
  - **四大信息流 Tab**：探索（推荐/最新/Pixivision 特辑）、排行（自定义榜单与历史排行榜日期筛选）、关注（关注动态/追更列表/好P友）、搜索（数字 ID 与 Pixiv 链接直达、标签联想、历史与热门标签网格、完整高级搜索）。
  - **媒体、画师与创作详情**：多页插画详情、双指缩放与双击大图浏览、Ugoira 逐帧播放与原生 MP4/GIF/ZIP 导出、Manga OCR 汉化与图译、画师主页/作品/收藏/关联、Pixivision 特辑、漫画/小说系列与标签页。
  - **小说详情、文库本阅读器与离线书库**：原生 `PixWebView`（禁用系统 `FORCE_DARK`、支持命令式 `evaluateJS` 与渲染进程恢复）支持横排与竖排文库本（`writing-mode: vertical-rl`、注音、着重号、标点悬挂）、AI 摘要/术语表/正文原位翻译、目录与正文检索、离线正文/插图保存与 EPUB/TXT 导出。
  - **账号与设置**：我的主页、多账号切换、收藏夹、浏览记录与统计、下载任务与分类文件管理、完整应用设置、自定义 AI 与 Grok OAuth 设备码授权、屏蔽管理、SauceNAO 以图搜图。
- **原生运行时与网络加固**：
  - 修复流式 SSE 订阅竞态与多字节 UTF-8 分片解码（消除 CJK/Emoji 乱码）、新增 `gzip`/`deflate` 解压与 RFC 7578 `multipart/form-data`、完善 Android Keystore 密钥失效自愈与文件原子写入、`file://` 分享规范化与后台线程 SAF 文件读取。

## 签名与 Obtainium 配置

- **包名**：`com.pixscripting.preview`（`versionName = 1.8.14.4-alpha.3`，`versionCode = 3`）
- **签名证书 SHA-256**：`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`
- **Release 附件**：`Pix-Scripting-Android.apk`、`SHA256SUMS`
