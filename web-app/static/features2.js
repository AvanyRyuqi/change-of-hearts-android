/* =========================================================================
   features2.js — tambahan tahap 2 (dimuat setelah features.js):
   - Mode hemat baterai AMOLED (hitam pekat)
   - Pencarian persona (dropdown Velvet Room)
   - Perbaikan: persona rekan tim (ID) tidak muncul di dropdown
   - Perbaikan: Gun Boost / Gun Amp "tidak ada" (di data game namanya Snipe / Cripple)
   - Info efek trait di bawah pilihan trait (data/TraitInfo.json)
   - Rekomendasi skill per tipe build (pratinjau dulu, baru diterapkan)
   - Alat "Raw byte diff": mencari offset yang belum dipetakan (Baton Pass, Technical rank, ...)
   Di desktop/browser (tanpa AndroidBridge) tidak melakukan apa-apa.
   ========================================================================= */
(function () {
  "use strict";

  const N = window.AndroidBridge;
  if (!N) return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const jparse = (s) => { try { return JSON.parse(s); } catch (e) { return { ok: false, error: String(e) }; } };
  const nat = (fn, ...a) => { try { return jparse(N[fn](...a)); } catch (e) { return { ok: false, error: String(e) }; } };
  const status = (m) => { if (typeof setStatus === "function") setStatus(m); };
  const fmtDate = (ms) => new Date(ms).toLocaleString();
  const db = () => { try { return DB || {}; } catch (e) { return {}; } };
  const slot = () => (window.CohSaves ? window.CohSaves.getLinked() : null);
  const pref = {
    get(k, d) { try { const v = N.getPref(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { N.setPref(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
  };

  // ------------------------------------------------------------------ CSS
  const CSS = `
  html.coh-amoled{--p5-black:#000;--p5-surface:#000;--p5-surface-alt:#000}
  html.coh-amoled body{background:#000!important;background-image:none!important}
  html.coh-amoled .p5-sidebar,html.coh-amoled .p5-top-strip,html.coh-amoled .p5-save-deck,
  html.coh-amoled #quickSearchBar,html.coh-amoled .p5-card,html.coh-amoled .p5-hero-spotlight,
  html.coh-amoled .p5-tarot-card,html.coh-amoled .dossier-panel,html.coh-amoled .thief-placard,
  html.coh-amoled .character-stage-card,html.coh-amoled .character-stats-overlay,
  html.coh-amoled .p5-modal-content,html.coh-amoled .fx-panel,html.coh-amoled .cm-panel,
  html.coh-amoled #gsPanel,html.coh-amoled #quickSearchResults,html.coh-amoled .fx-skinfo
  {background:#000!important;background-image:none!important}
  html.coh-amoled .p5-sidebar::before{display:none}
  html.coh-amoled .p5-select,html.coh-amoled .p5-input,html.coh-amoled #quickSearchInput{background:#000!important}
  html.coh-amoled .p5-btn-action.secondary,html.coh-amoled .filter-pill,html.coh-amoled .star-node,
  html.coh-amoled .elem-badge{background:#0a0a0a!important}
  html.coh-amoled .p5-nav-item:not(.active){background:#0a0a0a!important}
  html.coh-amoled .p5-modal-content{transform:none!important}
  html.coh-amoled *,html.coh-amoled *::before,html.coh-amoled *::after{animation:none!important;transition:none!important;backdrop-filter:none!important}
  .fx2-chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
  .fx2-chip{padding:2px 7px;font-size:10px;color:#fff;background:#16161f;border:1px solid #333}
  .fx2-chip.miss{color:#8E8E9F;text-decoration:line-through}
  .fx2-info{margin-top:4px;padding:5px 8px;font-size:11px;line-height:1.35;color:#cfcfe0;background:rgba(0,0,0,.4);border-left:3px solid var(--p5-cyan,#00C4FE)}
  .fx2-pid{margin-top:3px;font-size:10px;color:var(--p5-muted,#8E8E9F)}
  `;
  function ensureCss() {
    if ($("cohFeat2Css")) return;
    const st = document.createElement("style");
    st.id = "cohFeat2Css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- modal
  function closeModal() { const m = $("fx2Modal"); if (m) m.remove(); }
  function modal(title, html, opts) {
    ensureCss();
    opts = opts || {};
    closeModal();
    const ov = document.createElement("div");
    ov.id = "fx2Modal";
    ov.className = "fx-ov"; // gaya dari features.js
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
      btn.addEventListener("click", () => { if (b.onClick) b.onClick(); if (ov.isConnected) ov.remove(); });
      foot.appendChild(btn);
    });
    return ov;
  }
  const info = (msg) => modal("Info", "<div>" + msg + "</div>");

  // ----------------------------------------------------------- AMOLED mode
  let amoled = !!pref.get("amoled", false);
  function applyAmoled() {
    ensureCss();
    document.documentElement.classList.toggle("coh-amoled", amoled);
    try {
      let m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
      m.content = amoled ? "#000000" : "#060608";
    } catch (e) { /* abaikan */ }
  }
  function toggleAmoled() {
    amoled = !amoled;
    pref.set("amoled", amoled);
    applyAmoled();
    status(amoled ? "🌑 AMOLED battery-saver ON (pure black, no animations/blur)." : "🌑 AMOLED battery-saver OFF.");
  }

  // ------------------------------------------- data fixes (DB is loaded async)
  // Gun Boost / Gun Amp exist in the game's skill table as "Snipe" / "Cripple"
  // (JP: 銃撃ブースター / 銃撃ハイブースター), ids 953 / 954 — they were just hard to find by name.
  const SKILL_ALIASES = { 953: "Snipe (Gun Boost)", 954: "Cripple (Gun Amp)" };
  function patchSkillNames() {
    const skills = db().skills;
    if (!Array.isArray(skills) || !skills.length) return false;
    skills.forEach((s) => {
      const a = SKILL_ALIASES[s.id];
      if (a && s.name !== a && !/\(Gun /.test(s.name)) s.name = a;
    });
    return true;
  }

  // Teammate personas (Captain Kidd, Carmen, ...) share their name with a normal persona of a lower id, so the
  // dropdown's de-duplication by name drops their real ids and the select went blank. Re-add them.
  const TEAM_PERSONA_IDS = [0xCA, 0xD4, 0xF2, 0xCB, 0xD5, 0xF3, 0xCC, 0xE9, 0xF4, 0xCD, 0xEA, 0xF5, 0xCE, 0xEB, 0xF6,
    0xCF, 0xEC, 0xF7, 0xD0, 0xED, 0xF8, 0xD1, 0xD2, 0xF9, 0xF0, 0xF1, 0xFA];
  let allPersonaOpts = null;     // [{v, t}] full list for the search box
  let personaObserver = null;

  function ensureTeamOptions(sel) {
    const names = db().persona_names || {};
    const have = new Set(Array.from(sel.options).map((o) => o.value));
    TEAM_PERSONA_IDS.forEach((pid) => {
      if (have.has(String(pid))) return;
      const nm = names[pid];
      if (!nm) return;
      const o = document.createElement("option");
      o.value = String(pid);
      o.textContent = nm + " (ID: " + pid + ")";
      sel.appendChild(o);
    });
  }
  function snapshotPersonaOpts(sel) {
    allPersonaOpts = Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent }));
  }

  // ------------------------------------------------------- persona search box
  function initPersonaSearch() {
    const sel = $("personaSelect");
    if (!sel || $("fxPersonaSearch")) return;
    ensureCss();
    ensureTeamOptions(sel);
    snapshotPersonaOpts(sel);

    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
    wrap.innerHTML =
      '<input id="fxPersonaSearch" type="search" class="p5-input" placeholder="Search persona (name or ID, e.g. Satanael, 363, 0x16B)…" ' +
      'autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" style="flex:1;min-width:0;font-size:13px;padding:6px 10px;">' +
      '<span id="fxPersonaCount" style="font-size:10px;color:var(--p5-muted,#8E8E9F);white-space:nowrap;"></span>';
    sel.parentNode.insertBefore(wrap, sel);
    const idLine = document.createElement("div");
    idLine.id = "fxPersonaId";
    idLine.className = "fx2-pid";
    sel.insertAdjacentElement("afterend", idLine);

    const input = $("fxPersonaSearch"), count = $("fxPersonaCount");
    function apply() {
      const q = input.value.trim().toLowerCase();
      const hex = /^0x[0-9a-f]+$/.test(q) ? String(parseInt(q, 16)) : null;
      const cur = sel.value;
      const keep = allPersonaOpts.filter((o) => o.v === cur || o.v === "0" || !q || o.t.toLowerCase().includes(q) || o.v === q || o.v === hex);
      const frag = document.createDocumentFragment();
      keep.forEach((o) => { const e = document.createElement("option"); e.value = o.v; e.textContent = o.t; frag.appendChild(e); });
      sel.innerHTML = "";
      sel.appendChild(frag);
      sel.value = cur;
      if (personaObserver) personaObserver.takeRecords(); // our own rebuild must not retrigger the observer
      count.textContent = q ? (keep.length - 1) + " / " + (allPersonaOpts.length - 1) : "";
    }
    let t = null;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 100); });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { input.value = ""; apply(); } });

    // The app rebuilds the dropdown when the reference DB loads: re-add team ids and refresh the master list.
    personaObserver = new MutationObserver(() => {
      if (input.value.trim()) return; // filtered view is ours
      ensureTeamOptions(sel);
      snapshotPersonaOpts(sel);
      personaObserver.takeRecords();
    });
    personaObserver.observe(sel, { childList: true });

    // Always show which persona (and ID) is selected, also for teammates whose dropdown is locked.
    setInterval(() => {
      const pid = parseInt(sel.value, 10) || 0;
      if (!pid) { idLine.textContent = ""; return; }
      const nm = (db().persona_names || {})[pid] || "";
      idLine.textContent = "ID: 0x" + pid.toString(16).toUpperCase().padStart(3, "0") + " (" + pid + ")" + (nm ? " — " + nm : "");
    }, 600);
  }

  // ---------------------------------------------------------- trait info line
  let traitInfo = {};
  function initTraitInfo() {
    const sel = $("personaTraitSelect");
    if (!sel || $("fxTraitInfo")) return;
    ensureCss();
    const div = document.createElement("div");
    div.id = "fxTraitInfo";
    div.className = "fx2-info";
    div.style.display = "none";
    sel.insertAdjacentElement("afterend", div);
    const render = () => {
      const id = String(parseInt(sel.value, 10) || 0);
      const d = traitInfo[id];
      if (!d) {
        div.style.display = id === "0" ? "none" : "block";
        if (id !== "0") div.textContent = "No description for this trait yet (add it to data/TraitInfo.json).";
        return;
      }
      div.style.display = "block";
      div.textContent = d;
    };
    sel.addEventListener("change", render);
    setInterval(render, 700);
    fetch("/api/trait-info").then((r) => r.json()).then((j) => { if (j && typeof j === "object") { traitInfo = j; render(); } }).catch(() => {});
  }

  // ----------------------------------------------- recommendations per build
  const MAGIC_EXTRAS = ["Concentrate", "Magic Ability", "Spell Master", "SP Cost Down 25%"];
  const magic = (el, a, b, boost, amp) => ({ id: el, title: el + " mage", desc: "Two top " + el + " attacks, both boosts and SP support.", skills: [a, b, boost, amp].concat(MAGIC_EXTRAS), kind: "magic" });
  const BUILDS = [
    { id: "phys", kind: "phys", title: "Physical attacker", desc: "Big single/mass physical hits with attack buffs.", skills: ["Myriad Slashes", "Gigantomachia", "Vorpal Blade", "Heat Riser", "Charge", "Arms Master", "Attack Master", "Matarukaja"] },
    { id: "gun", kind: "phys", title: "Gun attacker", desc: "Gun skills plus gun boosts.", skills: ["Riot Gun", "One-shot Kill", "Triple Down", "Trigger Happy", "Snipe", "Cripple", "Heat Riser", "Charge"] },
    magic("Fire", "Agidyne", "Maragidyne", "Fire Boost", "Fire Amp"),
    magic("Ice", "Bufudyne", "Mabufudyne", "Ice Boost", "Ice Amp"),
    magic("Elec", "Ziodyne", "Maziodyne", "Elec Boost", "Elec Amp"),
    magic("Wind", "Garudyne", "Magarudyne", "Wind Boost", "Wind Amp"),
    magic("Psy", "Psiodyne", "Mapsiodyne", "Psy Boost", "Psy Amp"),
    magic("Nuke", "Freidyne", "Mafreidyne", "Nuke Boost", "Nuke Amp"),
    magic("Bless", "Kougaon", "Makougaon", "Bless Boost", "Bless Amp"),
    magic("Curse", "Eigaon", "Maeigaon", "Curse Boost", "Curse Amp"),
    { id: "almighty", kind: "magic", title: "Almighty mage", desc: "Megidolaon with almighty boosts.", skills: ["Megidolaon", "Almighty Boost", "Almighty Amp", "Concentrate", "Magic Ability", "Spell Master", "SP Cost Down 25%", "Mana Surge"] },
    { id: "support", kind: "support", title: "Support / buffer", desc: "Buffs, debuffs and cleanse.", skills: ["Debilitate", "Heat Riser", "Matarukaja", "Marakukaja", "Masukukaja", "Tetraja", "Dekunda", "Support Turn Extend"] },
    { id: "healer", kind: "support", title: "Healer", desc: "Full-party heals, revives and heal boosts.", skills: ["Salvation", "Mediarahan", "Diarahan", "Recarmdra", "Samarecarm", "Heal Magic Up 25%", "Heal Cost Down 25%", "Regenerate 3"] },
    { id: "ailment", kind: "support", title: "Ailment spreader", desc: "Inflict and exploit status ailments.", skills: ["Brain Jack", "Evil Smile", "Famine's Scream", "Lullaby", "Ailment Boost", "Ailment Effect Up +", "Ailment Success Up", "Debilitate"] },
    { id: "tank", kind: "tank", title: "Tank / survivor", desc: "Survive big hits and keep regenerating.", skills: ["Enduring Soul", "Endure", "Unshaken Will", "Defense Master", "Firm Stance", "Regenerate 3", "Invigorate 3", "Auto-Maraku"] },
  ];

  function skillIdByName(name) {
    const n = name.toLowerCase();
    const list = db().skills || [];
    let hit = list.find((s) => s.name.toLowerCase() === n);
    if (!hit) hit = list.find((s) => s.name.toLowerCase().startsWith(n + " ("));
    return hit ? hit.id : 0;
  }
  const num = (id) => parseInt(($(id) || {}).value, 10) || 0;

  function openRecommend() {
    if (!$("skillSlot_0")) { info("Open a persona in the <b>Velvet Room</b> tab first (a save must be loaded)."); return; }
    const st = num("stat_st"), ma = num("stat_ma");
    const hint = st >= ma ? "Physical / Gun (St " + st + " ≥ Ma " + ma + ")" : "Magic (Ma " + ma + " > St " + st + ")";
    const rows = BUILDS.map((b) => {
      const chips = b.skills.map((n) => {
        const ok = !!skillIdByName(n);
        return '<span class="fx2-chip' + (ok ? "" : " miss") + '">' + esc(n) + "</span>";
      }).join("");
      return '<div class="fx-row" style="align-items:flex-start;"><span class="fx-grow"><b>' + esc(b.title) + '</b>' +
        '<div class="fx-sub">' + esc(b.desc) + '</div><div class="fx2-chips">' + chips + "</div></span>" +
        '<button class="p5-btn-action" data-act="apply" data-id="' + b.id + '"><span>APPLY</span></button></div>';
    }).join("");
    modal("Skill recommendations",
      '<div class="fx-note">Stats of the open persona suggest: <b>' + esc(hint) + "</b>.</div>" +
      '<div class="fx-sub" style="margin-bottom:6px;">Suggestions come from general Persona 5 Royal knowledge, not from this save. Struck-through names do not exist in this editor\'s skill list and are skipped. APPLY only changes the editor; nothing is written until you SAVE.</div>' + rows,
      { onAct: { apply: (d) => applyBuild(d.id) } });
  }

  function applyBuild(id) {
    const b = BUILDS.find((x) => x.id === id);
    if (!b) return;
    const ids = b.skills.map(skillIdByName).filter(Boolean);
    if (!ids.length) { info("None of these skills exist in this editor's skill list."); return; }
    if (!window.confirm("Replace the first " + ids.length + " skill slots of the open persona with the “" + b.title + "” build?")) return;
    closeModal();
    const s = $("skillSearch");
    if (s && s.value) { s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); }
    setTimeout(() => {
      ids.forEach((sid, i) => {
        const el = $("skillSlot_" + i);
        if (!el) return;
        if (!Array.from(el.options).some((o) => o.value === String(sid))) {
          const sk = (db().skills || []).find((x) => x.id === sid);
          if (!sk) return;
          const o = document.createElement("option");
          o.value = String(sid); o.textContent = sk.name;
          el.appendChild(o);
        }
        el.value = String(sid);
      });
      if (typeof saveCurrentDeckToActiveTarget === "function") saveCurrentDeckToActiveTarget();
      status("✔ Applied “" + b.title + "” skills (" + ids.length + "/8 slots). Press SAVE to review and write.");
    }, 250);
  }

  // ------------------------------------------------------------- raw byte diff
  // Finds payload offsets that are not mapped yet. Workflow: snapshot, change ONE thing in the game (e.g. a
  // party member's Baton Pass level), save in game, snapshot again, compare here.
  function openRawDiff() {
    const l = slot();
    if (!l) { info("Open a slot first via <b>📁 GAME SAVES</b>."); return; }
    const r = nat("listBackups", l.path);
    if (!r.ok) { info("⚠ " + esc(r.error === "no_access" ? "Storage access is needed (open GAME SAVES)." : r.error)); return; }
    if (!r.backups.length) { info("Make at least one snapshot first (⏱ SNAPSHOTS ▸ NEW SNAPSHOT)."); return; }
    const opts = '<option value="slot">⚡ The slot now (file on disk)</option>' +
      r.backups.map((b) => '<option value="' + esc(b.name) + '">' + esc((b.label || "Auto-backup") + " — " + fmtDate(b.modified)) + "</option>").join("");
    modal("Raw byte diff",
      '<div class="fx-note">Finds which bytes of the save changed between two versions. Use it to locate things the editor cannot edit yet (Baton Pass level, Technical rank…): snapshot, change <b>one</b> thing in the game, save, snapshot again, compare. Send the result to the developer.</div>' +
      '<div class="fx-h">A (before)</div><select id="fx2A" class="p5-select" style="width:100%;">' + opts + "</select>" +
      '<div class="fx-h">B (after)</div><select id="fx2B" class="p5-select" style="width:100%;">' + opts + "</select>",
      {
        buttons: [{
          label: "COMPARE", primary: true, onClick: () => {
            const a = $("fx2A").value, b = $("fx2B").value;
            if (a === b) { setTimeout(() => info("Pick two different versions."), 0); return; }
            runRawDiff(a, b, r.backups);
          },
        }],
      });
    $("fx2A").value = r.backups[r.backups.length > 1 ? 1 : 0].name;
    $("fx2B").value = r.backups[0].name;
  }

  // Reads a version's bytes without touching Guardian's fingerprint of the slot.
  function versionB64(v) {
    if (v !== "slot") { const r = nat("readBackup", v); return r.ok ? r.data : null; }
    const l = slot();
    const snap = nat("createSnapshot", l.path, "tmp-rawdiff");
    if (!snap.ok) return null;
    const rb = nat("readBackup", snap.name);
    nat("deleteBackup", snap.name);
    return rb.ok ? rb.data : null;
  }

  async function runRawDiff(a, b) {
    try {
      status("Comparing raw bytes…");
      const da = versionB64(a), dbb = versionB64(b);
      if (!da || !dbb) throw new Error("could not read one of the versions");
      const res = await fetch("/api/rawdiff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: da, b: dbb }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      const MIRROR = 0x18510; // the save keeps a second copy of most data at +0x18510
      const offs = new Set(j.ranges.map((x) => x.off));
      const rows = j.ranges.filter((x) => !(x.off >= MIRROR && offs.has(x.off - MIRROR)));
      const hex = (n) => "0x" + n.toString(16).toUpperCase();
      const body = '<div class="fx-sub" style="margin-bottom:6px;">' + j.changed_bytes + " byte(s) changed in " + j.ranges.length + " range(s)" +
        (j.truncated ? " (list truncated)" : "") + ". Mirror copies at +0x18510 are folded into their primary range.</div>" +
        (rows.map((x) =>
          '<div class="fx-diff"><span class="k">' + hex(x.off) + " (len " + x.len + ")" + (offs.has(x.off + MIRROR) ? " + mirror" : "") +
          '</span><span class="v">' + esc(x.a) + " → " + esc(x.b) + "</span></div>").join("") || '<div class="fx-note">No differences found.</div>');
      modal(rows.length + " changed region" + (rows.length === 1 ? "" : "s"), body, { buttons: [{ label: "BACK", onClick: openRawDiff }] });
      status("Raw diff done: " + j.changed_bytes + " byte(s).");
    } catch (e) {
      info("⚠ " + esc(e && e.message ? e.message : e));
    }
  }

  // ------------------------------------------------------------ tools menu
  function openTools2() {
    modal("Persona & display tools",
      '<button class="p5-btn-action fx-menu" data-act="rec"><span>💡 Skill recommendations by build</span></button>' +
      '<button class="p5-btn-action fx-menu" data-act="amoled"><span>' + (amoled ? "🌑 AMOLED battery-saver: ON (tap to turn off)" : "🌑 AMOLED battery-saver (pure black)") + "</span></button>" +
      '<button class="p5-btn-action fx-menu" data-act="raw"><span>🔬 Raw byte diff (find Baton Pass / Technical offsets)</span></button>',
      { onAct: { rec: openRecommend, amoled: () => { closeModal(); toggleAmoled(); }, raw: openRawDiff } });
  }

  function addButton() {
    if ($("tools2Btn")) return;
    const box = document.querySelector(".save-selector-box");
    if (!box) return;
    const b = document.createElement("button");
    b.id = "tools2Btn";
    b.className = "p5-btn-action secondary";
    b.innerHTML = "<span>✨ MORE TOOLS</span>";
    b.addEventListener("click", openTools2);
    const anchor = $("moreBtn") || $("toolsBtn") || $("gameSavesBtn");
    if (anchor && anchor.parentNode === box) anchor.insertAdjacentElement("afterend", b);
    else box.insertBefore(b, box.firstChild);
  }

  // Quick "recommend" button right under the skills grid.
  function addRecommendButton() {
    const grid = $("skillsGrid");
    if (!grid || $("fxRecBtn")) return;
    const b = document.createElement("button");
    b.id = "fxRecBtn";
    b.className = "p5-btn-action secondary";
    b.style.cssText = "margin-top:8px;";
    b.innerHTML = "<span>💡 SKILL RECOMMENDATIONS</span>";
    b.addEventListener("click", openRecommend);
    const anchor = $("fxSkillInfo") || grid;
    anchor.insertAdjacentElement("afterend", b);
  }

  // ------------------------------------------------------------------ init
  function init() {
    applyAmoled();
    addButton();
    initPersonaSearch();
    initTraitInfo();
    addRecommendButton();
    // DB arrives asynchronously: patch names once it is there.
    let tries = 0;
    const iv = setInterval(() => {
      if (patchSkillNames() || ++tries > 120) clearInterval(iv);
      const sel = $("personaSelect");
      if (sel && db().persona_names && !sel.dataset.fx2) { sel.dataset.fx2 = "1"; ensureTeamOptions(sel); snapshotPersonaOpts(sel); }
    }, 500);
    window.CohFx2 = { amoled: () => amoled, toggleAmoled, openRecommend, openRawDiff };
  }

  // AMOLED as early as possible to avoid a bright flash.
  if (amoled) { ensureCss(); document.documentElement.classList.add("coh-amoled"); }
  const start = () => setTimeout(init, 150); // after features.js (60 ms) and android.js
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
