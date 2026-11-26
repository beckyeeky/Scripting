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
import java.util.concurrent.Executors
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

class PixFileSystemModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val ioPool = Executors.newFixedThreadPool(4)
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

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getDirectoriesSync(): WritableMap = Arguments.createMap().apply {
    putString("documents", docsRoot.absolutePath)
    putString("temp", tempRoot.absolutePath)
    putString("appGroup", appGroupRoot.absolutePath)
    putString("icloud", docsRoot.absolutePath)
    putString("cache", reactContext.cacheDir.absolutePath)
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsExistsSync(path: String): Boolean = File(path).exists()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsIsDirectorySync(path: String): Boolean = File(path).isDirectory

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsIsFileSync(path: String): Boolean = File(path).isFile

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsMkdirSync(path: String, recursive: Boolean): Boolean {
    val target = File(path)
    if (target.exists()) return target.isDirectory
    return if (recursive) target.mkdirs() else target.mkdir()
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsReadStringSync(path: String): String? {
    val f = File(path)
    if (!f.exists() || !f.isFile) return null
    return f.readText(Charsets.UTF_8)
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsWriteStringSync(path: String, content: String): Boolean {
    val target = File(path)
    target.parentFile?.mkdirs()
    target.writeText(content, Charsets.UTF_8)
    return true
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsReadBase64Sync(path: String): String? {
    val f = File(path)
    if (!f.exists() || !f.isFile) return null
    return Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsWriteBase64Sync(path: String, base64: String): Boolean {
    val target = File(path)
    target.parentFile?.mkdirs()
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    target.writeBytes(bytes)
    return true
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsWriteFromFileSync(srcPath: String, destPath: String, move: Boolean): Boolean {
    val src = File(srcPath)
    if (!src.exists() || !src.isFile) return false
    val dest = File(destPath)
    dest.parentFile?.mkdirs()
    if (move && src.renameTo(dest)) return true
    src.inputStream().use { input ->
      dest.outputStream().use { output ->
        input.copyTo(output, 64 * 1024)
      }
    }
    if (move) src.delete()
    return true
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsReaddirSync(path: String, recursive: Boolean): WritableArray {
    val arr = Arguments.createArray()
    val root = File(path)
    if (!root.exists() || !root.isDirectory) return arr
    if (!recursive) {
      val children = root.list() ?: return arr
      for (name in children) arr.pushString(name)
      return arr
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
    return arr
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsStatSync(path: String): WritableMap? {
    val f = File(path)
    if (!f.exists()) return null
    return Arguments.createMap().apply {
      putDouble("size", f.length().toDouble())
      putDouble("mtimeMs", f.lastModified().toDouble())
      putDouble("modificationDate", f.lastModified().toDouble())
      putBoolean("isDirectory", f.isDirectory)
      putBoolean("isFile", f.isFile)
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsRemoveSync(path: String): Boolean {
    val f = File(path)
    if (!f.exists()) return true
    return f.deleteRecursively()
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsRenameSync(fromPath: String, toPath: String): Boolean {
    val src = File(fromPath)
    if (!src.exists()) return false
    val dest = File(toPath)
    dest.parentFile?.mkdirs()
    if (dest.exists()) dest.deleteRecursively()
    if (src.renameTo(dest)) return true
    if (src.isDirectory) {
      src.copyRecursively(dest, overwrite = true)
      src.deleteRecursively()
      return true
    }
    src.inputStream().use { input ->
      dest.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
    }
    src.delete()
    return true
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun fsCopySync(fromPath: String, toPath: String): Boolean {
    val src = File(fromPath)
    if (!src.exists()) return false
    val dest = File(toPath)
    dest.parentFile?.mkdirs()
    if (src.isDirectory) {
      return src.copyRecursively(dest, overwrite = true)
    }
    src.inputStream().use { input ->
      dest.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
    }
    return true
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
  fun storageContainsSync(key: String): Boolean = storagePrefs.contains(key)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun storageGetSync(key: String): String? =
    if (storagePrefs.contains(key)) storagePrefs.getString(key, null) else null

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun storageSetSync(key: String, value: String): Boolean =
    storagePrefs.edit().putString(key, value).commit()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun storageRemoveSync(key: String): Boolean =
    storagePrefs.edit().remove(key).commit()

  // ZIP / Archive support (EPUB-compliant STORED mimetype first)
  @ReactMethod
  fun zipDirectory(sourceDirPath: String, destZipPath: String, promise: Promise) {
    ioPool.execute {
      try {
        val srcDir = File(sourceDirPath)
        require(srcDir.exists() && srcDir.isDirectory) { "Source directory does not exist" }
        val destZip = File(destZipPath)
        destZip.parentFile?.mkdirs()
        val tempZip = File(destZip.parentFile, ".tmp-${destZip.name}-${System.nanoTime()}")

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
        promise.resolve(true)
      } catch (e: Exception) {
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
        zf.getInputStream(entry).use { input ->
          destFile.outputStream().use { output -> input.copyTo(output, 32 * 1024) }
        }
      }
      true
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
