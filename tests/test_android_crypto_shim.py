"""The Android app has no native AES wheel, so core.crypto falls back to javax.crypto
(reached through Chaquopy's `java` module). This test fakes that module with a stub
built on `cryptography` and checks the fallback is byte-identical to the normal path,
including the signed-byte conversions Java arrays force on us."""
import sys
import types
import unittest

try:
    from cryptography.hazmat.primitives.ciphers import Cipher as _RealCipher, algorithms, modes
    HAVE_REAL = True
except ImportError:  # pragma: no cover
    HAVE_REAL = False

from core import crypto


def _unsigned(arr):
    return bytes((x & 0xFF) for x in arr)


def _build_fake_java():
    mod = types.ModuleType("java")

    class jbyte:  # marker type, mirrors chaquopy's `java.jbyte`
        pass

    def jarray(_kind):
        def make(data):
            if isinstance(data, (bytes, bytearray)):
                # Worst case: no fast path -> signed ints, exactly like a Java byte[].
                return [(b - 256) if b > 127 else b for b in data]
            return list(data)
        return make

    class _Cipher:
        ENCRYPT_MODE = 1
        DECRYPT_MODE = 2

        @staticmethod
        def getInstance(name):
            assert name == "AES/CBC/NoPadding"
            return _Cipher()

        def init(self, mode, key, iv):
            self.mode, self.key, self.iv = mode, key, iv

        def doFinal(self, data):
            c = _RealCipher(algorithms.AES(_unsigned(self.key.k)), modes.CBC(_unsigned(self.iv.iv)))
            op = c.encryptor() if self.mode == 1 else c.decryptor()
            out = op.update(_unsigned(data)) + op.finalize()
            return [(b - 256) if b > 127 else b for b in out]

    class _Key:
        def __init__(self, k, _alg):
            self.k = k

    class _Iv:
        def __init__(self, iv):
            self.iv = iv

    classes = {
        "javax.crypto.Cipher": _Cipher,
        "javax.crypto.spec.SecretKeySpec": _Key,
        "javax.crypto.spec.IvParameterSpec": _Iv,
    }
    mod.jclass = lambda name: classes[name]
    mod.jarray = jarray
    mod.jbyte = jbyte
    return mod


@unittest.skipUnless(HAVE_REAL, "cryptography not installed")
class TestJavaAesFallback(unittest.TestCase):
    def setUp(self):
        self._saved = (crypto.HAS_PYCRYPTODOME, getattr(crypto, "HAS_CRYPTOGRAPHY", False), sys.modules.get("java"))
        sys.modules["java"] = _build_fake_java()
        crypto.HAS_PYCRYPTODOME = False
        crypto.HAS_CRYPTOGRAPHY = False

    def tearDown(self):
        crypto.HAS_PYCRYPTODOME, crypto.HAS_CRYPTOGRAPHY, java = self._saved
        if java is None:
            sys.modules.pop("java", None)
        else:
            sys.modules["java"] = java

    def _reference(self, data, iv):
        c = _RealCipher(algorithms.AES(crypto.P5R_CRYPT_KEY), modes.CBC(iv)).encryptor()
        return c.update(data) + c.finalize()

    def test_encrypt_matches_reference(self):
        iv = bytes(range(16))
        data = bytes((i * 37) & 0xFF for i in range(512))  # includes bytes > 127
        self.assertEqual(crypto.aes_encrypt(data, iv), self._reference(data, iv))

    def test_decrypt_roundtrip(self):
        iv = bytes(range(16, 32))
        data = bytes((i * 91) & 0xFF for i in range(1024))
        self.assertEqual(crypto.aes_decrypt(crypto.aes_encrypt(data, iv), iv), data)

    def test_full_container_roundtrip_uses_java_path(self):
        import pathlib
        raw = (pathlib.Path(__file__).parent / "fixtures" / "canonical_save.dat").read_bytes()
        box = crypto.SaveContainer()
        box.unpack_raw(raw)
        repacked = crypto.SaveContainer()
        repacked.unpack_raw(box.pack_raw())
        self.assertEqual(repacked.data_bytes, box.data_bytes)
        self.assertEqual(repacked.header_bytes, box.header_bytes)

    def test_missing_everything_raises_clear_error(self):
        sys.modules.pop("java", None)
        sys.modules["java"] = None  # makes `from java import ...` raise ImportError
        with self.assertRaises(RuntimeError):
            crypto.aes_decrypt(b"\x00" * 16, b"\x00" * 16)


if __name__ == "__main__":
    unittest.main()
