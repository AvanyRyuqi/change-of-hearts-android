package com.changeofheart.p5r

import android.content.ContentValues
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast

/** Exposed to the page as `AndroidBridge` (see web-app/static/android.js). */
class NativeBridge(private val context: Context) {

    /** Writes a file the editor "downloaded" into Downloads/ChangeOfHeart and returns a status line. */
    @JavascriptInterface
    fun saveFile(name: String, mime: String, base64: String): String {
        return try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val safe = name.substringAfterLast('/').substringAfterLast('\\')
                .replace(Regex("[^A-Za-z0-9._() -]"), "_")
                .ifBlank { "download.bin" }
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safe)
                put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                put(MediaStore.Downloads.RELATIVE_PATH, "Download/ChangeOfHeart")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return "Could not create $safe in Downloads."
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: return "Could not write $safe."
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            val msg = "Saved to Downloads/ChangeOfHeart/$safe"
            Handler(Looper.getMainLooper()).post { Toast.makeText(context, msg, Toast.LENGTH_LONG).show() }
            msg
        } catch (e: Exception) {
            "Could not save $name: ${e.message}"
        }
    }
}
