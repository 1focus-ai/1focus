import { Logger, type LoggerConfig, type LogContext } from "./logging.js"

export interface ErrorReporterOptions extends LoggerConfig {
  /**
   * Automatically infer and attach the source file from the call stack.
   * Defaults to true.
   */
  captureSource?: boolean

  /**
   * Logical type assigned to emitted error events.
   */
  eventType?: string
}

export type ErrorContext = LogContext & {
  /** Optional absolute or relative file path supplied by the caller. */
  file?: string
  /** Optional nested source object used by some runtimes. */
  source?: {
    file?: string
  }
}

interface NormalizedErrorPayload {
  fields: Record<string, unknown>
  stack?: string
  file?: string
}

export class ErrorReporter {
  private readonly logger: Logger
  private readonly captureSource: boolean
  private readonly eventType: string

  constructor(options: ErrorReporterOptions = {}, logger?: Logger) {
    this.captureSource = options.captureSource ?? true
    this.eventType = options.eventType ?? "1focus:error"
    this.logger = logger ?? new Logger(options)
  }

  async capture(context: ErrorContext = {}, description: string, error?: unknown): Promise<void> {
    const normalized = normalizeError(error)
    const sourceFile = this.captureSource
      ? context.file ?? context.source?.file ?? normalized.file ?? inferFileFromStack(normalized.stack)
      : context.file ?? context.source?.file

    const event: Record<string, unknown> = {
      type: this.eventType,
      level: "error",
      message: description,
      timestamp: new Date().toISOString(),
      ...normalized.fields,
    }

    if (sourceFile) {
      event.source = { file: sourceFile }
    }

    const ctx = Object.keys(context).length > 0 ? { ...context } : undefined
    if (ctx) {
      event.context = ctx
    }

    await this.logger.error(event, ctx)
  }
}

export function createErrorReporter(options: ErrorReporterOptions = {}, logger?: Logger): ErrorReporter {
  return new ErrorReporter(options, logger)
}

let sharedReporter: ErrorReporter | undefined

export async function err(context: ErrorContext = {}, description: string, error?: unknown): Promise<void> {
  if (!sharedReporter) {
    sharedReporter = new ErrorReporter()
  }
  await sharedReporter.capture(context, description, error)
}

function normalizeError(error: unknown): NormalizedErrorPayload {
  if (error instanceof Error) {
    return {
      stack: error.stack,
      file: inferFileFromStack(error.stack),
      fields: {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
        cause: "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined,
      },
    }
  }

  if (error && typeof error === "object") {
    return { fields: { error } }
  }

  if (error !== undefined) {
    return { fields: { error } }
  }

  return { fields: {} }
}

function inferFileFromStack(stack?: string): string | undefined {
  if (!stack) {
    return undefined
  }

  const internalHints = ["node:internal", "1focus/dist", "1focus/src"]
  const lines = stack.split("\n").slice(1)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = trimmed.match(/(?:\(|\s)([^\s()]+):(\d+):(\d+)/)
    if (!match) continue

    const candidate = match[1]
    if (!candidate) {
      continue
    }
    if (internalHints.some((hint) => candidate.includes(hint))) {
      continue
    }
    return candidate
  }

  return undefined
}
