import { existsSync } from "node:fs";
import { join } from "node:path";

// Chromium-based browsers already on the machine, used when Playwright's own
// managed Chromium is missing. On Linux arm64 (Raspberry Pi OS / Debian)
// Playwright often has no build to download at all, so the distro's
// chromium package is the only browser there is.
export function systemBrowserCandidates(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean).flatMap((base) => [
      join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(base, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    ]);
  }
  if (platform === "linux") {
    return ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser"];
  }
  return [];
}

export function findSystemBrowser(platform = process.platform, env = process.env) {
  return systemBrowserCandidates(platform, env).find((path) => existsSync(path)) || null;
}
