#!/usr/bin/env python3
"""Remove Argos dirs under /argos that are not needed for LT_LOAD_ONLY (host mounts this to .../share/argos-translate)."""
import os
import re
import shutil
import sys
from pathlib import Path


def default_lt_load_only() -> str:
    env_path = Path(__file__).resolve().parent / "libretranslate-lt.default.env"
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("LT_LOAD_ONLY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError(f"LT_LOAD_ONLY not set in {env_path}")


allowed = set(
    os.environ.get("LT_LOAD_ONLY", default_lt_load_only()).replace(" ", "").split(",")
)
if not allowed or allowed == {""}:
    print("LT_LOAD_ONLY empty", file=sys.stderr)
    sys.exit(1)

argos = os.environ.get("ARGOS_ROOT", "/argos")
pkgs = os.path.join(argos, "packages")
msbd = os.path.join(argos, "minisbd")


def pair_from_dirname(name: str) -> tuple[str, str] | None:
    m = re.match(r"^([a-z]{2})_([a-z]{2})$", name)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^translate-([a-z]{2})_([a-z]{2})-", name)
    if m:
        return m.group(1), m.group(2)
    return None


removed = 0
if os.path.isdir(pkgs):
    for name in sorted(os.listdir(pkgs)):
        path = os.path.join(pkgs, name)
        if not os.path.isdir(path):
            continue
        p = pair_from_dirname(name)
        if p is None:
            print(f"skip (unrecognized name): {name}")
            continue
        f, t = p
        if f in allowed and t in allowed:
            continue
        print(f"remove package: {name}")
        shutil.rmtree(path)
        removed += 1

if os.path.isdir(msbd):
    for fn in sorted(os.listdir(msbd)):
        if not fn.endswith(".onnx"):
            continue
        code = fn[:-5]
        if code in allowed:
            continue
        p = os.path.join(msbd, fn)
        print(f"remove minisbd: {fn}")
        os.remove(p)
        removed += 1

print(f"done ({removed} removed)")
