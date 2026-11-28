"""Tests for core/battle.py: Baton Pass ranks and Technical rank.

Ground truth: offsets were found by diffing a rank-1 save against a maxed save and
verified in-game. The main copy and the mirror (+0x18510) must always agree.
"""

import base64
import http.client
import json
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import battle
from core.editor import SaveEditor

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "canonical_save.dat"
MEMBERS = [name for name, _ in battle.PC31_BATON_SLOTS]


def _editor():
    return SaveEditor(FIXTURE.read_bytes())


class TestBattleRanks(unittest.TestCase):
    def test_mirror_delta_matches_editor(self):
        self.assertEqual(battle.PC31_MIRROR_DELTA, SaveEditor.PC31_MIRROR_DELTA)

    def test_layout_matches_verified_diff(self):
        offs = [battle.PC31_OFFSET_BATON_RANKS + o for _, o in battle.PC31_BATON_SLOTS]
        self.assertEqual(offs, [0x40B0, 0x40B4, 0x40B8, 0x40BC, 0x40C0, 0x40C4, 0x40C8, 0x40D0, 0x40D4])
        self.assertEqual(battle.PC31_OFFSET_TECHNICAL_RANK, 0x40DC)

    def test_read_shape_and_range(self):
        r = battle.get_battle_ranks(_editor())
        self.assertEqual(sorted(r["baton"]), sorted(MEMBERS))
        self.assertTrue(all(1 <= v <= 3 for v in r["baton"].values()))
        self.assertTrue(1 <= r["technical"] <= 4)
        self.assertTrue(r["mirror_ok"])

    def test_set_writes_main_and_mirror(self):
        ed = _editor()
        battle.set_battle_ranks(ed, {m: 3 for m in MEMBERS}, 4)
        d = ed.parser.data_payload
        for o in battle._all_offsets():
            self.assertEqual(d[o + battle.PC31_MIRROR_DELTA], d[o])
        self.assertEqual(d[battle.PC31_OFFSET_TECHNICAL_RANK], 3)
        r = battle.get_battle_ranks(ed)
        self.assertTrue(all(v == 3 for v in r["baton"].values()))
        self.assertEqual(r["technical"], 4)
        self.assertTrue(r["mirror_ok"])

    def test_only_expected_bytes_change(self):
        ed = _editor()
        before = bytes(ed.parser.data_payload)
        battle.set_battle_ranks(ed, {m: 3 for m in MEMBERS}, 4)
        after = bytes(ed.parser.data_payload)
        allowed = set()
        for o in battle._all_offsets():
            allowed.update((o, o + battle.PC31_MIRROR_DELTA))
        changed = {i for i in range(len(before)) if before[i] != after[i]}
        self.assertTrue(changed <= allowed, sorted(hex(i) for i in changed - allowed))

    def test_partial_set_keeps_others(self):
        ed = _editor()
        battle.set_battle_ranks(ed, {m: 2 for m in MEMBERS}, 2)
        battle.set_battle_ranks(ed, {"Joker": 1})
        r = battle.get_battle_ranks(ed)
        self.assertEqual(r["baton"]["Joker"], 1)
        self.assertEqual(r["baton"]["Skull"], 2)
        self.assertEqual(r["technical"], 2)

    def test_values_are_clamped_and_dict_form_accepted(self):
        ed = _editor()
        battle.set_battle_ranks(ed, {"Skull": {"rank": 99}, "Mona": 0}, 99)
        r = battle.get_battle_ranks(ed)
        self.assertEqual(r["baton"]["Skull"], 3)
        self.assertEqual(r["baton"]["Mona"], 1)
        self.assertEqual(r["technical"], 4)

    def test_mismatch_between_copies_is_reported(self):
        ed = _editor()
        d = bytearray(ed.parser.data_payload)
        d[battle.PC31_OFFSET_BATON_RANKS + battle.PC31_MIRROR_DELTA] ^= 1
        ed.parser.data_payload = bytes(d)
        self.assertFalse(battle.get_battle_ranks(ed)["mirror_ok"])

    def test_survives_save_and_reload(self):
        ed = _editor()
        battle.set_battle_ranks(ed, {m: 3 for m in MEMBERS}, 4)
        again = SaveEditor(ed.save_to_bytes())
        self.assertTrue(again.integrity_report()["ok"])
        r = battle.get_battle_ranks(again)
        self.assertEqual(r["technical"], 4)
        self.assertTrue(all(v == 3 for v in r["baton"].values()))


ANDROID_PY = pathlib.Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "python"


@unittest.skipUnless((ANDROID_PY / "android_entry.py").is_file(), "android_entry.py not present")
class TestAndroidBackendBattle(unittest.TestCase):
    """Load -> edit battle ranks -> save, through the real Android backend over HTTP."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(ANDROID_PY))
        import android_entry
        cls.android_entry = android_entry
        cls.tmp = tempfile.TemporaryDirectory()
        root = str(pathlib.Path(__file__).resolve().parent.parent)
        cls.port = android_entry.start(root, cls.tmp.name, "testtoken")

    @classmethod
    def tearDownClass(cls):
        cls.android_entry.stop()
        cls.tmp.cleanup()

    def _post(self, path, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request("POST", path, body=json.dumps(body).encode(),
                     headers={"Content-Type": "application/json", "Cookie": "coh_token=testtoken"})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode("utf-8"))
        conn.close()
        return resp.status, data

    def _load(self):
        raw = base64.b64encode(FIXTURE.read_bytes()).decode()
        status, payload = self._post("/api/load-upload", {"data": raw, "filename": "DATA.DAT"})
        self.assertEqual(status, 200)
        return payload

    def test_load_payload_has_battle(self):
        payload = self._load()
        self.assertEqual(sorted(payload["battle"]["baton"]), sorted(MEMBERS))
        self.assertIn("technical", payload["battle"])

    def test_save_writes_posted_battle_ranks(self):
        payload = self._load()
        payload["battle"]["baton"] = {m: 3 for m in MEMBERS}
        payload["battle"]["technical"] = 4
        status, resp = self._post("/api/save", payload)
        self.assertEqual(status, 200, resp)
        saved = SaveEditor(base64.b64decode(resp["download_data"]))
        self.assertTrue(saved.integrity_report()["ok"])
        r = battle.get_battle_ranks(saved)
        self.assertTrue(all(v == 3 for v in r["baton"].values()))
        self.assertEqual(r["technical"], 4)
        self.assertTrue(r["mirror_ok"])

    def test_save_without_battle_keeps_ranks(self):
        payload = self._load()
        before = payload["battle"]
        payload.pop("battle")
        status, resp = self._post("/api/save", payload)
        self.assertEqual(status, 200, resp)
        after = battle.get_battle_ranks(SaveEditor(base64.b64decode(resp["download_data"])))
        self.assertEqual(after["baton"], before["baton"])
        self.assertEqual(after["technical"], before["technical"])

    def test_malformed_battle_does_not_break_save(self):
        payload = self._load()
        payload["battle"] = {"baton": "not-a-dict", "technical": "x"}
        status, resp = self._post("/api/save", payload)
        self.assertEqual(status, 200, resp)


if __name__ == "__main__":
    unittest.main()
