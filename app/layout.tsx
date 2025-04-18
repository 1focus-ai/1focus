import "./globals.css"
import type { Metadata, Viewport } from "next"
import { Manrope } from "next/font/google"

export const metadata: Metadata = {
  title: "1Focus",
  description: "Your AI companion",
}
export const viewport: Viewport = {
  maximumScale: 1,
}
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
})
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>{children}</body>
    </html>
  )
}
