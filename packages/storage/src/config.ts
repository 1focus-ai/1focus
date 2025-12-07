import { Effect } from "effect"
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { R2ConfigError, parseR2Url, type R2Config } from "./r2.js"

// Global config directory
const CONFIG_DIR = join(homedir(), ".config", "1focus")
const CONFIG_FILE = join(CONFIG_DIR, "r2.env")

/**
 * Load R2 config with fallback chain:
 * 1. R2_URL environment variable
 * 2. Individual R2_* environment variables
 * 3. Global config file (~/.config/1focus/r2.env)
 */
export const loadR2Config = (): R2Config | null => {
  // 1. Try R2_URL env var first
  const r2Url = process.env.R2_URL
  if (r2Url) {
    try {
      return parseR2Url(r2Url)
    } catch {
      return null
    }
  }

  // 2. Try individual env vars
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicUrl = process.env.R2_PUBLIC_URL

  if (accountId && accessKeyId && secretAccessKey && bucket) {
    return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl }
  }

  // 3. Try global config file
  if (existsSync(CONFIG_FILE)) {
    try {
      const content = readFileSync(CONFIG_FILE, "utf-8")
      const lines = content.split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith("R2_URL=")) {
          const url = trimmed.slice("R2_URL=".length).trim()
          return parseR2Url(url)
        }
      }
    } catch {
      return null
    }
  }

  return null
}

/**
 * Load R2 config as Effect
 */
export const loadR2ConfigEffect = Effect.gen(function* () {
  const config = loadR2Config()
  if (!config) {
    return yield* Effect.fail(
      new R2ConfigError({
        message: `No R2 config found. Run 'npx @1focus/storage init' to set up.`,
      }),
    )
  }
  return config
})

/**
 * Save R2 URL to global config
 */
export const saveGlobalConfig = (r2Url: string): void => {
  // Ensure directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  // Write config
  writeFileSync(CONFIG_FILE, `R2_URL=${r2Url}\n`, "utf-8")
}

/**
 * Get global config path
 */
export const getConfigPath = (): string => CONFIG_FILE

/**
 * Check if global config exists
 */
export const hasGlobalConfig = (): boolean => existsSync(CONFIG_FILE)
