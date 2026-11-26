package com.pixscripting

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class PixCredentialStore(context: Context) {
  private val localEncrypted = context.getSharedPreferences("pix_scripting_encrypted_local", Context.MODE_PRIVATE)
  private val syncEncrypted = context.getSharedPreferences("pix_scripting_encrypted_sync", Context.MODE_PRIVATE)

  private fun prefsFor(sync: Boolean) = if (sync) syncEncrypted else localEncrypted
  private fun aadFor(key: String, sync: Boolean) = "${if (sync) "sync" else "local"}:$key".toByteArray(Charsets.UTF_8)

  @Synchronized
  fun get(key: String, sync: Boolean): String? {
    val encoded = prefsFor(sync).getString(key, null) ?: return null
    return runCatching { decrypt(key, sync, encoded) }.getOrNull()
  }

  @Synchronized
  fun put(key: String, value: String, sync: Boolean) {
    val prefs = prefsFor(sync)
    val previous = prefs.getString(key, null)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    cipher.updateAAD(aadFor(key, sync))
    val encoded = Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    val saved = prefs.edit().putString(key, encoded).commit()
    try {
      check(saved && prefs.getString(key, null)?.let { decrypt(key, sync, it) } == value)
    } catch (error: Exception) {
      val rollback = prefs.edit()
      if (previous == null) rollback.remove(key) else rollback.putString(key, previous)
      rollback.commit()
      throw error
    }
  }

  @Synchronized
  fun remove(key: String, sync: Boolean) {
    prefsFor(sync).edit().remove(key).commit()
  }

  private fun decrypt(key: String, sync: Boolean, encoded: String): String {
    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
    require(bytes.size >= 28)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    cipher.updateAAD(aadFor(key, sync))
    return cipher.doFinal(bytes, 12, bytes.size - 12).toString(Charsets.UTF_8)
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
    (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).apply {
      init(
        KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build(),
      )
    }.generateKey()
  }

  private companion object {
    const val PROVIDER = "AndroidKeyStore"
    const val ALIAS = "pix-scripting-credentials-v1"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}
