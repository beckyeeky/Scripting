package com.pixscripting

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.UUID

data class SharedFileEntry(
  val filePath: String,
  val name: String,
  val mimeType: String,
  val size: Long,
)

data class PendingAppIntent(
  val kind: String, // "url" | "share"
  val url: String?,
  val text: String?,
  val files: List<SharedFileEntry>,
  val receivedAt: Long,
)

object PixIntentHolder {
  private val lock = Any()
  @Volatile
  private var latest: PendingAppIntent? = null

  fun capture(context: Context, intent: Intent?): Boolean {
    if (intent == null) return false
    val action = intent.action ?: return false

    if (action == Intent.ACTION_VIEW) {
      val dataUri = intent.data ?: return false
      val url = dataUri.toString()
      if (url.isBlank()) return false
      synchronized(lock) {
        latest = PendingAppIntent(
          kind = "url",
          url = url,
          text = null,
          files = emptyList(),
          receivedAt = System.currentTimeMillis(),
        )
      }
      return true
    }

    if (action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE) {
      val uris = linkedSetOf<Uri>()
      if (action == Intent.ACTION_SEND) {
        readParcelableUri(intent)?.let { uris.add(it) }
      } else {
        readParcelableUriList(intent)?.let { uris.addAll(it) }
      }
      intent.clipData?.let { clip ->
        for (i in 0 until clip.itemCount) {
          clip.getItemAt(i).uri?.let { uris.add(it) }
        }
      }
      val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }
      val files = uris.mapNotNull { uri -> stageContentUri(context, uri) }
      if (files.isEmpty() && text == null) return false
      synchronized(lock) {
        latest = PendingAppIntent(
          kind = "share",
          url = null,
          text = text,
          files = files,
          receivedAt = System.currentTimeMillis(),
        )
      }
      return true
    }

    return false
  }

  fun getLatest(): PendingAppIntent? = synchronized(lock) { latest }

  fun clear() {
    synchronized(lock) { latest = null }
  }

  fun toWritableMap(entry: PendingAppIntent): WritableMap {
    val map = Arguments.createMap()
    map.putString("kind", entry.kind)
    map.putDouble("receivedAt", entry.receivedAt.toDouble())
    if (entry.url != null) map.putString("url", entry.url) else map.putNull("url")
    if (entry.text != null) map.putString("text", entry.text) else map.putNull("text")
    val arr = Arguments.createArray()
    for (file in entry.files) {
      val item = Arguments.createMap()
      item.putString("filePath", file.filePath)
      item.putString("name", file.name)
      item.putString("mimeType", file.mimeType)
      item.putDouble("size", file.size.toDouble())
      arr.pushMap(item)
    }
    map.putArray("files", arr)
    return map
  }

  fun emitIfReady(reactContext: ReactContext?) {
    val item = getLatest() ?: return
    if (reactContext == null || !reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("PixIntentEvent", toWritableMap(item))
  }

  @Suppress("DEPRECATION")
  private fun readParcelableUri(intent: Intent): Uri? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
  }

  @Suppress("DEPRECATION")
  private fun readParcelableUriList(intent: Intent): ArrayList<Uri>? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
    }
  }

  fun stageContentUri(context: Context, uri: Uri): SharedFileEntry? {
    if (uri.scheme == "file" && uri.path != null) {
      val f = File(uri.path!!)
      if (!f.exists() || !f.isFile) return null
      return SharedFileEntry(
        filePath = f.absolutePath,
        name = f.name,
        mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream",
        size = f.length(),
      )
    }
    if (uri.scheme != "content") return null

    var displayName = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "shared-file"
    var byteSize = 0L
    val mimeType = runCatching { context.contentResolver.getType(uri) }.getOrNull() ?: "application/octet-stream"

    runCatching {
      context.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIdx >= 0) {
            val queried = cursor.getString(nameIdx)
            if (!queried.isNullOrBlank()) displayName = queried
          }
          val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
            byteSize = cursor.getLong(sizeIdx).coerceAtLeast(0L)
          }
        }
      }
    }

    val safeName = displayName.replace(Regex("[\\\\/:*?\"<>|\\r\\n\\t]"), "_")
    val dir = File(context.cacheDir, "shared-imports/${UUID.randomUUID()}")
    if (!dir.mkdirs() && !dir.exists()) return null
    val dest = File(dir, safeName)
    return try {
      context.contentResolver.openInputStream(uri)?.use { input ->
        dest.outputStream().use { output ->
          input.copyTo(output, 64 * 1024)
        }
      } ?: return null
      SharedFileEntry(
        filePath = dest.absolutePath,
        name = safeName,
        mimeType = mimeType,
        size = if (byteSize > 0) byteSize else dest.length(),
      )
    } catch (_: Exception) {
      null
    }
  }
}

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "PixScripting"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    runCatching { PixIntentHolder.capture(this, intent) }
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val captured = runCatching { PixIntentHolder.capture(this, intent) }.getOrDefault(false)
    if (captured && reactNativeHost.hasInstance()) {
      PixIntentHolder.emitIfReady(reactNativeHost.reactInstanceManager.currentReactContext)
    }
  }
}
