package com.pixscripting

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.PushbackInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.GZIPInputStream
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

private const val INLINE_BODY_LIMIT = 128 * 1024
private const val MAX_AUTO_REDIRECTS = 6
private const val MAX_CACHED_BLOBS = 64
private const val BLOB_RETENTION_MS = 5 * 60 * 1000L
private const val BLOB_PROTECT_RECENT_MS = 30 * 1000L
private const val ABORT_TTL_MS = 60 * 1000L

class PixHttpModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val pool = Executors.newCachedThreadPool()
  private val activeConnections = ConcurrentHashMap<String, HttpURLConnection>()
  private val abortedIds = ConcurrentHashMap<String, Long>()
  private val blobCounter = AtomicInteger(0)
  private val blobDir by lazy {
    File(reactContext.cacheDir, "http-blobs").apply {
      deleteRecursively()
      mkdirs()
    }
  }

  override fun getName(): String = "PixHttp"

  override fun invalidate() {
    super.invalidate()
    val conns = activeConnections.values.toList()
    activeConnections.clear()
    abortedIds.clear()
    pool.execute {
      for (c in conns) {
        runCatching { c.disconnect() }
      }
    }
  }

  private fun isAborted(reqId: String): Boolean = abortedIds.containsKey(reqId)

  private fun pruneAbortedIds() {
    if (abortedIds.size < 64) return
    val cutoff = System.currentTimeMillis() - ABORT_TTL_MS
    val iter = abortedIds.entries.iterator()
    while (iter.hasNext()) {
      if (iter.next().value < cutoff) iter.remove()
    }
  }

  private fun maybePruneBlobs() {
    if (blobCounter.incrementAndGet() % 16 != 0) return
    pool.execute {
      runCatching {
        val files = blobDir.listFiles()?.filter { it.isFile } ?: return@runCatching
        if (files.size <= MAX_CACHED_BLOBS) return@runCatching
        val now = System.currentTimeMillis()
        val sorted = files.sortedBy { it.lastModified() }
        var remaining = sorted.size
        for (f in sorted) {
          val age = now - f.lastModified()
          if (age < BLOB_PROTECT_RECENT_MS) continue
          if (remaining > MAX_CACHED_BLOBS || age > BLOB_RETENTION_MS) {
            if (f.delete()) remaining--
          }
        }
      }
    }
  }

  private fun parseHeadersMap(options: ReadableMap): MutableMap<String, String> {
    val map = LinkedHashMap<String, String>()
    if (options.hasKey("headers") && !options.isNull("headers")) {
      val headersMap = options.getMap("headers")
      headersMap?.entryIterator?.forEach { entry ->
        val value = entry.value?.toString()
        if (value != null) {
          map[entry.key] = value
        }
      }
    }
    return map
  }

  private fun hasHeaderIgnoreCase(headers: Map<String, String>, name: String): Boolean =
    headers.keys.any { it.equals(name, ignoreCase = true) }

  private fun originOf(url: URL): String {
    val proto = url.protocol.lowercase()
    val host = url.host.lowercase()
    val port = when {
      url.port > 0 -> url.port
      proto == "https" -> 443
      proto == "http" -> 80
      else -> -1
    }
    return "$proto://$host:$port"
  }

  private fun unwrapContentEncoding(raw: InputStream, contentEncoding: String?): Pair<InputStream, Boolean> {
    val enc = contentEncoding?.trim()?.lowercase() ?: return Pair(raw, false)
    return when {
      enc == "gzip" || enc == "x-gzip" -> Pair(GZIPInputStream(raw), true)
      enc == "deflate" -> {
        val pb = PushbackInputStream(raw, 2)
        val header = ByteArray(2)
        val n = pb.read(header)
        if (n > 0) pb.unread(header, 0, n)
        // Standard RFC 1950 zlib header has CMF low nibble == 8 and (CMF*256+FLG)%31 == 0
        val isZlib = n == 2 &&
          ((header[0].toInt() and 0x0F) == 8) &&
          ((((header[0].toInt() and 0xFF) shl 8) or (header[1].toInt() and 0xFF)) % 31 == 0)
        Pair(InflaterInputStream(pb, Inflater(!isZlib)), true)
      }
      else -> Pair(raw, false)
    }
  }

  private fun collectResponseHeaders(conn: HttpURLConnection, decompressed: Boolean): WritableMap {
    val respHeaders = Arguments.createMap()
    conn.headerFields?.forEach { (k, values) ->
      if (k != null && values.isNotEmpty()) {
        val lower = k.lowercase()
        if (decompressed && (lower == "content-encoding" || lower == "content-length")) {
          return@forEach
        }
        respHeaders.putString(lower, values.joinToString(", "))
      }
    }
    return respHeaders
  }

  private data class ConnectedResponse(
    val conn: HttpURLConnection,
    val status: Int,
    val finalUrl: String,
  )

  private fun connectWithRedirects(
    reqId: String,
    initialUrl: String,
    initialMethod: String,
    initialHeaders: Map<String, String>,
    initialBody: ByteArray?,
    connectTimeoutMs: Int,
    readTimeoutMs: Int,
    followRedirects: Boolean,
  ): ConnectedResponse {
    var currentUrl = URL(initialUrl)
    var currentMethod = initialMethod.uppercase()
    var currentHeaders = LinkedHashMap(initialHeaders)
    var currentBody = initialBody
    var redirects = 0

    while (true) {
      if (isAborted(reqId)) throw InterruptedException("Aborted")
      val conn = (currentUrl.openConnection() as HttpURLConnection)
      activeConnections[reqId] = conn
      if (isAborted(reqId)) {
        runCatching { conn.disconnect() }
        throw InterruptedException("Aborted")
      }

      conn.requestMethod = currentMethod
      conn.instanceFollowRedirects = false
      conn.useCaches = false
      conn.connectTimeout = connectTimeoutMs
      conn.readTimeout = readTimeoutMs

      for ((k, v) in currentHeaders) {
        conn.setRequestProperty(k, v)
      }

      if (currentBody != null && currentMethod != "GET" && currentMethod != "HEAD") {
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(currentBody.size)
        conn.outputStream.use { it.write(currentBody) }
      }

      val status = conn.responseCode
      if (followRedirects && status in listOf(301, 302, 303, 307, 308) && redirects < MAX_AUTO_REDIRECTS) {
        val loc = conn.getHeaderField("Location") ?: conn.getHeaderField("location")
        if (!loc.isNullOrBlank()) {
          val nextUrl = URL(currentUrl, loc)
          val sameOrigin = originOf(currentUrl) == originOf(nextUrl)
          runCatching { conn.inputStream?.close() }
          runCatching { conn.errorStream?.close() }
          runCatching { conn.disconnect() }

          if (!sameOrigin) {
            val iter = currentHeaders.entries.iterator()
            while (iter.hasNext()) {
              val key = iter.next().key.lowercase()
              if (key == "authorization" || key == "cookie" || key == "proxy-authorization") {
                iter.remove()
              }
            }
          }
          if (status == 303 || ((status == 301 || status == 302) && currentMethod == "POST")) {
            currentMethod = "GET"
            currentBody = null
            val iter = currentHeaders.entries.iterator()
            while (iter.hasNext()) {
              val key = iter.next().key.lowercase()
              if (key == "content-type" || key == "content-length") {
                iter.remove()
              }
            }
          }
          currentUrl = nextUrl
          redirects++
          continue
        }
      }

      return ConnectedResponse(
        conn = conn,
        status = status,
        finalUrl = conn.url?.toString() ?: currentUrl.toString(),
      )
    }
  }

  private fun readResponseBodyIntoResult(
    reqId: String,
    conn: HttpURLConnection,
    status: Int,
    result: WritableMap,
  ): Boolean {
    val rawStream: InputStream? = runCatching {
      if (status in 200..399) conn.inputStream else conn.errorStream
    }.getOrNull()
    if (rawStream == null) {
      result.putMap("headers", collectResponseHeaders(conn, decompressed = false))
      result.putString("bodyBase64", "")
      result.putDouble("byteLength", 0.0)
      return false
    }

    val (stream, decompressed) = unwrapContentEncoding(rawStream, conn.contentEncoding)
    result.putMap("headers", collectResponseHeaders(conn, decompressed = decompressed))

    val buffer = ByteArray(16 * 1024)
    val mem = ByteArrayOutputStream()
    var tempFile: File? = null
    var fileOut: java.io.OutputStream? = null
    var totalBytes = 0L
    var readSucceeded = false

    try {
      stream.use { input ->
        while (true) {
          if (isAborted(reqId)) {
            throw InterruptedException("Aborted")
          }
          val n = input.read(buffer)
          if (n < 0) break
          if (n == 0) continue
          totalBytes += n
          if (tempFile == null && totalBytes > INLINE_BODY_LIMIT) {
            tempFile = File(blobDir, "${UUID.randomUUID()}.bin")
            fileOut = tempFile!!.outputStream().buffered(32 * 1024)
            mem.writeTo(fileOut)
            mem.reset()
          }
          if (fileOut != null) {
            fileOut!!.write(buffer, 0, n)
          } else {
            mem.write(buffer, 0, n)
          }
        }
      }
      readSucceeded = true
    } finally {
      runCatching { fileOut?.close() }
      if (!readSucceeded && tempFile != null) {
        runCatching { tempFile!!.delete() }
      }
    }

    result.putDouble("byteLength", totalBytes.toDouble())
    if (tempFile != null) {
      result.putString("tempFilePath", tempFile!!.absolutePath)
      maybePruneBlobs()
    } else {
      result.putString("bodyBase64", Base64.encodeToString(mem.toByteArray(), Base64.NO_WRAP))
    }
    return decompressed
  }

  @ReactMethod
  fun abortRequest(reqId: String) {
    abortedIds[reqId] = System.currentTimeMillis()
    pruneAbortedIds()
    activeConnections.remove(reqId)?.let { conn ->
      pool.execute { runCatching { conn.disconnect() } }
    }
  }

  @ReactMethod
  fun request(reqId: String, options: ReadableMap, promise: Promise) {
    pool.execute {
      if (abortedIds.remove(reqId) != null) {
        promise.reject("AbortError", "Aborted")
        return@execute
      }
      var conn: HttpURLConnection? = null
      try {
        val urlStr = options.getString("url") ?: error("Missing URL")
        val method = (options.getString("method") ?: "GET").uppercase()
        val timeoutMs = if (options.hasKey("timeoutMs") && !options.isNull("timeoutMs")) {
          options.getInt("timeoutMs").coerceIn(1000, 600_000)
        } else {
          30_000
        }
        val followRedirects = !options.hasKey("followRedirects") || options.getBoolean("followRedirects")
        val headers = parseHeadersMap(options)

        val bodyBytes = if (method != "GET" && method != "HEAD") {
          val bodyBase64 = if (options.hasKey("bodyBase64") && !options.isNull("bodyBase64")) options.getString("bodyBase64") else null
          val bodyStr = if (options.hasKey("body") && !options.isNull("body")) options.getString("body") else null
          when {
            bodyBase64 != null -> Base64.decode(bodyBase64, Base64.DEFAULT)
            bodyStr != null -> bodyStr.toByteArray(Charsets.UTF_8)
            else -> null
          }
        } else {
          null
        }

        val connected = connectWithRedirects(
          reqId = reqId,
          initialUrl = urlStr,
          initialMethod = method,
          initialHeaders = headers,
          initialBody = bodyBytes,
          connectTimeoutMs = timeoutMs,
          readTimeoutMs = timeoutMs,
          followRedirects = followRedirects,
        )
        conn = connected.conn

        val result = Arguments.createMap().apply {
          putInt("status", connected.status)
          putString("url", connected.finalUrl)
        }
        readResponseBodyIntoResult(reqId, conn, connected.status, result)
        promise.resolve(result)
      } catch (e: Exception) {
        if (abortedIds.remove(reqId) != null || e is InterruptedException) {
          promise.reject("AbortError", "Aborted")
        } else if (e is java.net.SocketTimeoutException) {
          promise.reject("TimeoutError", e.message ?: "Request timed out")
        } else {
          promise.reject("E_HTTP", e.message ?: "Network error", e)
        }
      } finally {
        activeConnections.remove(reqId)
        abortedIds.remove(reqId)
        runCatching { conn?.disconnect() }
      }
    }
  }

  @ReactMethod
  fun streamRequest(reqId: String, options: ReadableMap, promise: Promise) {
    pool.execute {
      if (abortedIds.remove(reqId) != null) {
        promise.reject("AbortError", "Aborted")
        return@execute
      }
      var conn: HttpURLConnection? = null
      var promiseSettled = false
      try {
        val urlStr = options.getString("url") ?: error("Missing URL")
        val method = (options.getString("method") ?: "POST").uppercase()
        val readTimeoutMs = if (options.hasKey("timeoutMs") && !options.isNull("timeoutMs")) {
          options.getInt("timeoutMs").coerceIn(1000, 600_000)
        } else {
          180_000
        }
        val connectTimeoutMs = readTimeoutMs.coerceAtMost(30_000)

        val headers = parseHeadersMap(options)
        if (!hasHeaderIgnoreCase(headers, "Accept-Encoding")) {
          headers["Accept-Encoding"] = "identity"
        }

        val bodyBytes = if (method != "GET" && method != "HEAD") {
          val bodyBase64 = if (options.hasKey("bodyBase64") && !options.isNull("bodyBase64")) options.getString("bodyBase64") else null
          val bodyStr = if (options.hasKey("body") && !options.isNull("body")) options.getString("body") else null
          when {
            bodyBase64 != null -> Base64.decode(bodyBase64, Base64.DEFAULT)
            bodyStr != null -> bodyStr.toByteArray(Charsets.UTF_8)
            else -> null
          }
        } else {
          null
        }

        val connected = connectWithRedirects(
          reqId = reqId,
          initialUrl = urlStr,
          initialMethod = method,
          initialHeaders = headers,
          initialBody = bodyBytes,
          connectTimeoutMs = connectTimeoutMs,
          readTimeoutMs = readTimeoutMs,
          followRedirects = true,
        )
        conn = connected.conn
        val status = connected.status
        val contentType = (conn.contentType ?: "").lowercase()

        // Non-2xx errors or plain JSON responses: read body directly so res.json()/res.text() work reliably
        if (status !in 200..299 || contentType.contains("application/json")) {
          val result = Arguments.createMap().apply {
            putInt("status", status)
            putString("url", connected.finalUrl)
            putBoolean("isStream", false)
          }
          readResponseBodyIntoResult(reqId, conn, status, result)
          promiseSettled = true
          promise.resolve(result)
          return@execute
        }

        val rawStream: InputStream? = runCatching { conn.inputStream }.getOrNull()
        val (stream, decompressed) = if (rawStream != null) {
          unwrapContentEncoding(rawStream, conn.contentEncoding)
        } else {
          Pair(null, false)
        }
        val respHeaders = collectResponseHeaders(conn, decompressed = decompressed)

        promiseSettled = true
        promise.resolve(Arguments.createMap().apply {
          putInt("status", status)
          putString("url", connected.finalUrl)
          putMap("headers", respHeaders)
          putBoolean("isStream", true)
        })

        val emitter = reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        if (stream != null) {
          val buffer = ByteArray(4096)
          stream.use { input ->
            while (true) {
              if (isAborted(reqId)) break
              val n = input.read(buffer)
              if (n < 0) break
              if (n > 0 && reactContext.hasActiveReactInstance()) {
                emitter.emit("PixHttpStreamChunk", Arguments.createMap().apply {
                  putString("reqId", reqId)
                  putString("chunkBase64", Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP))
                  putBoolean("done", false)
                })
              }
            }
          }
        }
        if (reactContext.hasActiveReactInstance()) {
          emitter.emit("PixHttpStreamChunk", Arguments.createMap().apply {
            putString("reqId", reqId)
            putString("chunkBase64", "")
            putBoolean("done", true)
            if (isAborted(reqId)) putBoolean("aborted", true)
          })
        }
      } catch (e: Exception) {
        val wasAborted = isAborted(reqId) || e is InterruptedException
        if (!promiseSettled) {
          promiseSettled = true
          if (wasAborted) {
            promise.reject("AbortError", "Aborted")
          } else if (e is java.net.SocketTimeoutException) {
            promise.reject("TimeoutError", e.message ?: "Request timed out")
          } else {
            promise.reject("E_HTTP_STREAM", e.message ?: "Stream error", e)
          }
        } else if (reactContext.hasActiveReactInstance()) {
          runCatching {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("PixHttpStreamChunk", Arguments.createMap().apply {
                putString("reqId", reqId)
                putBoolean("done", true)
                if (wasAborted) {
                  putBoolean("aborted", true)
                } else {
                  putString("error", e.message ?: "Stream error")
                }
              })
          }
        }
      } finally {
        activeConnections.remove(reqId)
        abortedIds.remove(reqId)
        runCatching { conn?.disconnect() }
      }
    }
  }
}
