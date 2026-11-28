package com.changeofheart.p5r

import android.content.ClipData
import android.content.ClipboardManager
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
import java.io.BufferedOutputStream
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Exposed to the page as `AndroidBridge` (see web-app/static/android.js, features.js and save-folder code). */
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

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun stamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

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

    /** Candidate save files under [dir] (up to 3 levels deep), shared by listSaves and backupAllSlots. */
    private fun collectSaves(dir: File): List<File> =
        dir.walkTopDown().maxDepth(3)
            .filter { it.isFile && it.length() >= 1024 && it.extension.lowercase() !in IGNORED_EXT }
            .sortedBy { it.relativeTo(dir).path.lowercase() }
            .take(300)
            .toList()

    /** Lists candidate save files (up to 3 levels deep) as JSON: {ok, root, files:[{path, rel, name, size, modified}]} */
    @JavascriptInterface
    fun listSaves(rootPath: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val root = rootPath.ifBlank { DEFAULT_ROOT }
            val dir = resolveDir(root) ?: return fail("Folder not found: $root")
            if (!isAllowed(dir)) return fail("That folder is outside shared storage.")
            val arr = JSONArray()
            for (f in collectSaves(dir)) {
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

    /** Returns {ok, data(base64), size, modified, sha}. The sha/modified pair is how Guardian spots outside changes. */
    @JavascriptInterface
    fun readSave(path: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val f = File(path)
            if (!f.isFile || !isAllowed(f)) return fail("File not found or not allowed: $path")
            if (f.length() > MAX_BYTES) return fail("File is too large.")
            val bytes = f.readBytes()
            json {
                put("ok", true)
                put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                put("size", bytes.size)
                put("modified", f.lastModified())
                put("sha", sha256(bytes))
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /** Guardian: cheap fingerprint of a save file without sending its bytes to the page: {ok, size, modified, sha}. */
    @JavascriptInterface
    fun fileInfo(path: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val f = File(path)
            if (!f.isFile || !isAllowed(f)) return fail("File not found or not allowed: $path")
            if (f.length() > MAX_BYTES) return fail("File is too large.")
            val bytes = f.readBytes()
            json {
                put("ok", true)
                put("size", bytes.size)
                put("modified", f.lastModified())
                put("sha", sha256(bytes))
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /**
     * Overwrites an EXISTING save file in place. Before touching it, the original is copied to
     * Download/ChangeOfHeart/backup/. If the backup cannot be made, nothing is written.
     *
     * Guardian: after writing, the file is read back and compared byte for byte with what was meant to
     * be written. If the write failed or the file on disk differs, the original is restored from the backup.
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

            val bdir = backupDir()
            if (!bdir.isDirectory && !bdir.mkdirs()) {
                return fail("Could not create the backup folder. Nothing was written.")
            }
            val backup = newBackupFile(bdir, backupTag(target))
            target.copyTo(backup, overwrite = false)
            if (backup.length() != target.length()) {
                backup.delete()
                return fail("Backup check failed (size mismatch). Nothing was written.")
            }

            val writeError: String? = try {
                target.outputStream().use { out ->
                    out.write(bytes)
                    out.flush()
                    out.fd.sync()
                }
                null
            } catch (e: Exception) {
                e.message ?: e.toString()
            }

            val onDisk: ByteArray? = try {
                target.readBytes()
            } catch (e: Exception) {
                null
            }

            if (writeError != null || onDisk == null || !onDisk.contentEquals(bytes)) {
                val restored = try {
                    backup.copyTo(target, overwrite = true)
                    target.length() == backup.length()
                } catch (e: Exception) {
                    false
                }
                val why = writeError ?: "the file on disk differs from what was written"
                return fail(
                    "Write check failed ($why). " +
                        if (restored) "The original file was restored from backup."
                        else "COULD NOT RESTORE - the original is at ${backup.absolutePath}"
                )
            }

            toast("Saved ${target.parentFile?.name}/${target.name} (backup in Download/ChangeOfHeart/backup)")
            json {
                put("ok", true)
                put("backup", backup.name)
                put("bytes", bytes.size)
                put("sha", sha256(bytes))
                put("modified", target.lastModified())
                put("verified", true)
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    // ------------------------------------------------------------------
    // Small key/value store (survives restarts; the WebView origin changes every launch)
    // ------------------------------------------------------------------

    @JavascriptInterface
    fun getPref(key: String): String = prefs.getString("pref_" + key, null) ?: ""

    @JavascriptInterface
    fun setPref(key: String, value: String): String {
        prefs.edit().putString("pref_" + key, value).apply()
        return "ok"
    }

    // ------------------------------------------------------------------
    // Backups made by writeSave + named snapshots (Download/ChangeOfHeart/backup)
    // A snapshot is a normal .bak file plus an optional "<name>.bak.note" text file holding its label.
    // ------------------------------------------------------------------

    private fun backupDir(): File = File(externalRoot(), "Download/ChangeOfHeart/backup")

    private fun backupTag(target: File): String =
        ((target.parentFile?.name ?: "save") + "_" + target.name).replace(Regex("[^A-Za-z0-9._-]"), "_")

    /** A backup file name that does not exist yet (two writes within one second used to collide and fail). */
    private fun newBackupFile(dir: File, tag: String): File {
        val base = tag + "_" + stamp()
        var f = File(dir, "$base.bak")
        var n = 1
        while (f.exists()) {
            f = File(dir, "${base}_$n.bak")
            n++
        }
        return f
    }

    private fun validBackupName(name: String): Boolean =
        !(name.contains("/") || name.contains("\\") || name.contains("..") || !name.endsWith(".bak"))

    private fun noteFile(backup: File): File = File(backup.parentFile, backup.name + ".note")

    private fun readNote(backup: File): String = try {
        val n = noteFile(backup)
        if (n.isFile) n.readText(Charsets.UTF_8).trim() else ""
    } catch (e: Exception) {
        ""
    }

    private fun writeNote(backup: File, label: String) {
        val clean = label.replace(Regex("[\\r\\n]+"), " ").trim().take(80)
        val n = noteFile(backup)
        if (clean.isEmpty()) n.delete() else n.writeText(clean, Charsets.UTF_8)
    }

    /** Backups of one save file, newest first: {ok, backups:[{name, size, modified, label}]} */
    @JavascriptInterface
    fun listBackups(path: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val target = File(path)
            if (!isAllowed(target)) return fail("Not allowed: $path")
            val prefix = backupTag(target) + "_"
            val files = (backupDir().listFiles() ?: emptyArray<File>())
                .filter { it.isFile && it.name.startsWith(prefix) && it.name.endsWith(".bak") }
                .sortedByDescending { it.lastModified() }
                .take(200)
            val arr = JSONArray()
            for (f in files) {
                val o = JSONObject()
                o.put("name", f.name)
                o.put("size", f.length())
                o.put("modified", f.lastModified())
                o.put("label", readNote(f))
                arr.put(o)
            }
            json {
                put("ok", true)
                put("backups", arr)
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /** Returns {ok, data(base64)} for one backup file name from the backup folder. */
    @JavascriptInterface
    fun readBackup(name: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            if (!validBackupName(name)) return fail("Invalid backup name.")
            val f = File(backupDir(), name)
            if (!f.isFile || f.length() > MAX_BYTES) return fail("Backup not found.")
            val b64 = Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
            json {
                put("ok", true)
                put("data", b64)
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /** Time Machine: copies the save file as it is on disk right now into a named snapshot. */
    @JavascriptInterface
    fun createSnapshot(path: String, label: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val target = File(path)
            if (!target.isFile || !isAllowed(target)) return fail("File not found or not allowed: $path")
            val bdir = backupDir()
            if (!bdir.isDirectory && !bdir.mkdirs()) return fail("Could not create the backup folder.")
            val snap = newBackupFile(bdir, backupTag(target))
            target.copyTo(snap, overwrite = false)
            if (snap.length() != target.length()) {
                snap.delete()
                return fail("Snapshot check failed (size mismatch).")
            }
            writeNote(snap, label.ifBlank { "Snapshot" })
            json {
                put("ok", true)
                put("name", snap.name)
                put("modified", snap.lastModified())
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /** Sets (or clears, when blank) the label of a backup/snapshot. */
    @JavascriptInterface
    fun setBackupLabel(name: String, label: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            if (!validBackupName(name)) return fail("Invalid backup name.")
            val f = File(backupDir(), name)
            if (!f.isFile) return fail("Backup not found.")
            writeNote(f, label)
            json { put("ok", true) }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    /** Deletes one backup/snapshot (and its label). Only ever called after the user confirms. */
    @JavascriptInterface
    fun deleteBackup(name: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            if (!validBackupName(name)) return fail("Invalid backup name.")
            val f = File(backupDir(), name)
            if (!f.isFile) return fail("Backup not found.")
            noteFile(f).delete()
            if (!f.delete()) return fail("Could not delete the backup.")
            json { put("ok", true) }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    // ------------------------------------------------------------------
    // Backup of every slot into one dated ZIP in Downloads/ChangeOfHeart
    // ------------------------------------------------------------------

    @JavascriptInterface
    fun backupAllSlots(rootPath: String): String {
        if (!hasStorageAccess()) return fail("no_access")
        return try {
            val root = rootPath.ifBlank { DEFAULT_ROOT }
            val dir = resolveDir(root) ?: return fail("Folder not found: $root")
            if (!isAllowed(dir)) return fail("That folder is outside shared storage.")
            val files = collectSaves(dir)
            if (files.isEmpty()) return fail("No save files found to back up.")

            val zipName = "ChangeOfHeart_AllSlots_" + stamp() + ".zip"
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, zipName)
                put(MediaStore.Downloads.MIME_TYPE, "application/zip")
                put(MediaStore.Downloads.RELATIVE_PATH, "Download/ChangeOfHeart")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return fail("Could not create $zipName in Downloads.")

            var written = 0
            try {
                val out = resolver.openOutputStream(uri) ?: throw IllegalStateException("Could not open $zipName.")
                ZipOutputStream(BufferedOutputStream(out)).use { zip ->
                    val manifest = StringBuilder("Change of Heart - all slots backup\n")
                    manifest.append("Created: ").append(Date()).append("\nSource: ").append(dir.absolutePath).append("\n\n")
                    for (f in files) {
                        val rel = f.relativeTo(dir).path.replace('\\', '/')
                        zip.putNextEntry(ZipEntry(rel))
                        f.inputStream().use { it.copyTo(zip) }
                        zip.closeEntry()
                        manifest.append(rel).append("  ").append(f.length()).append(" bytes\n")
                        written++
                    }
                    zip.putNextEntry(ZipEntry("_manifest.txt"))
                    zip.write(manifest.toString().toByteArray(Charsets.UTF_8))
                    zip.closeEntry()
                }
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                return fail("Could not write the ZIP: " + (e.message ?: e.toString()))
            }

            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            toast("Backed up $written slot(s) to Downloads/ChangeOfHeart/$zipName")
            json {
                put("ok", true)
                put("name", zipName)
                put("files", written)
            }
        } catch (e: Exception) {
            fail(e.message ?: e.toString())
        }
    }

    // ------------------------------------------------------------------
    // Share sheet / clipboard (preset sharing)
    // ------------------------------------------------------------------

    /** Opens the Android share sheet with plain text. Returns "ok" or an error line. */
    @JavascriptInterface
    fun shareText(subject: String, text: String): String {
        return try {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, subject)
                putExtra(Intent.EXTRA_TEXT, text)
            }
            val chooser = Intent.createChooser(send, subject).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(chooser)
            "ok"
        } catch (e: Exception) {
            "Could not open the share sheet: " + (e.message ?: e.toString())
        }
    }

    @JavascriptInterface
    fun copyText(text: String): String {
        return try {
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("Change of Heart", text))
            "ok"
        } catch (e: Exception) {
            "Could not copy: " + (e.message ?: e.toString())
        }
    }

    @JavascriptInterface
    fun getClipboardText(): String {
        return try {
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = cm.primaryClip
            if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(context).toString() else ""
        } catch (e: Exception) {
            ""
        }
    }

    private companion object {
        const val DEFAULT_ROOT = "/storage/emulated/0/Persona 5 Royal/user/save"
        const val MAX_BYTES = 32L * 1024 * 1024
        val IGNORED_EXT = setOf("png", "jpg", "jpeg", "webp", "gif", "dds", "txt", "json", "log", "ini", "bak", "tmp", "xml", "zip", "note")
    }
}
