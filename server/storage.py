"""Filesystem persistence for cutouts + collections."""

from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data"
CUTOUTS_DIR = DATA_DIR / "cutouts"
COLLECTIONS_FILE = DATA_DIR / "collections.json"
DEFAULT_COLLECTION_ID = "default"
DEFAULT_COLLECTION_NAME = "모아둔 것"
MAX_BYTES = 15 * 1024 * 1024


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return default


def ensure_dirs() -> None:
    CUTOUTS_DIR.mkdir(parents=True, exist_ok=True)
    if not COLLECTIONS_FILE.exists():
        now = int(time.time() * 1000)
        write_json(
            COLLECTIONS_FILE,
            [
                {
                    "id": DEFAULT_COLLECTION_ID,
                    "name": DEFAULT_COLLECTION_NAME,
                    "createdAt": now,
                    "updatedAt": now,
                }
            ],
        )


def list_collections() -> list[dict[str, Any]]:
    cols = read_json(COLLECTIONS_FILE, [])
    if not isinstance(cols, list) or not cols:
        ensure_dirs()
        cols = read_json(COLLECTIONS_FILE, [])
    return cols


def save_collections(cols: list[dict[str, Any]]) -> None:
    write_json(COLLECTIONS_FILE, cols)


def cutout_dir(cutout_id: str) -> Path:
    return CUTOUTS_DIR / cutout_id


def meta_path(cutout_id: str) -> Path:
    return cutout_dir(cutout_id) / "meta.json"


def image_path(cutout_id: str) -> Path:
    return cutout_dir(cutout_id) / "preview.png"


def list_cutout_meta() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not CUTOUTS_DIR.exists():
        return items
    for child in CUTOUTS_DIR.iterdir():
        if not child.is_dir():
            continue
        meta = read_json(child / "meta.json", None)
        if isinstance(meta, dict) and meta.get("id"):
            items.append(meta)
    items.sort(key=lambda m: int(m.get("createdAt") or 0), reverse=True)
    return items


def create_collection(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip() or "새 컬렉션"
    now = int(time.time() * 1000)
    col = {
        "id": payload.get("id") or f"col-{uuid.uuid4().hex[:10]}",
        "name": name,
        "createdAt": int(payload.get("createdAt") or now),
        "updatedAt": now,
    }
    cols = list_collections()
    if any(c.get("id") == col["id"] for c in cols):
        raise ValueError("already_exists")
    cols.append(col)
    save_collections(cols)
    return col


def upsert_cutout(meta_obj: dict[str, Any], data: bytes) -> dict[str, Any]:
    cutout_id = str(meta_obj.get("id") or "").strip() or uuid.uuid4().hex
    name = str(meta_obj.get("name") or "cutout")
    collection_id = str(meta_obj.get("collectionId") or DEFAULT_COLLECTION_ID)
    created_at = int(meta_obj.get("createdAt") or time.time() * 1000)
    width = int(meta_obj.get("width") or 0)
    height = int(meta_obj.get("height") or 0)
    vertices = meta_obj.get("vertices") or []

    dest = cutout_dir(cutout_id)
    dest.mkdir(parents=True, exist_ok=True)
    image_path(cutout_id).write_bytes(data)

    record = {
        "id": cutout_id,
        "name": name,
        "createdAt": created_at,
        "collectionId": collection_id,
        "width": width,
        "height": height,
        "vertices": vertices,
        "updatedAt": int(time.time() * 1000),
    }
    write_json(meta_path(cutout_id), record)

    cols = list_collections()
    if not any(c.get("id") == collection_id for c in cols):
        cols.append(
            {
                "id": collection_id,
                "name": (
                    DEFAULT_COLLECTION_NAME
                    if collection_id == DEFAULT_COLLECTION_ID
                    else collection_id
                ),
                "createdAt": created_at,
                "updatedAt": record["updatedAt"],
            }
        )
    else:
        for c in cols:
            if c.get("id") == collection_id:
                c["updatedAt"] = record["updatedAt"]
    save_collections(cols)
    return record


def patch_cutout(cutout_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    path = meta_path(cutout_id)
    meta = read_json(path, None)
    if not isinstance(meta, dict):
        return None
    if "name" in payload and payload["name"] is not None:
        meta["name"] = str(payload["name"])
    if "collectionId" in payload and payload["collectionId"] is not None:
        meta["collectionId"] = str(payload["collectionId"])
    meta["updatedAt"] = int(time.time() * 1000)
    write_json(path, meta)
    return meta


def delete_cutout(cutout_id: str) -> bool:
    dest = cutout_dir(cutout_id)
    if not dest.exists():
        return False
    shutil.rmtree(dest, ignore_errors=True)
    return True
