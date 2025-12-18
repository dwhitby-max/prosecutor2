/**
 * apply_prosecutor_docai_patch_v5b.cjs
 * Removes the [DOC] wrapper from mergedText in server/src/analysis/evaluate.ts
 * using simple, reliable string replacement.
 */

const fs = require("fs");

const FILE = "server/src/analysis/evaluate.ts";

function backup(p) {
  const b = `${p}.bak.${Date.now()}`;
  fs.copyFileSync(p, b);
  return b;
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error("Missing:", FILE);
    process.exit(1);
  }

  const src = fs.readFileSync(FILE, "utf8");

  // This is the exact fragment your grep line indicates is present:
  // mergedText += `\n\n[DOC]\n${finalText}\n`;
  const needle = "\\n\\n[DOC]\\n${finalText}\\n";
  if (!src.includes(needle)) {
    // Fallback: find any template literal append that contains [DOC] and finalText
    const re = /mergedText\s*\+=\s*`[\s\S]*?$begin:math:display$DOC$end:math:display$[\s\S]*?\$\{finalText\}[\s\S]*?`;/m;
    const m = src.match(re);
    if (!m) {
      console.error("❌ Could not find [DOC] mergedText append to replace.");
      console.error("Run: sed -n '110,150p' server/src/analysis/evaluate.ts");
      process.exit(1);
    }
    const replaced = m[0].replace(/\[DOC\]\s*\n?/g, "");
    backup(FILE);
    fs.writeFileSync(FILE, src.replace(m[0], replaced), "utf8");
    console.log("✅ Removed [DOC] from mergedText append (regex fallback).");
    return;
  }

  const out = src.replace(needle, "\\n\\n${finalText}\\n");
  backup(FILE);
  fs.writeFileSync(FILE, out, "utf8");
  console.log("✅ Removed [DOC] wrapper from mergedText append.");
}

main();