package com.pixscripting

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

private const val INLINE_BODY_LIMIT = 128 * 1024

class PixHttpModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val pool = Executors.newCachedThreadPool()
  private val activeConnections = ConcurrentHashMap<String, HttpURLConnection>()
  private val abortedIds = ConcurrentHashMap.newKeySet<String>()
  private val blobDir by lazy {
    File(reactContext.cacheDir, "http-blobs").apply {
      deleteRecursively()
      mkdirs()
    }
  }

  override fun getName(): String = "PixHttp"

  @ReactMethod
  fun abortRequest(reqId: String) {
    abortedIds.add(reqId)
    activeConnections.remove(reqId)?.let { conn ->
      pool.execute { runCatching { conn.disconnect() } }
    }
  }

  @ReactMethod
  fun request(reqId: String, options: ReadableMap, promise: Promise) {
    pool.execute {
      if (abortedIds.remove(reqId)) {
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

        conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = method
          instanceFollowRedirects = followRedirects
          useCaches = false
          connectTimeout = timeoutMs
          readTimeout = timeoutMs
          val headersMap = if (options.hasKey("headers") && !options.isNull("headers")) options.getMap("headers") else null
          headersMap?.entryIterator?.forEach { entry ->
            setRequestProperty(entry.key, entry.value?.toString() ?: "")
          }
          if (method != "GET" && method != "HEAD") {
            val bodyBase64 = if (options.hasKey("bodyBase64") && !options.isNull("bodyBase64")) options.getString("bodyBase64") else null
            val bodyStr = if (options.hasKey("body") && !options.isNull("body")) options.getString("body") else null
            val bodyBytes = when {
              bodyBase64 != null -> Base64.decode(bodyBase64, Base64.DEFAULT)
              bodyStr != null -> bodyStr.toByteArray(Charsets.UTF_8)
              else -> null
            }
            if (bodyBytes != null) {
              doOutput = true
              setFixedLengthStreamingMode(bodyBytes.size)
              outputStream.use { it.write(bodyBytes) }
            }
          }
        }
        activeConnections[reqId] = conn
        if (abortedIds.contains(reqId)) {
          error("Aborted")
        }

        val status = conn.responseCode
        val respHeaders = Arguments.createMap()
        conn.headerFields?.forEach { (k, values) ->
          if (k != null && values.isNotEmpty()) {
            respHeaders.putString(k.lowercase(), values.joinToString(", "))
          }
        }

        val stream: InputStream? = if (status in 200..399) conn.inputStream else conn.errorStream
        val result = Arguments.createMap().apply {
          putInt("status", status)
          putString("url", conn.url?.toString() ?: urlStr)
          putMap("headers", respHeaders)
        }

        if (stream == null) {
          result.putString("bodyBase64", "")
          result.putInt("byteLength", 0)
          promise.resolve(result)
          return@execute
        }

        val buffer = ByteArray(16 * 1024)
        val mem = ByteArrayOutputStream()
        var tempFile: File? = null
        var fileOut: java.io.OutputStream? = null
        var totalBytes = 0

        try {
          stream.use { input ->
            while (true) {
              if (abortedIds.contains(reqId)) {
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
        } finally {
          runCatching { fileOut?.close() }
        }

        result.putInt("byteLength", totalBytes)
        if (tempFile != null) {
          result.putString("tempFilePath", tempFile!!.absolutePath)
        } else {
          result.putString("bodyBase64", Base64.encodeToString(mem.toByteArray(), Base64.NO_WRAP))
        }
        promise.resolve(result)
      } catch (e: Exception) {
        if (abortedIds.remove(reqId) || e is InterruptedException) {
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
      if (abortedIds.remove(reqId)) {
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
          120_000
        }

        conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = method
          instanceFollowRedirects = true
          useCaches = false
          connectTimeout = timeoutMs
          readTimeout = timeoutMs
          val headersMap = if (options.hasKey("headers") && !options.isNull("headers")) options.getMap("headers") else null
          headersMap?.entryIterator?.forEach { entry ->
            setRequestProperty(entry.key, entry.value?.toString() ?: "")
          }
          if (method != "GET" && method != "HEAD") {
            val bodyStr = if (options.hasKey("body") && !options.isNull("body")) options.getString("body") else null
            if (bodyStr != null) {
              val bodyBytes = bodyStr.toByteArray(Charsets.UTF_8)
              doOutput = true
              setFixedLengthStreamingMode(bodyBytes.size)
              outputStream.use { it.write(bodyBytes) }
            }
          }
        }
        activeConnections[reqId] = conn
        val status = conn.responseCode
        val respHeaders = Arguments.createMap()
        conn.headerFields?.forEach { (k, values) ->
          if (k != null && values.isNotEmpty()) {
            respHeaders.putString(k.lowercase(), values.joinToString(", "))
          }
        }

        // Resolve initial response headers immediately, then push stream chunks
        promise.resolve(Arguments.createMap().apply {
          putInt("status", status)
          putString("url", conn.url?.toString() ?: urlStr)
          putMap("headers", respHeaders)
        })

        val stream = if (status in 200..399) conn.inputStream else conn.errorStream
        val emitter = reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        if (stream != null) {
          val buffer = ByteArray(4096)
          stream.use { input ->
            while (true) {
              if (abortedIds.contains(reqId)) break
              val n = input.read(buffer)
              if (n < 0) break
              if (n > 0) {
                emitter.emit("PixHttpStreamChunk", Arguments.createMap().apply {
                  putString("reqId", reqId)
                  putString("chunkBase64", Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP))
                  putBoolean("done", false)
                })
              }
            }
          }
        }
        emitter.emit("PixHttpStreamChunk", Arguments.createMap().apply {
          putString("reqId", reqId)
          putString("chunkBase64", "")
          putBoolean("done", true)
          if (abortedIds.contains(reqId)) putBoolean("aborted", true)
        })
      } catch (e: Exception) {
        val wasAborted = abortedIds.contains(reqId) || e is InterruptedException
        runCatching {
          promise.reject(if (wasAborted) "AbortError" else "E_HTTP_STREAM", e.message ?: "Stream error")
        }
        runCatching {
          reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("PixHttpStreamChunk", Arguments.createMap().apply {
              putString("reqId", reqId)
              putBoolean("done", true)
              putString("error", e.message ?: "Stream error")
            })
        }
      } finally {
        activeConnections.remove(reqId)
        abortedIds.remove(reqId)
        runCatching { conn?.disconnect() }
      }
    }
  }
}
