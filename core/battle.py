"""Battle ranks: Baton Pass (per party member) and Technical rank.

Ground truth (AGENTS.md invariant 2): found by diffing a rank-1 save against a maxed
save of the same game, then verified in-game on a re-signed copy (2026-11-28). The
Cheat Engine table offsets for these fields are *memory* offsets and do not map to the
file, so they were not used.

Layout inside the decrypted payload (``parser.data_payload``):

* Baton Pass rank: one byte per member, 4-byte stride, starting at 0x40B0.
  0 / 1 / 2 = Rank 1 / 2 / 3. The slot at +0x1C is unused (always 0).
* Technical rank: one byte at 0x40DC. 0..3 = Rank 1..4.
* Both exist twice: the main copy and the mirror at +0x18510. The game needs both
  written. Reads report ``mirror_ok`` so a mismatch is never silent.

Public API uses the in-game, 1-based ranks. Functions take the ``SaveEditor`` so
``core/editor.py`` stays untouched.
"""

from __future__ import annotations

PC31_OFFSET_BATON_RANKS = 0x40B0
PC31_BATON_SLOTS = (
    ("Joker", 0x00), ("Skull", 0x04), ("Mona", 0x08), ("Panther", 0x0C),
    ("Fox", 0x10), ("Queen", 0x14), ("Noir", 0x18), ("Crow", 0x20), ("Violet", 0x24),
)
PC31_OFFSET_TECHNICAL_RANK = 0x40DC
PC31_MIRROR_DELTA = 0x18510  # must equal SaveEditor.PC31_MIRROR_DELTA (see tests)

BATON_MAX_RANK = 3
TECHNICAL_MAX_RANK = 4


def _all_offsets():
    return [PC31_OFFSET_BATON_RANKS + off for _, off in PC31_BATON_SLOTS] + [PC31_OFFSET_TECHNICAL_RANK]


def _has_mirror(payload) -> bool:
    return len(payload) > PC31_OFFSET_TECHNICAL_RANK + PC31_MIRROR_DELTA


def get_battle_ranks(editor) -> dict:
    """Return {"baton": {name: 1..3}, "technical": 1..4, "mirror_ok": bool}, or {} if unsupported."""
    if not editor.is_real_save():
        return {}
    d = editor.parser.data_payload
    if len(d) <= PC31_OFFSET_TECHNICAL_RANK:
        return {}
    baton = {name: max(1, min(d[PC31_OFFSET_BATON_RANKS + off] + 1, BATON_MAX_RANK)) for name, off in PC31_BATON_SLOTS}
    technical = max(1, min(d[PC31_OFFSET_TECHNICAL_RANK] + 1, TECHNICAL_MAX_RANK))
    mirror_ok = True
    if _has_mirror(d):
        mirror_ok = all(d[o] == d[o + PC31_MIRROR_DELTA] for o in _all_offsets())
    return {"baton": baton, "technical": technical, "mirror_ok": mirror_ok}


def set_battle_ranks(editor, baton=None, technical=None) -> dict:
    """Set Baton Pass ranks ({"Joker": 3, ...}) and/or the Technical rank.

    Members that are not listed keep their value. Values are clamped to the valid range.
    Both the main copy and the mirror are written.
    """
    if not editor.is_real_save():
        return {"status": "noop", "message": "Battle ranks need a real save"}
    d = bytearray(editor.parser.data_payload)
    if len(d) <= PC31_OFFSET_TECHNICAL_RANK:
        return {"status": "noop", "message": "Payload too short for battle ranks"}

    def _rank(v):
        if isinstance(v, dict):
            v = v.get("rank", 1)
        return int(v)

    shifts = [0, PC31_MIRROR_DELTA] if _has_mirror(d) else [0]
    for shift in shifts:
        if baton:
            for name, off in PC31_BATON_SLOTS:
                if name in baton:
                    d[PC31_OFFSET_BATON_RANKS + off + shift] = max(1, min(_rank(baton[name]), BATON_MAX_RANK)) - 1
        if technical is not None:
            d[PC31_OFFSET_TECHNICAL_RANK + shift] = max(1, min(int(technical), TECHNICAL_MAX_RANK)) - 1
    editor.parser.data_payload = bytes(d)
    return {"status": "ok"}
