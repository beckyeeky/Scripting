# Pix-Scripting Android 1.8.14.4-alpha.1

`Pix-Scripting Android` 将 `feature/pixivreader-port`（`1.8.14.4`）完整移植到 Android（Android 7.0+，`minSdk 24`），直接复用 `Pix-Scripting/src/` 业务逻辑与液态玻璃界面结构，并支持直接导入原 iOS 版配置与备份。

> [!NOTE]
> 本发布为 Android 预览频道（`--prerelease`，`--latest=false`），不会覆盖 iOS `Latest` 发布（`v1.8.14.4-pixivreader`）。

## 主要功能

- **完整客户端能力**：PKCE WebView 安全登录与 Cookie 提取、Refresh Token 登录、探索/排行/关注/搜索/动态/用户主页、插画多页原图与缩放、Ugoira 动图逐帧播放与原生 MP4/GIF 导出、Pixivision 特辑、Manga OCR 汉化渲染、CBZ/EPUB 导出及离线书库。
- **小说文库本阅读与 AI 翻译**：内嵌 WebView 引擎完整保留横/竖排排版、注音、着重号、标点悬挂、译文原位替换、目录检索、AI 摘要/术语表/正文翻译。
- **安全与本地存储**：登录令牌与 AI/SauceNAO 密钥采用 Android Keystore `AES/GCM/NoPadding` 加密保存。

## 导入原 iOS 版本配置

支持以下 4 种方式导入（登录前点击页面底部「导入 iOS 配置 / Token」，或登录后进入「设置 → 跨设备同步 → 从文件导入同步数据」，亦可通过 Android 系统「分享」直接发送至 Pix-Scripting）：

1. **跨设备同步包**：`Pix-Scripting-Sync-*.json`（支持设置、小说阅读器设置、历史、进度、屏蔽词、Pixivision 收藏）。
2. **iCloud 原始 JSON**：`settings.json`、`novel_reader_settings.json`、`blocklist.json`、`CustomAIProfile` JSON 或 SauceNAO 密钥数组（自动剥离 iOS 本地目录书签）。
3. **整包 ZIP 备份**：从 iPhone/iPad「文件」App 打包导出的 `Pix-Scripting.zip` 数据目录。
4. **Pixiv Refresh Token**：粘贴或导入原客户端的 Refresh Token 直接换取账号登录态。

## 签名校验与 Obtainium 自动更新

- **包名**：`com.pixscripting.preview`（`versionName = 1.8.14.4-alpha.1`，`versionCode = 1`）
- **签名证书 SHA-256**：`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`
- **Release 附件**：`Pix-Scripting-Android.apk`、`SHA256SUMS`
- **Obtainium 订阅配置**：
  - 仓库地址：`https://github.com/beckyeeky/Scripting`
  - 包含预发布版本（Include prereleases）：开启
  - APK 匹配正则：`^Pix-Scripting-Android\.apk$`
  - 版本号提取 / Tag 过滤：`android-v.+`
