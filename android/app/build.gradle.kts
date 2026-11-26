import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.chaquo.python")
}

/** Zips the desktop backend (server.py, core/, data/, web-app/) straight from the repo root,
 *  so the Android app always ships the same code as the desktop editor. */
abstract class BundleBackendTask : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @get:Internal
    abstract val repoRoot: DirectoryProperty

    @get:OutputDirectory
    abstract val outDir: DirectoryProperty

    @TaskAction
    fun bundle() {
        val root = repoRoot.get().asFile
        val out = outDir.get().asFile.also { it.mkdirs() }
        ZipOutputStream(File(out, "p5r_backend.zip").outputStream().buffered()).use { zos ->
            sources.files.filter { it.isFile }.sortedBy { it.invariantSeparatorsPath }.forEach { f ->
                zos.putNextEntry(ZipEntry(f.relativeTo(root).invariantSeparatorsPath))
                f.inputStream().use { it.copyTo(zos) }
                zos.closeEntry()
            }
        }
    }
}

android {
    namespace = "com.changeofheart.p5r"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.changeofheart.p5r"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.1.2-android"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    androidResources { noCompress += "zip" }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

chaquopy {
    defaultConfig {
        version = "3.12"
        // No pip packages and no pre-compiled bytecode: no Python is needed on the build machine.
        pyc { src = false }
    }
}

androidComponents {
    onVariants { variant ->
        val repo = rootProject.layout.projectDirectory.dir("..")
        val task = tasks.register<BundleBackendTask>("bundle${variant.name.replaceFirstChar { it.uppercase() }}Backend") {
            repoRoot.set(repo)
            sources.from(
                fileTree(repo) {
                    include("server.py", "core/**/*.py", "data/**", "web-app/static/**", "web-app/templates/**")
                    exclude("**/__pycache__/**")
                }
            )
            outDir.set(layout.buildDirectory.dir("generated/p5r/${variant.name}"))
        }
        variant.sources.assets?.addGeneratedSourceDirectory(task, BundleBackendTask::outDir)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
}
