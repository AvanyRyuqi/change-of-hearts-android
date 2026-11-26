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

  function showMsg(html) { document.getElementById("gsBody").innerHTML = '<div class="gs-msg">' + html + "</div>"; }

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

  function loadLinked(f) {
    const r = call("readSave", f.path);
    if (!r.ok) { showMsg("⚠ " + esc(r.error || "Could not read file")); return; }

    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], f.name, { type: "application/octet-stream" });

    const input = document.getElementById("manualFileInput");
    if (!input) { showMsg("⚠ Editor file input not found."); return; }

    closeSheet();
    linked = { path: f.path, rel: f.rel, name: f.name };
    updateButton();

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    loadingLinked = true;
    try { input.dispatchEvent(new Event("change", { bubbles: true })); }
    finally { loadingLinked = false; }
    status("Loading " + f.rel + " from the game folder…");
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
