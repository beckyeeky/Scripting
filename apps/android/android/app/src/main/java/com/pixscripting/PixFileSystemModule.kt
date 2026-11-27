package com.pixscripting

import android.content.Context
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

class PixFileSystemModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val ioPool = Executors.newFixedThreadPool(4)
  private val secureRandom = SecureRandom()
  private val credentials by lazy { PixCredentialStore(reactContext) }
  private val storagePrefs by lazy {
    reactContext.getSharedPreferences("pix_scripting_storage", Context.MODE_PRIVATE)
  }

  private val docsRoot: File by lazy {
    File(reactContext.filesDir, "documents").apply { mkdirs() }
  }
  private val tempRoot: File by lazy {
    File(reactContext.cacheDir, "temp").apply { mkdirs() }
  }
  private val appGroupRoot: File by lazy {
    File(reactContext.filesDir, "app_group").apply { mkdirs() }
  }

  override fun getName(): String = "PixFileSystem"

  private fun isSamePath(a: File, b: File): Boolean {
    return runCatching { a.canonicalPath == b.canonicalPath }
      .getOrElse { a.absolutePath == b.absolutePath }
  }

  private fun writeAtomic(target: File, writer: (File) -> Unit): Boolean {
    val parent = target.parentFile
    if (parent != null && !parent.exists()) {
      parent.mkdirs()
    }
    val tmp = File(parent ?: target.absoluteFile.parentFile, ".pixtmp-${target.name}-${System.nanoTime()}")
    return try {
      writer(tmp)
      if (tmp.renameTo(target)) {
        true
      } else {
        if (target.exists()) target.delete()
        if (tmp.renameTo(target)) {
          true
        } else {
          tmp.inputStream().use { inp ->
            target.outputStream().use { out -> inp.copyTo(out, 64 * 1024) }
          }
          tmp.delete()
          true
        }
      }
    } catch (_: Exception) {
      runCatching { tmp.delete() }
      false
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getDirectoriesSync(): WritableMap = Arguments.createMap().apply {
    putString("documents", docsRoot.absolutePath)
    putString("temp", tempRoot.absolutePath)
    putString("appGroup", appGroupRoot.absolutePath)
    putString("icloud", docsRoot.absolutePath)
    putString("cache", reactContext.cacheDir.absolutePath)
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun randomBytesBase64Sync(byteLen: Int): String {
    val safeLen = byteLen.coerceIn(1, 4096)
    val bytes = ByteArray(safeLen)
    secureRandom.nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsExistsSync(path: String): Boolean = runCatching { File(path).exists() }.getOrDefault(false)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsIsDirectorySync(path: String): Boolean = runCatching { File(path).isDirectory }.getOrDefault(false)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsIsFileSync(path: String): Boolean = runCatching { File(path).isFile }.getOrDefault(false)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsMkdirSync(path: String, recursive: Boolean): Boolean = runCatching {
    val target = File(path)
    if (target.exists()) return@runCatching target.isDirectory
    if (recursive) target.mkdirs() else target.mkdir()
  }.getOrDefault(false)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsReadStringSync(path: String): String? = runCatching {
    val f = File(path)
    if (!f.exists() || !f.isFile) return@runCatching null
    f.readText(Charsets.UTF_8)
  }.getOrNull()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsWriteStringSync(path: String, content: String): Boolean {
    return writeAtomic(File(path)) { tmp ->
      tmp.writeText(content, Charsets.UTF_8)
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsReadBase64Sync(path: String): String? = runCatching {
    val f = File(path)
    if (!f.exists() || !f.isFile) return@runCatching null
    Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
  }.getOrNull()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsWriteBase64Sync(path: String, base64: String): Boolean {
    return try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      writeAtomic(File(path)) { tmp ->
        tmp.writeBytes(bytes)
      }
    } catch (_: Exception) {
      false
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsWriteFromFileSync(srcPath: String, destPath: String, move: Boolean): Boolean {
    return try {
      val src = File(srcPath)
      if (!src.exists() || !src.isFile) return false
      val dest = File(destPath)
      if (isSamePath(src, dest)) return true
      dest.parentFile?.mkdirs()
      if (move && src.renameTo(dest)) return true
      val ok = writeAtomic(dest) { tmp ->
        src.inputStream().use { input ->
          tmp.outputStream().use { output ->
            input.copyTo(output, 64 * 1024)
          }
        }
      }
      if (ok && move) runCatching { src.delete() }
      ok
    } catch (_: Exception) {
      false
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsReaddirSync(path: String, recursive: Boolean): WritableArray {
    val arr = Arguments.createArray()
    runCatching {
      val root = File(path)
      if (!root.exists() || !root.isDirectory) return@runCatching
      if (!recursive) {
        val children = root.list() ?: return@runCatching
        for (name in children) arr.pushString(name)
        return@runCatching
      }
      val rootPath = root.canonicalPath
      fun walk(dir: File) {
        val items = dir.listFiles() ?: return
        for (child in items) {
          val rel = child.canonicalPath.removePrefix(rootPath).trimStart('/')
          if (rel.isNotEmpty()) arr.pushString(rel)
          if (child.isDirectory) walk(child)
        }
      }
      walk(root)
    }
    return arr
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsStatSync(path: String): WritableMap? = runCatching {
    val f = File(path)
    if (!f.exists()) return@runCatching null
    Arguments.createMap().apply {
      putDouble("size", f.length().toDouble())
      putDouble("mtimeMs", f.lastModified().toDouble())
      putDouble("modificationDate", f.lastModified().toDouble())
      putBoolean("isDirectory", f.isDirectory)
      putBoolean("isFile", f.isFile)
    }
  }.getOrNull()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsRemoveSync(path: String): Boolean = runCatching {
    val f = File(path)
    if (!f.exists()) return@runCatching true
    f.deleteRecursively()
  }.getOrDefault(false)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsRenameSync(fromPath: String, toPath: String): Boolean {
    return try {
      val src = File(fromPath)
      if (!src.exists()) return false
      val dest = File(toPath)
      if (isSamePath(src, dest)) return true
      dest.parentFile?.mkdirs()
      if (dest.exists()) dest.deleteRecursively()
      if (src.renameTo(dest)) return true
      if (src.isDirectory) {
        val copied = src.copyRecursively(dest, overwrite = true)
        if (copied) src.deleteRecursively()
        return copied
      }
      val ok = writeAtomic(dest) { tmp ->
        src.inputStream().use { input ->
          tmp.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
        }
      }
      if (ok) runCatching { src.delete() }
      ok
    } catch (_: Exception) {
      false
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsCopySync(fromPath: String, toPath: String): Boolean {
    return try {
      val src = File(fromPath)
      if (!src.exists()) return false
      val dest = File(toPath)
      if (isSamePath(src, dest)) return true
      dest.parentFile?.mkdirs()
      if (src.isDirectory) {
        return src.copyRecursively(dest, overwrite = true)
      }
      writeAtomic(dest) { tmp ->
        src.inputStream().use { input ->
          tmp.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
        }
      }
    } catch (_: Exception) {
      false
    }
  }

  // Keychain synchronous bridge
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun keychainGetSync(key: String, sync: Boolean): String? =
    runCatching { credentials.get(key, sync) }.getOrNull()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun keychainSetSync(key: String, value: String, sync: Boolean): Boolean {
    return try {
      credentials.put(key, value, sync)
      true
    } catch (_: Exception) {
      false
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun keychainRemoveSync(key: String, sync: Boolean): Boolean {
    return try {
      credentials.remove(key, sync)
      true
    } catch (_: Exception) {
      false
    }
  }

  // Storage synchronous bridge
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun storageContainsSync(key: String): Boolean =
    runCatching { storagePrefs.contains(key) }.getOrDefault(false)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun storageGetSync(key: String): String? =
    runCatching { if (storagePrefs.contains(key)) storagePrefs.getString(key, null) else null }.getOrNull()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun storageSetSync(key: String, value: String): Boolean =
    runCatching { storagePrefs.edit().putString(key, value).commit() }.getOrDefault(false)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun storageRemoveSync(key: String): Boolean =
    runCatching { storagePrefs.edit().remove(key).commit() }.getOrDefault(false)

  // ZIP / Archive support (EPUB-compliant STORED mimetype first)
  @ReactMethod
  fun zipDirectory(sourceDirPath: String, destZipPath: String, promise: Promise) {
    ioPool.execute {
      var tempZip: File? = null
      try {
        val srcDir = File(sourceDirPath)
        require(srcDir.exists() && srcDir.isDirectory) { "Source directory does not exist" }
        val destZip = File(destZipPath)
        destZip.parentFile?.mkdirs()
        tempZip = File(destZip.parentFile, ".tmp-${destZip.name}-${System.nanoTime()}")

        ZipOutputStream(BufferedOutputStream(FileOutputStream(tempZip))).use { zos ->
          val mimetypeFile = File(srcDir, "mimetype")
          if (mimetypeFile.exists() && mimetypeFile.isFile) {
            val bytes = mimetypeFile.readBytes()
            val crc = CRC32().apply { update(bytes) }.value
            val entry = ZipEntry("mimetype").apply {
              method = ZipEntry.STORED
              size = bytes.size.toLong()
              compressedSize = bytes.size.toLong()
              this.crc = crc
            }
            zos.putNextEntry(entry)
            zos.write(bytes)
            zos.closeEntry()
          }

          val rootCanonical = srcDir.canonicalPath
          fun writeDir(dir: File) {
            val files = dir.listFiles()?.sortedBy { it.name } ?: return
            for (f in files) {
              val rel = f.canonicalPath.removePrefix(rootCanonical).trimStart('/').replace('\\', '/')
              if (rel.isEmpty() || rel == "mimetype") continue
              if (f.isDirectory) {
                writeDir(f)
              } else {
                val entry = ZipEntry(rel).apply { method = ZipEntry.DEFLATED }
                zos.putNextEntry(entry)
                BufferedInputStream(FileInputStream(f)).use { input ->
                  input.copyTo(zos, 32 * 1024)
                }
                zos.closeEntry()
              }
            }
          }
          writeDir(srcDir)
        }

        if (destZip.exists()) destZip.delete()
        if (!tempZip.renameTo(destZip)) {
          tempZip.copyTo(destZip, overwrite = true)
          tempZip.delete()
        }
        tempZip = null
        promise.resolve(true)
      } catch (e: Exception) {
        runCatching { tempZip?.delete() }
        promise.reject("E_ZIP", e.message ?: "ZIP creation failed", e)
      }
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun listZipEntriesSync(zipPath: String): WritableArray {
    val arr = Arguments.createArray()
    runCatching {
      ZipFile(zipPath).use { zf ->
        val entries = zf.entries()
        while (entries.hasMoreElements()) {
          val e = entries.nextElement()
          if (!e.isDirectory) arr.pushString(e.name)
        }
      }
    }
    return arr
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun extractZipEntrySync(zipPath: String, entryName: String, destPath: String): Boolean {
    return try {
      val destFile = File(destPath)
      destFile.parentFile?.mkdirs()
      ZipFile(zipPath).use { zf ->
        val entry = zf.getEntry(entryName) ?: return false
        writeAtomic(destFile) { tmp ->
          zf.getInputStream(entry).use { input ->
            tmp.outputStream().use { output -> input.copyTo(output, 32 * 1024) }
          }
        }
      }
    } catch (_: Exception) {
      false
    }
  }

  @ReactMethod
  fun unzipArchive(zipPath: String, destDirPath: String, flattenBasename: Boolean, promise: Promise) {
    ioPool.execute {
      try {
        val destDir = File(destDirPath).apply { mkdirs() }
        val canonicalRoot = destDir.canonicalPath + File.separator
        ZipInputStream(BufferedInputStream(FileInputStream(zipPath))).use { zis ->
          while (true) {
            val entry = zis.nextEntry ?: break
            if (entry.isDirectory) {
              zis.closeEntry()
              continue
            }
            val rawName = entry.name.replace('\\', '/').trimStart('/')
            if (rawName.isEmpty() || rawName.startsWith("__MACOSX/")) {
              zis.closeEntry()
              continue
            }
            val targetName = if (flattenBasename) File(rawName).name else rawName
            if (targetName.isEmpty() || targetName.startsWith(".")) {
              zis.closeEntry()
              continue
            }
            val outFile = File(destDir, targetName)
            val canonicalOut = outFile.canonicalPath
            if (!canonicalOut.startsWith(canonicalRoot)) {
              zis.closeEntry()
              throw SecurityException("Blocked zip slip entry: $rawName")
            }
            outFile.parentFile?.mkdirs()
            BufferedOutputStream(FileOutputStream(outFile)).use { bos ->
              zis.copyTo(bos, 32 * 1024)
            }
            zis.closeEntry()
          }
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("E_UNZIP", e.message ?: "Unzip failed", e)
      }
    }
  }
}
