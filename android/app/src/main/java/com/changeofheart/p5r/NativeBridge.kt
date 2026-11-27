package com.changeofheart.p5r

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Exposed to the page as `AndroidBridge` (see web-app/static/android.js and save-folder code). */
class NativeBridge(private val context: Context) {

    private fun toast(msg: String) {
        Handler(Looper.getMainLooper()).post { Toast.makeText(context, msg, Toast.LENGTH_LONG).show() }
    }

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
            toast(msg)
            msg
        } catch (e: Exception) {
            "Could not save $name: ${e.message}"
        }
    }

    // ------------------------------------------------------------------
    // Direct access to the game's save folder
    // (default: /storage/emulated/0/Persona 5 Royal/user/save)
    // Needs "All files access" (Android 11+), granted once in system Settings.
    // ------------------------------------------------------------------

    private val prefs by lazy { context.getSharedPreferences("coh", Context.MODE_PRIVATE) }

    @Suppress("DEPRECATION")
    private fun externalRoot(): File = Environment.getExternalStorageDirectory()

    private fun json(block: JSONObject.() -> Unit): String = JSONObject().apply(block).toString()

    private fun fail(msg: String): String = json {
        put("ok", false)
        put("error", msg)
    }

    @JavascriptInterface
    fun hasStorageAccess(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()

    /** Opens the system "All files access" screen for this app. Returns "ok" or an error line. */
    @JavascriptInterface
    fun requestStorageAccess(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return "Direct save access needs Android 11 or newer. Use OPEN SAVE FILE instead."
        }
        return try {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + context.packageName))
            )
            "ok"
        } catch (e: Exception) {
            try {
                context.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                "ok"
            } catch (e2: Exception) {
                "Could not open the settings screen: " + e2.message
            }
        }
    }

    @JavascriptInterface
    fun getSaveRoot(): String = prefs.getString("save_root", null) ?: DEFAULT_ROOT

    @JavascriptInterface
    fun setSaveRoot(path: String): String {
        prefs.edit().putString("save_root", path.trim().ifBlank { DEFAULT_ROOT }).apply()
        return getSaveRoot()
    }

    /** Resolves a path segment by segment, ignoring letter case ("Persona 5 royal" == "Persona 5 Royal"). */
    private fun resolveDir(path: String): File? {
        var cur = File("/")
        for (part in path.trim().trim('/').split('/').filter { it.isNotEmpty() }) {
            val direct = File(cur, part)
            if (direct.exists()) {
                cur = direct
            } else {
                cur = cur.listFiles()?.firstOrNull { it.name.equals(part, ignoreCase = true) } ?: return null
            }
        }
        return if (cur.isDirectory) cur else null
    }

    /** Only shared storage, and never other apps' Android/ folders. */
    private fun isAllowed(f: File): Boolean {
        return try {
            val c = f.canonicalPath
            val base = externalRoot().canonicalPath
            (c == base || c.startsWith("$base/")) && !c.startsWith("$base/Android/")
        } catch (e: Exception) {
            false
        }
    }

    /** Lists candidate save files (up to 3 levels deep) as JSON: {ok, root, files:[{path, rel, name, size, modified}]} */
    @JavascriptInterface
    fun listSaves(rootPath: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val root = rootPath.ifBlank { DEFAULT_ROOT }
            val dir = resolveDir(root) ?: return fail("Folder not found: $root")
            if (!isAllowed(dir)) return fail("That folder is outside shared storage.")
            val files = dir.walkTopDown().maxDepth(3)
                .filter { it.isFile && it.length() >= 1024 && it.extension.lowercase() !in IGNORED_EXT }
                .sortedBy { it.relativeTo(dir).path.lowercase() }
                .take(300)
                .toList()
            val arr = JSONArray()
            for (f in files) {
                val o = JSONObject()
                o.put("path", f.absolutePath)
                o.put("rel", f.relativeTo(dir).path)
                o.put("name", f.name)
                o.put("size", f.length())
                o.put("modified", f.lastModified())
                arr.put(o)
            }
            json {
                put("ok", true)
                put("root", dir.absolutePath)
                put("files", arr)
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /** Returns {ok, data(base64), size}. */
    @JavascriptInterface
    fun readSave(path: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val f = File(path)
            if (!f.isFile || !isAllowed(f)) return fail("File not found or not allowed: $path")
            if (f.length() > MAX_BYTES) return fail("File is too large.")
            val b64 = Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
            json {
                put("ok", true)
                put("data", b64)
                put("size", f.length())
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /**
     * Overwrites an EXISTING save file in place. Before touching it, the original is copied to
     * Download/ChangeOfHeart/backup/. If the backup cannot be made, nothing is written.
     */
    @JavascriptInterface
    fun writeSave(path: String, base64: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val target = File(path)
            if (!target.isFile || !isAllowed(target)) return fail("File not found or not allowed: $path")

            val bytes = Base64.decode(base64, Base64.DEFAULT)
            if (bytes.size < 1024 || bytes.size > MAX_BYTES) {
                return fail("Refusing to write: unexpected size (${bytes.size} bytes).")
            }

            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val backupDir = File(externalRoot(), "Download/ChangeOfHeart/backup")
            if (!backupDir.isDirectory && !backupDir.mkdirs()) {
                return fail("Could not create the backup folder. Nothing was written.")
            }
            val tag = ((target.parentFile?.name ?: "save") + "_" + target.name)
                .replace(Regex("[^A-Za-z0-9._-]"), "_")
            val backup = File(backupDir, tag + "_" + stamp + ".bak")
            target.copyTo(backup, overwrite = false)

            target.outputStream().use { out ->
                out.write(bytes)
                out.flush()
                out.fd.sync()
            }
            if (target.length() != bytes.size.toLong()) {
                return fail("Write check failed (size mismatch). Original backup: ${backup.absolutePath}")
            }

            toast("Saved ${target.parentFile?.name}/${target.name} (backup in Download/ChangeOfHeart/backup)")
            json {
                put("ok", true)
                put("backup", backup.name)
                put("bytes", bytes.size)
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    private companion object {
        const val DEFAULT_ROOT = "/storage/emulated/0/Persona 5 Royal/user/save"
        const val MAX_BYTES = 32L * 1024 * 1024
        val IGNORED_EXT = setOf("png", "jpg", "jpeg", "webp", "gif", "dds", "txt", "json", "log", "ini", "bak", "tmp", "xml", "zip")
    }
}
