# Pix-Scripting Android release 混淆 / 裁剪规则（P2-4）
#
# 打开方式：apps/android/android/app/build.gradle 的 release 块默认启用
# minifyEnabled + shrinkResources；排障时可一键关闭：
#   ./gradlew :app:assembleRelease -PenableR8=false
#
# 说明：
# - com.facebook.react:react-android / hermes-android 的 AAR 自带 consumer rules
#   （NativeModule、@ReactProp、@DoNotStrip、com.facebook.react.bridge.**、okio 等），
#   这里不重复搬运，只补本项目与高风险边界；重复规则只会增加维护成本。
# - R8 会生成 app/build/outputs/mapping/release/mapping.txt，发布排障需一并留存，
#   否则混淆后的 Java 崩溃栈无法还原（JS/Hermes 栈不受影响）。

# ---- 自定义 bridge（com.pixscripting）----
# JS 通过 NativeModules.PixXxx / requireNativeComponent 调用，RN 在运行时按方法名
# 反射查找 @ReactMethod / @ReactProp，方法名不能被改写；类本身由 PixScriptingPackage
# 直接引用，无需整类 keep。
-keepclassmembers class com.pixscripting.** {
    @com.facebook.react.bridge.ReactMethod <methods>;
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
    @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
}

# 包入口由 MainApplication 显式构造；保留全部成员，避免后续新增注册逻辑被裁剪。
-keep class com.pixscripting.PixScriptingPackage { *; }

# WebView JS 桥：PixWebViewManager 里的匿名对象由 WebView 通过
# window.__PixAndroidWebBridge.postMessage(...) 按名称调用，方法名不可改写。
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ---- Hermes / JNI ----
# hermes-android 的 Java 执行器与 JNI 边界按名称互相查找；AAR 规则随版本可能变化，
# 这里做兜底（类数量很少，体积可忽略）。
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keepclassmembers class * {
    native <methods>;
}

# ---- OkHttp / Okio（RN 网络栈）----
# OkHttp 4.x 自带 META-INF/proguard/okhttp3.pro；以下 dontwarn 覆盖其可选 TLS provider，
# 避免 R8 因设备/依赖中不存在 conscrypt、bouncycastle、openjsse 而中断构建。
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn okio.**

# ---- WorkManager ----
# androidx.work 从数据库读取类名后反射实例化 Worker；当前没有自定义 Worker，
# 保留构造签名，防止后续新增后台下载任务时被裁剪（规则无匹配时无副作用）。
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# 保留源文件名与行号：alpha 阶段依赖用户 logcat 定位问题，体积影响很小。
-keepattributes SourceFile,LineNumberTable
