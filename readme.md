# 1Focus

> All inclusive toolkit to build complex apps

## Setup

Install [task](https://taskfile.dev/docs/installation). Then run `task setup` & follow instructions until it says `✔️ you are setup`.

## Commands

Run `task` to see all possible commands.

## Usage

`1focus` ships an ergonomic logging helper that wraps [`@axiomhq/js`](https://github.com/axiomhq/axiom-js) so you can ship events to Axiom from Node or browser code.

```ts
import { log } from "1focus"

await log("hello world")
await log("user signed in", { userId: "123" })
```

Need more control? Create a scoped logger that bundles defaults and context:

```ts
import { createLogger } from "1focus"

const logger = createLogger({
  metadata: { service: "api" },
  flush: true,
})

await logger.info("order placed", { orderId: "ord_123", value: 42.5 })
await logger.error(new Error("checkout failed"), { orderId: "ord_123" })

const requestLogger = logger.with({ requestId: "req_abc" })
await requestLogger.debug("db.query", { durationMs: 32 })
```

### Configuration

Set the following environment variables (or supply overrides when calling `log`):

- `AXIOM_TOKEN` – API token with ingest permissions.
- `AXIOM_DATASET` – Dataset name to receive the events.
- `AXIOM_ORG_ID` _(optional)_ – Only required when using personal tokens.
- `AXIOM_URL` _(optional)_ – Set when using a self-hosted Axiom instance.

For front-end apps built with Vite, use the `VITE_` prefixed variants (e.g. `VITE_AXIOM_TOKEN`).

## Contributing

Any PR to improve is welcome. [codex](https://github.com/openai/codex) & [cursor](https://cursor.com) are nice for dev. Great **working** & **useful** patches are most appreciated (ideally). Issues with bugs or ideas are welcome too.
