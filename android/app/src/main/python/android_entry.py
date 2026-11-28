"""Chaquopy entry point: runs the existing Change of Heart backend inside the Android app.

Kotlin calls start(root, tmp_dir, token) once per process. The backend is the
unmodified desktop `server.py` (stdlib HTTP server + save parser/editor); the
Android app just points a WebView at it.

Security: every Android app can open 127.0.0.1 sockets, so each request must
carry the random per-launch cookie that MainActivity plants in its own WebView.
Requests without it (other apps, adb port scans, ...) get 403.

Android-only additions on top of the desktop handler (server.py stays untouched):
  * POST requests are serialized with a lock. server.py keeps the open save in
    module globals and ThreadingHTTPServer runs one thread per request, so two
    overlapping requests (e.g. a save while the UI reloads) could mix two saves.
  * POST /api/validate  - Guardian: re-parse bytes and report CRC/AES integrity,
    without touching the open save.
  * POST /api/inspect   - Time Machine: parse bytes into the same payload the
    editor loads, without touching the open save (used to compare snapshots).
  * GET /api/skill-info serves optional data/SkillInfo.json (skill descriptions) if present.
  * GET /api/trait-info serves data/TraitInfo.json ({"<trait id>": "description"}) if present.
  * POST /api/rawdiff   - compares the raw payload bytes of two saves (finds unmapped offsets,
    e.g. Baton Pass level / Technical rank: change it in-game, snapshot, diff).
  * GET / injects /features.js before /android.js (Guardian, Time Machine,
    Quick Boosts, ...), so the desktop index.html does not need to change.
  * Unknown POST paths now get a 404 instead of a silently dropped connection.
  * Upload file names lose "(" and ")" - server.py builds "Uploaded (name)" and
    later strips every ")" to recover the name, which mangles "DATA (1).DAT".
"""
import base64
import io
import json
import os
import re
import sys
import threading
from urllib.parse import urlparse

_httpd = None
_lock = threading.Lock()

# One request at a time may read/modify the editor state kept in server.py globals.
_state_lock = threading.RLock()

_KNOWN_POST = {"/api/load", "/api/load-upload", "/api/save", "/api/restore"}
_OPTIONAL_DATA = {"/api/skill-info": "SkillInfo.json", "/api/trait-info": "TraitInfo.json"}
_STATELESS_POST = {"/api/validate", "/api/inspect", "/api/rawdiff"}


def start(root: str, tmp_dir: str, token: str) -> int:
    """Start the local backend on an OS-assigned loopback port and return that port."""
    global _httpd
    with _lock:
        if _httpd is not None:
            return _httpd.server_address[1]

        os.makedirs(tmp_dir, exist_ok=True)
        os.environ["COH_INSTANCES_DIR"] = os.path.join(tmp_dir, "instances")
        os.environ["TEMP"] = tmp_dir  # server.py writes its handler error log here
        if root not in sys.path:
            sys.path.insert(0, root)

        from http.server import ThreadingHTTPServer

        import server as web_server  # heavy: builds the reference tables

        cookie_pair = "coh_token=" + token

        def raw_diff(data):
            """Byte ranges that differ between the decrypted payloads of two saves (max 500 ranges)."""
            a = base64.b64decode(data.get("a", ""))
            b = base64.b64decode(data.get("b", ""))
            if not a or not b:
                raise ValueError("Two saves are required.")
            pa = bytes(web_server.SaveEditor(a).parser.data_payload)
            pb = bytes(web_server.SaveEditor(b).parser.data_payload)
            n = min(len(pa), len(pb))
            ranges, total, i = [], 0, 0
            while i < n:
                if pa[i] == pb[i]:
                    i += 1
                    continue
                start = last = i
                j = i + 1
                while j < n and j - last <= 4:  # merge changes that are at most 4 bytes apart
                    if pa[j] != pb[j]:
                        last = j
                    j += 1
                end = last + 1
                total += sum(1 for k in range(start, end) if pa[k] != pb[k])
                ranges.append({"off": start, "len": end - start,
                               "a": pa[start:end][:32].hex(), "b": pb[start:end][:32].hex()})
                i = end
                if len(ranges) >= 500:
                    break
            return {"len_a": len(pa), "len_b": len(pb), "ranges": ranges,
                    "truncated": len(ranges) >= 500, "changed_bytes": total}

        class GuardedHandler(web_server.P5RWebHandler):
            def parse_request(self):
                if not super().parse_request():
                    return False
                sent = [c.strip() for c in self.headers.get("Cookie", "").split(";")]
                if cookie_pair not in sent:
                    self.send_error(403, "Forbidden")
                    return False
                return True

            def end_headers(self):
                # Assets are served from this same process; never let WebView reuse a stale copy after an update.
                self.send_header("Cache-Control", "no-store")
                super().end_headers()

            # ---------------------------------------------------------- GET
            def do_GET(self):
                path = urlparse(self.path).path
                if path in _OPTIONAL_DATA and self._origin_allowed():
                    # Optional extra data files: SkillInfo.json = {"<skill id>": {"desc": "...", "target": "..."}},
                    # TraitInfo.json = {"<trait id>": "description"}
                    info_file = web_server.PROJECT_ROOT / "data" / _OPTIONAL_DATA[path]
                    body = info_file.read_bytes() if info_file.is_file() else b"{}"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if path in ("/", "/index.html") and self._origin_allowed():
                    try:
                        self._serve_index()
                        return
                    except Exception:
                        pass  # fall back to the stock handler below
                super().do_GET()

            def _serve_index(self):
                template = web_server.WEB_APP_DIR / "templates" / "index.html"
                html = template.read_text(encoding="utf-8")
                static = web_server.WEB_APP_DIR / "static"
                features = static / "features.js"
                feature_tag = '<script src="/features.js?v=1"></script>\n  '
                if (static / "features2.js").is_file():
                    feature_tag += '<script src="/features2.js?v=1"></script>\n  '
                if features.is_file() and "/features.js" not in html:
                    # Must run BEFORE android.js: it wraps window.AndroidBridge before android.js captures it.
                    pat = re.compile(r'<script[^>]*src="/android\.js[^"]*"[^>]*></script>')
                    if pat.search(html):
                        html = pat.sub(lambda m: feature_tag + m.group(0), html, count=1)
                    else:
                        html = html.replace("</body>", feature_tag + "</body>", 1)
                body = html.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            # --------------------------------------------------------- POST
            def do_POST(self):
                path = urlparse(self.path).path
                if path in _STATELESS_POST:
                    self._stateless(path)
                    return
                if path not in _KNOWN_POST:
                    self.send_json(404, {"error": "Unknown endpoint: " + path})
                    return
                if path == "/api/load-upload":
                    self._sanitize_upload_name()
                with _state_lock:
                    super().do_POST()

            def _read_body(self) -> bytes:
                length = int(self.headers.get("Content-Length", 0) or 0)
                return self.rfile.read(length) if length > 0 else b""

            def _sanitize_upload_name(self):
                """Strip ( and ) from the upload's file name, then hand the body back to the stock handler."""
                body = self._read_body()
                try:
                    data = json.loads(body.decode("utf-8"))
                    name = str(data.get("filename") or "DATA.DAT")
                    data["filename"] = re.sub(r"[()]", "_", name) or "DATA.DAT"
                    body = json.dumps(data).encode("utf-8")
                except Exception:
                    pass  # let the stock handler report whatever is wrong with the body
                if self.headers.get("Content-Length") is not None:
                    self.headers.replace_header("Content-Length", str(len(body)))
                else:
                    self.headers.add_header("Content-Length", str(len(body)))
                self.rfile = io.BytesIO(body)

            def _stateless(self, path):
                """Parse posted save bytes without touching the editor state of the open save."""
                if not self._origin_allowed():
                    self.send_json(403, {"error": "Cross-origin requests are not allowed."})
                    return
                validate = path == "/api/validate"
                try:
                    data = json.loads(self._read_body().decode("utf-8") or "{}")
                    if path == "/api/rawdiff":
                        self.send_json(200, raw_diff(data))
                        return
                    raw = base64.b64decode(data.get("data", ""))
                    if not raw:
                        raise ValueError("No file content.")
                    editor = web_server.SaveEditor(raw)
                    if validate:
                        report = editor.integrity_report()
                        self.send_json(200, {"ok": bool(report.get("ok")), "integrity": report})
                    else:
                        self.send_json(200, web_server._build_loaded_save_payload(editor, "Uploaded (inspect)"))
                except Exception as e:  # noqa: BLE001 - report to the UI, never crash the handler thread
                    if validate:
                        self.send_json(200, {"ok": False, "error": str(e)})
                    elif path == "/api/rawdiff":
                        self.send_json(500, {"error": "Raw diff failed: " + str(e)})
                    else:
                        self.send_json(500, {"error": "Could not read save: " + str(e)})

        class _Server(ThreadingHTTPServer):
            allow_reuse_address = False
            daemon_threads = True

        httpd = _Server(("127.0.0.1", 0), GuardedHandler)
        threading.Thread(target=httpd.serve_forever, name="coh-http", daemon=True).start()
        _httpd = httpd
        return httpd.server_address[1]


def stop() -> None:
    global _httpd
    with _lock:
        if _httpd is not None:
            try:
                _httpd.shutdown()
                _httpd.server_close()
            finally:
                _httpd = None
