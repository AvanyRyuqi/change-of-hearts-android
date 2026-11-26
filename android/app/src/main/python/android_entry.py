"""Chaquopy entry point: runs the existing Change of Heart backend inside the Android app.

Kotlin calls start(root, tmp_dir, token) once per process. The backend is the
unmodified desktop `server.py` (stdlib HTTP server + save parser/editor); the
Android app just points a WebView at it.

Security: every Android app can open 127.0.0.1 sockets, so each request must
carry the random per-launch cookie that MainActivity plants in its own WebView.
Requests without it (other apps, adb port scans, ...) get 403.
"""
import os
import sys
import threading

_httpd = None
_lock = threading.Lock()


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

        class GuardedHandler(web_server.P5RWebHandler):
            def parse_request(self):
                if not super().parse_request():
                    return False
                sent = [c.strip() for c in self.headers.get("Cookie", "").split(";")]
                if cookie_pair not in sent:
                    self.send_error(403, "Forbidden")
                    return False
                return True

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
