/** Shared domain types — single schema for local store + API. */

export type Point = { x: number; y: number }

export type CollectionRecord = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/** Cutout metadata without binary payloads. */
export type CutoutMeta = {
  id: string
  name: string
  createdAt: number
  collectionId: string
  width: number
  height: number
  vertices: Point[]
  updatedAt?: number
}

export const DEFAULT_COLLECTION_ID = 'default'
export const DEFAULT_COLLECTION_NAME = '모아둔 것'
export const MAX_FILE_BYTES = 15 * 1024 * 1024
export const MAX_FILES_PER_BATCH = 12
