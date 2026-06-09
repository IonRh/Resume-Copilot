// Copyright (c) 2025 wzdnzd
// SPDX-License-Identifier: MIT
import type { ResumeData } from "@/types/resume";
import { configureChromiumRuntimeEnv } from "@/lib/chromium";
import { ensureResumeAvatarOnPage, prepareResumeDataForPdf, resumeDataForSessionStorage, waitForResumeImages } from "@/lib/resume-core/pdf";
import { getAuthCookieValue } from "@/lib/server/pdf-auth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// 简单内存缓存，保存最近一次生成的 PDF，便于浏览器查看器下载时复用
// 使用 globalThis 持久化，避免 dev/HMR 或多实例下模块重载导致的缓存丢失
declare global {
  var __PDF_CACHE__: Map<string, { data: Uint8Array; expires: number }> | undefined;
}
const PDF_CACHE: Map<string, { data: Uint8Array; expires: number }> =
  globalThis.__PDF_CACHE__ ?? (globalThis.__PDF_CACHE__ = new Map());

function setPdfTokenCookie(token: string) {
  // 5 分钟有效
  const maxAge = 300;
  return `pdfToken=${token}; Path=/api/pdf; Max-Age=${maxAge}; SameSite=Lax`;
}

function getPdfTokenFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)pdfToken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function getOrigin(req: Request) {
  try {
    const u = new URL(req.url);
    if (u.origin) return u.origin;
  } catch { }
  const proto = (req.headers.get("x-forwarded-proto") || req.headers.get("scheme") || "http").split(",")[0].trim();
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ filename: string }> | { filename: string } }
) {
  try {
    configureChromiumRuntimeEnv();
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);

    // Body parsing: JSON, form, or raw text(JSON)
    let resumeData: ResumeData | null = null;
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => null);
      resumeData = body?.resumeData ?? body;
    } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      try {
        const form = await req.formData();
        const val = form.get("resumeData");
        if (typeof val === "string") {
          resumeData = JSON.parse(val);
        } else if (val instanceof Blob) {
          const text = await val.text();
          resumeData = JSON.parse(text);
        }
      } catch { }
    } else {
      const text = await req.text().catch(() => "");
      if (text) {
        try { resumeData = JSON.parse(text); } catch { }
      }
    }

    if (!resumeData) {
      return new Response(JSON.stringify({ error: "Missing resumeData" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const origin = getOrigin(req);
    if (!origin) {
      return new Response(JSON.stringify({ error: "Cannot resolve origin" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const url = `${origin}/print`;

    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || "";
    const executablePath = envPath || (await chromium.executablePath());
    if (!executablePath) {
      return new Response(JSON.stringify({ error: "Chromium executable not found (set PUPPETEER_EXECUTABLE_PATH)" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    const usingSystemChrome = !!envPath;
    const launchArgs = usingSystemChrome
      ? ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]
      : chromium.args;
    const chromiumLaunchDefaults = chromium as unknown as Pick<
      import("puppeteer-core").LaunchOptions,
      "headless"
    >;
    const headless: import("puppeteer-core").LaunchOptions["headless"] =
      usingSystemChrome ? true : (chromiumLaunchDefaults.headless ?? true);
    const browser = await puppeteer.launch({
      args: launchArgs,
      defaultViewport: { width: 1200, height: 1600, deviceScaleFactor: 2 },
      executablePath,
      headless,
    });
    const page = await browser.newPage();
    let pdf: Buffer | Uint8Array = Buffer.alloc(0);

    try {
      const cookieValue = getAuthCookieValue(req);
      if (cookieValue) {
        await page.setCookie({
          name: "site_auth",
          value: cookieValue,
          url: origin,
          path: "/",
        });
      }
    } catch {
      // Non-fatal: continue without cookie
    }

    try {
      // Prepare data: inline avatar if remote
      const preparedData = await prepareResumeDataForPdf(resumeData, origin);
      const sessionPayload = resumeDataForSessionStorage(preparedData);
      await page.evaluateOnNewDocument((data) => {
        try {
          window.sessionStorage.setItem("resumeData", JSON.stringify(data));
        } catch { }
      }, sessionPayload);
      await page.emulateMediaType("print");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      try { await page.waitForSelector(".resume-content, .pdf-preview-mode", { timeout: 40000 }); } catch { await new Promise(r => setTimeout(r, 1000)); }
      try {
        const anyPage = page as unknown as { waitForNetworkIdle?: (opts: { idleTime?: number; timeout?: number }) => Promise<void> };
        if (typeof anyPage.waitForNetworkIdle === "function") {
          await anyPage.waitForNetworkIdle({ idleTime: 300, timeout: 20000 });
        } else {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch { await new Promise(r => setTimeout(r, 300)); }
      try {
        await page.waitForFunction(() => {
          const root = document.querySelector('.resume-content');
          if (!root) return false;
          return !!root.querySelector('.ProseMirror, .resume-module p, .resume-module li, .resume-module a, .resume-module span');
        }, { timeout: 60000 });
      } catch { }
      try {
        await page.evaluate(async () => {
          const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
          if (fonts?.ready) {
            await fonts.ready;
          }
        });
      } catch { }

      await ensureResumeAvatarOnPage(page, preparedData.avatar);
      await waitForResumeImages(page);

    async function doPrint() {
      return await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
      });
    }
    try {
      pdf = await doPrint();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || "");
      if (/Target closed|Execution context was destroyed/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 300));
        pdf = await doPrint();
      } else {
        throw e;
      }
    }
    } finally {
      await browser.close().catch(() => undefined);
    }

    // Content-Disposition with filename from URL param (await params for Next.js dynamic APIs)
    const awaitedParams = await Promise.resolve(
      (ctx as { params: { filename: string } | Promise<{ filename: string }> }).params
    );
    const inputName = awaitedParams.filename || "resume.pdf";

    // 生成并缓存 token，供浏览器下载按钮重复请求（GET）时使用
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    PDF_CACHE.set(token, { data: Buffer.from(pdf), expires: Date.now() + 5 * 60 * 1000 });

    // 关键修复：不要直接返回 PDF 正文。
    // 某些浏览器的内置 PDF 查看器在点击“下载”时，会由扩展上下文发起一个新的 GET 请求，
    // 该请求不会携带 Lax Cookie，导致我们基于 Cookie 的缓存命中失败，出现“下载失败/网络错误”。
    // 这里改为 303 重定向到携带 token 的 GET URL，使后续的查看与下载都使用同一个带 token 的地址，
    // 无需依赖 Cookie，从而避免下载失败。
    const loc = new URL(req.url);
    const redirectUrl = `${loc.origin}/api/pdf/${encodeURIComponent(inputName)}?token=${encodeURIComponent(token)}`;
    return new Response(null, {
      status: 303,
      headers: {
        Location: redirectUrl,
        // 仍设置一次 Cookie 作为兜底（同站情况下也可命中）
        "set-cookie": setPdfTokenCookie(token),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ filename: string }> | { filename: string } }
) {
  try {
    // 允许通过 URL 查询参数或 Cookie 携带 token
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get("token");
    const token = tokenFromQuery || getPdfTokenFromRequest(req);
    const cached = token ? PDF_CACHE.get(token) : undefined;
    if (cached && cached.expires > Date.now()) {
      const awaitedParams = await Promise.resolve(
        (ctx as { params: { filename: string } | Promise<{ filename: string }> }).params
      );
      const inputName = awaitedParams.filename || "resume.pdf";
      const rawNameUnsafe = decodeURIComponent(inputName);
      const rawName = rawNameUnsafe.replace(/[\r\n]/g, "_").replace(/\//g, "_");
      const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, "_");
      const utf8Star = `UTF-8''${encodeURIComponent(rawName)}`;
      // Ensure BodyInit is acceptable to TypeScript: pass ArrayBuffer instead of Uint8Array
      const body = new Uint8Array(cached.data).buffer;
      return new Response(body, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename=\"${asciiFallback}\"; filename*=${utf8Star}`,
          "cache-control": "no-store",
        },
      });
    }
    // 若缓存失效或缺失，返回 404，提示用户重新生成
    return new Response(JSON.stringify({ error: "PDF cache expired. Please regenerate." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error instanceof Error ? error.message : String(error)) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
