// Copyright (c) 2025 wzdnzd
// SPDX-License-Identifier: MIT
import { configureChromiumRuntimeEnv } from "@/lib/chromium";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  try {
    configureChromiumRuntimeEnv();
    const { default: chromium } = await import("@sparticuz/chromium");
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || "";
    const resolvedPath = envPath || (await chromium.executablePath());
    if (!resolvedPath) {
      return new Response(JSON.stringify({ ok: false, error: "No executablePath (set PUPPETEER_EXECUTABLE_PATH)" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }
}
