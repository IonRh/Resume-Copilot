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
