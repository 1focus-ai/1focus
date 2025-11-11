import { Hono } from "hono"
import { create1Focus } from "./core.js"
import type { ErrorContext } from "./errors.js"

export type ErrorRecord = {
  id: string
  filePath: string
  project?: string
  message?: string
  stack?: string
  line?: number
  column?: number
  metadata?: Record<string, unknown>
  capturedAt: string
}

export type ErrorPayload = {
  filePath?: unknown
  project?: unknown
  message?: unknown
  stack?: unknown
  line?: unknown
  column?: unknown
  metadata?: unknown
}

const MAX_LOG_ENTRIES = 500
const inMemoryLog: ErrorRecord[] = []

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isErrorPayload = (value: unknown): value is ErrorPayload =>
  isPlainObject(value)

const asOptionalString = (value: unknown) => {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

const appendRecord = (record: ErrorRecord) => {
  inMemoryLog.push(record)
  if (inMemoryLog.length > MAX_LOG_ENTRIES) {
    inMemoryLog.splice(0, inMemoryLog.length - MAX_LOG_ENTRIES)
  }
}

const sdk = create1Focus()
const app = new Hono()

app.get("/api/errors", (c) => {
  const ordered = [...inMemoryLog].sort((a, b) =>
    a.capturedAt > b.capturedAt ? -1 : 1
  )
  return c.json({ errors: ordered })
})

app.post("/api/new-error", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Body must be valid JSON" }, 400)
  }

  if (!isErrorPayload(body)) {
    return c.json({ error: "Body must be a JSON object" }, 400)
  }

  const payload = body

  const filePath = asOptionalString(payload.filePath)
  if (!filePath) {
    return c.json({ error: "`filePath` is required" }, 400)
  }

  const record: ErrorRecord = {
    id: generateId(),
    filePath,
    project: asOptionalString(payload.project),
    message: asOptionalString(payload.message),
    stack: asOptionalString(payload.stack),
    capturedAt: new Date().toISOString(),
  }

  if (typeof payload.line === "number") {
    record.line = payload.line
  }

  if (typeof payload.column === "number") {
    record.column = payload.column
  }

  if (isPlainObject(payload.metadata)) {
    record.metadata = payload.metadata
  }

  appendRecord(record)

  const context: ErrorContext = {
    file: record.filePath,
    project: record.project,
    line: record.line,
    column: record.column,
    metadata: record.metadata,
  }

  await sdk.err(context, record.message ?? "Captured error", {
    message: record.message,
    stack: record.stack,
    metadata: record.metadata,
  })

  return c.json(
    {
      status: "stored",
      record,
    },
    201
  )
})

export default app

export const __getErrorLogForTests = () => [...inMemoryLog]
export const __resetErrorLogForTests = () =>
  inMemoryLog.splice(0, inMemoryLog.length)
