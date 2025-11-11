import { Logger, type LoggerConfig } from "./logging.js"
import { ErrorReporter, type ErrorReporterOptions } from "./errors.js"

export interface OneFocusOptions {
  logging?: LoggerConfig
  errors?: ErrorReporterOptions
}

export interface OneFocusInstance {
  logger: Logger
  reporter: ErrorReporter
  err: (
    context: Parameters<ErrorReporter["capture"]>[0],
    description: string,
    error?: unknown
  ) => Promise<void>
}

export function create1Focus(options: OneFocusOptions = {}): OneFocusInstance {
  const logger = options.logging ? new Logger(options.logging) : new Logger()
  const reporter = new ErrorReporter(options.errors ?? {}, logger)
  const errFn = reporter.capture.bind(reporter) as OneFocusInstance["err"]

  return {
    logger,
    reporter,
    err: errFn,
  }
}
