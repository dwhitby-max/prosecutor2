/**
 * apply_prosecutor_docai_patch_v5.cjs
 * Removes [DOC] injection in evaluate.ts and ensures mergedText uses finalText only.
 */

const fs = require("fs");
const path = require("path");

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, "utf8"); }
function backup(p) { const b = `${p}.bak.${Date.now()}`; fs.copyFileSync(p, b); return b; }

function replaceOrThrow(file, re, replacement, label) {
  const src = read(file);
  if (!re.test(src)) throw new Error(`❌ Not found: ${label} in ${file}`);
  backup(file);
  write(file, src.replace(re, replacement));
  console.log(`✅ Patched: ${label}`);
}

function main() {
  const evalTs = "server/src/analysis/evaluate.ts";
  if (!fs.existsSync(evalTs)) throw new Error(`Missing ${evalTs}`);

  // Replace the specific mergedText append that injects [DOC]
  replaceOrThrow(
    evalTs,
    /mergedText\s*\+\=\s*`\\n\\n\$begin:math:display$DOC\\$end:math:display$\\n\\$\\{finalText\\}\\n`;\s*/m,
    `mergedText += \`\\n\\n\${finalText}\\n\`;\n`,
    "Remove [DOC] prefix in mergedText append"
  );

  console.log("\n✅ Patch v5 complete.");
  console.log("Now run:");
  console.log("  npm --prefix server run build");
}

main();