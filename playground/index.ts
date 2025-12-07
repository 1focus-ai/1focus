import { Console, Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { R2, R2FromUrl } from "@1focus/storage"

const program = Effect.gen(function* () {
  yield* Console.log("=== @1focus/storage Playground ===\n")

  const r2 = yield* R2

  // Upload text
  yield* Console.log("Uploading hello.txt...")
  const obj = yield* r2.put("playground/hello.txt", "Hello from playground!", {
    contentType: "text/plain",
  })
  yield* Console.log(`Uploaded: ${obj.key} (${obj.size} bytes)`)
  if (obj.url) {
    yield* Console.log(`URL: ${obj.url}`)
  }

  // Read it back
  yield* Console.log("\nReading hello.txt...")
  const text = yield* r2.getText("playground/hello.txt")
  yield* Console.log(`Content: "${text}"`)

  // Upload JSON
  yield* Console.log("\nUploading data.json...")
  yield* r2.putJson("playground/data.json", {
    name: "playground test",
    timestamp: new Date().toISOString(),
  })

  // Read JSON
  const data = yield* r2.getJson<{ name: string; timestamp: string }>(
    "playground/data.json",
  )
  yield* Console.log(`JSON: ${JSON.stringify(data)}`)

  // List objects
  yield* Console.log("\nListing playground/...")
  const list = yield* r2.list({ prefix: "playground/" })
  for (const item of list.objects) {
    yield* Console.log(`  - ${item.key} (${item.size} bytes)`)
  }

  // Cleanup
  yield* Console.log("\nCleaning up...")
  yield* r2.deleteMany(["playground/hello.txt", "playground/data.json"])
  yield* Console.log("Done!")
})

const r2Url = process.env.R2_URL
if (!r2Url) {
  console.log("Missing R2_URL environment variable")
  console.log("Format: r2://ACCESS_KEY:SECRET@ACCOUNT_ID/BUCKET")
  process.exit(1)
}

program.pipe(
  Effect.provide(R2FromUrl(r2Url)),
  Effect.catchAll((error) =>
    Console.log(`Error: ${error._tag ?? "Unknown"} - ${String(error)}`),
  ),
  NodeRuntime.runMain,
)
