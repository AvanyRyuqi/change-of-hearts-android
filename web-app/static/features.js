/* =========================================================================
   features.js — fitur tambahan untuk app Android (Guardian, Time Machine,
   Quick Boosts, Backup semua slot, Share preset, Catatan slot, Mode Aman,
   Continue, Riwayat pencarian, Info skill).

   PENTING: file ini dimuat SEBELUM android.js (android_entry.py menyisipkannya).
   Alasannya: ia membungkus window.AndroidBridge dengan Proxy sebelum android.js
   menyimpannya, sehingga semua penulisan save (writeSave) lewat Guardian.
   Di desktop/browser (tanpa AndroidBridge) file ini tidak melakukan apa-apa.
   ========================================================================= */
(function () {
  "use strict";

  const N = window.AndroidBridge;
  if (!N) return;

  // Agar android.js mengekspos helper ringkasan-perubahan (normalize/snapshot/diff/label/fmt)
  // sebagai window.__cohTest — dipakai Time Machine supaya format "Bandingkan" identik dengan
  // layar ringkasan perubahan yang sudah ada.
  window.__COH_TEST = true;

  // ---------------------------------------------------------------- util
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const jparse = (s) => { try { return JSON.parse(s); } catch (e) { return { ok: false, error: String(e) }; } };
  const nat = (fn, ...a) => { try { return jparse(N[fn](...a)); } catch (e) { return { ok: false, error: String(e) }; } };
  const status = (m) => { if (typeof setStatus === "function") setStatus(m); };
  const fmtDate = (ms) => new Date(ms).toLocaleString();
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const G = {
    save: () => { try { return CURRENT_SAVE; } catch (e) { return null; } },
    db: () => { try { return DB || {}; } catch (e) { return {}; } },
    inv: () => { try { return INVENTORY_ITEM_COUNTS || {}; } catch (e) { return {}; } },
    path: () => { try { return CURRENT_FILE_PATH; } catch (e) { return ""; } },
  };
  const slot = () => (window.CohSaves ? window.CohSaves.getLinked() : null);
  const pref = {
    get(k, d) { try { const v = N.getPref(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { N.setPref(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
  };

  let safeMode = !!pref.get("safe_mode", false);

  // ============================================================ GUARDIAN
  // Sidik jari (sha256) file saat editor MEMBUKA-nya. Kalau saat menulis sidik jarinya beda,
  // berarti file di folder game berubah (mis. game sempat jalan dan menyimpan progres baru).
  const fp = {};

  function guardedWrite(path, b64, opts) {
    opts = opts || {};
    if (safeMode) {
      return JSON.stringify({ ok: false, error: "Safe Mode is ON - nothing can be written. Turn it off in MORE > Safe Mode." });
    }
    const base = fp[path];
    if (base && !opts.force) {
      const now = nat("fileInfo", path);
      if (now.ok && now.sha !== base.sha) {
        const go = window.confirm(
          "⚠ GUARDIAN: this save changed in the game folder after you opened it (last change: " + fmtDate(now.modified) + ").\n" +
          "The game may have saved newer progress.\n\n" +
          "Overwrite anyway? The newer file is backed up first, so you can still bring it back from Time Machine.\n\n" +
          "OK = overwrite · Cancel = keep the newer file"
        );
        if (!go) {
          return JSON.stringify({
            ok: false,
            error: "Guardian stopped the write: the file in the game folder is newer than what you opened. " +
              "Press SAVE again to overwrite anyway, or reload the slot (TOOLS > Revert) to keep the newer progress.",
          });
        }
      }
    }
    const out = N.writeSave(path, b64);
    const r = jparse(out);
    if (r && r.ok) {
      fp[path] = { sha: r.sha, modified: r.modified, size: r.bytes };
      setTimeout(() => verifyAfterWrite(path, r), 80);
    }
    return out;
  }

  // Baca ulang file yang baru ditulis, cek checksum/enkripsi lewat backend, dan kembalikan dari backup bila rusak.
  // (Kotlin sudah membandingkan byte-per-byte; ini lapisan kedua: apakah isinya save yang VALID.)
  async function verifyAfterWrite(path, wr) {
    try {
      const rd = nat("readSave", path); // N langsung: jangan mengubah sidik jari
      if (!rd.ok) throw new Error(rd.error || "could not read the file back");
      if (rd.sha !== wr.sha) throw new Error("the file changed right after writing");
      const res = await fetch("/api/validate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: rd.data }),
      });
      const j = await res.json();
      if (j.ok) { status("🛡 Guardian: written file re-read and verified (CRC + AES OK)."); return; }

      let restored = false;
      const bk = nat("readBackup", wr.backup);
      if (bk.ok) {
        const back = nat("writeSave", path, bk.data);
        restored = !!back.ok;
        const now = nat("fileInfo", path);
        if (now.ok) fp[path] = { sha: now.sha, modified: now.modified, size: now.size };
      }
      window.alert(
        "🛡 Guardian: the file that was just written FAILED verification" + (j.error ? " (" + j.error + ")" : "") + ".\n" +
        (restored ? "The previous version was restored automatically from backup. Reload the slot before editing again."
                  : "Automatic restore FAILED. Restore manually from Time Machine: " + wr.backup)
      );
      status("🛡 Guardian: verification failed — " + (restored ? "previous version restored." : "RESTORE MANUALLY."));
    } catch (e) {
      status("🛡 Guardian could not finish verifying: " + (e && e.message ? e.message : e));
    }
  }

  const overrides = {
    readSave(path) {
      const s = N.readSave(path);
      const r = jparse(s);
      if (r && r.ok) fp[path] = { sha: r.sha, modified: r.modified, size: r.size };
      return s;
    },
    writeSave(path, b64) { return guardedWrite(path, b64, {}); },
  };
  window.AndroidBridge = new Proxy(N, {
    get(target, key) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

  // Batal menyimpan bukan "kegagalan": jangan munculkan dialog "Save Failed: Cancelled by you".
  const prevAlert = window.alert;
  window.alert = function (msg) {
    if (/^Save Failed: Cancelled by you/.test(String(msg))) return;
    return prevAlert.call(window, msg);
  };

  // Peringatan saat kembali dari game: file di folder game berubah?
  let ignoredSha = null;
  function checkExternal() {
    const l = slot();
    if (!l || !fp[l.path]) return;
    const now = nat("fileInfo", l.path);
    if (!now.ok || now.sha === fp[l.path].sha || now.sha === ignoredSha) return;
    showExtBanner(l, now);
  }
  function showExtBanner(l, now) {
    let b = $("fxExtBanner");
    if (!b) { b = document.createElement("div"); b.id = "fxExtBanner"; document.body.appendChild(b); }
    b.innerHTML =
      '<span style="flex:1">⚠ <b>' + esc(l.rel) + "</b> changed in the game folder (" + esc(fmtDate(now.modified)) +
      '). Saving now would overwrite newer progress.</span>' +
      '<button class="p5-btn-action" id="fxExtReload"><span>RELOAD</span></button>' +
      '<button class="p5-btn-action secondary" id="fxExtIgnore"><span>IGNORE</span></button>';
    $("fxExtReload").onclick = () => {
      if (!window.confirm("Discard unsaved edits and reload " + l.rel + " from the game folder?")) return;
      b.remove();
      window.CohSaves.reload();
    };
    $("fxExtIgnore").onclick = () => { ignoredSha = now.sha; b.remove(); }; // pengecekan saat menulis tetap aktif
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(checkExternal, 400); });

  // ============================================================== CSS
  const CSS = `
  .fx-ov{position:fixed;inset:0;z-index:960;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:10px}
  .fx-panel{width:100%;max-width:540px;max-height:88vh;display:flex;flex-direction:column;background:#0E0E14;border:2px solid var(--p5-crimson,#E31500);box-shadow:4px 4px 0 #000}
  .fx-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:2px solid #1c1c28}
  .fx-head b{flex:1;font-size:14px;color:#fff;letter-spacing:1px}
  .fx-body{overflow-y:auto;padding:8px 10px;font-size:12px;color:#fff;line-height:1.45}
  .fx-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:8px 10px;border-top:2px solid #1c1c28}
  .fx-foot:empty{display:none}
  .fx-row{display:flex;align-items:center;gap:6px;padding:8px 2px;border-bottom:1px solid #1c1c28}
  .fx-grow{flex:1;min-width:0;overflow-wrap:anywhere}
  .fx-sub{font-size:10px;color:var(--p5-muted,#8E8E9F)}
  .fx-menu{display:block;width:100%;text-align:left;margin-bottom:6px}
  .fx-diff{display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #1c1c28;font-size:11px}
  .fx-diff .k{flex:1;color:#b9b9c9}.fx-diff .v{color:#fff;text-align:right;max-width:55%;overflow-wrap:anywhere}
  .fx-h{margin:10px 0 4px;font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--p5-yellow,#FFE600);text-transform:uppercase}
  .fx-note{margin:6px 0;padding:6px 8px;background:#16161f;border-left:3px solid var(--p5-yellow,#FFE600);font-size:11px}
  #fxSafePill{position:fixed;left:8px;bottom:76px;z-index:420;padding:5px 10px;font-size:11px;font-weight:800;color:#000;background:var(--p5-cyan,#00C4FE);border:2px solid #000;box-shadow:2px 2px 0 #000;cursor:pointer}
  #fxExtBanner{position:fixed;left:0;right:0;top:0;z-index:970;display:flex;align-items:center;gap:8px;padding:8px 10px;background:#3a1200;border-bottom:2px solid var(--p5-yellow,#FFE600);color:#fff;font-size:12px}
  #fxContinue{display:block;width:calc(100% - 20px);margin:8px 10px;font-size:15px}
  .fx-hist{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #1c1c28;cursor:pointer;font-size:12px;color:#fff}
  .fx-hist:hover{background:#1a1a28}
  .fx-skinfo{margin-top:10px;padding:8px;background:rgba(0,0,0,.35);border:2px solid #000;box-shadow:3px 3px 0 #000}
  .fx-skinfo .fx-sk{padding:3px 0;border-bottom:1px solid #1c1c28;font-size:11px;color:#ddd}
  .fx-skinfo .fx-sk b{color:#fff}
  .fx-skinfo .fx-sk i{font-style:normal;color:var(--p5-cyan,#00C4FE)}
  .fx-skinfo .fx-sd{display:block;color:#a9a9bb;font-size:10px}
  `;
  function ensureCss() {
    if ($("cohFeatCss")) return;
    const st = document.createElement("style");
    st.id = "cohFeatCss";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ============================================================ MODAL
  function closeModal() { const m = $("fxModal"); if (m) m.remove(); }
  // opts: { buttons:[{label, primary, onClick}], onAct:{name:(dataset, el)=>void} }
  function modal(title, html, opts) {
    ensureCss();
    opts = opts || {};
    closeModal();
    const ov = document.createElement("div");
    ov.id = "fxModal";
    ov.className = "fx-ov";
    ov.innerHTML =
      '<div class="fx-panel"><div class="fx-head"><b>' + esc(title) + '</b>' +
      '<button class="p5-btn-action secondary" data-x="1"><span>✕</span></button></div>' +
      '<div class="fx-body">' + html + '</div><div class="fx-foot"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", (ev) => {
      if (ev.target === ov) { ov.remove(); return; }
      const t = ev.target.closest ? ev.target.closest("[data-x],[data-act]") : null;
      if (!t) return;
      if (t.dataset.x) { ov.remove(); return; }
      const fn = opts.onAct && opts.onAct[t.dataset.act];
      if (fn) fn(t.dataset, t);
    });
    const foot = ov.querySelector(".fx-foot");
    (opts.buttons || []).forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "p5-btn-action" + (b.primary ? "" : " secondary");
      btn.innerHTML = "<span>" + esc(b.label) + "</span>";
      btn.addEventListener("click", () => {
        if (b.onClick) b.onClick();           // boleh membuka modal baru (yang lama otomatis diganti)
        if (ov.isConnected) ov.remove();
      });
      foot.appendChild(btn);
    });
    return ov;
  }
  const info = (msg) => modal("Info", "<div>" + msg + "</div>");

  function needSlot() {
    const l = slot();
    if (!l) { info("Open a slot first via <b>📁 GAME SAVES</b>. These tools work on the slot you are editing."); return null; }
    return l;
  }
  function noAccess(r) {
    if (r && r.error === "no_access") { info("Storage access is needed. Open <b>📁 GAME SAVES</b> and grant <b>All files access</b> first."); return true; }
    return false;
  }

  // ======================================================== TIME MACHINE
  let tmCache = [];

  function openTimeMachine() {
    const l = needSlot(); if (!l) return;
    const r = nat("listBackups", l.path);
    if (!r.ok) { if (!noAccess(r)) info("⚠ " + esc(r.error || "Could not list snapshots")); return; }
    tmCache = r.backups;
    const rows = r.backups.map((b) =>
      '<div class="fx-row"><span class="fx-grow"><b>' + esc(b.label || "Auto-backup") + '</b>' +
      '<div class="fx-sub">' + esc(fmtDate(b.modified)) + " · " + kb(b.size) + "</div></span>" +
      '<button class="p5-btn-action secondary" data-act="cmp" data-n="' + esc(b.name) + '"><span>⇄ COMPARE</span></button>' +
      '<button class="p5-btn-action secondary" data-act="more" data-n="' + esc(b.name) + '"><span>⋯</span></button></div>').join("");
    modal("Time Machine — " + l.rel,
      '<div class="fx-sub" style="margin-bottom:6px;">A snapshot is a named copy of the slot file <b>as it is on disk right now</b> (unsaved edits are not included). ' +
      "Every overwrite also creates an automatic backup.</div>" +
      (rows || '<div class="fx-sub">No snapshots or backups yet.</div>'),
      {
        buttons: [
          { label: "＋ NEW SNAPSHOT", primary: true, onClick: newSnapshot },
          { label: "COMPARE…", onClick: () => openComparePicker() },
        ],
        onAct: { cmp: (d) => openComparePicker(d.n), more: (d) => openBackupMenu(d.n) },
      });
  }

  function newSnapshot() {
    const l = needSlot(); if (!l) return;
    const label = window.prompt("Snapshot name (e.g. “before Palace 5”, “max all confidants”):", "");
    if (label === null) return;
    const r = nat("createSnapshot", l.path, label.trim());
    if (!r.ok) { if (!noAccess(r)) info("⚠ " + esc(r.error || "Could not create the snapshot")); return; }
    status("📸 Snapshot saved: " + (label.trim() || "Snapshot"));
    openTimeMachine();
  }

  function openBackupMenu(name) {
    const b = tmCache.find((x) => x.name === name);
    if (!b) { openTimeMachine(); return; }
    const l = slot();
    modal(b.label || "Auto-backup",
      '<div class="fx-sub" style="margin-bottom:8px;">' + esc(fmtDate(b.modified)) + " · " + kb(b.size) + "</div>" +
      '<button class="p5-btn-action fx-menu" data-act="rename"><span>✎ Rename / add note</span></button>' +
      '<button class="p5-btn-action fx-menu" data-act="restore"><span>♻ Restore this over ' + esc(l ? l.rel : "the slot") + "</span></button>" +
      '<button class="p5-btn-action fx-menu" data-act="del" style="border-color:#FF3333;color:#FF8888;"><span>🗑 Delete</span></button>',
      {
        buttons: [{ label: "BACK", onClick: openTimeMachine }],
        onAct: {
          rename: () => {
            const v = window.prompt("Name for this snapshot (blank = remove name):", b.label || "");
            if (v === null) return;
            const r = nat("setBackupLabel", name, v.trim());
            if (!r.ok) { info("⚠ " + esc(r.error || "Could not rename")); return; }
            openTimeMachine();
          },
          restore: () => restoreBackup(name, b),
          del: () => {
            if (!window.confirm("Delete this backup permanently?\n" + (b.label || fmtDate(b.modified)))) return;
            const r = nat("deleteBackup", name);
            if (!r.ok) { info("⚠ " + esc(r.error || "Could not delete")); return; }
            openTimeMachine();
          },
        },
      });
  }

  function restoreBackup(name, b) {
    const l = needSlot(); if (!l) return;
    if (safeMode) { info("🔒 Safe Mode is ON — nothing can be written. Turn it off in MORE ▸ Safe Mode first."); return; }
    if (!window.confirm("Restore “" + (b.label || fmtDate(b.modified)) + "” over " + l.rel + "?\nThe current file is backed up first. Unsaved edits are lost.")) return;
    const rb = nat("readBackup", name);
    if (!rb.ok) { info("⚠ " + esc(rb.error || "Could not read the backup")); return; }
    const w = jparse(guardedWrite(l.path, rb.data, { force: true }));
    if (!w.ok) { info("⚠ " + esc(w.error || "Could not restore")); return; }
    closeModal();
    status("✔ Restored " + l.rel + " from the backup. Reloading…");
    window.CohSaves.reload();
  }

  function openComparePicker(preA) {
    const l = needSlot(); if (!l) return;
    const r = nat("listBackups", l.path);
    if (!r.ok) { if (!noAccess(r)) info("⚠ " + esc(r.error || "Could not list snapshots")); return; }
    if (!r.backups.length) { info("No snapshots or backups to compare yet. Create one with <b>＋ NEW SNAPSHOT</b>."); return; }
    const opts = '<option value="slot">⚡ The slot now (file on disk)</option>' +
      r.backups.map((b) => '<option value="' + esc(b.name) + '">' + esc((b.label || "Auto-backup") + " — " + fmtDate(b.modified)) + "</option>").join("");
    const ov = modal("Compare",
      '<div class="fx-h">A (from)</div><select id="fxA" class="p5-select" style="width:100%;">' + opts + "</select>" +
      '<div class="fx-h">B (to)</div><select id="fxB" class="p5-select" style="width:100%;">' + opts + "</select>" +
      '<div class="fx-sub" style="margin-top:8px;">Shows what changed going from A to B, in the same format as the save summary.</div>',
      {
        buttons: [
          { label: "BACK", onClick: openTimeMachine },
          {
            label: "COMPARE", primary: true, onClick: () => {
              const a = $("fxA").value, b = $("fxB").value;
              if (a === b) { info("Pick two different versions."); return; }
              runCompare(a, b, r.backups);
            },
          },
        ],
      });
    $("fxA").value = preA || r.backups[0].name;
    $("fxB").value = "slot";
    return ov;
  }

  async function inspectSource(v) {
    const l = slot();
    const r = v === "slot" ? nat("readSave", l.path) : nat("readBackup", v); // N direkt: tidak menyentuh sidik jari
    if (!r.ok) throw new Error(r.error || "could not read the file");
    const res = await fetch("/api/inspect", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: r.data }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
  }

  function itemName(id) {
    const it = (G.db().items || []).find((x) => String(x.id) === String(id));
    return it ? it.name : "#" + id;
  }
  function invMap(p) {
    const n = (p && p.inventory_normalized) || {};
    const m = {};
    Object.entries(n.stacks || {}).forEach(([k, q]) => { m[k] = Number(q) || 0; });
    Object.entries(n.owned_gear || {}).forEach(([k, o]) => { m[k] = o ? 1 : 0; });
    return m;
  }

  function renderDiff(pa, pb) {
    const T = window.__cohTest;
    const rows = [];
    if (T && T.snapshot && T.diff) {
      const sa = T.snapshot(pa), sb = T.snapshot(pb);
      const out = [];
      T.diff(sa, sb, [], out);
      out.forEach((d) => rows.push({ k: T.label(d.path, sa), v: T.fmt(d.path, d.from) + " → " + T.fmt(d.path, d.to) }));
    }
    const ia = invMap(pa), ib = invMap(pb);
    new Set(Object.keys(ia).concat(Object.keys(ib))).forEach((id) => {
      const a = ia[id] || 0, b = ib[id] || 0;
      if (a !== b) rows.push({ k: "Item › " + itemName(id), v: a + " → " + b });
    });
    const ca = new Set((pa.compendium && pa.compendium.registered) || []);
    const cb = new Set((pb.compendium && pb.compendium.registered) || []);
    const pname = (id) => (G.db().persona_names || {})[id] || "#" + id;
    const added = [...cb].filter((x) => !ca.has(x)), removed = [...ca].filter((x) => !cb.has(x));
    if (added.length) rows.push({ k: "Compendium › registered +" + added.length, v: added.slice(0, 12).map(pname).join(", ") + (added.length > 12 ? "…" : "") });
    if (removed.length) rows.push({ k: "Compendium › unregistered −" + removed.length, v: removed.slice(0, 12).map(pname).join(", ") + (removed.length > 12 ? "…" : "") });
    return rows;
  }

  async function runCompare(a, b, backups) {
    const title = (v) => (v === "slot" ? "The slot now" : ((backups.find((x) => x.name === v) || {}).label || "Auto-backup"));
    try {
      status("Comparing…");
      const pa = await inspectSource(a);
      const pb = await inspectSource(b);
      const rows = renderDiff(pa, pb);
      const shown = rows.slice(0, 120);
      const html = '<div class="fx-sub" style="margin-bottom:6px;">' + esc(title(a)) + " → " + esc(title(b)) + "</div>" +
        (shown.map((r) => '<div class="fx-diff"><span class="k">' + esc(r.k) + '</span><span class="v">' + esc(r.v) + "</span></div>").join("") ||
          '<div class="fx-note">No differences found.</div>') +
        (rows.length > shown.length ? '<div class="fx-sub" style="padding-top:6px;">…and ' + (rows.length - shown.length) + " more</div>" : "");
      modal(rows.length + " difference" + (rows.length === 1 ? "" : "s"), html, {
        buttons: [{ label: "BACK", onClick: () => openComparePicker(a === "slot" ? undefined : a) }],
      });
      status("Compared " + title(a) + " → " + title(b));
    } catch (e) {
      info("⚠ " + esc(e && e.message ? e.message : e));
    }
  }

  // ========================================================= QUICK BOOSTS
  const SOCIAL = ["Knowledge", "Charm", "Proficiency", "Kindness", "Guts"];
  const rankOf = (v) => (v && typeof v === "object" ? (v.rank | 0) : (v | 0));
  const safeCall = (fn) => { try { if (typeof fn === "function") fn(); } catch (e) { console.warn("boost refresh:", e); } };

  function planSocial(S) {
    const ch = [];
    SOCIAL.forEach((s) => {
      const v = (S.social_stats || {})[s];
      if (v === undefined) return;
      const cur = rankOf(v);
      if (cur >= 5) return;
      ch.push({
        label: "Social › " + s, from: "Rank " + cur, to: "Rank 5",
        apply() {
          if (!v || typeof v !== "object") S.social_stats[s] = { rank: 5 };
          else S.social_stats[s].rank = 5;
        },
      });
    });
    return { changes: ch, after: () => safeCall(window.renderSocialStats) };
  }

  function planConfidants(S) {
    const db = G.db();
    const locked = new Set(db.story_locked_confidants || []);
    const prof = db.confidant_profiles || {};
    const ch = [], skipped = [];
    Object.entries(S.confidants || {}).forEach(([arc, c]) => {
      if (!c || !(c.rank > 0) || c.rank >= 10) return;
      const type = (prof[arc] || {}).type || "";
      const nm = (prof[arc] || {}).name || arc;
      if (locked.has(arc) || /deadline/.test(type)) { skipped.push(nm); return; }
      ch.push({ label: "Confidant › " + nm + " (" + arc + ")", from: "RK " + c.rank, to: "RK 10", apply() { c.rank = 10; } });
    });
    return {
      changes: ch,
      note: skipped.length ? "Skipped on purpose (story-locked or with a calendar deadline): " + skipped.join(", ") + ". Edit those by hand in the Confidants tab." : "",
      after: () => safeCall(window.renderConfidants),
    };
  }

  function planConsumables(allOwned) {
    return function () {
      const counts = G.inv();
      const ch = [];
      (G.db().items || []).forEach((it) => {
        if (it.category !== "Consumable") return;
        const q = counts[it.id] || counts[String(it.id)] || 0;
        if (q >= 99 || (!allOwned && q <= 0)) return;
        ch.push({
          label: "Item › " + it.name, from: String(q), to: "99",
          apply() { counts[it.id] = 99; safeCall(() => window._markDirty && window._markDirty(it.id)); },
        });
      });
      return { changes: ch, after: () => safeCall(window.renderUnifiedItemList) };
    };
  }

  function planMoney(S) {
    const cur = (S.header && S.header.money) || 0;
    const ch = cur >= 9999999 ? [] : [{
      label: "Money", from: "¥" + cur.toLocaleString(), to: "¥9,999,999",
      apply() { if (typeof window.setMaxYen === "function") window.setMaxYen(); else S.header.money = 9999999; },
    }];
    return { changes: ch };
  }

  const BOOSTS = [
    { icon: "★", title: "Max all Social Stats", desc: "Raise the 5 social stats to Rank 5.", plan: planSocial },
    { icon: "♥", title: "Raise all met Confidants to 10", desc: "Only confidants you already met (rank 1+). Story-locked / deadline ones are skipped.", plan: planConfidants },
    { icon: "🧪", title: "Owned consumables → 99", desc: "Every consumable already in your bag, filled to 99.", plan: planConsumables(false) },
    { icon: "📦", title: "ALL consumables → 99", desc: "Every consumable in the catalog, 99 each (bigger change).", plan: planConsumables(true) },
    { icon: "¥", title: "Yen to max", desc: "Set money to ¥9,999,999.", plan: planMoney },
  ];

  function openBoosts() {
    const S = G.save();
    if (!S) { info("Load a save first."); return; }
    const rows = BOOSTS.map((b, i) =>
      '<button class="p5-btn-action fx-menu" data-act="boost" data-i="' + i + '"><span>' + b.icon + " " + esc(b.title) +
      '</span><div class="fx-sub" style="font-weight:400;">' + esc(b.desc) + "</div></button>").join("");
    modal("Quick Boosts",
      (safeMode ? '<div class="fx-note">🔒 Safe Mode is ON — boosts are preview-only.</div>' : "") +
      '<div class="fx-sub" style="margin-bottom:8px;">Pick a boost to <b>preview</b> exactly what it changes. Nothing is written to the save file until you press SAVE and confirm the change summary.</div>' + rows,
      { onAct: { boost: (d) => previewBoost(parseInt(d.i, 10)) } });
  }

  function previewBoost(i) {
    const S = G.save(); const b = BOOSTS[i];
    if (!S || !b) return;
    const plan = b.plan(S);
    if (!plan.changes.length) {
      modal(b.title, '<div class="fx-note">Nothing to change — everything is already at the target.</div>' + (plan.note ? '<div class="fx-sub">' + esc(plan.note) + "</div>" : ""),
        { buttons: [{ label: "BACK", onClick: openBoosts }] });
      return;
    }
    const shown = plan.changes.slice(0, 60);
    const html =
      '<div class="fx-sub" style="margin-bottom:6px;">' + plan.changes.length + " change" + (plan.changes.length > 1 ? "s" : "") + " — applied to the editor only; written when you press SAVE.</div>" +
      shown.map((c) => '<div class="fx-diff"><span class="k">' + esc(c.label) + '</span><span class="v">' + esc(c.from) + " → " + esc(c.to) + "</span></div>").join("") +
      (plan.changes.length > shown.length ? '<div class="fx-sub" style="padding-top:6px;">…and ' + (plan.changes.length - shown.length) + " more</div>" : "") +
      (plan.note ? '<div class="fx-note">' + esc(plan.note) + "</div>" : "") +
      (safeMode ? '<div class="fx-note">🔒 Safe Mode is ON — cannot apply.</div>' : "");
    modal(b.title, html, {
      buttons: [
        { label: "BACK", onClick: openBoosts },
        {
          label: "APPLY TO EDITOR", primary: true, onClick: () => {
            if (safeMode) { info("🔒 Safe Mode is ON — turn it off in MORE ▸ Safe Mode to apply boosts."); return; }
            plan.changes.forEach((c) => { try { c.apply(); } catch (e) { console.warn("boost:", e); } });
            if (plan.after) plan.after();
            status("⚡ " + b.title + ": " + plan.changes.length + " change(s) applied in the editor. Press SAVE to review the summary and write them.");
          },
        },
      ],
    });
  }

  // ======================================================== BACKUP SEMUA SLOT
  function backupAll() {
    const r = nat("backupAllSlots", N.getSaveRoot());
    if (!r.ok) { if (!noAccess(r)) info("⚠ " + esc(r.error || "Could not create the ZIP")); return; }
    info("✔ Backed up <b>" + r.files + "</b> slot file(s) to<br><b>Download/ChangeOfHeart/" + esc(r.name) + "</b><br><br>" +
      "Open it in the Files app and share it to Google Drive.");
    status("📦 All slots saved to Download/ChangeOfHeart/" + r.name);
  }

  // ================================================== SHARE / IMPORT PRESET
  const b64e = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((x) => { bin += String.fromCharCode(x); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const b64d = (s) => {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };
  const readPresets = () => { const a = pref.get("presets", []); return Array.isArray(a) ? a : []; };

  function presetText(p) {
    const db = G.db();
    const sk = (id) => { const s = (db.skills || []).find((x) => x.id === id); return s ? s.name : "#" + id; };
    const tr = (db.traits || []).find((x) => x.id === p.trait);
    const code = b64e(JSON.stringify({ v: 1, n: p.name, f: p.from || "", l: p.level, t: p.trait, s: p.stats, k: p.skills }));
    return "🎭 Persona 5 Royal build — " + p.name + "\n" +
      (p.from ? "Persona: " + p.from + " · " : "") + "LV " + p.level + "\n" +
      "Trait: " + (tr ? tr.name : p.trait ? "#" + p.trait : "none") + "\n" +
      "St/Ma/En/Ag/Lu: " + p.stats.join("/") + "\n" +
      "Skills: " + p.skills.filter(Boolean).map(sk).join(", ") + "\n\n" +
      "Import: Change of Heart ▸ MORE ▸ Presets ▸ Import\n" +
      "COHP1:" + code;
  }

  function parsePresetText(text) {
    const m = /COHP1:([A-Za-z0-9_-]+)/.exec(text || "");
    if (!m) throw new Error("No preset code (COHP1:…) found in that text.");
    let o;
    try { o = JSON.parse(b64d(m[1])); } catch (e) { throw new Error("The preset code is damaged."); }
    const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    if (!o || o.v !== 1) throw new Error("Unsupported preset version.");
    if (typeof o.n !== "string" || !o.n.trim() || o.n.length > 60) throw new Error("Invalid preset name.");
    if (!int(o.l, 1, 99) || !int(o.t, 0, 999)) throw new Error("Invalid level or trait.");
    if (!Array.isArray(o.s) || o.s.length !== 5 || !o.s.every((x) => int(x, 0, 99))) throw new Error("Invalid stats.");
    if (!Array.isArray(o.k) || o.k.length !== 8 || !o.k.every((x) => int(x, 0, 2000))) throw new Error("Invalid skills.");
    const known = new Set((G.db().skills || []).map((x) => x.id));
    const bad = o.k.filter((x) => x && !known.has(x));
    if (bad.length) throw new Error(bad.length + " skill(s) in this preset do not exist in this editor — refusing to import.");
    if (o.t && !(G.db().traits || []).some((x) => x.id === o.t)) throw new Error("The trait in this preset does not exist in this editor.");
    return { name: o.n.trim(), from: String(o.f || "").slice(0, 60), saved: Date.now(), level: o.l, trait: o.t, stats: o.s, skills: o.k };
  }

  function openPresetShare() {
    const list = readPresets();
    const rows = list.map((p, i) =>
      '<div class="fx-row"><span class="fx-grow"><b>' + esc(p.name) + '</b><div class="fx-sub">LV ' + p.level + " · " + esc(p.from || "") + "</div></span>" +
      '<button class="p5-btn-action" data-act="share" data-i="' + i + '"><span>SHARE</span></button>' +
      '<button class="p5-btn-action secondary" data-act="copy" data-i="' + i + '"><span>COPY</span></button></div>').join("");
    modal("Share / import presets",
      (rows || '<div class="fx-sub">No presets yet. Save one first: TOOLS ▸ Persona presets ▸ SAVE CURRENT BUILD.</div>') +
      '<div class="fx-sub" style="margin-top:8px;">SHARE opens the Android share sheet with the build as plain text, so a friend can paste it into IMPORT.</div>',
      {
        buttons: [{ label: "IMPORT…", primary: true, onClick: openPresetImport }],
        onAct: {
          share: (d) => {
            const p = readPresets()[parseInt(d.i, 10)]; if (!p) return;
            const r = N.shareText("Persona build: " + p.name, presetText(p));
            if (r !== "ok") info("⚠ " + esc(r));
          },
          copy: (d) => {
            const p = readPresets()[parseInt(d.i, 10)]; if (!p) return;
            status(N.copyText(presetText(p)) === "ok" ? "📋 Preset copied to the clipboard." : "⚠ Could not copy.");
          },
        },
      });
  }

  function openPresetImport() {
    modal("Import preset",
      '<div class="fx-sub" style="margin-bottom:6px;">Paste the whole message you received (the line starting with COHP1: is what matters).</div>' +
      '<textarea id="fxImp" class="p5-input" style="width:100%;min-height:120px;" placeholder="COHP1:…"></textarea>' +
      '<button class="p5-btn-action secondary fx-menu" data-act="paste" style="margin-top:6px;"><span>📋 Paste from clipboard</span></button>',
      {
        buttons: [
          { label: "BACK", onClick: openPresetShare },
          {
            label: "IMPORT", primary: true, onClick: () => {
              try {
                const p = parsePresetText(($("fxImp") || {}).value);
                const list = readPresets();
                list.push(p);
                pref.set("presets", list.slice(-30));
                status("✔ Imported preset “" + p.name + "”. Apply it from TOOLS ▸ Persona presets.");
                setTimeout(() => info("✔ Imported <b>" + esc(p.name) + "</b>.<br>Apply it from <b>TOOLS ▸ Persona presets</b> while a persona is open in the Velvet Room tab."), 0);
              } catch (e) {
                const msg = e && e.message ? e.message : String(e);
                setTimeout(() => info("⚠ " + esc(msg)), 0);
              }
            },
          },
        ],
        onAct: { paste: () => { const t = N.getClipboardText(); if (t && $("fxImp")) $("fxImp").value = t; else status("Clipboard is empty."); } },
      });
  }

  // ======================================================== CATATAN PER SLOT
  const slotKey = () => { const l = slot(); return l ? l.rel : (G.path() || ""); };

  function openNotes() {
    const key = slotKey();
    if (!key || !G.save()) { info("Open a slot first."); return; }
    const all = pref.get("slot_notes", {});
    const list = Array.isArray(all[key]) ? all[key] : [];
    const persist = () => { all[key] = list; pref.set("slot_notes", all); };
    const rows = list.map((n, i) =>
      '<div class="fx-row"><label class="fx-grow" style="display:flex;gap:8px;align-items:center;">' +
      '<input type="checkbox" data-act="tick" data-i="' + i + '"' + (n.d ? " checked" : "") + ">" +
      '<span style="' + (n.d ? "text-decoration:line-through;opacity:.6;" : "") + '">' + esc(n.t) + "</span></label>" +
      '<button class="p5-btn-action secondary" data-act="rm" data-i="' + i + '"><span>✕</span></button></div>').join("");
    modal("Notes — " + key,
      (rows || '<div class="fx-sub">No notes yet.</div>') +
      '<div class="fx-h">Add</div><div style="display:flex;gap:6px;">' +
      '<input id="fxNoteIn" class="p5-input" style="flex:1;min-width:0;" maxlength="200" placeholder="e.g. confidant X not met yet / need persona Y">' +
      '<button class="p5-btn-action" data-act="add"><span>＋</span></button></div>',
      {
        onAct: {
          tick: (d, el) => {
            const n = list[parseInt(d.i, 10)]; if (!n) return;
            n.d = !!el.checked; persist();
            const sp = el.parentNode.querySelector("span");
            if (sp) sp.style.cssText = n.d ? "text-decoration:line-through;opacity:.6;" : "";
          },
          rm: (d) => { list.splice(parseInt(d.i, 10), 1); persist(); openNotes(); },
          add: () => {
            const v = (($("fxNoteIn") || {}).value || "").trim();
            if (!v) return;
            if (list.length >= 50) { status("Notes are full (50 per slot)."); return; }
            list.push({ t: v.slice(0, 200), d: false }); persist(); openNotes();
          },
        },
      });
  }

  // ============================================================== MODE AMAN
  function updateSafePill() {
    let p = $("fxSafePill");
    if (!safeMode) { if (p) p.remove(); return; }
    if (!p) {
      p = document.createElement("div");
      p.id = "fxSafePill";
      p.textContent = "🔒 SAFE MODE — read only";
      p.title = "Tap to turn off";
      p.addEventListener("click", toggleSafe);
      document.body.appendChild(p);
    }
  }
  function toggleSafe() {
    if (safeMode) {
      if (!window.confirm("Turn Safe Mode off? Saving will be possible again.")) return;
      safeMode = false;
    } else {
      safeMode = true;
    }
    pref.set("safe_mode", safeMode);
    updateSafePill();
    status(safeMode ? "🔒 Safe Mode ON — you can look at progress, nothing can be written." : "🔓 Safe Mode OFF.");
  }
  function blockedSave() {
    status("🔒 Safe Mode is ON — saving is disabled.");
    window.alert("🔒 Safe Mode is ON.\nThis save is open read-only, so nothing was written.\n\nTurn it off in MORE ▸ Safe Mode to save.");
  }
  function wrapGlobal(name) {
    const orig = window[name];
    if (typeof orig !== "function" || orig.__fx) return;
    const w = function () { if (safeMode) { blockedSave(); return; } return orig.apply(this, arguments); };
    w.__fx = true;
    window[name] = w;
  }

  // ===================================================== MENU "MORE" + tombol
  function openMore() {
    modal("More",
      '<button class="p5-btn-action fx-menu" data-act="all"><span>📦 Backup all slots (one ZIP)</span></button>' +
      '<button class="p5-btn-action fx-menu" data-act="share"><span>🔗 Share / import presets</span></button>' +
      '<button class="p5-btn-action fx-menu" data-act="notes"><span>📝 Slot notes</span></button>' +
      '<button class="p5-btn-action fx-menu" data-act="safe"><span>' + (safeMode ? "🔓 Turn Safe Mode off" : "🔒 Safe Mode (read only)") + "</span></button>",
      {
        onAct: {
          all: backupAll, share: openPresetShare, notes: openNotes,
          safe: () => { closeModal(); toggleSafe(); },
        },
      });
  }

  function addButtons() {
    const box = document.querySelector(".save-selector-box");
    if (!box || $("tmBtn")) return;
    const mk = (id, label, fn) => {
      const b = document.createElement("button");
      b.id = id; b.className = "p5-btn-action secondary"; b.innerHTML = "<span>" + label + "</span>";
      b.addEventListener("click", fn);
      return b;
    };
    const btns = [
      mk("tmBtn", "⏱ SNAPSHOTS", openTimeMachine),
      mk("qbBtn", "⚡ BOOSTS", openBoosts),
      mk("moreBtn", "⋯ MORE", openMore),
    ];
    let anchor = $("toolsBtn") || $("gameSavesBtn");
    if (anchor && anchor.parentNode === box) {
      btns.forEach((b) => { anchor.insertAdjacentElement("afterend", b); anchor = b; });
    } else {
      btns.reverse().forEach((b) => box.insertBefore(b, box.firstChild));
    }
  }

  // ============================================================== CONTINUE
  function initContinue() {
    if ($("fxContinue")) return;
    const anchor = $("quickSearchBar") || document.querySelector(".p5-top-strip");
    if (!anchor) return;
    const b = document.createElement("button");
    b.id = "fxContinue"; b.className = "p5-btn-action"; b.style.display = "none";
    anchor.insertAdjacentElement("afterend", b);
    const last = () => { try { const o = JSON.parse(N.getPref("last_save") || "null"); return o && o.path ? o : null; } catch (e) { return null; } };
    const refresh = () => {
      const l = last();
      b.style.display = l && !G.save() ? "block" : "none";
      if (l) b.innerHTML = "<span>▶ CONTINUE — " + esc(l.rel || l.name || "last slot") + "</span>";
    };
    b.addEventListener("click", () => {
      const l = last(); if (!l) return;
      if (!N.hasStorageAccess() || !nat("fileInfo", l.path).ok) { window.CohSaves.openSheet(); return; }
      window.CohSaves.loadFile(l);
    });
    refresh();
    setInterval(refresh, 1000);
  }

  // ================================================== RIWAYAT PENCARIAN
  function initSearchHistory() {
    const bar = $("quickSearchBar"), input = $("quickSearchInput"), box = $("quickSearchResults");
    if (!bar || !input || !box || bar.dataset.fx) return;
    bar.dataset.fx = "1";
    const hist = () => { const h = pref.get("search_history", []); return Array.isArray(h) ? h.filter((x) => typeof x === "string") : []; };
    const remember = (q) => {
      q = (q || "").trim();
      if (q.length < 2) return;
      const h = hist().filter((x) => x.toLowerCase() !== q.toLowerCase());
      h.unshift(q.slice(0, 60));
      pref.set("search_history", h.slice(0, 8));
    };
    // fase capture di elemen induk: berjalan SEBELUM handler android.js yang mengosongkan kotak.
    bar.addEventListener("click", (ev) => { if (ev.target.closest && ev.target.closest(".qs-row")) remember(input.value); }, true);
    bar.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target === input) remember(input.value); }, true);

    function showHist() {
      if (input.value.trim()) return;
      const h = hist();
      if (!h.length) return;
      ensureCss();
      box.innerHTML = '<div class="qs-empty">Recent searches</div>' +
        h.map((q) => '<div class="fx-hist" data-q="' + esc(q) + '">🕘 <span>' + esc(q) + "</span></div>").join("") +
        '<div class="fx-hist" data-clear="1" style="color:#8E8E9F;">✕ Clear history</div>';
      box.hidden = false;
    }
    input.addEventListener("focus", showHist);
    input.addEventListener("input", () => {
      if (!input.value.trim()) setTimeout(() => { if (document.activeElement === input) showHist(); }, 220);
    });
    box.addEventListener("click", (ev) => {
      const row = ev.target.closest ? ev.target.closest(".fx-hist") : null;
      if (!row) return;
      if (row.dataset.clear) { pref.set("search_history", []); box.hidden = true; return; }
      input.value = row.dataset.q || "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
  }

  // =================================================== INFO SKILL (8 slot)
  const EL = { 0: "Phys", 1: "Gun", 2: "Fire", 3: "Ice", 4: "Elec", 5: "Wind", 6: "Psy", 7: "Nuke", 8: "Bless", 9: "Curse", 10: "Almighty" };
  let skillInfoExtra = {}; // opsional: data/SkillInfo.json => { "<skill id>": { "desc": "...", "target": "..." } }

  function skillLine(id) {
    const db = G.db();
    const sk = (db.skills || []).find((x) => x.id === id);
    const meta = (db.skill_meta || {})[id];
    const bits = [];
    if (meta) {
      const el = EL[meta.element] || (meta.element === 255 ? "" : "E" + meta.element);
      if (el) bits.push(el);
      if (meta.cost > 0) bits.push(meta.costtype === 1 ? meta.cost + "% HP" : meta.costtype === 2 ? meta.cost + " SP" : "");
      if (meta.passive === 1) bits.push("Passive");
    }
    const extra = skillInfoExtra[String(id)] || {};
    if (extra.target) bits.push(extra.target);
    return { name: sk ? sk.name : "#" + id, tag: bits.filter(Boolean).join(" · "), desc: extra.desc || "" };
  }

  function renderSkillInfo() {
    const grid = $("skillsGrid");
    const panel = $("fxSkillInfo");
    if (!grid || !panel) return;
    let html = '<div class="fx-h" style="margin-top:0;">Skill info</div>';
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const el = $("skillSlot_" + i);
      const id = el ? parseInt(el.value, 10) || 0 : 0;
      if (!id) continue;
      const s = skillLine(id);
      n++;
      html += '<div class="fx-sk"><b>' + (i + 1) + ". " + esc(s.name) + "</b> <i>" + esc(s.tag || "no data") + "</i>" +
        (s.desc ? '<span class="fx-sd">' + esc(s.desc) + "</span>" : "") + "</div>";
    }
    panel.innerHTML = n ? html : '<div class="fx-sub">No skills equipped.</div>';
  }

  function initSkillInfo() {
    const grid = $("skillsGrid");
    if (!grid || $("fxSkillInfo")) return;
    ensureCss();
    const panel = document.createElement("div");
    panel.id = "fxSkillInfo";
    panel.className = "fx-skinfo";
    grid.insertAdjacentElement("afterend", panel);
    grid.addEventListener("change", () => setTimeout(renderSkillInfo, 0));
    new MutationObserver(() => setTimeout(renderSkillInfo, 0)).observe(grid, { childList: true });
    renderSkillInfo();
    fetch("/api/skill-info").then((r) => r.json()).then((j) => {
      if (j && typeof j === "object") { skillInfoExtra = j; renderSkillInfo(); }
    }).catch(() => { /* file opsional */ });
  }

  // ================================================================= INIT
  function init() {
    ensureCss();
    wrapGlobal("saveActiveSaveFile");
    wrapGlobal("executeSavePayload");
    addButtons();
    initContinue();
    initSearchHistory();
    initSkillInfo();
    updateSafePill();
    window.CohGuardian = { write: guardedWrite, check: checkExternal, safeMode: () => safeMode };
  }

  const start = () => setTimeout(init, 60); // setelah init android.js & app.js
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
