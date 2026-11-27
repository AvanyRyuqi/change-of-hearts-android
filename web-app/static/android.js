/* Android shell glue. Does nothing in a normal browser / desktop window:
   everything is gated on the native `AndroidBridge` object that the Android
   app injects into its WebView. */
(function () {
  "use strict";

  // Keep the active tab visible in the (horizontally scrollable) bottom nav.
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest || !ev.target.closest(".p5-nav-item")) return;
    setTimeout(() => {
      const act = document.querySelector(".p5-nav-item.active");
      if (act && act.scrollIntoView) act.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }, 60);
  });

  if (!window.AndroidBridge) return;

  document.documentElement.classList.add("is-android");

  // ---- Downloads -------------------------------------------------------
  // The editor "downloads" the re-signed save and the safety-backup ZIP by
  // clicking a temporary <a download href="blob:...">. WebView ignores that,
  // so hand the bytes to the native side, which writes them to
  // Downloads/ChangeOfHeart via MediaStore.
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || "";
    if (this.hasAttribute("download") && href.indexOf("blob:") === 0) {
      const name = this.getAttribute("download") || "download.bin";
      fetch(href)
        .then((r) => r.blob())
        .then(
          (blob) =>
            new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve({ blob, b64: String(fr.result).split(",")[1] || "" });
              fr.onerror = () => reject(fr.error);
              fr.readAsDataURL(blob);
            })
        )
        .then(({ blob, b64 }) => {
          const result = window.AndroidBridge.saveFile(name, blob.type || "application/octet-stream", b64);
          if (typeof setStatus === "function") setStatus(String(result));
        })
        .catch((err) => {
          if (typeof setStatus === "function") setStatus("Could not save " + name + ": " + err);
        });
      return;
    }
    return nativeClick.apply(this, arguments);
  };

  // ---- Wording for touch ----------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const browse = document.querySelector('.save-selector-box [onclick*="manualFileInput"] span');
    if (browse) browse.textContent = "\uD83D\uDCC2 OPEN SAVE FILE";
    const st = document.getElementById("status-text");
    if (st && /initializing/i.test(st.textContent)) st.textContent = "TAP \u201COPEN SAVE FILE\u201D AND PICK YOUR DATA.DAT";
  });
})();
