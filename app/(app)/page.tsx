"use client"

import { useState } from "react"

export default function Page() {
  const [authed, setAuthed] = useState(false)
  return (
    <div className="bg-background text-foreground w-full h-screen">
      <div>{authed ? "Logged In" : "Logged Out"}</div>
    </div>
  )
}
