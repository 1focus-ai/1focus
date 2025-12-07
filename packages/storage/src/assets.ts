import { Effect } from "effect"
import { R2, type R2Object, type R2PutOptions } from "./r2.js"

// =============================================================================
// Asset Storage Helpers
// =============================================================================

export interface AssetOptions extends R2PutOptions {
  /** Generate unique filename with timestamp */
  uniqueName?: boolean
  /** Add hash to filename for cache busting */
  addHash?: boolean
}

/** Infer content type from file extension */
export const inferContentType = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase()
  const types: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    avif: "image/avif",
    // Documents
    pdf: "application/pdf",
    json: "application/json",
    xml: "application/xml",
    // Text
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    ts: "text/typescript",
    md: "text/markdown",
    // Fonts
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    // Audio/Video
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    // Archives
    zip: "application/zip",
    gz: "application/gzip",
    tar: "application/x-tar",
  }
  return types[ext ?? ""] ?? "application/octet-stream"
}

/** Generate a unique filename */
export const uniqueFilename = (filename: string): string => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  const ext = filename.includes(".") ? `.${filename.split(".").pop()}` : ""
  const name = filename.includes(".")
    ? filename.slice(0, filename.lastIndexOf("."))
    : filename
  return `${name}-${timestamp}-${random}${ext}`
}

/** Hash content for cache busting */
const hashContent = async (content: ArrayBuffer): Promise<string> => {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content)
  return Array.from(new Uint8Array(hashBuffer))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Add hash to filename */
const addHashToFilename = (filename: string, hash: string): string => {
  if (!filename.includes(".")) return `${filename}-${hash}`
  const ext = filename.split(".").pop()
  const name = filename.slice(0, filename.lastIndexOf("."))
  return `${name}-${hash}.${ext}`
}

// =============================================================================
// Asset Storage Service
// =============================================================================

export interface AssetService {
  /** Upload an asset with automatic content type detection */
  upload: (
    key: string,
    data: string | ArrayBuffer | Uint8Array,
    options?: AssetOptions,
  ) => Effect.Effect<R2Object, Error>

  /** Upload a file from a URL */
  uploadFromUrl: (
    key: string,
    url: string,
    options?: AssetOptions,
  ) => Effect.Effect<R2Object, Error>

  /** Upload multiple assets in parallel */
  uploadMany: (
    assets: Array<{
      key: string
      data: string | ArrayBuffer | Uint8Array
      options?: AssetOptions
    }>,
  ) => Effect.Effect<R2Object[], Error>

  /** Delete old assets by prefix, keeping the N most recent */
  cleanup: (
    prefix: string,
    keepCount: number,
  ) => Effect.Effect<{ deleted: string[]; kept: string[] }, Error>
}

export const makeAssetService = Effect.gen(function* () {
  const r2 = yield* R2

  const service: AssetService = {
    upload: (key, data, options = {}) =>
      Effect.gen(function* () {
        let finalKey = key

        // Convert data to ArrayBuffer for hashing
        const buffer =
          typeof data === "string"
            ? new TextEncoder().encode(data).buffer
            : data instanceof Uint8Array
              ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
              : data

        if (options.uniqueName) {
          finalKey = uniqueFilename(key)
        }

        if (options.addHash) {
          const hash = yield* Effect.promise(() => hashContent(buffer as ArrayBuffer))
          finalKey = addHashToFilename(finalKey, hash)
        }

        const contentType = options.contentType ?? inferContentType(finalKey)

        return yield* r2.put(finalKey, data, {
          ...options,
          contentType,
          cacheControl: options.cacheControl ?? "public, max-age=31536000, immutable",
        })
      }),

    uploadFromUrl: (key, url, options = {}) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => fetch(url),
          catch: (e) => new Error(`Failed to fetch ${url}: ${e}`),
        })

        if (!response.ok) {
          return yield* Effect.fail(
            new Error(`Failed to fetch ${url}: ${response.status}`),
          )
        }

        const buffer = yield* Effect.tryPromise({
          try: () => response.arrayBuffer(),
          catch: (e) => new Error(`Failed to read response: ${e}`),
        })

        const contentType =
          options.contentType ??
          response.headers.get("content-type") ??
          inferContentType(key)

        return yield* service.upload(key, buffer, {
          ...options,
          contentType,
        })
      }),

    uploadMany: (assets) =>
      Effect.forEach(
        assets,
        ({ key, data, options }) => service.upload(key, data, options),
        { concurrency: 5 },
      ),

    cleanup: (prefix, keepCount) =>
      Effect.gen(function* () {
        const objects = yield* r2.listAll(prefix)

        // Sort by lastModified descending (newest first)
        const sorted = objects.sort(
          (a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
        )

        const toKeep = sorted.slice(0, keepCount)
        const toDelete = sorted.slice(keepCount)

        if (toDelete.length > 0) {
          yield* r2.deleteMany(toDelete.map((o) => o.key))
        }

        return {
          deleted: toDelete.map((o) => o.key),
          kept: toKeep.map((o) => o.key),
        }
      }),
  }

  return service
})

// =============================================================================
// Convenience Functions
// =============================================================================

/** Upload an image asset */
export const uploadImage = (
  key: string,
  data: ArrayBuffer | Uint8Array,
  options?: Omit<AssetOptions, "contentType">,
) =>
  Effect.gen(function* () {
    const assets = yield* makeAssetService
    return yield* assets.upload(key, data, {
      ...options,
      cacheControl: options?.cacheControl ?? "public, max-age=31536000, immutable",
    })
  })

/** Upload a JSON document */
export const uploadJson = <T>(key: string, data: T, options?: AssetOptions) =>
  Effect.gen(function* () {
    const r2 = yield* R2
    return yield* r2.putJson(key, data, {
      ...options,
      cacheControl: options?.cacheControl ?? "public, max-age=3600",
    })
  })

/** Upload from a local file path (Node.js/Bun) */
export const uploadFile = (key: string, filePath: string, options?: AssetOptions) =>
  Effect.gen(function* () {
    const buffer = yield* Effect.tryPromise({
      try: async () => {
        // Works in Bun and Node.js
        const fs = await import("fs/promises")
        return fs.readFile(filePath)
      },
      catch: (e) => new Error(`Failed to read file ${filePath}: ${e}`),
    })

    const assets = yield* makeAssetService
    return yield* assets.upload(key, buffer, options)
  })
