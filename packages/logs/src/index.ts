export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"

export type LogPayload = {
  message: string
  level?: LogLevel
  meta?: Record<string, unknown>
  source?: string
  timestamp?: number | string | Date
  attributes?: Record<string, unknown>
  resource?: Record<string, unknown>
  scope?: Record<string, unknown>
  traceId?: string
  spanId?: string
  parentSpanId?: string
  traceFlags?: number
}

export type LogsClientOptions = {
  apiKey: string
  server: string
  endpoint?: string
  fetchFn?: typeof fetch
  defaultSource?: string
  defaultMeta?: Record<string, unknown>
  timeoutMs?: number
}

export type LogsWriteResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; error: string }

export const DEFAULT_LOGS_ENDPOINT = "https://1focus.app/api/logs"

const allowedLevels = new Set<LogLevel>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
])

const normalizeLevel = (level?: string): LogLevel =>
  allowedLevels.has(level as LogLevel) ? (level as LogLevel) : "info"

const toTimestamp = (value: LogPayload["timestamp"]) => {
  if (!value) return undefined
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  if (typeof value === "string") return value
  return undefined
}

const compact = (record: Record<string, unknown>) => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

export const createLogsClient = ({
  apiKey,
  server,
  endpoint = DEFAULT_LOGS_ENDPOINT,
  fetchFn,
  defaultSource,
  defaultMeta = {},
  timeoutMs = 5000,
}: LogsClientOptions) => {
  const fetcher = fetchFn ?? globalThis.fetch
  if (!fetcher) {
    throw new Error("fetch is not available. Provide fetchFn.")
  }

  const send = async (payload: LogPayload): Promise<LogsWriteResult> => {
    const message = payload.message?.trim()
    if (!message) {
      return { ok: false, error: "message is required" }
    }

    const meta =
      payload.meta && Object.keys(payload.meta).length > 0
        ? { ...defaultMeta, ...payload.meta }
        : Object.keys(defaultMeta).length > 0
          ? { ...defaultMeta }
          : undefined

    const body = compact({
      server,
      message,
      level: normalizeLevel(payload.level),
      source: payload.source ?? defaultSource,
      timestamp: toTimestamp(payload.timestamp),
      meta,
      attributes: payload.attributes,
      resource: payload.resource,
      scope: payload.scope,
      traceId: payload.traceId,
      spanId: payload.spanId,
      parentSpanId: payload.parentSpanId,
      traceFlags: payload.traceFlags,
    })

    const controller = timeoutMs ? new AbortController() : null
    const timeout =
      controller && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null

    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        return {
          ok: false,
          status: response.status,
          error: text || response.statusText,
        }
      }

      return { ok: true, status: response.status }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  return {
    log: send,
    trace: (message: string, meta?: Record<string, unknown>) =>
      send({ message, level: "trace", meta }),
    debug: (message: string, meta?: Record<string, unknown>) =>
      send({ message, level: "debug", meta }),
    info: (message: string, meta?: Record<string, unknown>) =>
      send({ message, level: "info", meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      send({ message, level: "warn", meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      send({ message, level: "error", meta }),
    fatal: (message: string, meta?: Record<string, unknown>) =>
      send({ message, level: "fatal", meta }),
  }
}
