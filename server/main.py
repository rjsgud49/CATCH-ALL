"""CATCH-ALL API — warm rembg + dual-storage cutout library."""

from __future__ import annotations

import asyncio
import io
import json
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image
from rembg import new_session, remove

MODEL_NAME = "u2netp"
MAX_BYTES = 15 * 1024 * 1024
DATA_DIR = Path(__file__).resolve().parent / "data"
CUTOUTS_DIR = DATA_DIR / "cutouts"
COLLECTIONS_FILE = DATA_DIR / "collections.json"
DEFAULT_COLLECTION_ID = "default"
DEFAULT_COLLECTION_NAME = "모아둔 것"

session = None
ready = False
executor = ThreadPoolExecutor(max_workers=2)


def _ensure_dirs() -> None:
    CUTOUTS_DIR.mkdir(parents=True, exist_ok=True)
    if not COLLECTIONS_FILE.exists():
        now = __import__("time").time() * 1000
        _write_json(
            COLLECTIONS_FILE,
            [
                {
                    "id": DEFAULT_COLLECTION_ID,
                    "name": DEFAULT_COLLECTION_NAME,
                    "createdAt": int(now),
                    "updatedAt": int(now),
                }
            ],
        )


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return default


def _collections() -> list[dict[str, Any]]:
    cols = _read_json(COLLECTIONS_FILE, [])
    if not isinstance(cols, list) or not cols:
        _ensure_dirs()
        cols = _read_json(COLLECTIONS_FILE, [])
    return cols


def _save_collections(cols: list[dict[str, Any]]) -> None:
    _write_json(COLLECTIONS_FILE, cols)


def _cutout_dir(cutout_id: str) -> Path:
    return CUTOUTS_DIR / cutout_id


def _meta_path(cutout_id: str) -> Path:
    return _cutout_dir(cutout_id) / "meta.json"


def _image_path(cutout_id: str) -> Path:
    return _cutout_dir(cutout_id) / "preview.png"


def _list_cutout_meta() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not CUTOUTS_DIR.exists():
        return items
    for child in CUTOUTS_DIR.iterdir():
        if not child.is_dir():
            continue
        meta = _read_json(child / "meta.json", None)
        if isinstance(meta, dict) and meta.get("id"):
            items.append(meta)
    items.sort(key=lambda m: int(m.get("createdAt") or 0), reverse=True)
    return items


def _remove_sync(data: bytes) -> bytes:
    assert session is not None
    return remove(data, session=session)


def _warmup() -> None:
    global ready
    img = Image.new("RGB", (64, 64), (74, 144, 136))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    _remove_sync(buf.getvalue())
    ready = True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global session
    _ensure_dirs()
    session = new_session(MODEL_NAME)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, _warmup)
    yield
    executor.shutdown(wait=False)


app = FastAPI(title="CATCH-ALL API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "ready": ready, "model": MODEL_NAME, "storage": True}


@app.post("/api/remove-background")
async def remove_background(file: UploadFile = File(...)):
    if not ready or session is None:
        raise HTTPException(status_code=503, detail="모델 준비 중입니다")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="파일이 15MB를 초과합니다")

    content_type = (file.content_type or "").lower()
    if content_type and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="이미지 파일만 가능합니다")

    loop = asyncio.get_event_loop()
    try:

        def _run(raw: bytes) -> bytes:
            try:
                with Image.open(io.BytesIO(raw)) as im:
                    im = im.convert("RGBA")
                    buf = io.BytesIO()
                    im.save(buf, format="PNG")
                    raw = buf.getvalue()
            except Exception:
                pass
            return _remove_sync(raw)

        result = await loop.run_in_executor(executor, _run, data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"배경 제거 실패: {exc}") from exc

    return Response(content=result, media_type="image/png")


@app.get("/api/collections")
def list_collections():
    _ensure_dirs()
    return {"collections": _collections()}


@app.post("/api/collections")
async def create_collection(payload: dict[str, Any]):
    _ensure_dirs()
    name = str(payload.get("name") or "").strip() or "새 컬렉션"
    now = int(__import__("time").time() * 1000)
    col = {
        "id": payload.get("id") or f"col-{uuid.uuid4().hex[:10]}",
        "name": name,
        "createdAt": int(payload.get("createdAt") or now),
        "updatedAt": now,
    }
    cols = _collections()
    if any(c.get("id") == col["id"] for c in cols):
        raise HTTPException(status_code=409, detail="이미 있는 컬렉션입니다")
    cols.append(col)
    _save_collections(cols)
    return col


@app.get("/api/cutouts")
def list_cutouts():
    _ensure_dirs()
    return {"cutouts": _list_cutout_meta()}


@app.get("/api/cutouts/{cutout_id}")
def get_cutout_meta(cutout_id: str):
    meta = _read_json(_meta_path(cutout_id), None)
    if not isinstance(meta, dict):
        raise HTTPException(status_code=404, detail="누끼를 찾을 수 없습니다")
    return meta


@app.get("/api/cutouts/{cutout_id}/image")
def get_cutout_image(cutout_id: str):
    path = _image_path(cutout_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    return FileResponse(path, media_type="image/png")


@app.post("/api/cutouts")
async def upsert_cutout(
    file: UploadFile = File(...),
    meta: str = Form(...),
):
    """Save/overwrite a cutout (PNG + JSON meta). Dual-write companion for IndexedDB."""
    _ensure_dirs()
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="meta JSON이 올바르지 않습니다") from exc

    cutout_id = str(meta_obj.get("id") or "").strip() or uuid.uuid4().hex
    name = str(meta_obj.get("name") or "cutout")
    collection_id = str(meta_obj.get("collectionId") or DEFAULT_COLLECTION_ID)
    created_at = int(meta_obj.get("createdAt") or __import__("time").time() * 1000)
    width = int(meta_obj.get("width") or 0)
    height = int(meta_obj.get("height") or 0)
    vertices = meta_obj.get("vertices") or []

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="파일이 15MB를 초과합니다")

    dest = _cutout_dir(cutout_id)
    dest.mkdir(parents=True, exist_ok=True)
    image_path = _image_path(cutout_id)
    image_path.write_bytes(data)

    record = {
        "id": cutout_id,
        "name": name,
        "createdAt": created_at,
        "collectionId": collection_id,
        "width": width,
        "height": height,
        "vertices": vertices,
        "updatedAt": int(__import__("time").time() * 1000),
    }
    _write_json(_meta_path(cutout_id), record)

    cols = _collections()
    if not any(c.get("id") == collection_id for c in cols):
        cols.append(
            {
                "id": collection_id,
                "name": collection_id if collection_id != DEFAULT_COLLECTION_ID else DEFAULT_COLLECTION_NAME,
                "createdAt": created_at,
                "updatedAt": record["updatedAt"],
            }
        )
        _save_collections(cols)
    else:
        for c in cols:
            if c.get("id") == collection_id:
                c["updatedAt"] = record["updatedAt"]
        _save_collections(cols)

    return record


@app.patch("/api/cutouts/{cutout_id}")
async def patch_cutout(cutout_id: str, payload: dict[str, Any]):
    meta_path = _meta_path(cutout_id)
    meta = _read_json(meta_path, None)
    if not isinstance(meta, dict):
        raise HTTPException(status_code=404, detail="누끼를 찾을 수 없습니다")

    if "name" in payload and payload["name"] is not None:
        meta["name"] = str(payload["name"])
    if "collectionId" in payload and payload["collectionId"] is not None:
        meta["collectionId"] = str(payload["collectionId"])
    meta["updatedAt"] = int(__import__("time").time() * 1000)
    _write_json(meta_path, meta)
    return meta


@app.delete("/api/cutouts/{cutout_id}")
def delete_cutout(cutout_id: str):
    dest = _cutout_dir(cutout_id)
    if not dest.exists():
        raise HTTPException(status_code=404, detail="누끼를 찾을 수 없습니다")
    shutil.rmtree(dest, ignore_errors=True)
    return {"ok": True, "id": cutout_id}


@app.get("/")
def root():
    return JSONResponse({"service": "catch-all-api", "ready": ready, "storage": True})
