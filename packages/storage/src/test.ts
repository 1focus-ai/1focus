import { Console, Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { R2, R2Live, R2FromUrl, parseR2Url, type R2Config } from "./index.js"

const getConfig = (): R2Config | null => {
  // Try R2_URL first (single connection string)
  const r2Url = process.env.R2_URL
  if (r2Url) {
    try {
      return parseR2Url(r2Url)
    } catch {
      console.error("Invalid R2_URL format")
      return null
    }
  }

  // Fall back to individual env vars
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicUrl = process.env.R2_PUBLIC_URL

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl }
}

const runTests = (config: R2Config) => {
  const program = Effect.gen(function* () {
    yield* Console.log("=== @1focus/storage R2 Test ===\n")
    yield* Console.log(`Bucket: ${config.bucket}`)
    if (config.publicUrl) {
      yield* Console.log(`Public URL: ${config.publicUrl}`)
    }
    yield* Console.log("")

    const r2 = yield* R2

    // Test 1: Put text
    yield* Console.log("1. Uploading text file...")
    const textObj = yield* r2.put("test/hello.txt", "Hello from @1focus/storage!", {
      contentType: "text/plain",
      customMetadata: { source: "test" },
    })
    yield* Console.log(`   Key: ${textObj.key}`)
    yield* Console.log(`   Size: ${textObj.size} bytes`)
    if (textObj.url) {
      yield* Console.log(`   URL: ${textObj.url}`)
    }

    // Test 2: Put JSON
    yield* Console.log("\n2. Uploading JSON...")
    const jsonObj = yield* r2.putJson("test/data.json", {
      name: "@1focus/storage test",
      timestamp: new Date().toISOString(),
      version: "0.0.1",
    })
    yield* Console.log(`   Key: ${jsonObj.key}`)

    // Test 3: Get text
    yield* Console.log("\n3. Reading text file...")
    const text = yield* r2.getText("test/hello.txt")
    yield* Console.log(`   Content: "${text}"`)

    // Test 4: Get JSON
    yield* Console.log("\n4. Reading JSON...")
    const json = yield* r2.getJson<{ name: string; timestamp: string }>("test/data.json")
    yield* Console.log(`   Name: ${json.name}`)
    yield* Console.log(`   Timestamp: ${json.timestamp}`)

    // Test 5: Head (metadata)
    yield* Console.log("\n5. Getting metadata...")
    const meta = yield* r2.head("test/hello.txt")
    yield* Console.log(`   Size: ${meta.size} bytes`)
    yield* Console.log(`   ETag: ${meta.etag}`)
    yield* Console.log(`   Content-Type: ${meta.httpMetadata?.contentType}`)

    // Test 6: Exists
    yield* Console.log("\n6. Checking existence...")
    const exists = yield* r2.exists("test/hello.txt")
    const notExists = yield* r2.exists("test/nonexistent.txt")
    yield* Console.log(`   test/hello.txt: ${exists}`)
    yield* Console.log(`   test/nonexistent.txt: ${notExists}`)

    // Test 7: List
    yield* Console.log("\n7. Listing objects...")
    const list = yield* r2.list({ prefix: "test/" })
    yield* Console.log(`   Found ${list.objects.length} object(s):`)
    for (const obj of list.objects) {
      yield* Console.log(`     - ${obj.key} (${obj.size} bytes)`)
    }

    // Test 8: Copy
    yield* Console.log("\n8. Copying object...")
    const copied = yield* r2.copy("test/hello.txt", "test/hello-copy.txt")
    yield* Console.log(`   Copied to: ${copied.key}`)

    // Test 9: Cleanup
    yield* Console.log("\n9. Cleaning up...")
    yield* r2.deleteMany(["test/hello.txt", "test/hello-copy.txt", "test/data.json"])
    yield* Console.log("   Deleted test objects")

    // Verify
    const afterDelete = yield* r2.list({ prefix: "test/" })
    yield* Console.log(`   Remaining: ${afterDelete.objects.length}`)

    yield* Console.log("\n=== Test Complete ===")
  }).pipe(
    Effect.provide(R2Live(config)),
    Effect.catchAll((error) =>
      Console.log(`\nError: ${error._tag ?? "Unknown"} - ${String(error)}`),
    ),
  )

  program.pipe(NodeRuntime.runMain)
}

// Main
const config = getConfig()
if (config) {
  runTests(config)
} else {
  console.log("=== @1focus/storage R2 Test ===\n")
  console.log("Missing R2 configuration.\n")
  console.log("Option 1 - Single connection string (recommended):")
  console.log("  export R2_URL=r2://ACCESS_KEY:SECRET@ACCOUNT_ID/BUCKET\n")
  console.log("Option 2 - Individual env vars:")
  console.log("  export R2_ACCOUNT_ID=...")
  console.log("  export R2_ACCESS_KEY_ID=...")
  console.log("  export R2_SECRET_ACCESS_KEY=...")
  console.log("  export R2_BUCKET=...")
  console.log("  export R2_PUBLIC_URL=... (optional)\n")
  console.log("Run 'flow setup' to configure interactively.")
}
