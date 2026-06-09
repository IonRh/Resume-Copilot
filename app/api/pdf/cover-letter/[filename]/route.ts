import { configureChromiumRuntimeEnv } from "@/lib/chromium"
import type { CoverLetterPrintPayload } from "@/lib/cover-letter-pdf"
import { getAuthCookieValue } from "@/lib/server/pdf-auth-cookie"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 180

declare global {
  var __PDF_CACHE__: Map<string, { data: Uint8Array; expires: number }> | undefined
}
const PDF_CACHE: Map<string, { data: Uint8Array; expires: number }> =
  globalThis.__PDF_CACHE__ ?? (globalThis.__PDF_CACHE__ = new Map())

function setPdfTokenCookie(token: string) {
  const maxAge = 300
  return `pdfToken=${token}; Path=/api/pdf; Max-Age=${maxAge}; SameSite=Lax`
}

function getPdfTokenFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie") || ""
  const m = cookie.match(/(?:^|;\s*)pdfToken=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function getOrigin(req: Request) {
  try {
    const u = new URL(req.url)
    if (u.origin) return u.origin
  } catch {
    /* ignore */
  }
  const proto = (req.headers.get("x-forwarded-proto") || req.headers.get("scheme") || "http").split(",")[0].trim()
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim()
  if (!host) return ""
  return `${proto}://${host}`
}

async function readCoverLetterData(req: Request): Promise<CoverLetterPrintPayload | null> {
  let coverLetterData: CoverLetterPrintPayload | null = null
  const ct = (req.headers.get("content-type") || "").toLowerCase()
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null)
    coverLetterData = body?.coverLetterData ?? body
  } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    try {
      const form = await req.formData()
      const val = form.get("coverLetterData")
      if (typeof val === "string") {
        coverLetterData = JSON.parse(val)
      } else if (val instanceof Blob) {
        coverLetterData = JSON.parse(await val.text())
      }
    } catch {
      /* ignore */
    }
  } else {
    const text = await req.text().catch(() => "")
    if (text) {
      try {
        coverLetterData = JSON.parse(text)
      } catch {
        /* ignore */
      }
    }
  }
  return coverLetterData
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ filename: string }> | { filename: string } },
) {
  try {
    configureChromiumRuntimeEnv()
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ])

    const coverLetterData = await readCoverLetterData(req)
    if (!coverLetterData) {
      return new Response(JSON.stringify({ error: "Missing coverLetterData" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }

    const origin = getOrigin(req)
    if (!origin) {
      return new Response(JSON.stringify({ error: "Cannot resolve origin" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }
    const url = `${origin}/print/cover-letter`

    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || ""
    const executablePath = envPath || (await chromium.executablePath())
    if (!executablePath) {
      return new Response(JSON.stringify({ error: "Chromium executable not found (set PUPPETEER_EXECUTABLE_PATH)" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    }
    const usingSystemChrome = !!envPath
    const launchArgs = usingSystemChrome
      ? ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]
      : chromium.args
    const chromiumLaunchDefaults = chromium as unknown as Pick<import("puppeteer-core").LaunchOptions, "headless">
    const headless: import("puppeteer-core").LaunchOptions["headless"] =
      usingSystemChrome ? true : (chromiumLaunchDefaults.headless ?? true)
    const browser = await puppeteer.launch({
      args: launchArgs,
      defaultViewport: { width: 1200, height: 1600, deviceScaleFactor: 2 },
      executablePath,
      headless,
    })
    const page = await browser.newPage()
    let pdf: Buffer | Uint8Array = Buffer.alloc(0)

    try {
      const cookieValue = getAuthCookieValue(req)
      if (cookieValue) {
        await page.setCookie({
          name: "site_auth",
          value: cookieValue,
          url: origin,
          path: "/",
        })
      }
    } catch {
      /* ignore */
    }

    try {
      await page.evaluateOnNewDocument((data) => {
        try {
          window.sessionStorage.setItem("coverLetterPrintData", JSON.stringify(data))
        } catch {
          /* ignore */
        }
      }, coverLetterData)
      await page.emulateMediaType("print")
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 })
      try {
        await page.waitForSelector(".cover-letter-print-content, .pdf-preview-mode", { timeout: 40000 })
      } catch {
        await new Promise((r) => setTimeout(r, 1000))
      }
      try {
        const anyPage = page as unknown as { waitForNetworkIdle?: (opts: { idleTime?: number; timeout?: number }) => Promise<void> }
        if (typeof anyPage.waitForNetworkIdle === "function") {
          await anyPage.waitForNetworkIdle({ idleTime: 300, timeout: 20000 })
        } else {
          await new Promise((r) => setTimeout(r, 300))
        }
      } catch {
        await new Promise((r) => setTimeout(r, 300))
      }
      try {
        await page.waitForFunction(() => {
          const root = document.querySelector(".cover-letter-print-content")
          if (!root) return false
          return !!root.querySelector(".ProseMirror, .cover-letter-print-body p, .cover-letter-print-body li")
        }, { timeout: 60000 })
      } catch {
        /* ignore */
      }
      try {
        await page.evaluate(async () => {
          const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
          if (fonts?.ready) await fonts.ready
        })
      } catch {
        /* ignore */
      }

      async function doPrint() {
        return await page.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: true,
        })
      }

      try {
        pdf = await doPrint()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "")
        if (/Target closed|Execution context was destroyed/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 300))
          pdf = await doPrint()
        } else {
          throw e
        }
      }
    } finally {
      await browser.close().catch(() => undefined)
    }

    const awaitedParams = await Promise.resolve(
      (ctx as { params: { filename: string } | Promise<{ filename: string }> }).params,
    )
    const inputName = awaitedParams.filename || "cover-letter.pdf"
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
    PDF_CACHE.set(token, { data: Buffer.from(pdf), expires: Date.now() + 5 * 60 * 1000 })

    const loc = new URL(req.url)
    const redirectUrl = `${loc.origin}/api/pdf/cover-letter/${encodeURIComponent(inputName)}?token=${encodeURIComponent(token)}`
    return new Response(null, {
      status: 303,
      headers: {
        Location: redirectUrl,
        "set-cookie": setPdfTokenCookie(token),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ filename: string }> | { filename: string } },
) {
  try {
    const url = new URL(req.url)
    const tokenFromQuery = url.searchParams.get("token")
    const token = tokenFromQuery || getPdfTokenFromRequest(req)
    const cached = token ? PDF_CACHE.get(token) : undefined
    if (cached && cached.expires > Date.now()) {
      const awaitedParams = await Promise.resolve(
        (ctx as { params: { filename: string } | Promise<{ filename: string }> }).params,
      )
      const inputName = awaitedParams.filename || "cover-letter.pdf"
      const rawNameUnsafe = decodeURIComponent(inputName)
      const rawName = rawNameUnsafe.replace(/[\r\n]/g, "_").replace(/\//g, "_")
      const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, "_")
      const utf8Star = `UTF-8''${encodeURIComponent(rawName)}`
      const body = new Uint8Array(cached.data).buffer
      return new Response(body, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename=\"${asciiFallback}\"; filename*=${utf8Star}`,
          "cache-control": "no-store",
        },
      })
    }
    return new Response(JSON.stringify({ error: "PDF cache expired. Please regenerate." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })
  }
}
