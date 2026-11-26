# Change of Heart — Android app

Runs the unmodified desktop backend (`server.py`, `core/`) inside the app with
[Chaquopy](https://chaquo.com/chaquopy/) 17.2 and shows the editor UI in a WebView.
The backend is zipped from the repo root at build time, so there is one source of truth.

## Build
1. Install Android Studio (needs JDK 17+, bundled) and the Android SDK Platform 36 (Studio offers it on sync).
2. **File > Open** the `android/` folder (inside this repo, next to `server.py`). Let Gradle sync.
3. Run on a device/emulator (Android 10+, arm64 or x86_64), or **Build > Build APK(s)**.

CLI: run `gradle wrapper` once inside `android/`, then `./gradlew assembleDebug`
(APK: `app/build/outputs/apk/debug/`).

If Gradle complains that it needs a Python interpreter, install Python 3.12 and add
`buildPython("python3.12")` (Windows: `buildPython("py", "-3.12")`) in the `chaquopy { defaultConfig { } }` block.

## Use
1. Copy your save (`DATA*.DAT`) from the PC/Steam Deck onto the phone.
2. Tap **OPEN SAVE FILE**, pick it, edit, then tap **SAVE CHANGES & RE-SIGN**.
3. The re-signed save and a backup ZIP land in `Downloads/ChangeOfHeart/`. Copy the save back to the game.

Edits live in memory until you save; if Android kills the app in the background they are lost.

## Notes
- The backend only listens on `127.0.0.1` and rejects requests lacking a per-launch secret cookie.
- Not verified on a real build: this project was written without an Android SDK. Backend, AES shim and mobile UI were tested on a desktop; Gradle/Kotlin were not compiled.
