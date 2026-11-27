package com.pixscripting

import android.Manifest
import android.app.Activity
import android.app.Dialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.DocumentsContract
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.math.roundToInt

private const val REQ_PICK_IMAGES = 9101
private const val REQ_PICK_FILES = 9102
private const val REQ_PICK_DIR = 9103
private const val DOWNLOAD_CHANNEL_ID = "pix_scripting_downloads"
private const val NOTIFICATION_PERMISSION_REQUEST = 4311
private const val PIXIV_OAUTH_CALLBACK_PATH = "/web/v1/users/auth/pixiv/callback"
private const val EXPORT_DIR_PREFS = "pix_export_directory"
private const val EXPORT_DIR_URI_KEY = "tree_uri"
private const val EXPORT_DIR_NAME_KEY = "display_name"
private const val EXPORT_DIR_MAX_NAME_LENGTH = 80

class PixSystemBridgeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val ioPool = Executors.newFixedThreadPool(2)
  private var pendingPickerPromise: Promise? = null
  private var pendingPickerMode: Int = 0
  private var activeAuthDialog: Dialog? = null
  private val headlessWebViews = ConcurrentHashMap<String, WebView>()
  private val exportDirPrefs by lazy {
    reactContext.getSharedPreferences(EXPORT_DIR_PREFS, Context.MODE_PRIVATE)
  }

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
            // 授权失败也记录 URI：设置页会通过 getExportDirectory 报告“授权已失效”，
            // 让用户重新选择，而不是静默写不进去。
            runCatching { rememberExportDirectory(treeUri) }
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

        ioPool.execute {
          try {
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
          } catch (e: Exception) {
            promise.reject("E_PICKER_STAGE", e.message ?: "读取所选文件失败", e)
          }
        }
      }
    })
  }

  override fun getName(): String = "PixSystemBridge"

  override fun invalidate() {
    super.invalidate()
    val dialog = activeAuthDialog
    activeAuthDialog = null
    val webViews = headlessWebViews.values.toList()
    headlessWebViews.clear()
    reactContext.runOnUiQueueThread {
      runCatching { dialog?.dismiss() }
      for (wv in webViews) {
        runCatching {
          wv.stopLoading()
          (wv.parent as? ViewGroup)?.removeView(wv)
          wv.destroy()
        }
      }
    }
  }

  // ---------- App Build Metadata (read-only) ----------

  // 关于页展示真实包名/版本，避免 JS 侧写死与 BuildConfig 漂移。release 变体
  // 带 applicationIdSuffix ".preview"，因此必须读取 APPLICATION_ID 而非手写。
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getAppMetadataSync(): WritableMap {
    return Arguments.createMap().apply {
      putString("applicationId", BuildConfig.APPLICATION_ID)
      putString("versionName", BuildConfig.VERSION_NAME)
      putInt("versionCode", BuildConfig.VERSION_CODE)
    }
  }

  // ---------- Edge-to-Edge Window Insets & System Bars ----------
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getWindowInsetsSync(): WritableMap {
    val activity = currentActivity
    if (activity == null) {
      PixWindowInsetsHolder.seedFallbackIfNeeded(reactContext)
    }
    val snapshot = PixWindowInsetsHolder.readLiveFromActivity(activity)
    return PixWindowInsetsHolder.toWritableMap(snapshot)
  }

  @ReactMethod
  fun setSystemBarStyle(isDark: Boolean) {
    val activity = currentActivity ?: return
    activity.runOnUiThread {
      runCatching {
        PixWindowInsetsHolder.applyEdgeToEdge(activity, isDark, persistStyle = true)
        activity.window?.decorView?.let { ViewCompat.requestApplyInsets(it) }
      }
    }
  }

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

  private fun normalizeFilePath(raw: String): String {
    if (raw.startsWith("file://", ignoreCase = true)) {
      return runCatching { Uri.parse(raw).path }.getOrNull()
        ?: raw.removePrefix("file://").removePrefix("FILE://")
    }
    return raw
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
        val normalized = normalizeFilePath(raw)
        val f = File(normalized)
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
          val clip = ClipData.newRawUri("Pix-Scripting", uris[0])
          for (idx in 1 until uris.size) clip.addItem(ClipData.Item(uris[idx]))
          clipData = clip
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
      } else if (uris.size == 1) {
        val u = uris[0]
        val mime = reactContext.contentResolver.getType(u) ?: "*/*"
        Intent(Intent.ACTION_SEND).apply {
          type = mime
          putExtra(Intent.EXTRA_STREAM, u)
          if (texts.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, texts.joinToString("\n"))
          clipData = ClipData.newRawUri("Pix-Scripting", u)
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

  // ---------- Custom export directory (Storage Access Framework) ----------

  private fun fallbackTreeName(treeUri: Uri): String {
    val documentId = runCatching { DocumentsContract.getTreeDocumentId(treeUri) }.getOrNull().orEmpty()
    val tail = documentId.substringAfterLast(':').ifEmpty { documentId }
    return tail.substringAfterLast('/').ifEmpty { "导出目录" }
  }

  private fun resolveTreeDisplayName(treeUri: Uri): String? = runCatching {
    val documentUri = DocumentsContract.buildDocumentUriUsingTree(
      treeUri,
      DocumentsContract.getTreeDocumentId(treeUri),
    )
    reactContext.contentResolver.query(
      documentUri,
      arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
      null,
      null,
      null,
    )?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    }
  }.getOrNull()

  private fun rememberExportDirectory(treeUri: Uri) {
    val previous = exportDirPrefs.getString(EXPORT_DIR_URI_KEY, null)
    if (!previous.isNullOrBlank() && previous != treeUri.toString()) {
      runCatching {
        reactContext.contentResolver.releasePersistableUriPermission(
          Uri.parse(previous),
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
      }
    }
    val displayName = (resolveTreeDisplayName(treeUri) ?: fallbackTreeName(treeUri))
      .trim()
      .ifEmpty { "导出目录" }
    exportDirPrefs.edit()
      .putString(EXPORT_DIR_URI_KEY, treeUri.toString())
      .putString(EXPORT_DIR_NAME_KEY, displayName)
      .apply()
  }

  private fun listExportChildNames(treeUri: Uri): Set<String> {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
      treeUri,
      DocumentsContract.getTreeDocumentId(treeUri),
    )
    val names = HashSet<String>()
    reactContext.contentResolver.query(
      childrenUri,
      arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
      null,
      null,
      null,
    )?.use { cursor ->
      while (cursor.moveToNext()) {
        cursor.getString(0)?.trim()?.lowercase()?.let { if (it.isNotEmpty()) names.add(it) }
      }
    }
    return names
  }

  private fun splitExportName(rawName: String): Pair<String, String> {
    val base = rawName.trim().substringAfterLast('/').substringAfterLast('\\')
    val cleaned = base
      .replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F\\u007F]"), "_")
      .replace(Regex("_+"), "_")
      .trim()
      .trim('.', ' ', '_')
    if (cleaned.isEmpty()) return "export" to "bin"

    val dot = cleaned.lastIndexOf('.')
    val hasExtension = dot > 0
    var extension = if (hasExtension) cleaned.substring(dot + 1).lowercase() else ""
    if (!extension.matches(Regex("^[a-z0-9]{1,10}$"))) extension = "bin"
    var stem = if (hasExtension) cleaned.substring(0, dot) else cleaned
    stem = stem.trim('.', ' ', '_').ifEmpty { "export" }
    val maxStem = (EXPORT_DIR_MAX_NAME_LENGTH - extension.length - 1).coerceAtLeast(1)
    return stem.take(maxStem) to extension
  }

  /** 重名时生成 "name (1).ext"、"name (2).ext"…，与 JS 侧 nextAvailableFileName 对齐 */
  private fun uniqueExportName(desired: String, existing: Set<String>): String {
    val (stem, extension) = splitExportName(desired)
    val suffix = ".$extension"
    val direct = "$stem$suffix"
    if (!existing.contains(direct.lowercase())) return direct
    for (index in 1..9999) {
      val marker = " ($index)"
      val maxStem = (EXPORT_DIR_MAX_NAME_LENGTH - marker.length - suffix.length).coerceAtLeast(1)
      val candidate = "${stem.take(maxStem)}$marker$suffix"
      if (!existing.contains(candidate.lowercase())) return candidate
    }
    return "${stem.take(40)}-${System.currentTimeMillis()}$suffix"
  }

  private fun mimeForExportName(name: String): String {
    val extension = name.substringAfterLast('.', "").lowercase()
    return when (extension) {
      "mp4" -> "video/mp4"
      "gif" -> "image/gif"
      "epub" -> "application/epub+zip"
      "txt" -> "text/plain"
      "zip" -> "application/zip"
      "cbz" -> "application/vnd.comicbook+zip"
      "json" -> "application/json"
      "jpg", "jpeg" -> "image/jpeg"
      "png" -> "image/png"
      "webp" -> "image/webp"
      else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
        ?: "application/octet-stream"
    }
  }

  /**
   * 当前导出目录：URI、显示名以及实时授权状态。JS 侧用 writeGranted/reachable
   * 判定 "ready" / "revoked"，避免把已删除目录或撤销授权的记录当成可用。
   */
  @ReactMethod
  fun getExportDirectory(promise: Promise) {
    try {
      val uriString = exportDirPrefs.getString(EXPORT_DIR_URI_KEY, null)
      if (uriString.isNullOrBlank()) {
        promise.resolve(null)
        return
      }
      val treeUri = Uri.parse(uriString)
      val grant = reactContext.contentResolver.persistedUriPermissions.firstOrNull { it.uri == treeUri }
      val writeGranted = grant?.isWritePermission == true
      val readGranted = grant?.isReadPermission == true
      val storedName = exportDirPrefs.getString(EXPORT_DIR_NAME_KEY, null)
      val name = (storedName ?: resolveTreeDisplayName(treeUri) ?: fallbackTreeName(treeUri))
        .trim()
        .ifEmpty { "导出目录" }

      var reachable = false
      if (writeGranted) {
        reachable = runCatching {
          val documentUri = DocumentsContract.buildDocumentUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri),
          )
          reactContext.contentResolver.query(
            documentUri,
            arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
            null,
            null,
            null,
          )?.use { cursor -> cursor.moveToFirst() } ?: false
        }.getOrDefault(false)
      }

      promise.resolve(Arguments.createMap().apply {
        putString("uri", uriString)
        putString("name", name)
        putBoolean("writeGranted", writeGranted)
        putBoolean("readGranted", readGranted)
        putBoolean("reachable", reachable)
      })
    } catch (e: Exception) {
      promise.reject("E_SAF_STATE", e.message ?: "读取导出目录状态失败", e)
    }
  }

  /** 取消自定义目录并释放持久化授权，导出回到应用专属目录/相册 */
  @ReactMethod
  fun clearExportDirectory(promise: Promise) {
    try {
      val uriString = exportDirPrefs.getString(EXPORT_DIR_URI_KEY, null)
      if (!uriString.isNullOrBlank()) {
        runCatching {
          reactContext.contentResolver.releasePersistableUriPermission(
            Uri.parse(uriString),
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
          )
        }
      }
      exportDirPrefs.edit()
        .remove(EXPORT_DIR_URI_KEY)
        .remove(EXPORT_DIR_NAME_KEY)
        .apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_SAF_CLEAR", e.message ?: "清除导出目录失败", e)
    }
  }

  /**
   * 把缓存/文档目录中的成品写入已授权的 tree URI，重名自动加序号。
   * 未选择目录返回 E_SAF_DIR_NONE；授权撤销/目录删除返回 E_SAF_DIR_REVOKED，
   * 由 JS 侧提示重新选择并回退默认位置。
   */
  @ReactMethod
  fun writeToExportDirectory(sourcePath: String, fileName: String?, promise: Promise) {
    ioPool.execute {
      var createdDocument: Uri? = null
      try {
        val uriString = exportDirPrefs.getString(EXPORT_DIR_URI_KEY, null)
        if (uriString.isNullOrBlank()) {
          promise.reject("E_SAF_DIR_NONE", "未选择自定义导出目录")
          return@execute
        }
        val treeUri = Uri.parse(uriString)
        val grant = reactContext.contentResolver.persistedUriPermissions.firstOrNull { it.uri == treeUri }
        if (grant == null || !grant.isWritePermission) {
          promise.reject("E_SAF_DIR_REVOKED", "导出目录授权已失效，请重新选择")
          return@execute
        }

        val source = File(normalizeFilePath(sourcePath))
        if (!source.exists() || !source.isFile) {
          promise.reject("E_SAF_SOURCE", "源文件不存在：$sourcePath")
          return@execute
        }

        val existing = try {
          listExportChildNames(treeUri)
        } catch (e: Exception) {
          promise.reject("E_SAF_DIR_REVOKED", e.message ?: "导出目录不可访问，可能已被删除", e)
          return@execute
        }
        val desired = if (fileName.isNullOrBlank()) source.name else fileName
        val finalName = uniqueExportName(desired, existing)
        val parentDocumentUri = DocumentsContract.buildDocumentUriUsingTree(
          treeUri,
          DocumentsContract.getTreeDocumentId(treeUri),
        )
        val documentUri = DocumentsContract.createDocument(
          reactContext.contentResolver,
          parentDocumentUri,
          mimeForExportName(finalName),
          finalName,
        )
        if (documentUri == null) {
          promise.reject("E_SAF_WRITE", "无法在所选目录创建文件")
          return@execute
        }
        createdDocument = documentUri

        reactContext.contentResolver.openOutputStream(documentUri, "w")?.use { output ->
          source.inputStream().use { input -> input.copyTo(output, 64 * 1024) }
        } ?: error("无法打开导出目录写入流")

        promise.resolve(Arguments.createMap().apply {
          putString("uri", documentUri.toString())
          putString("name", finalName)
          putString("directoryName", exportDirPrefs.getString(EXPORT_DIR_NAME_KEY, null) ?: "")
          putDouble("size", source.length().toDouble())
        })
        createdDocument = null
      } catch (e: Exception) {
        runCatching {
          createdDocument?.let { DocumentsContract.deleteDocument(reactContext.contentResolver, it) }
        }
        promise.reject("E_SAF_WRITE", e.message ?: "写入导出目录失败", e)
      }
    }
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

  private fun extractOrigin(rawUrl: String): String? {
    return runCatching {
      val uri = URI(rawUrl)
      val scheme = uri.scheme?.lowercase() ?: return null
      val host = uri.host ?: return null
      if (scheme != "http" && scheme != "https") return null
      val portPart = if (uri.port > 0 && !((scheme == "http" && uri.port == 80) || (scheme == "https" && uri.port == 443))) {
        ":${uri.port}"
      } else {
        ""
      }
      "$scheme://$host$portPart"
    }.getOrNull()
  }

  private fun isOAuthCallbackUrl(target: String, prefixes: List<String>): Boolean {
    for (prefix in prefixes) {
      if (prefix.isNotEmpty() && target.startsWith(prefix)) return true
    }
    if (target.startsWith("pixiv://")) return true
    val parsed = runCatching { Uri.parse(target) }.getOrNull() ?: return false
    if (parsed.path == PIXIV_OAUTH_CALLBACK_PATH && !parsed.getQueryParameter("code").isNullOrBlank()) {
      return true
    }
    return false
  }

  // OAuth WebView Dialog (supports Pixiv PKCE login + Cookie extraction + custom gateways)
  @ReactMethod
  fun presentOAuthWebView(options: ReadableMap, promise: Promise) {
    val activity = currentActivity ?: return promise.reject("E_WEBVIEW", "No active Activity")
    val url = options.getString("url") ?: return promise.reject("E_WEBVIEW", "Missing URL")
    val title = options.getString("title") ?: "Pixiv 登录"
    val ephemeral = options.hasKey("ephemeral") && !options.isNull("ephemeral") && options.getBoolean("ephemeral")
    val cookieSyncOnly =
      options.hasKey("cookieSyncOnly") && !options.isNull("cookieSyncOnly") && options.getBoolean("cookieSyncOnly")
    val isDark = if (options.hasKey("isDark") && !options.isNull("isDark")) {
      options.getBoolean("isDark")
    } else {
      PixWindowInsetsHolder.currentRequestedDark(activity)
    }

    val urlOrigin = extractOrigin(url)
    val redirectPrefixes = LinkedHashSet<String>()
    // Cookie-sync mode has no OAuth callback: registering prefixes would either
    // never match (dead prefix) or close the dialog before the user finishes.
    if (!cookieSyncOnly) {
      if (options.hasKey("redirectPrefix") && !options.isNull("redirectPrefix")) {
        options.getString("redirectPrefix")?.takeIf { it.isNotBlank() }?.let { redirectPrefixes.add(it) }
      }
      if (options.hasKey("redirectPrefixes") && !options.isNull("redirectPrefixes")) {
        val arr = options.getArray("redirectPrefixes")
        if (arr != null) {
          for (i in 0 until arr.size()) {
            arr.getString(i)?.takeIf { it.isNotBlank() }?.let { redirectPrefixes.add(it) }
          }
        }
      }
      redirectPrefixes.add("pixiv://account/login")
      redirectPrefixes.add("https://app-api.pixiv.net$PIXIV_OAUTH_CALLBACK_PATH")
      if (urlOrigin != null) {
        redirectPrefixes.add("$urlOrigin$PIXIV_OAUTH_CALLBACK_PATH")
      }
    }
    val prefixList = redirectPrefixes.toList()

    val extraCookieHosts = LinkedHashSet<String>()
    if (urlOrigin != null) extraCookieHosts.add(urlOrigin)
    if (options.hasKey("extraCookieHosts") && !options.isNull("extraCookieHosts")) {
      val arr = options.getArray("extraCookieHosts")
      if (arr != null) {
        for (i in 0 until arr.size()) {
          arr.getString(i)?.takeIf { it.isNotBlank() }?.let { extraCookieHosts.add(it) }
        }
      }
    }
    // Cookie-sync mode: the configured gateway/Web origin goes first so its
    // session cookies win over same-named cookies from the Pixiv hosts.
    val cookieHosts = LinkedHashSet<String>().apply {
      addAll(extraCookieHosts)
      add("https://www.pixiv.net")
      add("https://app-api.pixiv.net")
      add("https://accounts.pixiv.net")
    }
    // OAuth mode keeps the historical order (Pixiv hosts first, last write
    // wins) so existing PKCE callers receive the same cookieHeader as before.
    val oauthCookieHosts = LinkedHashSet<String>().apply {
      add("https://www.pixiv.net")
      add("https://app-api.pixiv.net")
      add("https://accounts.pixiv.net")
      addAll(extraCookieHosts)
    }

    activity.runOnUiThread {
      runCatching { activeAuthDialog?.dismiss() }
      var settled = false
      var webViewDestroyed = false

      val themeRes = if (isDark) {
        android.R.style.Theme_DeviceDefault_NoActionBar
      } else {
        android.R.style.Theme_DeviceDefault_Light_NoActionBar
      }
      val dialog = Dialog(activity, themeRes)
      activeAuthDialog = dialog

      val cookieManager = CookieManager.getInstance()
      cookieManager.setAcceptCookie(true)

      // Single result builder for every exit path (OAuth callback, 完成同步,
      // 关闭/返回键/系统取消). It flushes first and returns whatever the
      // WebView stored, including the configured reverse-proxy origin.
      fun buildWebViewResult(cancelled: Boolean, redirectUrl: String?): WritableMap {
        runCatching { cookieManager.flush() }
        val entries = Arguments.createArray()
        val merged = LinkedHashMap<String, String>()
        val hosts = if (cookieSyncOnly) cookieHosts else oauthCookieHosts
        for (host in hosts) {
          val raw = runCatching { cookieManager.getCookie(host) }.getOrNull().orEmpty()
          if (raw.isBlank()) continue
          entries.pushMap(Arguments.createMap().apply {
            putString("url", host)
            putString("cookie", raw)
          })
          for (part in raw.split(";")) {
            val eq = part.indexOf('=')
            if (eq > 0) {
              val key = part.substring(0, eq).trim()
              val value = part.substring(eq + 1).trim()
              if (key.isNotEmpty() && value.isNotEmpty()) {
                if (cookieSyncOnly) {
                  if (!merged.containsKey(key)) merged[key] = value
                } else {
                  merged[key] = value
                }
              }
            }
          }
        }
        return Arguments.createMap().apply {
          putBoolean("cancelled", cancelled)
          if (redirectUrl != null) putString("redirectUrl", redirectUrl)
          putString("cookieHeader", merged.entries.joinToString("; ") { "${it.key}=${it.value}" })
          putArray("cookies", entries)
        }
      }

      fun finishAuthFlow(cancelled: Boolean, redirectUrl: String?) {
        if (settled) return
        settled = true
        promise.resolve(buildWebViewResult(cancelled, redirectUrl))
        dialog.dismiss()
      }

      val density = activity.resources.displayMetrics.density
      fun dp(v: Int): Int = (v * density).roundToInt()

      val bgColor = if (isDark) Color.parseColor("#111318") else Color.WHITE
      val headerBgColor = if (isDark) Color.parseColor("#1B1F27") else Color.parseColor("#F5F6F8")
      val titleTextColor = if (isDark) Color.parseColor("#F3F4F6") else Color.parseColor("#111827")
      val closeTextColor = if (isDark) Color.parseColor("#60A5FA") else Color.parseColor("#007AFF")

      val root = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(bgColor)
      }

      val initialTopPx = (PixWindowInsetsHolder.getCurrent().top * density).roundToInt()
      val header = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(16), initialTopPx + dp(10), dp(12), dp(10))
        setBackgroundColor(headerBgColor)
      }
      val titleBlock = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
      }
      val titleView = TextView(activity).apply {
        text = title
        textSize = 16f
        setTextColor(titleTextColor)
      }
      titleBlock.addView(titleView)
      if (cookieSyncOnly) {
        titleBlock.addView(TextView(activity).apply {
          text = "登录完成后点右上角「完成同步」"
          textSize = 11f
          setTextColor(if (isDark) Color.parseColor("#9CA3AF") else Color.parseColor("#6B7280"))
        })
      }
      val doneBtn = Button(activity).apply {
        text = "完成同步"
        setTextColor(closeTextColor)
        setBackgroundColor(Color.TRANSPARENT)
        isAllCaps = false
        setOnClickListener {
          finishAuthFlow(cancelled = false, redirectUrl = null)
        }
      }
      val closeBtn = Button(activity).apply {
        text = "关闭"
        setTextColor(closeTextColor)
        setBackgroundColor(Color.TRANSPARENT)
        isAllCaps = false
        setOnClickListener {
          // Closing is still a cancel, but cookies captured so far are kept.
          finishAuthFlow(cancelled = true, redirectUrl = null)
        }
      }
      header.addView(titleBlock)
      if (cookieSyncOnly) header.addView(doneBtn)
      header.addView(closeBtn)

      val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
        isIndeterminate = true
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3))
      }

      val wv = WebView(activity).apply {
        PixManagedWebView.configureWebView(this)
        setBackgroundColor(bgColor)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
      }

      cookieManager.setAcceptThirdPartyCookies(wv, true)

      wv.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
          val target = request?.url?.toString() ?: return false
          if (cookieSyncOnly) {
            // Let the WebView stay on http(s); swallow pixiv:// / intent:// links
            // instead of showing an unknown-scheme error page.
            val scheme = request?.url?.scheme?.lowercase()
            return scheme != "http" && scheme != "https"
          }
          if (isOAuthCallbackUrl(target, prefixList)) {
            finishAuthFlow(cancelled = false, redirectUrl = target)
            return true
          }
          return false
        }

        @Deprecated("Deprecated in Java")
        override fun shouldOverrideUrlLoading(view: WebView?, targetUrl: String?): Boolean {
          val target = targetUrl ?: return false
          if (cookieSyncOnly) {
            val scheme = runCatching { Uri.parse(target).scheme?.lowercase() }.getOrNull()
            return scheme != "http" && scheme != "https"
          }
          if (isOAuthCallbackUrl(target, prefixList)) {
            finishAuthFlow(cancelled = false, redirectUrl = target)
            return true
          }
          return false
        }

        override fun onPageStarted(view: WebView?, pageUrl: String?, favicon: android.graphics.Bitmap?) {
          super.onPageStarted(view, pageUrl, favicon)
          if (!cookieSyncOnly && pageUrl != null && isOAuthCallbackUrl(pageUrl, prefixList)) {
            view?.stopLoading()
            finishAuthFlow(cancelled = false, redirectUrl = pageUrl)
            return
          }
          progress.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView?, pageUrl: String?) {
          super.onPageFinished(view, pageUrl)
          progress.visibility = View.GONE
        }

        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
          if (!settled) {
            dialog.dismiss()
          }
          return true
        }
      }

      ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
        val safe = insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        )
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
        header.setPadding(
          dp(16) + safe.left,
          safe.top + dp(10),
          dp(12) + safe.right,
          dp(10),
        )
        val bottomPad = maxOf(safe.bottom, ime.bottom)
        v.setPadding(0, 0, 0, bottomPad)
        insets
      }

      root.addView(header)
      root.addView(progress)
      root.addView(wv)
      dialog.setContentView(root)

      dialog.window?.let { win ->
        win.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        @Suppress("DEPRECATION")
        win.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        WindowCompat.setDecorFitsSystemWindows(win, false)
        @Suppress("DEPRECATION")
        win.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        win.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          win.attributes = win.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
          }
        }
        val ctrl = WindowInsetsControllerCompat(win, win.decorView)
        ctrl.isAppearanceLightStatusBars = !isDark
        ctrl.isAppearanceLightNavigationBars = !isDark
      }

      dialog.setOnKeyListener { _, keyCode, event ->
        if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
          if (!webViewDestroyed && wv.canGoBack()) {
            wv.goBack()
          } else {
            dialog.dismiss()
          }
          true
        } else {
          false
        }
      }

      dialog.setOnDismissListener {
        activeAuthDialog = null
        // Back gesture, outside tap or activity teardown: still flush and hand
        // back the cookies captured so far instead of dropping them.
        if (!settled) {
          settled = true
          promise.resolve(buildWebViewResult(cancelled = true, redirectUrl = null))
        }
        webViewDestroyed = true
        runCatching {
          wv.stopLoading()
          (wv.parent as? ViewGroup)?.removeView(wv)
          wv.destroy()
        }
      }

      dialog.show()
      ViewCompat.requestApplyInsets(root)

      if (ephemeral) {
        cookieManager.removeAllCookies { _ ->
          cookieManager.flush()
          wv.post {
            if (!settled && !webViewDestroyed && dialog.isShowing) {
              wv.loadUrl(url)
            }
          }
        }
      } else {
        wv.loadUrl(url)
      }
    }
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
        headlessWebViews.remove(sessionId)?.let { old ->
          runCatching {
            old.stopLoading()
            old.destroy()
          }
        }
        val wv = WebView(activity)
        PixManagedWebView.configureWebView(wv)
        wv.addJavascriptInterface(object {
          @JavascriptInterface
          fun postMessage(name: String, jsonPayload: String) {
            if (!reactContext.hasActiveReactInstance()) return
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

          override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            headlessWebViews.remove(sessionId)
            if (!done) {
              done = true
              promise.resolve(false)
            }
            return true
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
    reactContext.runOnUiQueueThread {
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

  /**
   * Android 13+ requires a runtime POST_NOTIFICATIONS grant; without it every
   * download/export notification is silently dropped. Resolves false when the
   * host has no foreground activity to show the system dialog from.
   */
  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(true)
      return
    }
    val granted =
      ContextCompat.checkSelfPermission(reactContext, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    if (granted) {
      promise.resolve(true)
      return
    }
    val activity = currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    runCatching {
        activity.requestPermissions(
          arrayOf(Manifest.permission.POST_NOTIFICATIONS),
          NOTIFICATION_PERMISSION_REQUEST,
        ) { _, _, grantResults ->
          promise.resolve(
            grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
          )
          true
        }
      }
      .onFailure { promise.resolve(false) }
  }

  @ReactMethod
  fun startDownloadService(promise: Promise) {
    promise.resolve(PixDownloadService.start(reactContext))
  }

  @ReactMethod
  fun stopDownloadService(promise: Promise) {
    PixDownloadService.stop(reactContext)
    promise.resolve(true)
  }
}
