package com.pixscripting

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

class PixImageMediaModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val workerPool = Executors.newFixedThreadPool(2)

  override fun getName(): String = "PixImageMedia"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun imageBoundsSync(path: String): WritableMap? {
    val f = File(path)
    if (!f.exists() || !f.isFile) return null
    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, opts)
    if (opts.outWidth <= 0 || opts.outHeight <= 0) return null
    return Arguments.createMap().apply {
      putInt("width", opts.outWidth)
      putInt("height", opts.outHeight)
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun imagePaletteSync(
    path: String,
    cropX: Int,
    cropY: Int,
    cropW: Int,
    cropH: Int,
    dominantCount: Int,
  ): WritableMap? {
    val f = File(path)
    if (!f.exists() || !f.isFile) return null

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sampleSize = 1
    while (bounds.outWidth / sampleSize > 128 && bounds.outHeight / sampleSize > 128) {
      sampleSize *= 2
    }
    val decodeOpts = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val bmp = BitmapFactory.decodeFile(path, decodeOpts) ?: return null

    return try {
      val scaleX = bmp.width.toFloat() / bounds.outWidth.toFloat()
      val scaleY = bmp.height.toFloat() / bounds.outHeight.toFloat()

      val sx = if (cropW > 0) (cropX * scaleX).roundToInt().coerceIn(0, bmp.width - 1) else 0
      val sy = if (cropH > 0) (cropY * scaleY).roundToInt().coerceIn(0, bmp.height - 1) else 0
      val ex = if (cropW > 0) ((cropX + cropW) * scaleX).roundToInt().coerceIn(sx + 1, bmp.width) else bmp.width
      val ey = if (cropH > 0) ((cropY + cropH) * scaleY).roundToInt().coerceIn(sy + 1, bmp.height) else bmp.height

      val rw = ex - sx
      val rh = ey - sy
      val pixels = IntArray(rw * rh)
      bmp.getPixels(pixels, 0, rw, sx, sy, rw, rh)

      var sumR = 0L
      var sumG = 0L
      var sumB = 0L
      val buckets = HashMap<Int, LongArray>()

      for (px in pixels) {
        val r = (px ushr 16) and 0xFF
        val g = (px ushr 8) and 0xFF
        val b = px and 0xFF
        sumR += r
        sumG += g
        sumB += b
        // 4-bit per channel bucket (4096 bins) for dominant color extraction
        val key = ((r ushr 4) shl 8) or ((g ushr 4) shl 4) or (b ushr 4)
        val acc = buckets.getOrPut(key) { LongArray(4) }
        acc[0] += r.toLong()
        acc[1] += g.toLong()
        acc[2] += b.toLong()
        acc[3] += 1L
      }

      val count = max(1, pixels.size)
      val avgMap = Arguments.createMap().apply {
        putDouble("red", (sumR.toDouble() / count) / 255.0)
        putDouble("green", (sumG.toDouble() / count) / 255.0)
        putDouble("blue", (sumB.toDouble() / count) / 255.0)
      }

      val sortedBuckets = buckets.values.sortedByDescending { it[3] }
      val domArr = Arguments.createArray()
      val limit = dominantCount.coerceIn(1, 12)
      for (idx in 0 until min(limit, sortedBuckets.size)) {
        val b = sortedBuckets[idx]
        val cnt = max(1L, b[3])
        val entry = Arguments.createMap().apply {
          putMap("color", Arguments.createMap().apply {
            putDouble("red", (b[0].toDouble() / cnt) / 255.0)
            putDouble("green", (b[1].toDouble() / cnt) / 255.0)
            putDouble("blue", (b[2].toDouble() / cnt) / 255.0)
          })
          putDouble("fraction", cnt.toDouble() / count.toDouble())
        }
        domArr.pushMap(entry)
      }

      Arguments.createMap().apply {
        putMap("average", avgMap)
        putArray("dominants", domArr)
      }
    } finally {
      bmp.recycle()
    }
  }

  @ReactMethod
  fun saveMediaToGallery(filePath: String, mediaType: String, albumName: String, promise: Promise) {
    workerPool.execute {
      try {
        val src = File(filePath)
        require(src.exists() && src.isFile) { "Media file does not exist" }
        val isVideo = mediaType == "video" || filePath.endsWith(".mp4", ignoreCase = true)
        val ext = src.extension.lowercase().ifEmpty { if (isVideo) "mp4" else "jpg" }
        val mime = when (ext) {
          "png" -> "image/png"
          "gif" -> "image/gif"
          "webp" -> "image/webp"
          "mp4" -> "video/mp4"
          else -> "image/jpeg"
        }
        val cleanAlbum = albumName.trim().ifEmpty { "Pix-Scripting" }
        val fileName = src.name.ifEmpty { "pix_${System.currentTimeMillis()}.$ext" }
        val resolver = reactContext.contentResolver

        val collection = if (isVideo) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
          } else {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
          }
        } else {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
          } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
          }
        }

        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
          put(MediaStore.MediaColumns.MIME_TYPE, mime)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val baseDir = if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES
            put(MediaStore.MediaColumns.RELATIVE_PATH, "$baseDir/$cleanAlbum")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }
        }

        val uri = resolver.insert(collection, values) ?: error("Failed to create MediaStore entry")
        try {
          resolver.openOutputStream(uri)?.use { out ->
            src.inputStream().use { inp -> inp.copyTo(out, 64 * 1024) }
          } ?: error("Failed to open MediaStore output stream")

          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
          }
          promise.resolve(uri.toString())
        } catch (err: Exception) {
          runCatching { resolver.delete(uri, null, null) }
          throw err
        }
      } catch (e: Exception) {
        promise.reject("E_SAVE_MEDIA", e.message ?: "Failed to save media", e)
      }
    }
  }

  @ReactMethod
  fun renderOCRImage(
    filePath: String,
    bubblesJson: String,
    scale: Double,
    outputFormat: String,
    promise: Promise,
  ) {
    workerPool.execute {
      var mutableBmp: Bitmap? = null
      try {
        val rawBmp = BitmapFactory.decodeFile(filePath) ?: error("Cannot decode image")
        mutableBmp = rawBmp.copy(Bitmap.Config.ARGB_8888, true)
        if (rawBmp !== mutableBmp) rawBmp.recycle()

        val canvas = Canvas(mutableBmp)
        val width = mutableBmp.width.toFloat()
        val height = mutableBmp.height.toFloat()
        val effectiveScale = scale.toFloat().coerceIn(0.5f, 2.0f)

        val bubbles = JSONArray(bubblesJson)
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          style = Paint.Style.FILL
          color = Color.argb(245, 255, 255, 255)
        }
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          style = Paint.Style.STROKE
          color = Color.argb(64, 0, 0, 0)
        }
        val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.BLACK
        }

        for (i in 0 until bubbles.length()) {
          val b = bubbles.optJSONObject(i) ?: continue
          val box = b.optJSONArray("box_2d") ?: continue
          val translation = b.optString("translation", "").trim()
          if (box.length() != 4 || translation.isEmpty()) continue

          val ymin = box.optDouble(0, 0.0).coerceIn(0.0, 1000.0).toFloat()
          val xmin = box.optDouble(1, 0.0).coerceIn(0.0, 1000.0).toFloat()
          val ymax = box.optDouble(2, 0.0).coerceIn(0.0, 1000.0).toFloat()
          val xmax = box.optDouble(3, 0.0).coerceIn(0.0, 1000.0).toFloat()

          val rawX = (xmin / 1000f) * width
          val rawY = (ymin / 1000f) * height
          val rawW = ((xmax - xmin) / 1000f) * width
          val rawH = ((ymax - ymin) / 1000f) * height
          val cx = rawX + rawW / 2f
          val cy = rawY + rawH / 2f
          val sw = rawW * effectiveScale
          val sh = rawH * effectiveScale
          val sx = cx - sw / 2f + sw * 0.015f
          val sy = cy - sh / 2f + sh * 0.015f
          val w = max(4f, sw * 0.97f)
          val h = max(4f, sh * 0.97f)
          if (w < 6f || h < 6f) continue

          val rect = RectF(sx, sy, sx + w, sy + h)
          val aspect = w / h
          val rawShape = b.optString("shape", "")
          val isEllipse = if (rawShape == "ellipse" || rawShape == "round_rect") {
            rawShape == "ellipse"
          } else {
            aspect in 0.4f..2.5f
          }

          strokePaint.strokeWidth = max(1f, min(min(w, h) * 0.025f, width * 0.002f))
          canvas.save()
          if (isEllipse) {
            canvas.drawOval(rect, fillPaint)
            canvas.drawOval(rect, strokePaint)
          } else {
            val radius = min(w / 2f, min(h / 2f, min(w, h) * 0.35f))
            canvas.drawRoundRect(rect, radius, radius, fillPaint)
            canvas.drawRoundRect(rect, radius, radius, strokePaint)
          }

          val inset = if (isEllipse) 0.24f else 0.10f
          val maxTextW = max(8f, w * (1f - inset)).roundToInt()
          val maxTextH = max(8f, h * (1f - inset))
          val idealSize = sqrt((maxTextW * maxTextH) / (max(1, translation.length) * 1.45f)) * effectiveScale
          var fontSize = idealSize.coerceIn(max(6f, maxTextH * 0.08f), min(maxTextH * 0.7f, maxTextW * 0.9f))

          var layout: StaticLayout
          while (true) {
            textPaint.textSize = fontSize
            layout = StaticLayout.Builder.obtain(translation, 0, translation.length, textPaint, maxTextW)
              .setAlignment(Layout.Alignment.ALIGN_CENTER)
              .setIncludePad(false)
              .build()
            if (layout.height <= maxTextH || fontSize <= 8f) break
            fontSize *= 0.85f
          }

          val tx = sx + (w - layout.width) / 2f
          val ty = sy + (h - layout.height) / 2f
          canvas.translate(tx, ty)
          layout.draw(canvas)
          canvas.restore()
        }

        val outBytes = ByteArrayOutputStream()
        val fmt = if (outputFormat == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
        mutableBmp.compress(fmt, 92, outBytes)
        promise.resolve(Base64.encodeToString(outBytes.toByteArray(), Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("E_OCR_RENDER", e.message ?: "OCR render failed", e)
      } finally {
        mutableBmp?.recycle()
      }
    }
  }

  @ReactMethod
  fun encodeUgoiraMp4(framesDir: String, framesJson: String, outputPath: String, promise: Promise) {
    workerPool.execute {
      var codec: MediaCodec? = null
      var muxer: MediaMuxer? = null
      var muxerStarted = false
      try {
        val frames = JSONArray(framesJson)
        require(frames.length() > 0) { "Empty frames" }
        val firstObj = frames.getJSONObject(0)
        val firstBmp = BitmapFactory.decodeFile(File(framesDir, firstObj.getString("file")).absolutePath)
          ?: error("Cannot decode first ugoira frame")
        val width = (firstBmp.width + 1) and -2
        val height = (firstBmp.height + 1) and -2
        firstBmp.recycle()

        val outFile = File(outputPath)
        outFile.parentFile?.mkdirs()
        val tmpOut = File(outFile.parentFile, ".tmp-${outFile.name}")
        if (tmpOut.exists()) tmpOut.delete()

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
          setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
          setInteger(MediaFormat.KEY_BIT_RATE, 4_000_000)
          setInteger(MediaFormat.KEY_FRAME_RATE, 30)
          setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()

        muxer = MediaMuxer(tmpOut.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val bufferInfo = MediaCodec.BufferInfo()
        var trackIndex = -1
        var outputDone = false

        fun drainEncoder(waitForEos: Boolean) {
          val timeoutUs = if (waitForEos) 10_000L else 0L
          while (!outputDone) {
            val outIndex = codec!!.dequeueOutputBuffer(bufferInfo, timeoutUs)
            when {
              outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                if (!waitForEos) break
              }
              outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                check(!muxerStarted)
                trackIndex = muxer!!.addTrack(codec!!.outputFormat)
                muxer!!.start()
                muxerStarted = true
              }
              outIndex >= 0 -> {
                val encodedData = codec!!.getOutputBuffer(outIndex)
                if (encodedData != null && (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && bufferInfo.size > 0 && muxerStarted) {
                  encodedData.position(bufferInfo.offset)
                  encodedData.limit(bufferInfo.offset + bufferInfo.size)
                  muxer!!.writeSampleData(trackIndex, encodedData, bufferInfo)
                }
                codec!!.releaseOutputBuffer(outIndex, false)
                if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                  outputDone = true
                  break
                }
              }
            }
          }
        }

        fun queueYuvFrame(argb: IntArray, bmpW: Int, bmpH: Int, ptsUs: Long) {
          while (true) {
            val inIndex = codec!!.dequeueInputBuffer(10_000)
            if (inIndex >= 0) {
              val img = codec!!.getInputImage(inIndex)
              val buf = codec!!.getInputBuffer(inIndex)!!
              if (img != null && img.planes.size >= 3) {
                val yPlane = img.planes[0]
                val uPlane = img.planes[1]
                val vPlane = img.planes[2]
                val yBuf = yPlane.buffer
                val uBuf = uPlane.buffer
                val vBuf = vPlane.buffer
                val yRowStride = yPlane.rowStride
                val yPixStride = yPlane.pixelStride
                val uRowStride = uPlane.rowStride
                val uPixStride = uPlane.pixelStride
                val vRowStride = vPlane.rowStride
                val vPixStride = vPlane.pixelStride

                for (row in 0 until height) {
                  for (col in 0 until width) {
                    val px = if (col < bmpW && row < bmpH) argb[row * bmpW + col] else Color.BLACK
                    val r = (px ushr 16) and 0xFF
                    val g = (px ushr 8) and 0xFF
                    val b = px and 0xFF
                    val yVal = (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).coerceIn(0, 255)
                    yBuf.put(row * yRowStride + col * yPixStride, yVal.toByte())
                    if ((row and 1) == 0 && (col and 1) == 0) {
                      val uVal = (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).coerceIn(0, 255)
                      val vVal = (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).coerceIn(0, 255)
                      val uvRow = row ushr 1
                      val uvCol = col ushr 1
                      uBuf.put(uvRow * uRowStride + uvCol * uPixStride, uVal.toByte())
                      vBuf.put(uvRow * vRowStride + uvCol * vPixStride, vVal.toByte())
                    }
                  }
                }
              }
              codec!!.queueInputBuffer(inIndex, 0, buf.capacity(), ptsUs, 0)
              drainEncoder(false)
              break
            }
            drainEncoder(false)
          }
        }

        var ptsUs = 0L
        var lastArgb: IntArray? = null
        var lastBmpW = width
        var lastBmpH = height
        for (i in 0 until frames.length()) {
          val fObj = frames.getJSONObject(i)
          val framePath = File(framesDir, fObj.getString("file")).absolutePath
          val delayMs = max(10, fObj.optInt("delay", 50))
          val bmp = BitmapFactory.decodeFile(framePath) ?: error("Missing frame $framePath")
          val argb = IntArray(bmp.width * bmp.height)
          bmp.getPixels(argb, 0, bmp.width, 0, 0, bmp.width, bmp.height)
          val bw = bmp.width
          val bh = bmp.height
          bmp.recycle()

          queueYuvFrame(argb, bw, bh, ptsUs)
          ptsUs += delayMs * 1000L
          lastArgb = argb
          lastBmpW = bw
          lastBmpH = bh
        }
        if (lastArgb != null) {
          queueYuvFrame(lastArgb, lastBmpW, lastBmpH, ptsUs)
        }
        while (true) {
          val eosIdx = codec!!.dequeueInputBuffer(10_000)
          if (eosIdx >= 0) {
            codec!!.queueInputBuffer(eosIdx, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            break
          }
          drainEncoder(false)
        }
        drainEncoder(true)
        codec.stop()
        codec.release()
        codec = null
        if (muxerStarted) muxer.stop()
        muxer.release()
        muxer = null

        if (outFile.exists()) outFile.delete()
        if (!tmpOut.renameTo(outFile)) {
          tmpOut.copyTo(outFile, overwrite = true)
          tmpOut.delete()
        }
        promise.resolve(outFile.exists() && outFile.length() > 0)
      } catch (e: Exception) {
        promise.reject("E_UGOIRA_MP4", e.message ?: "MP4 export failed", e)
      } finally {
        runCatching { codec?.stop() }
        runCatching { codec?.release() }
        runCatching { if (muxerStarted) muxer?.stop() }
        runCatching { muxer?.release() }
      }
    }
  }

  @ReactMethod
  fun encodeUgoiraGif(framesDir: String, framesJson: String, outputPath: String, promise: Promise) {
    workerPool.execute {
      try {
        val frames = JSONArray(framesJson)
        require(frames.length() > 0) { "Empty frames" }
        val outFile = File(outputPath)
        outFile.parentFile?.mkdirs()
        val tmpOut = File(outFile.parentFile, ".tmp-${outFile.name}")

        val firstBmp = BitmapFactory.decodeFile(File(framesDir, frames.getJSONObject(0).getString("file")).absolutePath)
          ?: error("Cannot decode first frame")
        val maxDim = 720
        val scale = if (max(firstBmp.width, firstBmp.height) > maxDim) {
          maxDim.toFloat() / max(firstBmp.width, firstBmp.height).toFloat()
        } else 1f
        val targetW = max(1, (firstBmp.width * scale).roundToInt())
        val targetH = max(1, (firstBmp.height * scale).roundToInt())
        firstBmp.recycle()

        FileOutputStream(tmpOut).buffered(64 * 1024).use { out ->
          val encoder = SimpleGifEncoder(out, targetW, targetH)
          encoder.writeHeader()
          for (i in 0 until frames.length()) {
            val fObj = frames.getJSONObject(i)
            val delayMs = max(20, fObj.optInt("delay", 50))
            val raw = BitmapFactory.decodeFile(File(framesDir, fObj.getString("file")).absolutePath)
              ?: error("Missing frame")
            val scaled = if (raw.width != targetW || raw.height != targetH) {
              Bitmap.createScaledBitmap(raw, targetW, targetH, true).also { raw.recycle() }
            } else raw
            try {
              encoder.writeFrame(scaled, delayMs)
            } finally {
              scaled.recycle()
            }
          }
          encoder.finish()
        }

        if (outFile.exists()) outFile.delete()
        if (!tmpOut.renameTo(outFile)) {
          tmpOut.copyTo(outFile, overwrite = true)
          tmpOut.delete()
        }
        promise.resolve(outFile.exists() && outFile.length() > 0)
      } catch (e: Exception) {
        promise.reject("E_UGOIRA_GIF", e.message ?: "GIF export failed", e)
      }
    }
  }
}

/**
 * Compact GIF89a encoder using a uniform 6x7x6 (252-color) + 4-gray global color table and standard LZW compression.
 */
private class SimpleGifEncoder(
  private val out: OutputStream,
  private val width: Int,
  private val height: Int,
) {
  private val palette = IntArray(256)
  private val pixels = IntArray(width * height)
  private val indexed = ByteArray(width * height)

  init {
    var idx = 0
    for (r in 0 until 6) {
      for (g in 0 until 7) {
        for (b in 0 until 6) {
          palette[idx++] = ((r * 51) shl 16) or ((g * 42) shl 8) or (b * 51)
        }
      }
    }
    while (idx < 256) {
      val v = (idx - 252) * 64
      palette[idx++] = (v shl 16) or (v shl 8) or v
    }
  }

  private fun writeShort(v: Int) {
    out.write(v and 0xFF)
    out.write((v ushr 8) and 0xFF)
  }

  fun writeHeader() {
    out.write("GIF89a".toByteArray(Charsets.US_ASCII))
    writeShort(width)
    writeShort(height)
    out.write(0xF7) // Global Color Table flag (1), color res (7), sort (0), GCT size 2^(7+1)=256
    out.write(0)    // Background color index
    out.write(0)    // Pixel aspect ratio
    for (c in palette) {
      out.write((c ushr 16) and 0xFF)
      out.write((c ushr 8) and 0xFF)
      out.write(c and 0xFF)
    }
    // NETSCAPE2.0 infinite loop application extension
    out.write(0x21)
    out.write(0xFF)
    out.write(11)
    out.write("NETSCAPE2.0".toByteArray(Charsets.US_ASCII))
    out.write(3)
    out.write(1)
    writeShort(0)
    out.write(0)
  }

  fun writeFrame(bmp: Bitmap, delayMs: Int) {
    bmp.getPixels(pixels, 0, width, 0, 0, width, height)
    for (i in pixels.indices) {
      val px = pixels[i]
      val r = ((px ushr 16) and 0xFF) * 5 / 255
      val g = ((px ushr 8) and 0xFF) * 6 / 255
      val b = (px and 0xFF) * 5 / 255
      indexed[i] = ((r * 42) + (g * 6) + b).toByte()
    }

    // Graphic Control Extension
    out.write(0x21)
    out.write(0xF9)
    out.write(4)
    out.write(0x04) // dispose: do not dispose
    writeShort(max(2, delayMs / 10))
    out.write(0)
    out.write(0)

    // Image Descriptor
    out.write(0x2C)
    writeShort(0)
    writeShort(0)
    writeShort(width)
    writeShort(height)
    out.write(0) // no local color table

    writeLzwPixels(8)
  }

  fun finish() {
    out.write(0x3B)
    out.flush()
  }

  private fun writeLzwPixels(minCodeSize: Int) {
    out.write(minCodeSize)
    val clearCode = 1 shl minCodeSize
    val eofCode = clearCode + 1
    var codeSize = minCodeSize + 1
    var nextCode = eofCode + 1

    val table = IntArray(4096)
    val keys = IntArray(4096)
    keys.fill(-1)

    val block = ByteArray(256)
    var blockLen = 0
    var bitAcc = 0
    var bitCount = 0

    fun emitCode(code: Int) {
      bitAcc = bitAcc or (code shl bitCount)
      bitCount += codeSize
      while (bitCount >= 8) {
        block[blockLen++] = (bitAcc and 0xFF).toByte()
        bitAcc = bitAcc ushr 8
        bitCount -= 8
        if (blockLen == 255) {
          out.write(255)
          out.write(block, 0, 255)
          blockLen = 0
        }
      }
    }

    emitCode(clearCode)
    var ent = indexed[0].toInt() and 0xFF
    for (i in 1 until indexed.size) {
      val c = indexed[i].toInt() and 0xFF
      val fcode = (c shl 12) or ent
      var found = -1
      var h = ((c shl 4) xor ent) and 0xFFF
      if (keys[h] == fcode) {
        found = table[h]
      } else if (keys[h] >= 0) {
        val disp = if (h == 0) 1 else 4096 - h
        var probe = h
        while (true) {
          probe -= disp
          if (probe < 0) probe += 4096
          if (keys[probe] == fcode) {
            found = table[probe]
            break
          }
          if (keys[probe] < 0) {
            h = probe
            break
          }
        }
      }
      if (found >= 0) {
        ent = found
      } else {
        emitCode(ent)
        ent = c
        if (nextCode < 4096) {
          table[h] = nextCode
          keys[h] = fcode
          if (nextCode == (1 shl codeSize) && codeSize < 12) {
            codeSize++
          }
          nextCode++
        } else {
          emitCode(clearCode)
          keys.fill(-1)
          codeSize = minCodeSize + 1
          nextCode = eofCode + 1
        }
      }
    }
    emitCode(ent)
    emitCode(eofCode)
    if (bitCount > 0) {
      block[blockLen++] = (bitAcc and 0xFF).toByte()
    }
    if (blockLen > 0) {
      out.write(blockLen)
      out.write(block, 0, blockLen)
    }
    out.write(0)
  }
}
