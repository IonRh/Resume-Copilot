export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getOrigin(req: Request) {
  // Prefer the actual request URL's origin (works in dev and prod)
  try {
    const u = new URL(req.url);
    if (u.origin) return u.origin;
  } catch { }
  // Fallback to headers
  const proto = (req.headers.get("x-forwarded-proto") || req.headers.get("scheme") || "http").split(",")[0].trim();
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

async function toDataUrlIfRemote(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (/^data:/i.test(url)) return url;
  if (/^blob:/i.test(url)) return undefined; // cannot dereference blob: across contexts
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const ct = res.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return url;
  }
}

export async function POST(req: Request) {
  try {
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    // 兼容多种提交方式：application/json、text/plain(JSON字符串)、form-urlencoded/form-data（字段名：resumeData）
    let resumeData: import("@/types/resume").ResumeData | null = null;
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
      ? [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ]
      : chromium.args;
    const headless: import('puppeteer-core').LaunchOptions["headless"] = usingSystemChrome ? true : chromium.headless;
    const browser = await puppeteer.launch({
      args: launchArgs,
      defaultViewport: { width: 1200, height: 1600, deviceScaleFactor: 2 },
      executablePath,
      headless,
    });
    const page = await browser.newPage();
    // If SITE_PASSWORD is set, set the same auth cookie as middleware expects
    try {
      const pwd = (process.env.SITE_PASSWORD ?? "").trim();
      if (pwd) {
        const { createHash } = await import("node:crypto");
        const cookieValue = createHash("sha256").update(pwd).digest("hex");
        await page.setCookie({
          name: "site_auth",
          value: cookieValue,
          url: origin,
          path: "/",
        });
      }
    } catch { /* non-fatal */ }
    // 在任何脚本运行之前，将简历数据写入 sessionStorage，避免超长 URL 及 431 错误
    // 同时将远端头像资源内联为 data URL，避免因网络或拦截导致图片缺失
    const preparedData: import("@/types/resume").ResumeData = { ...resumeData } as import("@/types/resume").ResumeData;
    if (preparedData.avatar) {
      preparedData.avatar = await toDataUrlIfRemote(preparedData.avatar);
    }
    await page.evaluateOnNewDocument((data) => {
      try {
        window.sessionStorage.setItem("resumeData", JSON.stringify(data));
      } catch { }
    }, preparedData);
    await page.emulateMediaType("print");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // 等待关键容器渲染：优先等待 .resume-content；若未出现则退而求其次等待 .pdf-preview-mode
    try {
      await page.waitForSelector(".resume-content, .pdf-preview-mode", { timeout: 20000 });
    } catch {
      // 继续尝试：给客户端再一点时间完成渲染，避免直接失败
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      const anyPage = page as unknown as { waitForNetworkIdle?: (opts: { idleTime?: number; timeout?: number }) => Promise<void> };
      if (typeof anyPage.waitForNetworkIdle === "function") {
        await anyPage.waitForNetworkIdle({ idleTime: 300, timeout: 10000 });
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
    // 等富文本内容（Tiptap）完成渲染：等待 ProseMirror 或段落/列表出现
    try {
      await page.waitForFunction(() => {
        const root = document.querySelector('.resume-content');
        if (!root) return false;
        return !!root.querySelector('.ProseMirror, .resume-module p, .resume-module li, .resume-module a, .resume-module span');
      }, { timeout: 30000 });
    } catch { }
    // 字体就绪
    try {
      await page.evaluate(async () => {
        const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
        if (fonts?.ready) {
          await fonts.ready;
        }
      });
    } catch { }

    async function doPrint() {
      return await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: false,
        // 让 @page 的 margin 生效，避免双重边距引发空白页
        preferCSSPageSize: true,
      });
    }
    let pdf: Buffer | Uint8Array;
    try {
      pdf = await doPrint();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || "");
      if (/Target closed|Execution context was destroyed/i.test(msg)) {
        // retry once after a short delay
        await new Promise((r) => setTimeout(r, 300));
        pdf = await doPrint();
      } else {
        throw e;
      }
    }
    await browser.close();

    // Generate filename and provide ASCII fallback
    const { generatePdfFilename } = await import("@/lib/utils");
    const rawName = generatePdfFilename(String(resumeData?.title || "resume"));
    const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, "_");
    const utf8Star = `UTF-8''${encodeURIComponent(rawName)}`;

    // Ensure BodyInit is acceptable to TypeScript: pass ArrayBuffer
    const body = new Uint8Array(pdf).buffer; // clones to guarantee ArrayBuffer
    return new Response(body, {
      headers: {
        "content-type": "application/pdf",
        // 同时提供 filename 与 filename* 以兼容旧浏览器与非 ASCII 场景
        "content-disposition": `inline; filename="${asciiFallback}"; filename*=${utf8Star}`,
        "cache-control": "no-store",
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
