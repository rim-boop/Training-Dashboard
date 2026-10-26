// Cloudflare Pages build step: copy only the public pages into dist/.
// Without this, Cloudflare would also publish the repo's other files (README, package.json, ...).
import { mkdirSync, rmSync, readdirSync, copyFileSync } from "node:fs";

const OUT = "dist";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
const pages = readdirSync(".").filter((f) => f.endsWith(".html"));
for (const f of pages) copyFileSync(f, `${OUT}/${f}`);
console.log(`Copied ${pages.length} pages to ${OUT}/: ${pages.join(", ")}`);
