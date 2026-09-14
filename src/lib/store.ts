import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Point } from './makeCutout'
import {
  createServerCollection,
  deleteServerCutout,
  fetchServerCollections,
  fetchServerCutoutImage,
  fetchServerCutouts,
  patchServerCutout,
  uploadCutoutToServer,
} from './api'

const DB_NAME = 'catch-all'
const DB_VERSION = 1
export const DEFAULT_COLLECTION_ID = 'default'
export const DEFAULT_COLLECTION_NAME = '모아둔 것'
export const SESSION_IDS_KEY = 'catch-all-session-ids-v1'

export type CollectionRecord = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type CutoutRecord = {
  id: string
  name: string
  createdAt: number
  collectionId: string
  previewBlob: Blob
  textureBlob: Blob
  width: number
  height: number
  vertices: Point[]
}

/** Runtime cutout with object URLs for UI / physics. */
export type StoredCutout = {
  id: string
  name: string
  createdAt: number
  collectionId: string
  previewUrl: string
  textureUrl: string
  width: number
  height: number
  vertices: Point[]
}

interface CatchAllDB extends DBSchema {
  collections: {
    key: string
    value: CollectionRecord
  }
  cutouts: {
    key: string
    value: CutoutRecord
    indexes: { 'by-collection': string; 'by-created': number }
  }
}

let dbPromise: Promise<IDBPDatabase<CatchAllDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<CatchAllDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('collections')) {
          db.createObjectStore('collections', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('cutouts')) {
          const store = db.createObjectStore('cutouts', { keyPath: 'id' })
          store.createIndex('by-collection', 'collectionId')
          store.createIndex('by-created', 'createdAt')
        }
      },
    })
  }
  return dbPromise
}

async function ensureDefaultCollection() {
  const db = await getDb()
  const existing = await db.get('collections', DEFAULT_COLLECTION_ID)
  if (!existing) {
    const now = Date.now()
    await db.put('collections', {
      id: DEFAULT_COLLECTION_ID,
      name: DEFAULT_COLLECTION_NAME,
      createdAt: now,
      updatedAt: now,
    })
  }
}

export async function listCollections(): Promise<CollectionRecord[]> {
  await ensureDefaultCollection()
  const db = await getDb()
  const all = await db.getAll('collections')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function createCollection(name: string): Promise<CollectionRecord> {
  await ensureDefaultCollection()
  const db = await getDb()
  const now = Date.now()
  const record: CollectionRecord = {
    id: `col-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || '새 컬렉션',
    createdAt: now,
    updatedAt: now,
  }
  await db.put('collections', record)
  void createServerCollection(record)
  return record
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const db = await getDb()
  const existing = await db.get('collections', id)
  if (!existing) return
  await db.put('collections', {
    ...existing,
    name: name.trim() || existing.name,
    updatedAt: Date.now(),
  })
}

export async function deleteCollection(id: string): Promise<void> {
  if (id === DEFAULT_COLLECTION_ID) return
  const db = await getDb()
  const cutouts = await db.getAllFromIndex('cutouts', 'by-collection', id)
  const tx = db.transaction(['cutouts', 'collections'], 'readwrite')
  for (const c of cutouts) {
    await tx.objectStore('cutouts').put({
      ...c,
      collectionId: DEFAULT_COLLECTION_ID,
    })
  }
  await tx.objectStore('collections').delete(id)
  await tx.done
  const def = await db.get('collections', DEFAULT_COLLECTION_ID)
  if (def) {
    await db.put('collections', { ...def, updatedAt: Date.now() })
  }
}

function recordToStored(record: CutoutRecord): StoredCutout {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    collectionId: record.collectionId,
    previewUrl: URL.createObjectURL(record.previewBlob),
    textureUrl: URL.createObjectURL(record.textureBlob),
    width: record.width,
    height: record.height,
    vertices: record.vertices,
  }
}

export function revokeStoredUrls(item: Pick<StoredCutout, 'previewUrl' | 'textureUrl'>) {
  try {
    if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
  } catch {
    /* ignore */
  }
  try {
    if (item.textureUrl.startsWith('blob:') && item.textureUrl !== item.previewUrl) {
      URL.revokeObjectURL(item.textureUrl)
    }
  } catch {
    /* ignore */
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export async function saveCutout(input: {
  id?: string
  name: string
  collectionId?: string
  textureUrl: string
  previewUrl?: string
  width: number
  height: number
  vertices: Point[]
  createdAt?: number
  /** When false, skip server upload (used while pulling from server). */
  syncRemote?: boolean
}): Promise<StoredCutout> {
  await ensureDefaultCollection()
  const db = await getDb()
  const id = input.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const createdAt = input.createdAt ?? Date.now()
  const collectionId = input.collectionId ?? DEFAULT_COLLECTION_ID
  const textureBlob = await dataUrlToBlob(input.textureUrl)
  const previewBlob =
    input.previewUrl && input.previewUrl !== input.textureUrl
      ? await dataUrlToBlob(input.previewUrl)
      : textureBlob

  const record: CutoutRecord = {
    id,
    name: input.name,
    createdAt,
    collectionId,
    previewBlob,
    textureBlob,
    width: input.width,
    height: input.height,
    vertices: input.vertices,
  }
  await db.put('cutouts', record)

  // Mirror key in localStorage for quick dual-store signal
  try {
    const raw = localStorage.getItem('catch-all-local-ids-v1')
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : []
    if (!ids.includes(id)) {
      ids.push(id)
      localStorage.setItem('catch-all-local-ids-v1', JSON.stringify(ids))
    }
  } catch {
    /* ignore */
  }

  const col = await db.get('collections', collectionId)
  if (col) {
    await db.put('collections', { ...col, updatedAt: Date.now() })
  }

  if (input.syncRemote !== false) {
    await uploadCutoutToServer({
      id,
      name: record.name,
      collectionId,
      createdAt,
      width: record.width,
      height: record.height,
      vertices: record.vertices,
      blob: previewBlob,
    })
  }

  return recordToStored(record)
}

/** Persist blob directly (for server → local sync). */
export async function saveCutoutFromBlobs(input: {
  id: string
  name: string
  collectionId: string
  createdAt: number
  width: number
  height: number
  vertices: Point[]
  blob: Blob
  syncRemote?: boolean
}): Promise<StoredCutout> {
  await ensureDefaultCollection()
  const db = await getDb()
  const record: CutoutRecord = {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    collectionId: input.collectionId,
    previewBlob: input.blob,
    textureBlob: input.blob,
    width: input.width,
    height: input.height,
    vertices: input.vertices,
  }
  await db.put('cutouts', record)
  try {
    const raw = localStorage.getItem('catch-all-local-ids-v1')
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : []
    if (!ids.includes(input.id)) {
      ids.push(input.id)
      localStorage.setItem('catch-all-local-ids-v1', JSON.stringify(ids))
    }
  } catch {
    /* ignore */
  }
  if (input.syncRemote) {
    void uploadCutoutToServer({
      id: input.id,
      name: input.name,
      collectionId: input.collectionId,
      createdAt: input.createdAt,
      width: input.width,
      height: input.height,
      vertices: input.vertices,
      blob: input.blob,
    })
  }
  return recordToStored(record)
}

export async function listCutouts(collectionId?: string | 'all'): Promise<StoredCutout[]> {
  await ensureDefaultCollection()
  const db = await getDb()
  let records: CutoutRecord[]
  if (!collectionId || collectionId === 'all') {
    records = await db.getAll('cutouts')
  } else {
    records = await db.getAllFromIndex('cutouts', 'by-collection', collectionId)
  }
  records.sort((a, b) => b.createdAt - a.createdAt)
  return records.map(recordToStored)
}

export async function getCutout(id: string): Promise<StoredCutout | null> {
  const db = await getDb()
  const record = await db.get('cutouts', id)
  return record ? recordToStored(record) : null
}

export async function getCutoutsByIds(ids: string[]): Promise<StoredCutout[]> {
  const db = await getDb()
  const out: StoredCutout[] = []
  for (const id of ids) {
    const record = await db.get('cutouts', id)
    if (record) out.push(recordToStored(record))
  }
  return out
}

export async function countCutouts(): Promise<number> {
  const db = await getDb()
  return db.count('cutouts')
}

export async function moveCutout(id: string, collectionId: string): Promise<void> {
  const db = await getDb()
  const record = await db.get('cutouts', id)
  if (!record) return
  await db.put('cutouts', { ...record, collectionId })
  const col = await db.get('collections', collectionId)
  if (col) await db.put('collections', { ...col, updatedAt: Date.now() })
  void patchServerCutout(id, { collectionId })
}

export async function deleteCutouts(ids: string[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('cutouts', 'readwrite')
  for (const id of ids) {
    await tx.store.delete(id)
  }
  await tx.done
  try {
    const raw = localStorage.getItem('catch-all-local-ids-v1')
    const prev: string[] = raw ? (JSON.parse(raw) as string[]) : []
    const remove = new Set(ids)
    localStorage.setItem(
      'catch-all-local-ids-v1',
      JSON.stringify(prev.filter((id) => !remove.has(id))),
    )
  } catch {
    /* ignore */
  }
  await Promise.all(ids.map((id) => deleteServerCutout(id)))
}

export async function getCutoutBlobs(ids: string[]): Promise<
  { id: string; name: string; blob: Blob }[]
> {
  const db = await getDb()
  const out: { id: string; name: string; blob: Blob }[] = []
  for (const id of ids) {
    const record = await db.get('cutouts', id)
    if (record) {
      out.push({ id: record.id, name: record.name, blob: record.previewBlob })
    }
  }
  return out
}

export function loadSessionIds(): string[] {
  try {
    const raw = localStorage.getItem(SESSION_IDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveSessionIds(ids: string[]) {
  try {
    localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

export function clearSessionIds() {
  try {
    localStorage.removeItem(SESSION_IDS_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Dual sync:
 * - Pull server cutouts missing locally into IndexedDB
 * - Push local-only cutouts up to the server
 */
export async function syncLibraryDual(): Promise<{ pulled: number; pushed: number }> {
  await ensureDefaultCollection()
  const db = await getDb()

  const remoteCols = await fetchServerCollections()
  for (const col of remoteCols) {
    const existing = await db.get('collections', col.id)
    if (!existing) await db.put('collections', col)
  }

  const remote = await fetchServerCutouts()
  const local = await db.getAll('cutouts')
  const localIds = new Set(local.map((c) => c.id))
  const remoteIds = new Set(remote.map((c) => c.id))

  let pulled = 0
  for (const meta of remote) {
    if (localIds.has(meta.id)) continue
    const blob = await fetchServerCutoutImage(meta.id)
    if (!blob) continue
    await saveCutoutFromBlobs({
      id: meta.id,
      name: meta.name,
      collectionId: meta.collectionId || DEFAULT_COLLECTION_ID,
      createdAt: meta.createdAt,
      width: meta.width || 1,
      height: meta.height || 1,
      vertices: Array.isArray(meta.vertices) ? meta.vertices : [],
      blob,
      syncRemote: false,
    })
    pulled += 1
  }

  let pushed = 0
  for (const record of local) {
    if (remoteIds.has(record.id)) continue
    const ok = await uploadCutoutToServer({
      id: record.id,
      name: record.name,
      collectionId: record.collectionId,
      createdAt: record.createdAt,
      width: record.width,
      height: record.height,
      vertices: record.vertices,
      blob: record.previewBlob,
    })
    if (ok) pushed += 1
  }

  return { pulled, pushed }
}
