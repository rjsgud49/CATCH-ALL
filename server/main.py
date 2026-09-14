"""CATCH-ALL API — warm rembg + dual-storage cutout library."""

from __future__ import annotations

import asyncio
import io
import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image
from rembg import new_session, remove

import storage as store

MODEL_NAME = "u2netp"

session = None
ready = False
executor = ThreadPoolExecutor(max_workers=2)


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
    store.ensure_dirs()
    session = new_session(MODEL_NAME)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, _warmup)
    yield
    executor.shutdown(wait=False)


app = FastAPI(title="CATCH-ALL API", version="1.2.0", lifespan=lifespan)
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
    if len(data) > store.MAX_BYTES:
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
    store.ensure_dirs()
    return {"collections": store.list_collections()}


@app.post("/api/collections")
async def create_collection(payload: dict):
    store.ensure_dirs()
    try:
        return store.create_collection(payload)
    except ValueError:
        raise HTTPException(status_code=409, detail="이미 있는 컬렉션입니다") from None


@app.get("/api/cutouts")
def list_cutouts():
    store.ensure_dirs()
    return {"cutouts": store.list_cutout_meta()}


@app.get("/api/cutouts/{cutout_id}")
def get_cutout_meta(cutout_id: str):
    meta = store.read_json(store.meta_path(cutout_id), None)
    if not isinstance(meta, dict):
        raise HTTPException(status_code=404, detail="누끼를 찾을 수 없습니다")
    return meta


@app.get("/api/cutouts/{cutout_id}/image")
def get_cutout_image(cutout_id: str):
    path = store.image_path(cutout_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    return FileResponse(path, media_type="image/png")


@app.post("/api/cutouts")
async def upsert_cutout(file: UploadFile = File(...), meta: str = Form(...)):
    store.ensure_dirs()
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="meta JSON이 올바르지 않습니다") from exc

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다")
    if len(data) > store.MAX_BYTES:
        raise HTTPException(status_code=400, detail="파일이 15MB를 초과합니다")

    return store.upsert_cutout(meta_obj, data)


@app.patch("/api/cutouts/{cutout_id}")
async def patch_cutout(cutout_id: str, payload: dict):
    meta = store.patch_cutout(cutout_id, payload)
    if meta is None:
        raise HTTPException(status_code=404, detail="누끼를 찾을 수 없습니다")
    return meta


@app.delete("/api/cutouts/{cutout_id}")
def delete_cutout(cutout_id: str):
    if not store.delete_cutout(cutout_id):
        raise HTTPException(status_code=404, detail="누끼를 찾을 수 없습니다")
    return {"ok": True, "id": cutout_id}


@app.get("/")
def root():
    return JSONResponse({"service": "catch-all-api", "ready": ready, "storage": True})
