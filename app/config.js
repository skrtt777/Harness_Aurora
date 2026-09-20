import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Only development loads the project's .env. Installed apps use userData and
// explicit environment overrides; never read an arbitrary working directory.
if (!process.versions.electron || !import.meta.url.includes("app.asar")) {
  try { loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url))); }
  catch (error) { if (error.code !== "ENOENT") console.warn("Não foi possível carregar .env:", error.message); }
}
