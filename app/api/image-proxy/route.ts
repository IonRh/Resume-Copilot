export const runtime = "edge";
export const dynamic = "force-dynamic";

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("url") || "";
    if (!raw) return badRequest("Missing url");

    let target: URL;
    try { target = new URL(raw); } catch { return badRequest("Invalid url"); }
    if (!/^https?:$/i.test(target.protocol)) return badRequest("Only http/https allowed");

    // Basic SSRF protection: block localhost and private ranges
    const hostname = target.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return badRequest("Blocked host");
    }

    const res = await fetch(target.toString(), {
      headers: {
        // Some servers require a UA to return image bytes
        "user-agent": "Mozilla/5.0 (compatible; ResumeExporter/1.0)",
        "accept": "image/avif,image/webp,image/apng,image/*;q=0.8,*/*;q=0.5",
      },
    });
    if (!res.ok || !res.body) {
      return badRequest(`Upstream fetch failed: ${res.status} ${res.statusText}`, 502);
    }
    const ct = res.headers.get("content-type") || "application/octet-stream";
    const headers = new Headers({
      "content-type": ct,
      // Short cache to reduce repeated fetches during export
      "cache-control": "public, max-age=60",
    });
    return new Response(res.body, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || "");
    return badRequest(msg, 500);
  }
}

