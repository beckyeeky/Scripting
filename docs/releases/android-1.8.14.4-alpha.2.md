# Pix-Scripting Android 1.8.14.4-alpha.2

> [!NOTE]
> 本发布为 Android 预览频道修复版（`--prerelease`，`--latest=false`），可直接在 `1.8.14.4-alpha.1` 上覆盖升级，保留已导入的配置与登录态，不会覆盖 iOS `Latest` 发布（`v1.8.14.4-pixivreader`）。

## 修复内容

- **修复导入配置或 Token 登录后白屏的问题**：
  - 补全 `UIGlass.regular()` / `UIGlass.clear()` 的 chainable `.tint()` 与 `.interactive()` 方法，修复开启自定义玻璃色调、玻璃交互或加载插画卡片收藏按钮时抛出的 `TypeError: glass.interactive is not a function` / `glass.tint is not a function`。
  - 修复原生渐变组件 `PixGradientView` 重复解析已转换的 Android 负整数色值（如不透明白色、氛围光渐变蒙层）导致 UI 线程 `UnexpectedNativeTypeException` 崩溃。
  - 修复 `ZStack` 子层叠加布局与 `ignoresSafeArea` 全屏拉伸，避免启动过渡层或悬浮层将主内容挤出可视区。
  - 使用 Pixiv Refresh Token 登录成功后自动收起导入弹窗，避免与首页首次引导弹窗并发叠层。
  - 为 `RootView` 外层增加 `RootErrorBoundary` 异常兜底与一键恢复入口，便于真机定位后续异常并防止纯白屏。
- **更换应用启动图标**：
  - 合入 `pixiv_refined_v2_android` 图标资源包（`mipmap-mdpi` 至 `mipmap-xxxhdpi` 正式 `ic_launcher.png` 及 `play_store_512.png`），移除占位圆角图标与清单中的 `android:roundIcon` 引用。

## 签名与 Obtainium 配置

- **包名**：`com.pixscripting.preview`（`versionName = 1.8.14.4-alpha.2`，`versionCode = 2`）
- **签名证书 SHA-256**：`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`
- **Release 附件**：`Pix-Scripting-Android.apk`、`SHA256SUMS`
