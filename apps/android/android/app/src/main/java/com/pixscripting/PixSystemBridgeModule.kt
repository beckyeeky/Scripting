package com.pixscripting

import android.app.Activity
import android.app.Dialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.concurrent.ConcurrentHashMap

private const val REQ_PICK_IMAGES = 9101
private const val REQ_PICK_FILES = 9102
private const val REQ_PICK_DIR = 9103
private const val DOWNLOAD_CHANNEL_ID = "pix_scripting_downloads"

class PixSystemBridgeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var pendingPickerPromise: Promise? = null
  private var pendingPickerMode: Int = 0
  private var activeAuthDialog: Dialog? = null
  private val headlessWebViews = ConcurrentHashMap<String, WebView>()

  init {
    reactContext.addActivityEventListener(object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_PICK_IMAGES && requestCode != REQ_PICK_FILES && requestCode != REQ_PICK_DIR) return
        val promise = pendingPickerPromise ?: return
        pendingPickerPromise = null
        val mode = pendingPickerMode
        pendingPickerMode = 0

        if (resultCode != Activity.RESULT_OK || data == null) {
          promise.resolve(if (mode == REQ_PICK_DIR) null else Arguments.createArray())
          return
        }

        if (mode == REQ_PICK_DIR) {
          val treeUri = data.data
          if (treeUri != null) {
            runCatching {
              reactContext.contentResolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
              )
            }
            promise.resolve(treeUri.toString())
          } else {
            promise.resolve(null)
          }
          return
        }

        val uris = linkedSetOf<Uri>()
        data.data?.let { uris.add(it) }
        data.clipData?.let { clip ->
          for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
        }

        val results = Arguments.createArray()
        for (uri in uris) {
          val staged = PixIntentHolder.stageContentUri(reactContext, uri)
          if (staged != null) {
            results.pushMap(Arguments.createMap().apply {
              putString("filePath", staged.filePath)
              putString("name", staged.name)
              putString("mimeType", staged.mimeType)
              putDouble("size", staged.size.toDouble())
            })
          }
        }
        promise.resolve(results)
      }
    })
  }

  override fun getName(): String = "PixSystemBridge"

  @ReactMethod
  fun getInitialIntent(promise: Promise) {
    val item = PixIntentHolder.getLatest()
    promise.resolve(if (item != null) PixIntentHolder.toWritableMap(item) else null)
  }

  @ReactMethod
  fun clearIntent(promise: Promise) {
    PixIntentHolder.clear()
    promise.resolve(true)
  }

  @ReactMethod
  fun copyToClipboard(text: String, promise: Promise) {
    try {
      val cm = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: return promise.reject("E_CLIPBOARD", "Clipboard service unavailable")
      cm.setPrimaryClip(ClipData.newPlainText("Pix-Scripting", text))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_CLIPBOARD", e.message, e)
    }
  }

  @ReactMethod
  fun readClipboardText(promise: Promise) {
    try {
      val cm = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      val clip = cm?.primaryClip
      if (clip != null && clip.itemCount > 0) {
        promise.resolve(clip.getItemAt(0)?.coerceToText(reactContext)?.toString())
      } else {
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.reject("E_CLIPBOARD", e.message, e)
    }
  }

  @ReactMethod
  fun triggerHaptic(kind: String) {
    runCatching {
      val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = reactContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
        vm?.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        reactContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      } ?: return
      if (!vibrator.hasVibrator()) return
      val duration = when (kind) {
        "heavy", "rigid" -> 24L
        "medium", "success", "warning", "error" -> 16L
        else -> 9L
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(duration)
      }
    }
  }

  @ReactMethod
  fun openExternalUrl(url: String, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_OPEN_URL", e.message ?: "Cannot open URL", e)
    }
  }

  @ReactMethod
  fun shareItems(items: ReadableArray, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("E_SHARE", "No active Activity")
      return
    }
    try {
      val uris = ArrayList<Uri>()
      val texts = ArrayList<String>()
      val authority = "${reactContext.packageName}.fileprovider"

      for (i in 0 until items.size()) {
        val raw = items.getString(i) ?: continue
        val f = File(raw)
        if (f.exists() && f.isFile) {
          val shareFile = ensureShareableFile(f)
          uris.add(FileProvider.getUriForFile(reactContext, authority, shareFile))
        } else {
          texts.add(raw)
        }
      }

      val intent = if (uris.size > 1) {
        Intent(Intent.ACTION_SEND_MULTIPLE).apply {
          type = "*/*"
          putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
          if (texts.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, texts.joinToString("\n"))
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
      } else if (uris.size == 1) {
        val u = uris[0]
        val mime = reactContext.contentResolver.getType(u) ?: "*/*"
        Intent(Intent.ACTION_SEND).apply {
          type = mime
          putExtra(Intent.EXTRA_STREAM, u)
          if (texts.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, texts.joinToString("\n"))
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
      } else {
        Intent(Intent.ACTION_SEND).apply {
          type = "text/plain"
          putExtra(Intent.EXTRA_TEXT, texts.joinToString("\n"))
        }
      }

      activity.runOnUiThread {
        activity.startActivity(Intent.createChooser(intent, "分享"))
        promise.resolve(true)
      }
    } catch (e: Exception) {
      promise.reject("E_SHARE", e.message ?: "Share failed", e)
    }
  }

  private fun ensureShareableFile(src: File): File {
    val filesRoot = reactContext.filesDir.canonicalPath
    val cacheRoot = reactContext.cacheDir.canonicalPath
    val canon = src.canonicalPath
    if (canon.startsWith(filesRoot) || canon.startsWith(cacheRoot)) return src
    val copy = File(reactContext.cacheDir, "share/${src.name}")
    copy.parentFile?.mkdirs()
    src.copyTo(copy, overwrite = true)
    return copy
  }

  @ReactMethod
  fun pickImages(allowMultiple: Boolean, promise: Promise) {
    launchPicker(REQ_PICK_IMAGES, Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "image/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }, promise)
  }

  @ReactMethod
  fun pickFiles(mimeTypes: ReadableArray?, promise: Promise) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      if (mimeTypes != null && mimeTypes.size() > 0) {
        val mimes = Array(mimeTypes.size()) { i -> mimeTypes.getString(i) ?: "*/*" }
        putExtra(Intent.EXTRA_MIME_TYPES, mimes)
      }
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    launchPicker(REQ_PICK_FILES, intent, promise)
  }

  @ReactMethod
  fun pickDirectory(promise: Promise) {
    launchPicker(REQ_PICK_DIR, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }, promise)
  }

  private fun launchPicker(requestCode: Int, intent: Intent, promise: Promise) {
    val activity = currentActivity ?: return promise.reject("E_PICKER", "No active Activity")
    activity.runOnUiThread {
      if (pendingPickerPromise != null) {
        promise.reject("E_PICKER_BUSY", "文件选择器已打开")
        return@runOnUiThread
      }
      pendingPickerPromise = promise
      pendingPickerMode = requestCode
      try {
        activity.startActivityForResult(intent, requestCode)
      } catch (e: Exception) {
        pendingPickerPromise = null
        pendingPickerMode = 0
        promise.reject("E_PICKER", e.message ?: "无法打开系统选择器", e)
      }
    }
  }

  // OAuth WebView Dialog (supports Pixiv PKCE login + Cookie extraction)
  @ReactMethod
  fun presentOAuthWebView(options: ReadableMap, promise: Promise) {
    val activity = currentActivity ?: return promise.reject("E_WEBVIEW", "No active Activity")
    val url = options.getString("url") ?: return promise.reject("E_WEBVIEW", "Missing URL")
    val title = options.getString("title") ?: "Pixiv 登录"
    val redirectPrefix = options.getString("redirectPrefix") ?: "pixiv://account/login"
    val ephemeral = options.hasKey("ephemeral") && options.getBoolean("ephemeral")

    activity.runOnUiThread {
      runCatching { activeAuthDialog?.dismiss() }
      var settled = false

      val dialog = Dialog(activity, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
      activeAuthDialog = dialog

      val root = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Color.WHITE)
      }
      val header = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(24, 18, 24, 18)
        setBackgroundColor(Color.parseColor("#F5F6F8"))
      }
      val titleView = TextView(activity).apply {
        text = title
        textSize = 16f
        setTextColor(Color.parseColor("#111827"))
        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
      }
      val closeBtn = Button(activity).apply {
        text = "关闭"
        setOnClickListener {
          dialog.dismiss()
        }
      }
      header.addView(titleView)
      header.addView(closeBtn)

      val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
        isIndeterminate = true
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8)
      }

      val wv = WebView(activity).apply {
        PixManagedWebView.configureWebView(this)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
      }

      val cookieManager = CookieManager.getInstance()
      cookieManager.setAcceptCookie(true)
      cookieManager.setAcceptThirdPartyCookies(wv, true)
      if (ephemeral) {
        cookieManager.removeAllCookies(null)
        cookieManager.flush()
      }

      wv.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
          val target = request?.url?.toString() ?: return false
          if (target.startsWith(redirectPrefix) || target.startsWith("pixiv://")) {
            if (!settled) {
              settled = true
              cookieManager.flush()
              val pixivCookies = collectPixivCookies(cookieManager)
              val res = Arguments.createMap().apply {
                putBoolean("cancelled", false)
                putString("redirectUrl", target)
                putString("cookieHeader", pixivCookies)
              }
              promise.resolve(res)
              dialog.dismiss()
            }
            return true
          }
          return false
        }

        override fun onPageFinished(view: WebView?, pageUrl: String?) {
          super.onPageFinished(view, pageUrl)
          progress.visibility = android.view.View.GONE
        }
      }

      root.addView(header)
      root.addView(progress)
      root.addView(wv)
      dialog.setContentView(root)
      dialog.setOnDismissListener {
        activeAuthDialog = null
        runCatching { wv.destroy() }
        if (!settled) {
          settled = true
          promise.resolve(Arguments.createMap().apply {
            putBoolean("cancelled", true)
          })
        }
      }
      dialog.show()
      wv.loadUrl(url)
    }
  }

  private fun collectPixivCookies(cm: CookieManager): String {
    val hosts = listOf("https://www.pixiv.net", "https://app-api.pixiv.net", "https://accounts.pixiv.net")
    val map = LinkedHashMap<String, String>()
    for (host in hosts) {
      val raw = cm.getCookie(host) ?: continue
      for (part in raw.split(";")) {
        val eq = part.indexOf('=')
        if (eq > 0) {
          val k = part.substring(0, eq).trim()
          val v = part.substring(eq + 1).trim()
          if (k.isNotEmpty() && v.isNotEmpty()) map[k] = v
        }
      }
    }
    return map.entries.joinToString("; ") { "${it.key}=${it.value}" }
  }

  @ReactMethod
  fun getCookiesForUrl(url: String, promise: Promise) {
    try {
      val cm = CookieManager.getInstance()
      val raw = cm.getCookie(url) ?: ""
      val arr = Arguments.createArray()
      val domain = runCatching { Uri.parse(url).host ?: "pixiv.net" }.getOrDefault("pixiv.net")
      for (part in raw.split(";")) {
        val eq = part.indexOf('=')
        if (eq > 0) {
          val k = part.substring(0, eq).trim()
          val v = part.substring(eq + 1).trim()
          if (k.isNotEmpty()) {
            arr.pushMap(Arguments.createMap().apply {
              putString("name", k)
              putString("value", v)
              putString("domain", domain)
              putString("path", "/")
            })
          }
        }
      }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("E_COOKIE", e.message, e)
    }
  }

  @ReactMethod
  fun clearPixivCookies(promise: Promise) {
    reactContext.runOnUiQueueThread {
      runCatching {
        val cm = CookieManager.getInstance()
        cm.removeAllCookies { _ ->
          cm.flush()
          promise.resolve(true)
        }
      }.onFailure { promise.resolve(false) }
    }
  }

  // Headless WebView (used by epubExporter.stampSeriesOnCover)
  @ReactMethod
  fun loadHeadlessHtml(sessionId: String, html: String, promise: Promise) {
    val activity = currentActivity ?: return promise.resolve(false)
    activity.runOnUiThread {
      try {
        headlessWebViews.remove(sessionId)?.let { old -> runCatching { old.destroy() } }
        val wv = WebView(activity)
        PixManagedWebView.configureWebView(wv)
        wv.addJavascriptInterface(object {
          @JavascriptInterface
          fun postMessage(name: String, jsonPayload: String) {
            reactContext
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("PixHeadlessWebMessage", Arguments.createMap().apply {
                putString("sessionId", sessionId)
                putString("name", name)
                putString("payload", jsonPayload)
              })
          }
        }, "__PixAndroidWebBridge")

        var done = false
        wv.webViewClient = object : WebViewClient() {
          override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            view?.evaluateJavascript(WEBKIT_SHIM_JS, null)
            if (!done) {
              done = true
              promise.resolve(true)
            }
          }
        }
        headlessWebViews[sessionId] = wv
        val injected = PixManagedWebView.injectWebkitShimIntoHtml(html)
        wv.loadDataWithBaseURL("https://appassets.pixscripting.local/", injected, "text/html", "UTF-8", null)
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun disposeHeadlessWebView(sessionId: String) {
    val wv = headlessWebViews.remove(sessionId) ?: return
    currentActivity?.runOnUiThread {
      runCatching {
        wv.stopLoading()
        wv.destroy()
      }
    }
  }

  // Download progress / completion notification
  @ReactMethod
  fun showNotification(id: Int, title: String, body: String, progress: Int, maxProgress: Int, ongoing: Boolean) {
    runCatching {
      val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val ch = NotificationChannel(DOWNLOAD_CHANNEL_ID, "下载与导出", NotificationManager.IMPORTANCE_LOW)
        nm.createNotificationChannel(ch)
      }
      val builder = NotificationCompat.Builder(reactContext, DOWNLOAD_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle(title)
        .setContentText(body)
        .setOngoing(ongoing)
        .setOnlyAlertOnce(true)
      if (maxProgress > 0) {
        builder.setProgress(maxProgress, progress.coerceIn(0, maxProgress), false)
      } else {
        builder.setProgress(0, 0, false)
      }
      if (!ongoing) {
        builder.setSmallIcon(android.R.drawable.stat_sys_download_done)
      }
      nm.notify(id, builder.build())
    }
  }

  @ReactMethod
  fun cancelNotification(id: Int) {
    runCatching {
      val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      nm.cancel(id)
    }
  }
}
