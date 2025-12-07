#!/usr/bin/env node
import { existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { saveGlobalConfig, getConfigPath, hasGlobalConfig, loadR2Config } from "./config.js"
import { parseR2Url, toR2Url } from "./r2.js"

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
})

const prompt = (question: string): Promise<string> =>
  new Promise((resolve) => rl.question(question, resolve))

const promptSecret = (question: string): Promise<string> =>
  new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode?.(true)
    stdin.resume()

    let input = ""
    const onData = (char: Buffer) => {
      const c = char.toString()
      if (c === "\n" || c === "\r") {
        stdin.removeListener("data", onData)
        stdin.setRawMode?.(wasRaw ?? false)
        stdin.pause()
        process.stdout.write("\n")
        resolve(input)
      } else if (c === "\x03") {
        // Ctrl+C
        process.exit(1)
      } else if (c === "\x7f") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1)
        }
      } else {
        input += c
      }
    }
    stdin.on("data", onData)
  })

async function init() {
  console.log("=== @1focus/storage Setup ===\n")

  if (hasGlobalConfig()) {
    const config = loadR2Config()
    if (config) {
      console.log(`Existing config found at ${getConfigPath()}`)
      console.log(`  Bucket: ${config.bucket}`)
      console.log(`  Account: ${config.accountId.slice(0, 8)}...`)
      console.log("")
      const overwrite = await prompt("Overwrite? (y/N): ")
      if (overwrite.toLowerCase() !== "y") {
        console.log("Keeping existing config.")
        rl.close()
        return
      }
      console.log("")
    }
  }

  console.log("Get your R2 credentials from Cloudflare Dashboard:")
  console.log("  1. Go to https://dash.cloudflare.com")
  console.log("  2. Select your account → R2 Object Storage")
  console.log("  3. Create a bucket (if needed)")
  console.log("  4. Go to 'Manage R2 API Tokens' → Create API Token")
  console.log("     - Permissions: Object Read & Write")
  console.log("")
  console.log("Your Account ID is in the dashboard URL:")
  console.log("  dash.cloudflare.com/<ACCOUNT_ID>/r2")
  console.log("")

  const accountId = await prompt("Account ID: ")
  const accessKeyId = await prompt("Access Key ID: ")
  const secretAccessKey = await promptSecret("Secret Access Key: ")
  const bucket = await prompt("Bucket name: ")
  const publicUrl = await prompt("Public URL (optional, press enter to skip): ")

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.log("\nError: All fields except Public URL are required.")
    rl.close()
    process.exit(1)
  }

  const r2Url = toR2Url({
    accountId: accountId.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
    bucket: bucket.trim(),
    publicUrl: publicUrl.trim() || undefined,
  })

  // Validate
  try {
    parseR2Url(r2Url)
  } catch (e) {
    console.log(`\nError: Invalid config - ${e}`)
    rl.close()
    process.exit(1)
  }

  saveGlobalConfig(r2Url)
  console.log(`\n✓ Saved to ${getConfigPath()}`)
  console.log("")
  console.log("Usage in your code:")
  console.log('  import { R2, R2FromEnv } from "@1focus/storage"')
  console.log("  import { Effect } from \"effect\"")
  console.log("")
  console.log("  Effect.gen(function* () {")
  console.log("    const r2 = yield* R2")
  console.log("    yield* r2.put(\"hello.txt\", \"Hello!\")")
  console.log("  }).pipe(Effect.provide(R2FromEnv))")
  console.log("")

  rl.close()
}

async function status() {
  const configPath = getConfigPath()
  const config = loadR2Config()

  console.log("=== @1focus/storage Status ===\n")
  console.log(`Config file: ${configPath}`)
  console.log(`Exists: ${existsSync(configPath) ? "yes" : "no"}`)
  console.log("")

  if (config) {
    console.log("Configuration:")
    console.log(`  Account ID: ${config.accountId}`)
    console.log(`  Bucket: ${config.bucket}`)
    console.log(`  Public URL: ${config.publicUrl || "(not set)"}`)
    console.log(`  Access Key: ${config.accessKeyId.slice(0, 8)}...`)
  } else {
    console.log("No configuration found.")
    console.log("Run 'npx @1focus/storage init' to set up.")
  }
}

async function main() {
  const command = process.argv[2]

  switch (command) {
    case "init":
    case "setup":
      await init()
      break
    case "status":
    case "info":
      await status()
      break
    default:
      console.log("@1focus/storage CLI")
      console.log("")
      console.log("Commands:")
      console.log("  init    - Set up R2 credentials")
      console.log("  status  - Show current configuration")
      console.log("")
      console.log("Usage:")
      console.log("  npx @1focus/storage init")
      console.log("  npx @1focus/storage status")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
