import { Axiom, type ClientOptions, type IngestOptions } from "@axiomhq/js"

export type LoggableValue =
  | Record<string, unknown>
  | string
  | number
  | boolean
  | bigint
  | Error
  | null
  | undefined

export interface LogOptions {
  /**
   * Override the dataset name (defaults to env AXIOM_DATASET / VITE_AXIOM_DATASET).
   */
  dataset?: string
  /**
   * Override the Axiom token (defaults to env AXIOM_TOKEN / VITE_AXIOM_TOKEN).
   */
  token?: string
  /**
   * Override the Axiom organization id (defaults to env AXIOM_ORG_ID / VITE_AXIOM_ORG_ID).
   */
  orgId?: string
  /**
   * Override the Axiom API url (defaults to env AXIOM_URL / VITE_AXIOM_URL).
   */
  url?: string
  /**
   * Additional fields merged into every event.
   */
  metadata?: Record<string, unknown>
  /**
   * Optional ingest options forwarded to Axiom.
   */
  ingestOptions?: IngestOptions
  /**
   * Provide a custom environment object; useful for tests.
   */
  env?: Record<string, string | undefined>
  /**
   * When true, await the internal flush queue after ingest (defaults to false).
   */
  flush?: boolean
}

export type LogContext = Record<string, unknown>

export type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface LoggerConfig extends LogOptions {
  /**
   * Minimum level emitted by this logger (defaults to "info").
   */
  level?: LogLevel
}

export type LogOverrides = LogOptions

interface ResolvedConfig {
  dataset: string
  clientOptions: ClientOptions
}

const clientCache = new Map<string, Axiom>()

let importMetaEnv: Record<string, string | undefined> | undefined
let importMetaEnvChecked = false

export class Logger {
  private readonly baseOptions: Omit<LoggerConfig, "metadata" | "level">
  private readonly level: LogLevel
  private readonly metadata: Record<string, unknown>
  private resolved?: ResolvedConfig
  private client?: Axiom

  constructor(config: LoggerConfig = {}, resolved?: ResolvedConfig, client?: Axiom) {
    const { level, metadata, ...rest } = config
    this.baseOptions = rest
    this.level = level ?? "info"
    this.metadata = { ...(metadata ?? {}) }
    this.resolved = resolved
    this.client = client
  }

  /**
   * Log with an explicit level.
   */
  async log(
    level: LogLevel,
    value: LoggableValue,
    contextOrOverrides?: LogContext | LogOverrides,
    overridesMaybe?: LogOverrides
  ): Promise<void> {
    await this.dispatch(level, value, contextOrOverrides, overridesMaybe)
  }

  debug = (
    value: LoggableValue,
    contextOrOverrides?: LogContext | LogOverrides,
    overridesMaybe?: LogOverrides
  ): Promise<void> => this.dispatch("debug", value, contextOrOverrides, overridesMaybe)

  info = (
    value: LoggableValue,
    contextOrOverrides?: LogContext | LogOverrides,
    overridesMaybe?: LogOverrides
  ): Promise<void> => this.dispatch("info", value, contextOrOverrides, overridesMaybe)

  warn = (
    value: LoggableValue,
    contextOrOverrides?: LogContext | LogOverrides,
    overridesMaybe?: LogOverrides
  ): Promise<void> => this.dispatch("warn", value, contextOrOverrides, overridesMaybe)

  error = (
    value: LoggableValue,
    contextOrOverrides?: LogContext | LogOverrides,
    overridesMaybe?: LogOverrides
  ): Promise<void> => this.dispatch("error", value, contextOrOverrides, overridesMaybe)

  /**
   * Create a derived logger that automatically applies additional metadata.
   */
  with(context: LogContext = {}): Logger {
    return new Logger(
      {
        ...this.baseOptions,
        metadata: { ...this.metadata, ...context },
        level: this.level,
      },
      this.resolved,
      this.client
    )
  }

  private async dispatch(
    level: LogLevel,
    value: LoggableValue,
    contextOrOverrides?: LogContext | LogOverrides,
    overridesMaybe?: LogOverrides
  ): Promise<void> {
    if (!shouldLog(level, this.level)) {
      return
    }

    const { context, overrides } = splitContextAndOverrides(contextOrOverrides, overridesMaybe)
    const { resolved, client } = this.resolve(overrides)
    const metadata = mergeMetadata(this.metadata, overrides?.metadata, context)
    const event = normalizeEvent(value, metadata)
    await client.ingest(
      resolved.dataset,
      event,
      overrides?.ingestOptions ?? this.baseOptions.ingestOptions
    )

    if (overrides?.flush ?? this.baseOptions.flush) {
      await client.flush()
    }
  }

  private resolve(overrides?: LogOverrides): { resolved: ResolvedConfig; client: Axiom } {
    if (!overrides || !hasConnectionOverrides(overrides)) {
      return this.ensureBaseConnection()
    }

    const merged: LogOptions = {
      ...this.baseOptions,
      ...overrides,
    }

    const resolved = resolveConfig(merged)
    const client = getClient(resolved.clientOptions)
    return { resolved, client }
  }

  private ensureBaseConnection(): { resolved: ResolvedConfig; client: Axiom } {
    if (!this.resolved || !this.client) {
      const resolved = resolveConfig(this.baseOptions)
      this.resolved = resolved
      this.client = getClient(resolved.clientOptions)
    }
    return { resolved: this.resolved, client: this.client }
  }
}

export function createLogger(config: LoggerConfig = {}): Logger {
  return new Logger(config)
}

type LogArgs = [
  value: LoggableValue,
  contextOrOverrides?: LogContext | LogOverrides,
  overridesMaybe?: LogOverrides
]

export interface LogFunction {
  (...args: LogArgs): Promise<void>
  debug(...args: LogArgs): Promise<void>
  info(...args: LogArgs): Promise<void>
  warn(...args: LogArgs): Promise<void>
  error(...args: LogArgs): Promise<void>
  with(context: LogContext): Logger
  logger: Logger
}

export const defaultLogger = createLogger()

export const log: LogFunction = Object.assign(
  async (...args: LogArgs) => defaultLogger.info(...args),
  {
    debug: (...args: LogArgs) => defaultLogger.debug(...args),
    info: (...args: LogArgs) => defaultLogger.info(...args),
    warn: (...args: LogArgs) => defaultLogger.warn(...args),
    error: (...args: LogArgs) => defaultLogger.error(...args),
    with: (context: LogContext) => defaultLogger.with(context),
    logger: defaultLogger,
  }
)

function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[threshold]
}

function splitContextAndOverrides(
  contextOrOverrides?: LogContext | LogOverrides,
  overridesMaybe?: LogOverrides
): { context?: LogContext; overrides?: LogOverrides } {
  if (isLogOptions(contextOrOverrides)) {
    return { overrides: contextOrOverrides }
  }

  const context = isPlainObject(contextOrOverrides) ? (contextOrOverrides as LogContext) : undefined
  const overrides = isLogOptions(overridesMaybe) ? overridesMaybe : undefined
  return { context, overrides }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const OVERRIDE_KEYS = new Set<keyof LogOverrides>([
  "dataset",
  "token",
  "orgId",
  "url",
  "metadata",
  "ingestOptions",
  "env",
  "flush",
])

function isLogOptions(value: unknown): value is LogOverrides {
  if (!isPlainObject(value)) {
    return false
  }
  for (const key of Object.keys(value)) {
    if (OVERRIDE_KEYS.has(key as keyof LogOverrides)) {
      return true
    }
  }
  return false
}

function hasConnectionOverrides(overrides: LogOverrides): boolean {
  return (
    overrides.dataset !== undefined ||
    overrides.token !== undefined ||
    overrides.orgId !== undefined ||
    overrides.url !== undefined ||
    overrides.env !== undefined
  )
}

function resolveConfig(options: LogOptions): ResolvedConfig {
  const dataset = options.dataset ?? readEnv("AXIOM_DATASET", options.env)
  if (!dataset) {
    throw new Error(
      "Missing dataset: set AXIOM_DATASET (or VITE_AXIOM_DATASET) in the environment or pass dataset explicitly."
    )
  }

  const token = options.token ?? readEnv("AXIOM_TOKEN", options.env)
  if (!token) {
    throw new Error(
      "Missing token: set AXIOM_TOKEN (or VITE_AXIOM_TOKEN) in the environment or pass token explicitly."
    )
  }

  const orgId = options.orgId ?? readEnv("AXIOM_ORG_ID", options.env)
  const url = options.url ?? readEnv("AXIOM_URL", options.env)

  return {
    dataset,
    clientOptions: { token, orgId, url },
  }
}

function readEnv(key: string, provided?: Record<string, string | undefined>): string | undefined {
  const candidates = [key]
  if (!key.startsWith("VITE_")) {
    candidates.push(`VITE_${key}`)
  }

  for (const candidate of candidates) {
    const fromProvided = valueFrom(provided, candidate)
    if (fromProvided !== undefined) return fromProvided

    const fromProcess = valueFrom(
      typeof process !== "undefined" ? (process.env as Record<string, string | undefined>) : undefined,
      candidate
    )
    if (fromProcess !== undefined) return fromProcess

    const fromImportMeta = valueFrom(getImportMetaEnv(), candidate)
    if (fromImportMeta !== undefined) return fromImportMeta
  }

  return undefined
}

function getImportMetaEnv(): Record<string, string | undefined> | undefined {
  if (!importMetaEnvChecked) {
    importMetaEnvChecked = true
    try {
      importMetaEnv = (import.meta as { env?: Record<string, string | undefined> }).env
    } catch {
      importMetaEnv = undefined
    }
  }
  return importMetaEnv
}

function valueFrom(
  source: Record<string, string | undefined> | undefined,
  key: string
): string | undefined {
  const value = source?.[key]
  return value === undefined || value === "" ? undefined : value
}

function getClient(options: ClientOptions): Axiom {
  const key = [options.token, options.orgId ?? "", options.url ?? ""].join("|")
  const cached = clientCache.get(key)
  if (cached) {
    return cached
  }
  const client = new Axiom({
    token: options.token,
    orgId: options.orgId,
    url: options.url,
  })
  clientCache.set(key, client)
  return client
}

function mergeMetadata(
  base: Record<string, unknown>,
  overrides?: Record<string, unknown>,
  context?: Record<string, unknown>
): Record<string, unknown> {
  const entries: Record<string, unknown>[] = [base]
  if (overrides) entries.push(overrides)
  if (context) entries.push(context)
  if (entries.length === 1) {
    return { ...base }
  }
  return Object.assign({}, ...entries)
}

function normalizeEvent(
  value: LoggableValue,
  metadata: Record<string, unknown> = {}
): Record<string, unknown> {
  const base: Record<string, unknown> = {}

  if (value instanceof Error) {
    base.message = value.message
    base.name = value.name
    if (value.stack) {
      base.stack = value.stack
    }
    const { cause, ...rest } = value as Error & Record<string, unknown>
    for (const [key, val] of Object.entries(rest)) {
      if (!(key in base)) {
        base[key] = val
      }
    }
    if (cause && typeof cause === "object") {
      base.cause = cause
    }
  } else if (value && typeof value === "object") {
    Object.assign(base, value as Record<string, unknown>)
  } else if (typeof value === "string") {
    base.message = value
  } else if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    base.value = value
  } else if (value === null) {
    base.value = null
  } else if (value === undefined) {
    base.value = undefined
  }

  return { ...base, ...metadata }
}
