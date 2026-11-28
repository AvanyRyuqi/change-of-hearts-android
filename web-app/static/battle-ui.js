/* Battle ranks card (Baton Pass per member 1-3, Technical 1-4).
   Loaded by server.py as a separate script, so app.js and index.html stay untouched.
   Data lives in CURRENT_SAVE.battle and is posted back with the rest of the save;
   server.py writes it via core/battle.py (main copy + mirror). */
(function () {
  "use strict";
  if (window.__cohBattleUi) return;
  window.__cohBattleUi = true;

  const MEMBERS = ["Joker", "Skull", "Mona", "Panther", "Fox", "Queen", "Noir", "Crow", "Violet"];

  function save() {
    try { return CURRENT_SAVE; } catch (e) { return null; }
  }

  function ensureCard() {
    let box = document.getElementById("battleRanksList");
    if (box) return box;
    const stage = document.getElementById("stage-daily_life");
    if (!stage) return null;
    const card = document.createElement("div");
    card.className = "p5-card";
    card.style.marginTop = "15px";
    card.innerHTML =
      '<div class="p5-card-header"><span> BATTLE: BATON PASS &amp; TECHNICAL</span>' +
      '<button class="p5-btn-action" id="battleMaxAll" style="padding:6px 14px; font-size:14px;"><span>MAX ALL</span></button></div>' +
      '<div id="battleRanksList"></div>' +
      '<p style="font-size:11px; color:var(--p5-muted); margin-top:15px;">' +
      "<b>INFO:</b> Baton Pass rank (1-3) per member and Technical rank (1-4). " +
      "Written to both save copies @ <code>0x40B0</code> / <code>0x1C5C0</code>.</p>";
    stage.appendChild(card);
    box = card.querySelector("#battleRanksList");

    box.addEventListener("click", (ev) => {
      const node = ev.target.closest ? ev.target.closest(".star-node[data-r]") : null;
      const S = save();
      if (!node || !S || !S.battle || !S.battle.baton) return;
      const rank = parseInt(node.dataset.r, 10);
      if (node.dataset.m === "_technical") S.battle.technical = rank;
      else if (MEMBERS.indexOf(node.dataset.m) !== -1) S.battle.baton[node.dataset.m] = rank;
      render();
    });
    card.querySelector("#battleMaxAll").addEventListener("click", () => {
      const S = save();
      if (!S || !S.battle || !S.battle.baton) return;
      MEMBERS.forEach((m) => { S.battle.baton[m] = 3; });
      S.battle.technical = 4;
      render();
    });
    return box;
  }

  function row(title, member, cur, max) {
    let nodes = "";
    for (let r = 1; r <= max; r++) {
      nodes += '<div class="star-node ' + (r <= cur ? "active" : "") + '" data-m="' + member + '" data-r="' + r + '">★ ' + r + "</div>";
    }
    return '<div class="stat-item" style="flex-direction:column; align-items:stretch; gap:6px;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div class="stat-title">' + title + " (Rank " + cur + ")</div>" +
      '<div class="star-rank-box">' + nodes + "</div></div></div>";
  }

  function render() {
    const box = ensureCard();
    if (!box) return;
    const S = save();
    const b = S && S.battle;
    if (!b || !b.baton) {
      box.innerHTML = '<div style="font-size:12px; color:var(--p5-muted);">Not available for this save.</div>';
      return;
    }
    let html = "";
    if (b.mirror_ok === false) {
      html += '<div style="font-size:11px; color:var(--p5-yellow, #FFE600); margin-bottom:8px;">' +
        "⚠ The two save copies of these ranks disagree. Saving will write both with the values shown.</div>";
    }
    MEMBERS.forEach((m) => { html += row("Baton Pass: " + m, m, b.baton[m] || 1, 3); });
    html += row("Technical", "_technical", b.technical || 1, 4);
    box.innerHTML = html;
  }

  // Re-render whenever the editor (re)renders a loaded save.
  function hook(tries) {
    if (typeof window.renderSaveData === "function") {
      if (window.renderSaveData.__battleHooked) return;
      const prev = window.renderSaveData;
      const wrapped = function () {
        const result = prev.apply(this, arguments);
        try { render(); } catch (e) { console.warn("battle ranks:", e); }
        return result;
      };
      wrapped.__battleHooked = true;
      window.renderSaveData = wrapped;
      if (save()) render();
    } else if (tries > 0) {
      setTimeout(() => hook(tries - 1), 200);
    }
  }
  hook(25);
})();
