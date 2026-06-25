import { existsSync } from "node:fs";
import path from "node:path";

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function configureChromiumRuntimeEnv() {
  if (process.platform !== "linux") {
    return;
  }

  // Keep Chromium extraction/runtime work on the Linux filesystem in WSL.
  process.env.TMPDIR = "/tmp";
  process.env.TMP = "/tmp";
  process.env.TEMP = "/tmp";

  const localLibDirs = [
    path.join(process.cwd(), ".runtime", "chromium-libs", "usr", "lib", "x86_64-linux-gnu"),
    path.join(process.cwd(), ".runtime", "chromium-libs", "lib", "x86_64-linux-gnu"),
  ].filter((dir) => existsSync(dir));

  if (!localLibDirs.length) {
    return;
  }

  const currentDirs = (process.env.LD_LIBRARY_PATH || "")
    .split(":")
    .filter(Boolean);

  process.env.LD_LIBRARY_PATH = unique([...localLibDirs, ...currentDirs]).join(":");
}

function resolveWindowsChromePath(): string {
  const candidates = unique([
    process.env.PUPPETEER_EXECUTABLE_PATH || "",
    process.env.CHROME_PATH || "",
    process.env.CHROME_BIN || "",
    process.env.GOOGLE_CHROME_BIN || "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe")
      : "",
    process.env.LocalAppData ? path.join(process.env.LocalAppData, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")
      : "",
    process.env.LocalAppData ? path.join(process.env.LocalAppData, "Microsoft", "Edge", "Application", "msedge.exe") : "",
  ]);

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

export async function resolveChromiumExecutablePath(
  chromium?: { executablePath: () => Promise<string> },
): Promise<{ executablePath: string; usingSystemChrome: boolean }> {
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.CHROME_BIN ||
    process.env.GOOGLE_CHROME_BIN ||
    "";

  if (envPath && existsSync(envPath)) {
    return { executablePath: envPath, usingSystemChrome: true };
  }

  if (process.platform === "win32") {
    const systemChrome = resolveWindowsChromePath();
    if (systemChrome) {
      return { executablePath: systemChrome, usingSystemChrome: true };
    }
  }

  const bundledPath = chromium ? await chromium.executablePath().catch(() => "") : "";
  if (bundledPath && existsSync(bundledPath)) {
    return { executablePath: bundledPath, usingSystemChrome: false };
  }

  return { executablePath: "", usingSystemChrome: false };
}
