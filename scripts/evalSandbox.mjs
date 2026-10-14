// Every evaluation works with fake personal folders: Desktop, Documentos and Downloads under its own
// temporary folder, so no run ever writes into the person's real ones (one did, 06/10/2026: a chat
// "estimate" spreadsheet in OneDrive\Documentos, removed). Import it before anything from app/.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Evaluations never open the person's Power BI Desktop (it stayed open after the battery, ~1 GB each).
process.env.HARNESS_PBI_OPEN ||= "off";

if (!process.env.HARNESS_KNOWN_FOLDERS) {
  const home = mkdtempSync(join(tmpdir(), "aurora-pessoa-"));
  const folders = { desktop: join(home, "Desktop"), documents: join(home, "Documents"), downloads: join(home, "Downloads"), home };
  for (const dir of [folders.desktop, folders.documents, folders.downloads]) mkdirSync(dir, { recursive: true });
  process.env.HARNESS_KNOWN_FOLDERS = JSON.stringify(folders);
}
