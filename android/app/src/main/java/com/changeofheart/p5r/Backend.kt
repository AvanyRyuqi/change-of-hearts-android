package com.changeofheart.p5r

import android.content.Context
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import java.io.File
import java.util.UUID
import java.util.zip.ZipInputStream

/** Starts the bundled Python backend once per process and exposes its loopback port. */
object Backend {
    /** Random per-launch secret; the WebView sends it as a cookie, the backend rejects requests without it. */
    val token: String = UUID.randomUUID().toString().replace("-", "")

    @Volatile
    var port: Int = 0
        private set

    @Synchronized
    fun ensureStarted(context: Context): Int {
        if (port != 0) return port
        val app = context.applicationContext
        if (!Python.isStarted()) Python.start(AndroidPlatform(app))
        val root = unpack(app)
        val tmp = File(app.cacheDir, "coh").absolutePath
        port = Python.getInstance().getModule("android_entry")
            .callAttr("start", root.absolutePath, tmp, token).toInt()
        return port
    }

    /** Extracts assets/p5r_backend.zip to real files (server.py resolves data/ and web-app/ next to itself). */
    private fun unpack(app: Context): File {
        val stamp = app.packageManager.getPackageInfo(app.packageName, 0).lastUpdateTime
        val base = File(app.filesDir, "p5r")
        val dir = File(base, "v$stamp")
        val marker = File(dir, ".ready")
        if (marker.exists()) return dir
        base.deleteRecursively()
        dir.mkdirs()
        val rootPath = dir.canonicalPath + File.separator
        ZipInputStream(app.assets.open("p5r_backend.zip").buffered()).use { zin ->
            while (true) {
                val entry = zin.nextEntry ?: break
                val out = File(dir, entry.name)
                if (!out.canonicalPath.startsWith(rootPath)) continue // zip-slip guard
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zin.copyTo(it) }
                }
            }
        }
        marker.writeText("ok")
        return dir
    }
}
