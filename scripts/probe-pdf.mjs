import { existsSync } from "node:fs"

const healthUrl = process.env.HEALTH_URL || "http://localhost:3000/api/pdf/health"

async function probeHealth() {
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    console.log("HEALTH status:", res.status)
    console.log("HEALTH body:", text)
  } catch (e) {
    console.log("HEALTH error:", e.message)
  }
}

async function probeChromium() {
  try {
    const { configureChromiumRuntimeEnv } = await import("../lib/chromium.ts")
    configureChromiumRuntimeEnv()
    const { default: chromium } = await import("@sparticuz/chromium")
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || ""
    console.log("platform:", process.platform)
    console.log("PUPPETEER_EXECUTABLE_PATH:", envPath || "(empty)")
    console.log("CHROME_PATH:", process.env.CHROME_PATH || "(empty)")
    let resolved = envPath
    if (!resolved) {
      try {
        resolved = await chromium.executablePath()
      } catch (e) {
        console.log("chromium.executablePath error:", e.message)
      }
    }
    console.log("resolved executable:", resolved || "(none)")
    if (resolved) console.log("exists:", existsSync(resolved))
  } catch (e) {
    console.log("chromium probe error:", e.message)
  }
}

await probeHealth()
await probeChromium()
