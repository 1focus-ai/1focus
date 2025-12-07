# @1focus/storage

Cloudflare R2 storage with Effect.

## Install

```bash
bun add @1focus/storage effect @effect/platform @effect/platform-node
```

## Setup

Get your R2 credentials from [Cloudflare Dashboard](https://dash.cloudflare.com) → R2 → Manage R2 API Tokens.

Set the `R2_URL` environment variable:

```bash
R2_URL=r2://ACCESS_KEY:SECRET@ACCOUNT_ID/BUCKET
```

Optional: Add public URL for public access:

```bash
R2_URL=r2://ACCESS_KEY:SECRET@ACCOUNT_ID/BUCKET?publicUrl=https://pub-xxx.r2.dev
```

## Usage

```typescript
import { Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { R2, R2FromUrl } from "@1focus/storage"

const program = Effect.gen(function* () {
  const r2 = yield* R2

  // Upload text
  yield* r2.put("hello.txt", "Hello world!", { contentType: "text/plain" })

  // Upload JSON
  yield* r2.putJson("data.json", { name: "test", value: 42 })

  // Read text
  const text = yield* r2.getText("hello.txt")

  // Read JSON
  const data = yield* r2.getJson<{ name: string }>("data.json")

  // Get raw bytes
  const bytes = yield* r2.get("file.bin")

  // Check if exists
  const exists = yield* r2.exists("hello.txt")

  // Get metadata
  const meta = yield* r2.head("hello.txt")

  // List objects
  const list = yield* r2.list({ prefix: "uploads/" })

  // List all (handles pagination)
  const all = yield* r2.listAll("uploads/")

  // Copy
  yield* r2.copy("hello.txt", "hello-backup.txt")

  // Delete
  yield* r2.delete("hello.txt")

  // Delete many
  yield* r2.deleteMany(["file1.txt", "file2.txt"])

  // Get public URL (if publicUrl configured)
  const url = r2.getPublicUrl("hello.txt")
})

program.pipe(
  Effect.provide(R2FromUrl(process.env.R2_URL!)),
  NodeRuntime.runMain,
)
```

## API

### `R2FromUrl(url: string)`

Create R2 layer from connection string.

### `R2Live(config: R2Config)`

Create R2 layer from config object:

```typescript
import { R2Live } from "@1focus/storage"

const layer = R2Live({
  accountId: "...",
  accessKeyId: "...",
  secretAccessKey: "...",
  bucket: "my-bucket",
  publicUrl: "https://pub-xxx.r2.dev", // optional
})
```

### Methods

| Method | Description |
|--------|-------------|
| `put(key, body, options?)` | Upload data (string, ArrayBuffer, Uint8Array) |
| `putJson(key, data, options?)` | Upload JSON |
| `get(key)` | Get raw bytes |
| `getText(key)` | Get as text |
| `getJson<T>(key)` | Get as JSON |
| `head(key)` | Get metadata |
| `exists(key)` | Check if exists |
| `list(options?)` | List objects |
| `listAll(prefix?)` | List all objects (handles pagination) |
| `copy(src, dest)` | Copy object |
| `delete(key)` | Delete object |
| `deleteMany(keys)` | Delete multiple objects |
| `getPublicUrl(key)` | Get public URL |

### Options

```typescript
interface R2PutOptions {
  contentType?: string
  contentDisposition?: string
  cacheControl?: string
  customMetadata?: Record<string, string>
}

interface R2ListOptions {
  prefix?: string
  delimiter?: string
  cursor?: string
  limit?: number
}
```

## Error Handling

```typescript
import { R2Error, R2NotFoundError } from "@1focus/storage"

program.pipe(
  Effect.catchTag("R2NotFoundError", (e) =>
    Console.log(`Not found: ${e.key}`),
  ),
  Effect.catchTag("R2Error", (e) =>
    Console.log(`R2 error: ${e.message}`),
  ),
)
```
