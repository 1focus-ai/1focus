import { db } from "@/lib/db/drizzle"
import { User, users } from "@/lib/db/schema"

await main()
console.log("✔️")

async function createUser() {
  // TODO: why are fields like username, tokens required?
  const newUser: User = {
    id: "1",
    email: "x@nikiv.dev",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    username: null,
    tokens: 0,
    unlimitedTokensEndDate: null,
  }
  const [createdUser] = await db.insert(users).values(newUser).returning()
  console.log(createdUser)
}

async function main() {
  await createUser()
}
