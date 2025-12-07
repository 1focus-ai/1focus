import { Context, Effect, Layer } from "effect"
import { TaggedError } from "effect/Data"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform"

// =============================================================================
// Errors
// =============================================================================

export class R2Error extends TaggedError("R2Error")<{
  operation: string
  message: string
  status?: number
}> {}

export class R2NotFoundError extends TaggedError("R2NotFoundError")<{
  bucket: string
  key: string
}> {}

export class R2ConfigError extends TaggedError("R2ConfigError")<{
  message: string
}> {}

// =============================================================================
// Types
// =============================================================================

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** Optional public URL prefix for accessing objects (e.g., https://pub-xxx.r2.dev) */
  publicUrl?: string
}

export interface R2Object {
  key: string
  size: number
  etag: string
  lastModified: Date
  /** Public URL if publicUrl is configured */
  url?: string
  httpMetadata?: {
    contentType?: string
    contentLanguage?: string
    contentDisposition?: string
    contentEncoding?: string
    cacheControl?: string
  }
  customMetadata?: Record<string, string>
}

export interface R2ListResult {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
  delimitedPrefixes: string[]
}

export interface R2PutOptions {
  contentType?: string
  contentDisposition?: string
  cacheControl?: string
  customMetadata?: Record<string, string>
}

export interface R2ListOptions {
  prefix?: string
  delimiter?: string
  cursor?: string
  limit?: number
}

// =============================================================================
// AWS Signature V4
// =============================================================================

const hmacSha256 = async (
  key: ArrayBuffer | string,
  message: string,
): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder()
  const keyData = typeof key === "string" ? encoder.encode(key) : key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message))
}

const sha256 = async (message: string | ArrayBuffer): Promise<string> => {
  const data =
    typeof message === "string" ? new TextEncoder().encode(message) : message
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

const getSignatureKey = async (
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> => {
  const kDate = await hmacSha256(`AWS4${secretKey}`, dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  return hmacSha256(kService, "aws4_request")
}

interface SignedRequest {
  url: string
  headers: Record<string, string>
}

const signRequest = async (
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | ArrayBuffer,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<SignedRequest> => {
  const parsedUrl = new URL(url)
  const service = "s3"

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const dateStamp = amzDate.slice(0, 8)

  const payloadHash = await sha256(body)

  // Normalize all headers to lowercase keys
  const normalizedHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders[k.toLowerCase()] = v
  }

  const signedHeaders: Record<string, string> = {
    ...normalizedHeaders,
    host: parsedUrl.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  }

  const sortedHeaderKeys = Object.keys(signedHeaders).sort()
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${signedHeaders[k]?.trim()}`)
    .join("\n")
  const signedHeadersStr = sortedHeaderKeys.join(";")

  const canonicalUri = parsedUrl.pathname
  const canonicalQuerystring = parsedUrl.search.slice(1)

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders + "\n",
    signedHeadersStr,
    payloadHash,
  ].join("\n")

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join("\n")

  const signingKey = await getSignatureKey(
    secretAccessKey,
    dateStamp,
    region,
    service,
  )
  const signature = toHex(await hmacSha256(signingKey, stringToSign))

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`

  return {
    url,
    headers: {
      ...signedHeaders,
      Authorization: authorizationHeader,
    },
  }
}

// =============================================================================
// R2 Service
// =============================================================================

export interface R2Service {
  readonly config: R2Config

  /** Get raw bytes */
  get: (key: string) => Effect.Effect<ArrayBuffer, R2Error | R2NotFoundError>

  /** Get as text */
  getText: (key: string) => Effect.Effect<string, R2Error | R2NotFoundError>

  /** Get as JSON */
  getJson: <T>(key: string) => Effect.Effect<T, R2Error | R2NotFoundError>

  /** Put raw data */
  put: (
    key: string,
    body: string | ArrayBuffer | Uint8Array,
    options?: R2PutOptions,
  ) => Effect.Effect<R2Object, R2Error>

  /** Put JSON data */
  putJson: <T>(
    key: string,
    data: T,
    options?: R2PutOptions,
  ) => Effect.Effect<R2Object, R2Error>

  /** Delete object */
  delete: (key: string) => Effect.Effect<void, R2Error>

  /** Delete multiple objects */
  deleteMany: (keys: string[]) => Effect.Effect<void, R2Error>

  /** Get object metadata */
  head: (key: string) => Effect.Effect<R2Object, R2Error | R2NotFoundError>

  /** List objects */
  list: (options?: R2ListOptions) => Effect.Effect<R2ListResult, R2Error>

  /** List all objects (handles pagination) */
  listAll: (prefix?: string) => Effect.Effect<R2Object[], R2Error>

  /** Check if object exists */
  exists: (key: string) => Effect.Effect<boolean, R2Error>

  /** Copy object */
  copy: (
    sourceKey: string,
    destKey: string,
  ) => Effect.Effect<R2Object, R2Error | R2NotFoundError>

  /** Get public URL for an object (if publicUrl is configured) */
  getPublicUrl: (key: string) => string | undefined
}

export class R2 extends Context.Tag("@1focus/storage/R2")<R2, R2Service>() {}

// =============================================================================
// R2 Implementation
// =============================================================================

export const makeR2Layer = (config: R2Config) =>
  Layer.effect(
    R2,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient

      const baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`
      const region = "auto"

      // Encode key preserving slashes
      const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/")

      const getPublicUrl = (key: string): string | undefined => {
        if (!config.publicUrl) return undefined
        const base = config.publicUrl.endsWith("/")
          ? config.publicUrl.slice(0, -1)
          : config.publicUrl
        return `${base}/${key}`
      }

      const doSignRequest = (
        method: string,
        url: string,
        body: string | ArrayBuffer = "",
        extraHeaders: Record<string, string> = {},
      ) =>
        Effect.promise(() =>
          signRequest(
            method,
            url,
            extraHeaders,
            body,
            config.accessKeyId,
            config.secretAccessKey,
            region,
          ),
        )

      const service: R2Service = {
        config,
        getPublicUrl,

        get: (key) =>
          Effect.gen(function* () {
            const url = `${baseUrl}/${encodeKey(key)}`
            const signed = yield* doSignRequest("GET", url)

            const response = yield* httpClient
              .get(signed.url, { headers: signed.headers })
              .pipe(
                Effect.mapError(
                  (e) => new R2Error({ operation: "get", message: String(e) }),
                ),
              )

            if (response.status === 404) {
              return yield* Effect.fail(
                new R2NotFoundError({ bucket: config.bucket, key }),
              )
            }

            if (response.status < 200 || response.status >= 300) {
              const body = yield* response.text.pipe(
                Effect.orElse(() => Effect.succeed("")),
              )
              return yield* Effect.fail(
                new R2Error({
                  operation: "get",
                  message: body,
                  status: response.status,
                }),
              )
            }

            return yield* response.arrayBuffer.pipe(
              Effect.mapError(
                (e) => new R2Error({ operation: "get", message: String(e) }),
              ),
            )
          }),

        getText: (key) =>
          Effect.gen(function* () {
            const buffer = yield* service.get(key)
            return new TextDecoder().decode(buffer)
          }),

        getJson: <T>(key: string) =>
          Effect.gen(function* () {
            const text = yield* service.getText(key)
            return JSON.parse(text) as T
          }),

        put: (key, body, options = {}) =>
          Effect.gen(function* () {
            const bodyBytes =
              typeof body === "string"
                ? new TextEncoder().encode(body)
                : body instanceof Uint8Array
                  ? body
                  : new Uint8Array(body)

            const contentType = options.contentType ?? "application/octet-stream"
            const headers: Record<string, string> = {
              "content-type": contentType,
            }
            if (options.cacheControl)
              headers["cache-control"] = options.cacheControl
            if (options.contentDisposition) {
              headers["content-disposition"] = options.contentDisposition
            }
            if (options.customMetadata) {
              for (const [k, v] of Object.entries(options.customMetadata)) {
                headers[`x-amz-meta-${k}`] = v
              }
            }

            const url = `${baseUrl}/${encodeKey(key)}`
            const signed = yield* doSignRequest("PUT", url, bodyBytes.buffer as ArrayBuffer, headers)

            const response = yield* httpClient
              .execute(
                HttpClientRequest.put(signed.url).pipe(
                  HttpClientRequest.setHeaders(signed.headers),
                  HttpClientRequest.bodyUint8Array(bodyBytes, contentType),
                ),
              )
              .pipe(
                Effect.mapError(
                  (e) => new R2Error({ operation: "put", message: String(e) }),
                ),
              )

            if (response.status < 200 || response.status >= 300) {
              const responseBody = yield* response.text.pipe(
                Effect.orElse(() => Effect.succeed("")),
              )
              return yield* Effect.fail(
                new R2Error({
                  operation: "put",
                  message: responseBody,
                  status: response.status,
                }),
              )
            }

            const etag = response.headers["etag"] ?? ""
            return {
              key,
              size: bodyBytes.byteLength,
              etag,
              lastModified: new Date(),
              url: getPublicUrl(key),
              httpMetadata: {
                contentType: options.contentType,
                cacheControl: options.cacheControl,
                contentDisposition: options.contentDisposition,
              },
              customMetadata: options.customMetadata,
            }
          }),

        putJson: (key, data, options = {}) =>
          service.put(key, JSON.stringify(data), {
            ...options,
            contentType: options.contentType ?? "application/json",
          }),

        delete: (key) =>
          Effect.gen(function* () {
            const url = `${baseUrl}/${encodeKey(key)}`
            const signed = yield* doSignRequest("DELETE", url)

            const response = yield* httpClient
              .execute(
                HttpClientRequest.del(signed.url).pipe(
                  HttpClientRequest.setHeaders(signed.headers),
                ),
              )
              .pipe(
                Effect.mapError(
                  (e) => new R2Error({ operation: "delete", message: String(e) }),
                ),
              )

            if (
              response.status < 200 ||
              (response.status >= 300 && response.status !== 404)
            ) {
              const body = yield* response.text.pipe(
                Effect.orElse(() => Effect.succeed("")),
              )
              return yield* Effect.fail(
                new R2Error({
                  operation: "delete",
                  message: body,
                  status: response.status,
                }),
              )
            }
          }),

        deleteMany: (keys) =>
          Effect.forEach(keys, service.delete, { concurrency: 10, discard: true }),

        head: (key) =>
          Effect.gen(function* () {
            const url = `${baseUrl}/${encodeKey(key)}`
            const signed = yield* doSignRequest("HEAD", url)

            const response = yield* httpClient
              .execute(
                HttpClientRequest.head(signed.url).pipe(
                  HttpClientRequest.setHeaders(signed.headers),
                ),
              )
              .pipe(
                Effect.mapError(
                  (e) => new R2Error({ operation: "head", message: String(e) }),
                ),
              )

            if (response.status === 404) {
              return yield* Effect.fail(
                new R2NotFoundError({ bucket: config.bucket, key }),
              )
            }

            if (response.status < 200 || response.status >= 300) {
              return yield* Effect.fail(
                new R2Error({
                  operation: "head",
                  message: "HEAD failed",
                  status: response.status,
                }),
              )
            }

            const contentLength = response.headers["content-length"]
            const etag = response.headers["etag"]
            const lastModified = response.headers["last-modified"]
            const contentType = response.headers["content-type"]

            return {
              key,
              size: contentLength ? parseInt(contentLength, 10) : 0,
              etag: etag ?? "",
              lastModified: lastModified ? new Date(lastModified) : new Date(),
              url: getPublicUrl(key),
              httpMetadata: {
                contentType,
              },
            }
          }),

        list: (options = {}) =>
          Effect.gen(function* () {
            const params = new URLSearchParams()
            params.set("list-type", "2")
            if (options.prefix) params.set("prefix", options.prefix)
            if (options.delimiter) params.set("delimiter", options.delimiter)
            if (options.cursor) params.set("continuation-token", options.cursor)
            if (options.limit) params.set("max-keys", String(options.limit))

            const url = `${baseUrl}?${params.toString()}`
            const signed = yield* doSignRequest("GET", url)

            const response = yield* httpClient
              .get(signed.url, { headers: signed.headers })
              .pipe(
                Effect.mapError(
                  (e) => new R2Error({ operation: "list", message: String(e) }),
                ),
              )

            if (response.status < 200 || response.status >= 300) {
              const body = yield* response.text.pipe(
                Effect.orElse(() => Effect.succeed("")),
              )
              return yield* Effect.fail(
                new R2Error({
                  operation: "list",
                  message: body,
                  status: response.status,
                }),
              )
            }

            const xml = yield* response.text.pipe(
              Effect.mapError(
                (e) => new R2Error({ operation: "list", message: String(e) }),
              ),
            )

            const getTag = (tag: string, text: string): string | undefined => {
              const match = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
              return match?.[1]
            }

            const getAllTags = (tag: string, text: string): string[] => {
              const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, "g")
              const results: string[] = []
              let match
              while ((match = regex.exec(text)) !== null) {
                if (match[1]) results.push(match[1])
              }
              return results
            }

            const getContents = (text: string): R2Object[] => {
              const objects: R2Object[] = []
              const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g
              let match
              while ((match = contentsRegex.exec(text)) !== null) {
                const content = match[1] ?? ""
                const objKey = getTag("Key", content)
                const size = getTag("Size", content)
                const etag = getTag("ETag", content)
                const lastModified = getTag("LastModified", content)
                if (objKey) {
                  objects.push({
                    key: objKey,
                    size: size ? parseInt(size, 10) : 0,
                    etag: etag?.replace(/"/g, "") ?? "",
                    lastModified: lastModified
                      ? new Date(lastModified)
                      : new Date(),
                    url: getPublicUrl(objKey),
                  })
                }
              }
              return objects
            }

            const truncated = getTag("IsTruncated", xml) === "true"
            const cursor = getTag("NextContinuationToken", xml)
            const prefixes = getAllTags("Prefix", xml).filter((p) =>
              xml.includes(
                `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`,
              ),
            )

            return {
              objects: getContents(xml),
              truncated,
              cursor,
              delimitedPrefixes: prefixes,
            }
          }),

        listAll: (prefix) =>
          Effect.gen(function* () {
            const allObjects: R2Object[] = []
            let cursor: string | undefined

            do {
              const result = yield* service.list({ prefix, cursor, limit: 1000 })
              allObjects.push(...result.objects)
              cursor = result.truncated ? result.cursor : undefined
            } while (cursor)

            return allObjects
          }),

        exists: (key) =>
          service.head(key).pipe(
            Effect.map(() => true),
            Effect.catchTag("R2NotFoundError", () => Effect.succeed(false)),
          ),

        copy: (sourceKey, destKey) =>
          Effect.gen(function* () {
            const data = yield* service.get(sourceKey)
            const sourceMeta = yield* service.head(sourceKey)
            return yield* service.put(destKey, data, {
              contentType: sourceMeta.httpMetadata?.contentType,
              customMetadata: sourceMeta.customMetadata,
            })
          }),
      }

      return service
    }),
  )

// Legacy export for compatibility
export const makeR2 = (config: R2Config): R2Service => {
  throw new Error("Use R2Live(config) layer instead of makeR2()")
}

// =============================================================================
// Layers
// =============================================================================

/** Create R2 layer from config */
export const R2Live = (config: R2Config) =>
  makeR2Layer(config).pipe(Layer.provide(FetchHttpClient.layer))

/**
 * Parse R2 connection string
 * Format: r2://ACCESS_KEY_ID:SECRET_ACCESS_KEY@ACCOUNT_ID/BUCKET?publicUrl=https://...
 */
export const parseR2Url = (url: string): R2Config => {
  const parsed = new URL(url)
  if (parsed.protocol !== "r2:") {
    throw new Error("Invalid R2 URL: must start with r2://")
  }

  const accessKeyId = decodeURIComponent(parsed.username)
  const secretAccessKey = decodeURIComponent(parsed.password)
  const accountId = parsed.hostname
  const bucket = parsed.pathname.slice(1) // remove leading /
  const publicUrl = parsed.searchParams.get("publicUrl") ?? undefined

  if (!accessKeyId || !secretAccessKey || !accountId || !bucket) {
    throw new Error(
      "Invalid R2 URL format. Expected: r2://ACCESS_KEY_ID:SECRET_ACCESS_KEY@ACCOUNT_ID/BUCKET",
    )
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl }
}

/**
 * Create R2 connection string from config
 * Format: r2://ACCESS_KEY_ID:SECRET_ACCESS_KEY@ACCOUNT_ID/BUCKET?publicUrl=https://...
 */
export const toR2Url = (config: R2Config): string => {
  const url = new URL(`r2://${config.accountId}/${config.bucket}`)
  url.username = encodeURIComponent(config.accessKeyId)
  url.password = encodeURIComponent(config.secretAccessKey)
  if (config.publicUrl) {
    url.searchParams.set("publicUrl", config.publicUrl)
  }
  return url.toString()
}

/** Create R2 layer from connection string */
export const R2FromUrl = (url: string) => R2Live(parseR2Url(url))

/** Create R2 layer from environment variables */
export const R2FromEnv = Effect.gen(function* () {
  // Try R2_URL first (single connection string)
  const r2Url = process.env.R2_URL
  if (r2Url) {
    try {
      return R2Live(parseR2Url(r2Url))
    } catch (e) {
      return yield* Effect.fail(
        new R2ConfigError({ message: `Invalid R2_URL: ${e}` }),
      )
    }
  }

  // Fall back to individual env vars
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicUrl = process.env.R2_PUBLIC_URL

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return yield* Effect.fail(
      new R2ConfigError({
        message:
          "Missing R2 config. Set R2_URL or: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
      }),
    )
  }

  return R2Live({ accountId, accessKeyId, secretAccessKey, bucket, publicUrl })
})
