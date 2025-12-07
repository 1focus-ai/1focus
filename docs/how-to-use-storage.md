# @1focus/storage

Cloudflare R2 storage with Effect. Zero-config after initial setup.

## Install

```bash
bun add @1focus/storage effect @effect/platform @effect/platform-node
```

## Setup (one-time)

```bash
npx @1focus/storage init
```

This prompts for your R2 credentials and saves them globally to `~/.config/1focus/r2.env`. You only need to do this once per machine.

To get credentials:
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2 Object Storage
2. Create a bucket (if needed)
3. Go to "Manage R2 API Tokens" → Create API Token
4. Your Account ID is in the URL: `dash.cloudflare.com/<ACCOUNT_ID>/r2`

## Usage

```typescript
import { Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { R2, R2FromEnv } from "@1focus/storage"

const program = Effect.gen(function* () {
  const r2 = yield* R2

  // Upload
  yield* r2.put("hello.txt", "Hello world!")
  yield* r2.putJson("data.json", { name: "test" })

  // Read
  const text = yield* r2.getText("hello.txt")
  const data = yield* r2.getJson<{ name: string }>("data.json")

  // List & manage
  const list = yield* r2.list({ prefix: "uploads/" })
  yield* r2.delete("hello.txt")
})

program.pipe(Effect.provide(R2FromEnv), NodeRuntime.runMain)
```

That's it. No environment variables needed in your project.

## Config Resolution

`R2FromEnv` looks for config in this order:
1. `R2_URL` environment variable
2. Individual `R2_*` environment variables
3. Global config at `~/.config/1focus/r2.env`

## CLI Commands

```bash
npx @1focus/storage init     # Set up credentials
npx @1focus/storage status   # Show current config
```

## API Reference

### Layer Providers

| Function | Description |
|----------|-------------|
| `R2FromEnv` | Auto-loads config (recommended) |
| `R2FromUrl(url)` | From connection string |
| `R2Live(config)` | From config object |

### R2 Service Methods

| Method | Description |
|--------|-------------|
| `put(key, body, options?)` | Upload data |
| `putJson(key, data, options?)` | Upload JSON |
| `get(key)` | Get raw bytes |
| `getText(key)` | Get as text |
| `getJson<T>(key)` | Get as JSON |
| `head(key)` | Get metadata |
| `exists(key)` | Check if exists |
| `list(options?)` | List objects |
| `listAll(prefix?)` | List all (handles pagination) |
| `copy(src, dest)` | Copy object |
| `delete(key)` | Delete object |
| `deleteMany(keys)` | Delete multiple |
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

## Per-Project Override

If you need different buckets per project, set `R2_URL` in that project's `.env`:

```bash
R2_URL=r2://ACCESS_KEY:SECRET@ACCOUNT_ID/my-bucket
```

This takes precedence over the global config.
