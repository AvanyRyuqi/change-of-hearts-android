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

/* =========================================================================
   QUICK SEARCH — satu kotak cari untuk semua bagian editor.
   Mencari: tab, confidant, persona. Juga bisa meneruskan kata kunci ke
   pencarian item (Inventory) dan Compendium yang sudah ada.
   Ditambahkan di akhir android.js. Tidak mengubah logika editor.
   ========================================================================= */
(function () {
  "use strict";

  const CSS = `
  #quickSearchBar { position: relative; z-index: 450; padding: 6px 10px; background: #0A0A0F; border-bottom: 2px solid #1c1c28; }
  #quickSearchInput { width: 100%; box-sizing: border-box; min-height: 34px; padding: 4px 10px; font-size: 13px !important;
    color: #fff; background: #12121a; border: 2px solid var(--p5-crimson, #E31500); border-radius: 0; outline: none; }
  #quickSearchInput:focus { border-color: var(--p5-cyan, #00C4FE); }
  #quickSearchResults { position: absolute; left: 10px; right: 10px; top: calc(100% - 2px); max-height: 55vh; overflow-y: auto;
    background: #0E0E14; border: 2px solid var(--p5-cyan, #00C4FE); box-shadow: 4px 4px 0 #000; }
  #quickSearchResults[hidden] { display: none; }
  .qs-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid #1c1c28; cursor: pointer; font-size: 12px; color: #fff; }
  .qs-row:hover, .qs-row.qs-active { background: #1a1a28; }
  .qs-tag { flex: none; min-width: 66px; font-size: 9px; font-weight: 800; letter-spacing: .5px; color: var(--p5-yellow, #FFE600); text-transform: uppercase; }
  .qs-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qs-empty { padding: 10px; font-size: 12px; color: var(--p5-muted, #8E8E9F); }
  `;

  // Baca variabel global app.js dengan aman (tanpa eval).
  const getDB = () => { try { return DB; } catch (e) { return undefined; } };
  const getSave = () => { try { return CURRENT_SAVE; } catch (e) { return undefined; } };
  const getUnsafe = () => { try { return ALLOW_UNSAFE_CONFIDANTS; } catch (e) { return false; } };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function buildResults(raw) {
    const q = raw.toLowerCase().trim();
    const out = [];
    if (!q) return out;

    // 1) Tab
    document.querySelectorAll(".p5-nav-item").forEach((b) => {
      const t = (b.textContent || "").replace(/\s+/g, " ").trim();
      if (t && t.toLowerCase().includes(q)) out.push({ tag: "Tab", label: t, run: () => b.click() });
    });

    // 2) Confidant (hanya yang sudah bertemu, kecuali mode unsafe aktif)
    try {
      const save = getSave();
      const db = getDB() || {};
      const profiles = db.confidant_profiles || {};
      const unsafe = !!getUnsafe();
      Object.entries((save && save.confidants) || {}).forEach(([arcana, info]) => {
        const prof = profiles[arcana] || { name: arcana };
        const hay = `${prof.name || ""} ${arcana} ${prof.role || ""}`.toLowerCase();
        if (!hay.includes(q)) return;
        if (!(info && info.rank > 0) && !unsafe) return;
        out.push({
          tag: "Confidant",
          label: `${prof.name || arcana} — ${arcana} (RK ${info ? info.rank : 0})`,
          run: () => {
            if (typeof switchStage === "function") switchStage("confidants");
            if (typeof filterConfidants === "function") filterConfidants("all", document.getElementById("pillAll"));
            if (typeof selectConfidantArcana === "function") selectConfidantArcana(arcana);
          },
        });
      });
    } catch (e) { /* abaikan */ }

    // 3) Persona (nama atau ID) -> Compendium
    try {
      const db = getDB() || {};
      const seen = new Set();
      for (const p of db.personas || []) {
        if (!p || !p.name || /^Lab /.test(p.name)) continue;
        const n = p.name.toLowerCase();
        if (!(n.includes(q) || String(p.id) === q) || seen.has(n)) continue;
        seen.add(n);
        out.push({ tag: "Persona", label: `${p.name} (#${p.id})`, run: () => gotoCompendium(p.name) });
        if (seen.size >= 8) break;
      }
    } catch (e) { /* abaikan */ }

    // 4) Teruskan ke pencarian yang sudah ada
    out.push({ tag: "Item", label: `Search items for “${raw}”`, run: () => gotoItems(raw) });
    out.push({ tag: "Compendium", label: `Search compendium for “${raw}”`, run: () => gotoCompendium(raw) });
    return out;
  }

  function gotoItems(q) {
    if (typeof switchStage === "function") switchStage("inventory");
    const box = document.getElementById("globalItemSearchBox");
    if (box) {
      box.value = q;
      if (typeof onGlobalSearchInput === "function") onGlobalSearchInput();
    }
  }
  function gotoCompendium(q) {
    if (typeof switchStage === "function") switchStage("compendium");
    const apply = () => {
      const box = document.getElementById("compendiumSearchInput");
      if (box) {
        box.value = q;
        if (typeof filterCompendiumGrid === "function") filterCompendiumGrid();
      }
    };
    apply();
    setTimeout(apply, 250); // data compendium bisa dimuat async
  }

  function init() {
    const strip = document.querySelector(".p5-top-strip");
    if (!strip || document.getElementById("quickSearchBar")) return;

    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const bar = document.createElement("div");
    bar.id = "quickSearchBar";
    bar.innerHTML =
      '<input id="quickSearchInput" type="search" placeholder="Search tab, confidant, persona, item…" ' +
      'autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
      '<div id="quickSearchResults" hidden></div>';
    strip.insertAdjacentElement("afterend", bar);

    const input = document.getElementById("quickSearchInput");
    const box = document.getElementById("quickSearchResults");
    let rows = [];
    let active = 0;
    let timer = null;

    function close() { box.hidden = true; }
    function setActive(i) {
      active = Math.max(0, Math.min(i, rows.length - 1));
      box.querySelectorAll(".qs-row").forEach((el, idx) => el.classList.toggle("qs-active", idx === active));
      const el = box.querySelectorAll(".qs-row")[active];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }
    function choose(i) {
      const r = rows[i];
      if (!r) return;
      close();
      input.value = "";
      input.blur();
      try { r.run(); } catch (e) { console.warn("quick search:", e); }
    }
    function render() {
      const q = input.value;
      if (!q.trim()) { close(); return; }
      rows = buildResults(q);
      box.innerHTML = rows
        .map((r, i) => `<div class="qs-row" data-i="${i}"><span class="qs-tag">${esc(r.tag)}</span><span class="qs-label">${esc(r.label)}</span></div>`)
        .join("") || '<div class="qs-empty">No results</div>';
      box.hidden = false;
      setActive(0);
    }

    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 120); });
    input.addEventListener("focus", () => { if (input.value.trim()) render(); });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(active + 1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(active - 1); }
      else if (ev.key === "Enter") { ev.preventDefault(); render(); choose(active); }
      else if (ev.key === "Escape") { close(); input.blur(); }
    });
    box.addEventListener("click", (ev) => {
      const row = ev.target.closest && ev.target.closest(".qs-row");
      if (row) choose(parseInt(row.dataset.i, 10));
    });
    document.addEventListener("click", (ev) => { if (!bar.contains(ev.target)) close(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
