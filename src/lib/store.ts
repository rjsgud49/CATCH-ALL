import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CollectionRecord, CutoutMeta, Point } from '../types/domain'
import { DEFAULT_COLLECTION_ID, DEFAULT_COLLECTION_NAME } from '../types/domain'
import {
  createServerCollection,
  deleteServerCutout,
  fetchServerCollections,
  fetchServerCutoutImage,
  fetchServerCutouts,
  patchServerCutout,
  uploadCutoutToServer,
} from './api'

export { DEFAULT_COLLECTION_ID, DEFAULT_COLLECTION_NAME }
export type { CollectionRecord, Point }

const DB_NAME = 'catch-all'
const DB_VERSION = 1
export const SESSION_IDS_KEY = 'catch-all-session-ids-v1'

export type CutoutRecord = CutoutMeta & {
  previewBlob: Blob
  textureBlob: Blob
}

/** Runtime cutout with object URLs for UI / physics. */
export type StoredCutout = CutoutMeta & {
  previewUrl: string
  textureUrl: string
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

function recordToStored(record: CutoutRecord): StoredCutout {
  const previewUrl = URL.createObjectURL(record.previewBlob)
  const textureUrl =
    record.textureBlob === record.previewBlob
      ? previewUrl
      : URL.createObjectURL(record.textureBlob)
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    collectionId: record.collectionId,
    previewUrl,
    textureUrl,
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

async function touchCollection(collectionId: string) {
  const db = await getDb()
  const col = await db.get('collections', collectionId)
  if (col) await db.put('collections', { ...col, updatedAt: Date.now() })
}

/** Single persist path for IndexedDB (+ optional server mirror). */
async function persistCutoutRecord(
  record: CutoutRecord,
  syncRemote: boolean,
): Promise<StoredCutout> {
  await ensureDefaultCollection()
  const db = await getDb()
  await db.put('cutouts', record)
  await touchCollection(record.collectionId)

  if (syncRemote) {
    await uploadCutoutToServer({
      id: record.id,
      name: record.name,
      collectionId: record.collectionId,
      createdAt: record.createdAt,
      width: record.width,
      height: record.height,
      vertices: record.vertices,
      blob: record.previewBlob,
    })
  }

  return recordToStored(record)
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
  syncRemote?: boolean
}): Promise<StoredCutout> {
  const id = input.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const createdAt = input.createdAt ?? Date.now()
  const collectionId = input.collectionId ?? DEFAULT_COLLECTION_ID
  const textureBlob = await (await fetch(input.textureUrl)).blob()
  const previewBlob =
    input.previewUrl && input.previewUrl !== input.textureUrl
      ? await (await fetch(input.previewUrl)).blob()
      : textureBlob

  return persistCutoutRecord(
    {
      id,
      name: input.name,
      createdAt,
      collectionId,
      previewBlob,
      textureBlob,
      width: input.width,
      height: input.height,
      vertices: input.vertices,
    },
    input.syncRemote !== false,
  )
}

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
  return persistCutoutRecord(
    {
      id: input.id,
      name: input.name,
      createdAt: input.createdAt,
      collectionId: input.collectionId,
      previewBlob: input.blob,
      textureBlob: input.blob,
      width: input.width,
      height: input.height,
      vertices: input.vertices,
    },
    Boolean(input.syncRemote),
  )
}

export async function listCutouts(collectionId?: string | 'all'): Promise<StoredCutout[]> {
  await ensureDefaultCollection()
  const db = await getDb()
  const records =
    !collectionId || collectionId === 'all'
      ? await db.getAll('cutouts')
      : await db.getAllFromIndex('cutouts', 'by-collection', collectionId)
  records.sort((a, b) => b.createdAt - a.createdAt)
  return records.map(recordToStored)
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
  await touchCollection(collectionId)
  void patchServerCutout(id, { collectionId })
}

export async function deleteCutouts(ids: string[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('cutouts', 'readwrite')
  for (const id of ids) await tx.store.delete(id)
  await tx.done
  await Promise.all(ids.map((id) => deleteServerCutout(id)))
}

export async function getCutoutBlobs(
  ids: string[],
): Promise<{ id: string; name: string; blob: Blob }[]> {
  const db = await getDb()
  const out: { id: string; name: string; blob: Blob }[] = []
  for (const id of ids) {
    const record = await db.get('cutouts', id)
    if (record) out.push({ id: record.id, name: record.name, blob: record.previewBlob })
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

/** Pull missing from server, push local-only to server. */
export async function syncLibraryDual(): Promise<{ pulled: number; pushed: number }> {
  await ensureDefaultCollection()
  const db = await getDb()

  for (const col of await fetchServerCollections()) {
    if (!(await db.get('collections', col.id))) await db.put('collections', col)
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
