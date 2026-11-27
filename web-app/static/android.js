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

/* =========================================================================
   SKILL SEARCH — kotak cari untuk 8 slot "Learned Skills" (Velvet Room).
   Mengetik akan mempersempit daftar di semua slot (nama, elemen, biaya, atau ID).
   Skill yang sedang terpasang selalu tetap ada, jadi data tidak berubah.
   Ditambahkan di akhir android.js. Tidak mengubah logika editor.
   ========================================================================= */
(function () {
  "use strict";

  function init() {
    // Kotak cari skill bawaan index.html dobel dengan yang ini -> hapus (satu saja).
    const legacy = document.getElementById("skillSearch");
    if (legacy) legacy.remove();

    const grid = document.getElementById("skillsGrid");
    if (!grid || document.getElementById("skillSearchInput")) return;

    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; align-items:center; gap:6px; margin-bottom:6px;";
    wrap.innerHTML =
      '<input id="skillSearchInput" type="search" class="p5-input" ' +
      'placeholder="Search skill (name, element, ID) e.g. Mabufu, Fire, Recarm…" ' +
      'autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" ' +
      'style="flex:1; min-width:0; font-size:13px; padding:6px 10px;">' +
      '<span id="skillSearchCount" style="font-size:10px; color:var(--p5-muted, #8E8E9F); white-space:nowrap;"></span>';
    grid.parentNode.insertBefore(wrap, grid);

    const input = document.getElementById("skillSearchInput");
    const count = document.getElementById("skillSearchCount");

    function matches(opt, tokens) {
      if (!tokens.length || opt.v === "0") return true;
      const text = opt.t.toLowerCase();
      return tokens.every((k) => text.includes(k) || opt.v === k);
    }

    function apply() {
      const tokens = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      let total = 0;
      let first = true;

      grid.querySelectorAll("select").forEach((sel) => {
        // simpan daftar lengkap sekali per select (renderSkillsGrid membuat select baru)
        if (!sel._skillAll) {
          sel._skillAll = Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent }));
        }
        const all = sel._skillAll;
        const cur = sel.value;
        const keep = all.filter((o) => o.v === cur || matches(o, tokens));

        const frag = document.createDocumentFragment();
        keep.forEach((o) => {
          const op = document.createElement("option");
          op.value = o.v;
          op.textContent = o.t;
          frag.appendChild(op);
        });
        sel.innerHTML = "";
        sel.appendChild(frag);
        sel.value = cur;

        if (first) {
          first = false;
          total = all.filter((o) => o.v !== "0").length;
          shown = all.filter((o) => o.v !== "0" && matches(o, tokens)).length;
        }
      });

      count.textContent = tokens.length ? `${shown} / ${total}` : "";
    }

    let timer = null;
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 100); });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { input.value = ""; apply(); }
    });

    // Terapkan ulang filter setiap kali grid skill dibangun ulang (ganti persona/member).
    new MutationObserver(() => apply()).observe(grid, { childList: true });
    apply();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* =========================================================================
   SAVE FOLDER (Android) — baca save langsung dari folder game dan timpa
   file yang sama saat "SAVE CHANGES & RE-SIGN".
   Default: /storage/emulated/0/Persona 5 Royal/user/save
   Hanya aktif di app Android (butuh AndroidBridge.listSaves dari build baru).
   Ditambahkan di akhir android.js.
   ========================================================================= */
(function () {
  "use strict";

  const B = window.AndroidBridge;
  if (!B || typeof B.listSaves !== "function") return;

  let linked = null;        // { path, rel, name } — file game yang sedang diedit
  let loadingLinked = false;

  const status = (m) => { if (typeof setStatus === "function") setStatus(m); };
  const call = (fn, ...args) => {
    try { return JSON.parse(B[fn](...args)); }
    catch (e) { return { ok: false, error: String(e) }; }
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtKB = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  const CSS = `
  #gsOverlay { position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,.72); display: flex; align-items: flex-end; justify-content: center; }
  #gsOverlay[hidden] { display: none; }
  #gsPanel { width: 100%; max-width: 560px; max-height: 80vh; display: flex; flex-direction: column; background: #0E0E14;
    border: 2px solid var(--p5-crimson, #E31500); box-shadow: 0 -4px 0 #000; }
  #gsHead { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 2px solid #1c1c28; }
  #gsHead b { flex: 1; font-size: 14px; color: #fff; letter-spacing: 1px; }
  #gsRoot { padding: 6px 10px; font-size: 10px; color: var(--p5-muted, #8E8E9F); word-break: break-all; border-bottom: 1px solid #1c1c28; }
  #gsBody { overflow-y: auto; padding: 4px 0; }
  .gs-msg { padding: 14px 12px; font-size: 12px; color: #fff; line-height: 1.5; }
  .gs-row { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid #1c1c28; cursor: pointer; font-size: 12px; color: #fff; }
  .gs-row:hover, .gs-row:active { background: #1a1a28; }
  .gs-row .gs-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
  .gs-row .gs-meta { flex: none; font-size: 10px; color: var(--p5-muted, #8E8E9F); text-align: right; }
  .gs-row.gs-on { border-left: 3px solid var(--p5-yellow, #FFE600); background: #16161f; }
  `;

  function getOverlay() {
    let ov = document.getElementById("gsOverlay");
    if (ov) return ov;
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    ov = document.createElement("div");
    ov.id = "gsOverlay";
    ov.hidden = true;
    ov.innerHTML =
      '<div id="gsPanel">' +
      '<div id="gsHead"><b>GAME SAVES</b>' +
      '<button class="p5-btn-action secondary" id="gsFolder"><span>FOLDER</span></button>' +
      '<button class="p5-btn-action secondary" id="gsRefresh"><span>REFRESH</span></button>' +
      '<button class="p5-btn-action secondary" id="gsClose"><span>✕</span></button></div>' +
      '<div id="gsRoot"></div><div id="gsBody"></div></div>';
    document.body.appendChild(ov);

    ov.addEventListener("click", (ev) => { if (ev.target === ov) closeSheet(); });
    document.getElementById("gsClose").addEventListener("click", closeSheet);
    document.getElementById("gsRefresh").addEventListener("click", refreshList);
    document.getElementById("gsFolder").addEventListener("click", () => {
      const cur = B.getSaveRoot();
      const v = window.prompt("Save folder path:", cur);
      if (v && v.trim()) { B.setSaveRoot(v.trim()); refreshList(); }
    });
    return ov;
  }

  function closeSheet() { getOverlay().hidden = true; }
  function openSheet() { getOverlay().hidden = false; refreshList(); }

  function showMsg(html) {
    const el = document.getElementById("gsBody");
    if (el) el.innerHTML = '<div class="gs-msg">' + html + "</div>";
    status(String(html).replace(/<[^>]*>/g, " "));
  }

  function refreshList() {
    const body = document.getElementById("gsBody");
    document.getElementById("gsRoot").textContent = B.getSaveRoot();
    body.innerHTML = '<div class="gs-msg">Scanning…</div>';

    const r = call("listSaves", B.getSaveRoot());
    if (!r.ok) {
      if (r.error === "no_access") {
        showMsg(
          "To read and overwrite saves directly, the app needs <b>All files access</b> (one time).<br>" +
          '<button class="p5-btn-action" id="gsGrant" style="margin-top:10px;"><span>GRANT ACCESS</span></button>'
        );
        document.getElementById("gsGrant").addEventListener("click", () => {
          const res = B.requestStorageAccess();
          if (res !== "ok") showMsg(esc(res));
        });
      } else {
        showMsg("⚠ " + esc(r.error || "Unknown error") + "<br><br>Use <b>FOLDER</b> to change the path.");
      }
      return;
    }
    if (!r.files.length) {
      showMsg("No save files found in this folder.<br><br>Use <b>FOLDER</b> to point to the right path.");
      return;
    }
    document.getElementById("gsRoot").textContent = r.root;
    body.innerHTML = "";

    // Slot terakhir yang dipakai
    let last = null;
    try { last = JSON.parse(B.getPref("last_save") || "null"); } catch (e) { last = null; }
    if (last && last.path && !(linked && linked.path === last.path) && r.files.some((x) => x.path === last.path)) {
      const cont = document.createElement("div");
      cont.className = "gs-row";
      cont.style.borderLeft = "3px solid var(--p5-cyan, #00C4FE)";
      cont.innerHTML = '<span class="gs-name">▶ Continue: ' + esc(last.rel) + "</span>";
      cont.addEventListener("click", () => loadLinked(last));
      body.appendChild(cont);
    }
    r.files.forEach((f) => {
      const row = document.createElement("div");
      row.className = "gs-row" + (linked && linked.path === f.path ? " gs-on" : "");
      row.innerHTML =
        '<span class="gs-name">' + esc(f.rel) + "</span>" +
        '<span class="gs-meta">' + fmtKB(f.size) + "<br>" + esc(new Date(f.modified).toLocaleString()) + "</span>";
      row.addEventListener("click", () => loadLinked(f));
      body.appendChild(row);
    });
  }

  function waitForLoad(prev, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        let cur = null;
        try { cur = CURRENT_SAVE; } catch (e) { /* belum ada */ }
        if (cur && cur !== prev) return resolve(true);
        if (Date.now() - t0 > ms) return resolve(false);
        setTimeout(tick, 120);
      })();
    });
  }

  // Memuat file game ke editor. Mengembalikan Promise<boolean> (true = editor selesai memuat).
  function loadLinked(f) {
    const r = call("readSave", f.path);
    if (!r.ok) { showMsg("⚠ " + esc(r.error || "Could not read file")); return Promise.resolve(false); }

    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], f.name, { type: "application/octet-stream" });

    const input = document.getElementById("manualFileInput");
    if (!input) { showMsg("⚠ Editor file input not found."); return Promise.resolve(false); }

    closeSheet();
    linked = { path: f.path, rel: f.rel, name: f.name };
    updateButton();
    try { B.setPref("last_save", JSON.stringify(linked)); } catch (e) { /* abaikan */ }

    let prev = null;
    try { prev = CURRENT_SAVE; } catch (e) { /* belum ada */ }

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    loadingLinked = true;
    try { input.dispatchEvent(new Event("change", { bubbles: true })); }
    finally { loadingLinked = false; }
    status("Loading " + f.rel + " from the game folder…");
    return waitForLoad(prev, 20000);
  }

  function updateButton() {
    const b = document.getElementById("gameSavesBtn");
    if (!b) return;
    const span = b.querySelector("span");
    if (span) span.textContent = linked ? "📁 " + linked.rel : "📁 GAME SAVES";
    b.title = linked ? "Saving will overwrite: " + linked.path : "Open a save directly from the game folder";
  }

  function readB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  // Saat editor "mengunduh" save hasil re-sign -> timpa file game (ZIP backup tetap ke Downloads).
  const prevClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || "";
    const name = this.getAttribute("download") || "";
    if (linked && this.hasAttribute("download") && href.indexOf("blob:") === 0 && !/\.zip$/i.test(name)) {
      const target = linked;
      fetch(href)
        .then((r) => r.blob())
        .then(readB64)
        .then((b64) => {
          const res = call("writeSave", target.path, b64);
          if (res.ok) status("✔ Saved directly to " + target.rel + " — old file backed up as " + res.backup);
          else status("⚠ Could not overwrite " + target.rel + ": " + (res.error === "no_access" ? "file access was revoked" : res.error));
          if (!res.ok) window.alert("Could not overwrite " + target.rel + ":\n" + (res.error || "unknown error"));
        })
        .catch((err) => status("⚠ Could not overwrite " + target.rel + ": " + err));
      return;
    }
    return prevClick.apply(this, arguments);
  };

  // Teks alert lama bilang "downloaded"; ganti agar sesuai.
  const prevAlert = window.alert;
  window.alert = function (msg) {
    if (linked && /Save successful!/.test(String(msg))) {
      msg = "★ Re-signed! Overwriting " + linked.rel + " in the game folder. The old file is backed up in Download/ChangeOfHeart/backup.";
    }
    return prevAlert.call(window, msg);
  };

  // Kalau pengguna memilih file lain secara manual, lepaskan tautan ke file game.
  document.addEventListener("change", (ev) => {
    if (ev.target && ev.target.id === "manualFileInput" && !loadingLinked) { linked = null; updateButton(); }
  }, true);
  // Kembali dari layar izin Android -> segarkan daftar.
  document.addEventListener("visibilitychange", () => {
    const ov = document.getElementById("gsOverlay");
    if (!document.hidden && ov && !ov.hidden) refreshList();
  });

  function init() {
    if (document.getElementById("gameSavesBtn")) return;
    const box = document.querySelector(".save-selector-box");
    if (!box) return;
    const btn = document.createElement("button");
    btn.id = "gameSavesBtn";
    btn.className = "p5-btn-action";
    btn.innerHTML = "<span>📁 GAME SAVES</span>";
    btn.addEventListener("click", openSheet);
    box.insertBefore(btn, box.firstChild);
    const dd = document.getElementById("saveFileDropdown");
    if (dd) dd.addEventListener("change", () => { linked = null; updateButton(); });
  }

  window.CohSaves = {
    getLinked: () => linked,
    loadFile: loadLinked,
    reload: () => (linked ? loadLinked(linked) : Promise.resolve(false)),
    list: () => call("listSaves", B.getSaveRoot()),
    openSheet: openSheet,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* =========================================================================
   EXTRAS — fitur tambahan editor (Android):
   - Ringkasan perubahan + konfirmasi sebelum menimpa save
   - Menu TOOLS: Restore backup, Salin antar slot, Progres, Preset build,
     Revert edit, Ukuran UI
   - Chip filter elemen di pencarian skill
   Ditambahkan di akhir android.js setelah quick-search, skill-search, save-folder.
   ========================================================================= */
(function () {
  "use strict";

  const B = window.AndroidBridge;
  const hasNative = !!(B && typeof B.getPref === "function" && typeof B.listBackups === "function");

  // ---------- util ----------
  const status = (m) => { if (typeof setStatus === "function") setStatus(m); };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = (fn, ...args) => {
    try { return JSON.parse(B[fn](...args)); } catch (e) { return { ok: false, error: String(e) }; }
  };
  const G = {
    save: () => { try { return CURRENT_SAVE; } catch (e) { return null; } },
    db: () => { try { return DB || {}; } catch (e) { return {}; } },
    comp: () => { try { return COMPENDIUM_DATA; } catch (e) { return null; } },
    inv: () => { try { return INVENTORY_ITEM_COUNTS || {}; } catch (e) { return {}; } },
    path: () => { try { return CURRENT_FILE_PATH; } catch (e) { return ""; } },
  };
  const linked = () => (window.CohSaves ? window.CohSaves.getLinked() : null);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmtDate = (ms) => new Date(ms).toLocaleString();

  // ---------- CSS ----------
  const CSS = `
  .cm-ov { position: fixed; inset: 0; z-index: 950; background: rgba(0,0,0,.75); display: flex; align-items: center; justify-content: center; padding: 10px; }
  .cm-panel { width: 100%; max-width: 520px; max-height: 88vh; display: flex; flex-direction: column; background: #0E0E14;
    border: 2px solid var(--p5-crimson, #E31500); box-shadow: 4px 4px 0 #000; }
  .cm-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 2px solid #1c1c28; }
  .cm-head b { flex: 1; font-size: 14px; color: #fff; letter-spacing: 1px; }
  .cm-body { overflow-y: auto; padding: 8px 10px; font-size: 12px; color: #fff; line-height: 1.45; }
  .cm-foot { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 10px; border-top: 2px solid #1c1c28; }
  .cm-foot:empty { display: none; }
  .cm-row { display: flex; align-items: center; gap: 8px; padding: 8px 4px; border-bottom: 1px solid #1c1c28; }
  .cm-grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .cm-sub { font-size: 10px; color: var(--p5-muted, #8E8E9F); }
  .cm-menu { display: block; width: 100%; text-align: left; margin-bottom: 6px; }
  .cm-diff { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #1c1c28; font-size: 11px; }
  .cm-diff .k { flex: 1; color: #b9b9c9; }
  .cm-diff .v { color: #fff; text-align: right; max-width: 55%; }
  .cm-bar { height: 6px; background: #1c1c28; margin-top: 3px; }
  .cm-bar i { display: block; height: 100%; background: var(--p5-crimson, #E31500); }
  .cm-h { margin: 10px 0 4px; font-size: 11px; font-weight: 800; letter-spacing: .5px; color: var(--p5-yellow, #FFE600); text-transform: uppercase; }
  .cm-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .cm-chip { padding: 3px 8px; font-size: 11px; color: #fff; background: #12121a; border: 1px solid #333; cursor: pointer; }
  .cm-chip.on { background: var(--p5-crimson, #E31500); border-color: var(--p5-crimson, #E31500); }
  `;
  function ensureCss() {
    if (document.getElementById("cohExtrasCss")) return;
    const st = document.createElement("style");
    st.id = "cohExtrasCss";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---------- modal ----------
  let modalCancel = null;
  function closeModal() {
    const m = document.getElementById("cohModal");
    if (m) m.remove();
    const cb = modalCancel;
    modalCancel = null;
    if (cb) cb();
  }
  // opts: { buttons:[{label, primary, onClick}], onAct:{name:fn(dataset, el)}, onCancel }
  function modal(title, html, opts) {
    ensureCss();
    const old = document.getElementById("cohModal");
    if (old) old.remove();
    modalCancel = null;
    opts = opts || {};
    const ov = document.createElement("div");
    ov.id = "cohModal";
    ov.className = "cm-ov";
    ov.innerHTML =
      '<div class="cm-panel"><div class="cm-head"><b>' + esc(title) + '</b>' +
      '<button class="p5-btn-action secondary" data-x="1"><span>✕</span></button></div>' +
      '<div class="cm-body">' + html + '</div><div class="cm-foot"></div></div>';
    document.body.appendChild(ov);
    modalCancel = opts.onCancel || null;

    ov.addEventListener("click", (ev) => {
      if (ev.target === ov) { closeModal(); return; }
      const t = ev.target.closest ? ev.target.closest("[data-x],[data-act]") : null;
      if (!t) return;
      if (t.dataset.x) { closeModal(); return; }
      const fn = opts.onAct && opts.onAct[t.dataset.act];
      if (fn) fn(t.dataset, t);
    });
    const foot = ov.querySelector(".cm-foot");
    (opts.buttons || []).forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "p5-btn-action" + (b.primary ? "" : " secondary");
      btn.innerHTML = "<span>" + esc(b.label) + "</span>";
      btn.addEventListener("click", () => {
        modalCancel = null;
        if (b.onClick) b.onClick();   // jalankan saat isi modal masih ada (bisa membaca input)
        if (ov.isConnected) ov.remove();
      });
      foot.appendChild(btn);
    });
    return ov;
  }
  const info = (msg) => modal("Info", "<div>" + msg + "</div>");

  // =====================================================================
  // 1) RINGKASAN PERUBAHAN SEBELUM MENIMPA
  // =====================================================================
  const SKIP = new Set(["inventory", "inventory_normalized", "compendium", "unlock_compendium", "integrity", "notice", "file_path"]);
  let baseline = null;

  function normalize(v, key) {
    if (Array.isArray(v)) {
      const arr = v.map((x) => normalize(x, key));
      return key === "skills" ? arr.map((x) => (x && typeof x === "object" ? x.id : x)) : arr;
    }
    if (v && typeof v === "object") {
      if (key === "stats" && "st" in v) return [v.st, v.ma, v.en, v.ag, v.lu];
      const o = {};
      Object.keys(v).forEach((k) => { o[k] = normalize(v[k], k); });
      return o;
    }
    return v;
  }
  function snapshot(d) {
    const o = {};
    Object.keys(d || {}).forEach((k) => { if (!SKIP.has(k)) o[k] = d[k]; });
    return normalize(clone(o), "");
  }
  function diff(a, b, path, out) {
    if (out.length > 400) return;
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === "object" && typeof b === "object") {
      const keys = new Set(Object.keys(a).concat(Object.keys(b)));
      keys.forEach((k) => diff(a[k], b[k], path.concat(Array.isArray(a) || Array.isArray(b) ? Number(k) : k), out));
    } else {
      out.push({ path: path, from: a, to: b });
    }
  }
  const pretty = (seg) => (typeof seg === "number" ? "#" + (seg + 1) : String(seg).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
  function label(path, base) {
    const a = path[0];
    if (a === "header") return path[1] === "money" ? "Money" : "Header › " + pretty(path[1]);
    if (a === "social_stats") return "Social › " + path[1];
    if (a === "confidants") return "Confidant " + path[1] + " › " + path.slice(2).map(pretty).join(" › ");
    if (a === "party") {
      const m = (base.party || [])[path[1]] || {};
      const who = m.name || "Member " + (path[1] + 1);
      return who + " › " + path.slice(2).map((s, i, arr) => (arr[i - 1] === "skills" ? "skill " + (s + 1) : pretty(s))).join(" › ");
    }
    if (a === "joker_stock") {
      return "Persona stock " + ((path[1] || 0) + 1) + " › " + path.slice(2).map((s, i, arr) => (arr[i - 1] === "skills" ? "skill " + (s + 1) : pretty(s))).join(" › ");
    }
    return path.map(pretty).join(" › ");
  }
  function fmt(path, v) {
    if (v === undefined || v === null) return "—";
    const last = path[path.length - 1];
    const parent = path[path.length - 2];
    const db = G.db();
    if (Array.isArray(v) && last === "skills") {
      const names = v.filter(Boolean).map((id) => {
        const sk = (db.skills || []).find((x) => x.id === id);
        return sk ? sk.name : "#" + id;
      });
      return names.length ? names.join(", ") : "(empty)";
    }
    if (parent === "skills" && typeof v === "number") {
      if (!v) return "(empty)";
      const s = (db.skills || []).find((x) => x.id === v);
      return s ? s.name : "#" + v;
    }
    if (last === "persona_id") {
      if (!v) return "(empty)";
      const p = (db.personas || []).find((x) => x.id === v);
      return p ? p.name : "#" + v;
    }
    if (last === "trait_id") {
      if (!v) return "(none)";
      const t = (db.traits || []).find((x) => x.id === v);
      return t ? t.name : "#" + v;
    }
    if (typeof v === "number") return v.toLocaleString();
    if (typeof v === "object") return JSON.stringify(v).slice(0, 40);
    return String(v);
  }

  function confirmSave(bodyStr) {
    let cur;
    try { cur = JSON.parse(bodyStr); } catch (e) { return Promise.resolve(true); }
    if (!baseline) return Promise.resolve(true);
    const snap = snapshot(cur);
    const out = [];
    diff(baseline, snap, [], out);
    if (!out.length) return Promise.resolve(true);

    const L = linked();
    const shown = out.slice(0, 60);
    const rows = shown.map((d) =>
      '<div class="cm-diff"><span class="k">' + esc(label(d.path, baseline)) + '</span><span class="v">' +
      esc(fmt(d.path, d.from)) + " → " + esc(fmt(d.path, d.to)) + "</span></div>").join("");
    const more = out.length > shown.length ? '<div class="cm-sub" style="padding-top:6px;">…and ' + (out.length - shown.length) + " more changes</div>" : "";
    const where = L
      ? "This will <b>overwrite " + esc(L.rel) + "</b> in the game folder (old file is backed up first)."
      : "This will re-sign the save and download it.";

    return new Promise((resolve) => {
      let decided = false;
      const done = (v) => { if (!decided) { decided = true; resolve(v); } };
      modal(out.length + " change" + (out.length > 1 ? "s" : "") + " to save",
        '<div style="margin-bottom:6px;">' + where + "</div>" + rows + more,
        {
          buttons: [
            { label: "CANCEL", onClick: () => done(false) },
            { label: "OVERWRITE", primary: true, onClick: () => done(true) },
          ],
          onCancel: () => done(false),
        });
    });
  }

  if (hasNative) {
    const origFetch = window.fetch.bind(window);
    window.__cohRawFetch = origFetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

      if (url.indexOf("/api/save") !== -1 && method === "POST" && init && typeof init.body === "string") {
        const body = init.body;
        return confirmSave(body).then((ok) => {
          if (!ok) {
            status("Save cancelled — nothing was changed.");
            return new Response(JSON.stringify({ error: "Cancelled by you — nothing was changed." }), {
              status: 200, headers: { "Content-Type": "application/json" },
            });
          }
          return origFetch(input, init).then((res) => {
            try {
              res.clone().json().then((j) => { if (j && !j.error) baseline = snapshot(JSON.parse(body)); }).catch(() => {});
            } catch (e) { /* abaikan */ }
            return res;
          });
        });
      }

      const p = origFetch(input, init);
      if (url.indexOf("/api/load") !== -1) {
        p.then((res) => {
          res.clone().json().then((d) => { if (d && !d.error) baseline = snapshot(d); }).catch(() => {});
        }).catch(() => {});
      }
      return p;
    };
  }

  // =====================================================================
  // 2) RESTORE BACKUP (folder game)
  // =====================================================================
  function openRestore() {
    const L = linked();
    if (!L) { info("Open a slot first via <b>GAME SAVES</b>. Backups are matched to the slot you are editing."); return; }
    const r = call("listBackups", L.path);
    if (!r.ok) { info("⚠ " + esc(r.error || "Could not list backups")); return; }
    if (!r.backups.length) { info("No backups yet for <b>" + esc(L.rel) + "</b>. One is created automatically every time you overwrite it."); return; }

    const rows = r.backups.map((b) =>
      '<div class="cm-row"><span class="cm-grow">' + esc(fmtDate(b.modified)) +
      '<div class="cm-sub">' + Math.max(1, Math.round(b.size / 1024)) + " KB</div></span>" +
      '<button class="p5-btn-action" data-act="restore" data-name="' + esc(b.name) + '"><span>RESTORE</span></button></div>').join("");

    modal("Restore backup — " + L.rel, rows, {
      onAct: {
        restore: (d) => {
          const when = d.name;
          if (!window.confirm("Restore this backup over " + L.rel + "?\nThe current file is backed up first. Unsaved edits are lost.")) return;
          const rb = call("readBackup", when);
          if (!rb.ok) { info("⚠ " + esc(rb.error || "Could not read backup")); return; }
          const w = call("writeSave", L.path, rb.data);
          if (!w.ok) { info("⚠ " + esc(w.error || "Could not restore")); return; }
          closeModal();
          status("✔ Restored " + L.rel + " from backup. Reloading…");
          window.CohSaves.reload();
        },
      },
    });
  }

  // =====================================================================
  // 3) SALIN ANTAR SLOT (uang, social stats, persona stock)
  // =====================================================================
  let copying = false;
  function openCopy() {
    const L = linked();
    if (!L) { info("Open the <b>target</b> slot first via <b>GAME SAVES</b>. Data is copied <i>into</i> the slot you are editing."); return; }
    const r = window.CohSaves.list();
    if (!r.ok) { info("⚠ " + esc(r.error || "Could not list saves")); return; }
    const others = r.files.filter((f) => f.path !== L.path);
    if (!others.length) { info("No other save files found."); return; }

    const opts = others.map((f, i) => '<option value="' + i + '">' + esc(f.rel) + "</option>").join("");
    modal("Copy into " + L.rel,
      '<div class="cm-h">Copy from</div><select id="cpSrc" class="p5-select" style="width:100%;">' + opts + "</select>" +
      '<div class="cm-h">What to copy</div>' +
      '<label class="cm-row"><input type="checkbox" id="cpMoney" checked> <span>Money</span></label>' +
      '<label class="cm-row"><input type="checkbox" id="cpSocial" checked> <span>Social stats</span></label>' +
      '<label class="cm-row"><input type="checkbox" id="cpStock" checked> <span>Persona stock (all 12 slots + Joker\'s equipped persona)</span></label>' +
      '<div class="cm-sub" style="margin-top:8px;">Unsaved edits in <b>' + esc(L.rel) + "</b> are discarded (the slot is reloaded first). " +
      "Nothing is written until you press SAVE and confirm. Inventory and confidants are not copied.</div>",
      {
        buttons: [
          { label: "CANCEL" },
          {
            label: "COPY", primary: true, onClick: () => {
              const srcEl = document.getElementById("cpSrc");
              const src = others[parseInt(srcEl ? srcEl.value : "0", 10) || 0];
              const sec = {
                money: !!(document.getElementById("cpMoney") || {}).checked,
                social: !!(document.getElementById("cpSocial") || {}).checked,
                stock: !!(document.getElementById("cpStock") || {}).checked,
              };
              if (!sec.money && !sec.social && !sec.stock) { setTimeout(() => info("Nothing selected."), 0); return; }
              runCopy(src, sec);
            },
          },
        ],
      });
  }

  async function runCopy(src, sec) {
    if (copying) return;
    copying = true;
    try {
      const L = linked();
      if (!L) throw new Error("No target slot is open.");
      status("Reading " + src.rel + "…");
      const rs = call("readSave", src.path);
      if (!rs.ok) throw new Error(rs.error || "Could not read the source file");

      // Server menyimpan SATU file aktif secara global: memuat sumber mengganti file aktif.
      // Jadi muat sumber (hanya untuk dibaca), lalu muat ulang slot tujuan.
      const resp = await window.__cohRawFetch("/api/load-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: rs.data, filename: src.name }),
      });
      const srcData = await resp.json();
      if (srcData.error) throw new Error(srcData.error);

      status("Reloading " + L.rel + "…");
      const ok = await window.CohSaves.reload();
      const S = G.save();
      if (!ok || !S) throw new Error("Could not reload the target slot. Nothing was changed.");

      const done = [];
      if (sec.money && srcData.header && srcData.header.money !== undefined) {
        S.header.money = srcData.header.money; done.push("money");
      }
      if (sec.social && srcData.social_stats) {
        S.social_stats = clone(srcData.social_stats); done.push("social stats");
      }
      if (sec.stock && Array.isArray(srcData.joker_stock)) {
        S.joker_stock = clone(srcData.joker_stock);
        const joker = (S.party || []).find((m) => m && m.slot === 0);
        const first = S.joker_stock[0];
        if (joker && first && !first.empty) joker.persona = first;
        done.push("persona stock");
      }
      if (typeof _applyLoadedSaveData === "function") _applyLoadedSaveData(S, G.path() || L.name);
      status("✔ Copied " + done.join(", ") + " from " + src.rel + ". Review, then press SAVE to write it to " + L.rel + ".");
    } catch (e) {
      info("⚠ " + esc(e.message || e));
    } finally {
      copying = false;
    }
  }

  // =====================================================================
  // 4) PROGRES
  // =====================================================================
  function bar(v, max) { return '<div class="cm-bar"><i style="width:' + Math.max(0, Math.min(100, (v / max) * 100)) + '%"></i></div>'; }
  function openProgress() {
    const S = G.save();
    if (!S) { info("Load a save first."); return; }
    const h = S.header || {};
    const profiles = G.db().confidant_profiles || {};
    const met = Object.entries(S.confidants || {}).filter((e) => e[1] && e[1].rank > 0);
    const maxed = met.filter((e) => e[1].rank >= 10).length;
    const comp = G.comp();
    const stock = (S.joker_stock || []).filter((e) => e && !e.empty && e.persona_id).length;
    const inv = Object.keys(G.inv()).length;

    let html = '<div class="cm-h">Overview</div>' +
      '<div class="cm-diff"><span class="k">Day</span><span class="v">' + esc(h.day || "—") + "</span></div>" +
      '<div class="cm-diff"><span class="k">Playtime</span><span class="v">' + esc(h.playtime || "—") + "</span></div>" +
      '<div class="cm-diff"><span class="k">Money</span><span class="v">¥' + (h.money || 0).toLocaleString() + "</span></div>" +
      '<div class="cm-diff"><span class="k">Persona stock used</span><span class="v">' + stock + " / 12</span></div>" +
      '<div class="cm-diff"><span class="k">Item types owned</span><span class="v">' + inv + "</span></div>";
    if (comp && Array.isArray(comp.registered)) {
      html += '<div class="cm-diff"><span class="k">Compendium registered</span><span class="v">' + comp.registered.length + "</span></div>";
    }

    html += '<div class="cm-h">Social stats</div>';
    Object.entries(S.social_stats || {}).forEach((e) => {
      const rk = typeof e[1] === "object" ? (e[1].rank || 0) : (e[1] || 0);
      html += '<div style="margin-bottom:4px;"><div class="cm-diff" style="border:0;padding:0;"><span class="k">' + esc(e[0]) +
        '</span><span class="v">' + rk + " / 5</span></div>" + bar(rk, 5) + "</div>";
    });

    html += '<div class="cm-h">Confidants met: ' + met.length + " — maxed: " + maxed + "</div>";
    met.sort((a, b) => b[1].rank - a[1].rank).forEach((e) => {
      const nm = (profiles[e[0]] && profiles[e[0]].name) || e[0];
      html += '<div style="margin-bottom:4px;"><div class="cm-diff" style="border:0;padding:0;"><span class="k">' + esc(nm) +
        '</span><span class="v">RK ' + e[1].rank + " / 10</span></div>" + bar(e[1].rank, 10) + "</div>";
    });
    modal("Progress", html);
  }

  // =====================================================================
  // 5) PRESET BUILD PERSONA
  // =====================================================================
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
  function readPresets() {
    try { const a = JSON.parse(B.getPref("presets") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function writePresets(list) { B.setPref("presets", JSON.stringify(list)); }

  function savePreset() {
    if (!G.save() || !document.getElementById("skillSlot_0")) { info("Open a persona in the Velvet Room tab first."); return false; }
    const sel = document.getElementById("personaSelect");
    const pname = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.trim() : "Persona";
    const name = window.prompt("Preset name:", pname + " build");
    if (!name || !name.trim()) return false;
    const skills = [];
    for (let i = 0; i < 8; i++) skills.push(parseInt(val("skillSlot_" + i), 10) || 0);
    const list = readPresets();
    list.push({
      name: name.trim(), from: pname, saved: Date.now(),
      level: parseInt(val("personaLevel"), 10) || 1,
      trait: parseInt(val("personaTraitSelect"), 10) || 0,
      stats: ["stat_st", "stat_ma", "stat_en", "stat_ag", "stat_lu"].map((id) => parseInt(val(id), 10) || 10),
      skills: skills,
    });
    writePresets(list.slice(-30));
    return true;
  }

  function applyPreset(p) {
    const sInput = document.getElementById("skillSearchInput");
    if (sInput && sInput.value) { sInput.value = ""; sInput.dispatchEvent(new Event("input", { bubbles: true })); }
    setTimeout(() => {
      const db = G.db();
      let missing = 0;
      p.skills.forEach((id, i) => {
        const el = document.getElementById("skillSlot_" + i);
        if (!el) return;
        if (!Array.from(el.options).some((o) => o.value === String(id))) {
          const sk = (db.skills || []).find((x) => x.id === id);
          if (!sk) { missing++; return; }
          const o = document.createElement("option");
          o.value = String(id); o.textContent = sk.name;
          el.appendChild(o);
        }
        el.value = String(id);
      });
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
      set("personaLevel", p.level);
      set("personaTraitSelect", p.trait);
      ["stat_st", "stat_ma", "stat_en", "stat_ag", "stat_lu"].forEach((id, i) => set(id, p.stats[i]));
      if (typeof saveCurrentDeckToActiveTarget === "function") saveCurrentDeckToActiveTarget();
      status("✔ Applied preset “" + p.name + "”" + (missing ? " (" + missing + " skill(s) not found)" : "") + ". Press SAVE to write it.");
    }, 250);
  }

  function openPresets() {
    const list = readPresets();
    const rows = list.map((p, i) =>
      '<div class="cm-row"><span class="cm-grow"><b>' + esc(p.name) + '</b><div class="cm-sub">LV ' + p.level + " · " +
      esc(p.from || "") + "</div></span>" +
      '<button class="p5-btn-action" data-act="apply" data-i="' + i + '"><span>APPLY</span></button>' +
      '<button class="p5-btn-action secondary" data-act="del" data-i="' + i + '"><span>✕</span></button></div>').join("");
    modal("Persona presets",
      (rows || '<div class="cm-sub">No presets yet. Open a persona, set it up, then tap SAVE CURRENT BUILD.</div>') +
      '<div class="cm-sub" style="margin-top:8px;">A preset stores level, trait, stats and all 8 skills. Applying it changes the persona currently open in the Velvet Room tab.</div>',
      {
        buttons: [{ label: "SAVE CURRENT BUILD", primary: true, onClick: () => { if (savePreset()) status("✔ Preset saved."); } }],
        onAct: {
          apply: (d) => {
            const p = readPresets()[parseInt(d.i, 10)];
            if (!p) return;
            if (!window.confirm("Apply “" + p.name + "” to the persona currently open?")) return;
            closeModal();
            applyPreset(p);
          },
          del: (d) => {
            const l = readPresets();
            const p = l[parseInt(d.i, 10)];
            if (!p || !window.confirm("Delete preset “" + p.name + "”?")) return;
            l.splice(parseInt(d.i, 10), 1);
            writePresets(l);
            openPresets();
          },
        },
      });
  }

  // =====================================================================
  // 6) REVERT (buang edit yang belum disimpan)
  // =====================================================================
  function doRevert() {
    const L = linked();
    if (!L) { info("Revert works for slots opened via <b>GAME SAVES</b>."); return; }
    if (!window.confirm("Discard all unsaved edits and reload " + L.rel + " from the game folder?")) return;
    window.CohSaves.reload().then((ok) => status(ok ? "↶ Reverted to the saved state of " + L.rel : "⚠ Could not reload " + L.rel));
  }

  // =====================================================================
  // 7) UKURAN UI
  // =====================================================================
  function applyZoom(z) {
    document.documentElement.style.zoom = z && z !== 1 ? String(z) : "";
  }
  function openUiSize() {
    modal("UI size",
      '<div class="cm-sub" style="margin-bottom:8px;">Scales the whole editor. Saved for next launch.</div>' +
      '<button class="p5-btn-action cm-menu" data-act="z" data-z="0.85"><span>Small (85%)</span></button>' +
      '<button class="p5-btn-action cm-menu" data-act="z" data-z="1"><span>Normal (100%)</span></button>' +
      '<button class="p5-btn-action cm-menu" data-act="z" data-z="1.15"><span>Large (115%)</span></button>',
      {
        onAct: {
          z: (d) => {
            const z = parseFloat(d.z) || 1;
            applyZoom(z);
            B.setPref("ui_zoom", String(z));
            status("UI size set to " + Math.round(z * 100) + "%");
          },
        },
      });
  }

  // =====================================================================
  // MENU TOOLS
  // =====================================================================
  function openTools() {
    const L = linked();
    modal("Tools",
      '<div class="cm-sub" style="margin-bottom:8px;">' + (L ? "Editing: <b>" + esc(L.rel) + "</b>" : "No game slot open (use GAME SAVES)") + "</div>" +
      '<button class="p5-btn-action cm-menu" data-act="restore"><span>♻ Restore backup</span></button>' +
      '<button class="p5-btn-action cm-menu" data-act="copy"><span>📋 Copy from another slot</span></button>' +
      '<button class="p5-btn-action cm-menu" data-act="progress"><span>📊 Progress</span></button>' +
      '<button class="p5-btn-action cm-menu" data-act="presets"><span>🎭 Persona presets</span></button>' +
      '<button class="p5-btn-action cm-menu" data-act="revert"><span>↶ Revert unsaved edits</span></button>' +
      '<button class="p5-btn-action cm-menu" data-act="size"><span>🔠 UI size</span></button>',
      {
        onAct: {
          restore: openRestore, copy: openCopy, progress: openProgress,
          presets: openPresets, size: openUiSize,
          revert: () => { closeModal(); doRevert(); },
        },
      });
  }

  // =====================================================================
  // CHIP FILTER ELEMEN UNTUK SKILL
  // =====================================================================
  function addChips(tries) {
    const input = document.getElementById("skillSearchInput");
    if (!input) { if (tries > 0) setTimeout(() => addChips(tries - 1), 400); return; }
    if (document.getElementById("skillChips")) return;
    ensureCss();
    const els = ["Fire", "Ice", "Elec", "Wind", "Psy", "Nuke", "Bless", "Curse", "Almighty", "Phys", "Gun"];
    const wrap = document.createElement("div");
    wrap.id = "skillChips";
    wrap.className = "cm-chips";
    wrap.innerHTML = els.map((n) => '<span class="cm-chip" data-k="[' + n.toLowerCase() + '">' + n + "</span>").join("");
    const row = input.parentNode;
    row.parentNode.insertBefore(wrap, row.nextSibling);

    function sync() {
      wrap.querySelectorAll(".cm-chip").forEach((c) => c.classList.toggle("on", input.value.trim().toLowerCase() === c.dataset.k));
    }
    wrap.addEventListener("click", (ev) => {
      const c = ev.target.closest ? ev.target.closest(".cm-chip") : null;
      if (!c) return;
      input.value = input.value.trim().toLowerCase() === c.dataset.k ? "" : c.dataset.k;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      sync();
    });
    input.addEventListener("input", sync);
  }

  // =====================================================================
  // INIT
  // =====================================================================
  function init() {
    ensureCss();
    addChips(10);
    if (!hasNative) return;

    try {
      const z = parseFloat(B.getPref("ui_zoom"));
      if (z) applyZoom(z);
    } catch (e) { /* abaikan */ }

    if (document.getElementById("toolsBtn")) return;
    const box = document.querySelector(".save-selector-box");
    if (!box) return;
    const btn = document.createElement("button");
    btn.id = "toolsBtn";
    btn.className = "p5-btn-action secondary";
    btn.innerHTML = "<span>🧰 TOOLS</span>";
    btn.addEventListener("click", openTools);
    const gs = document.getElementById("gameSavesBtn");
    if (gs && gs.parentNode === box) box.insertBefore(btn, gs.nextSibling);
    else box.insertBefore(btn, box.firstChild);
  }

  if (window.__COH_TEST) window.__cohTest = { normalize, snapshot, diff, label, fmt };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
