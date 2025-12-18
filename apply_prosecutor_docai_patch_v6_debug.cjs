const fs = require("fs");
const file = "server/src/analysis/evaluate.ts";
if (!fs.existsSync(file)) throw new Error("Missing " + file);
const src = fs.readFileSync(file, "utf8");
if (src.includes("DEBUG_OCR_PROVIDER")) {
  console.log("Debug already present");
  process.exit(0);
}
const out = src.replace(
  /const\s+provider\s*=\s*getOcrProviderFromEnv\([^)]+\);/,
  match => match + `\n    console.log("DEBUG_OCR_PROVIDER", provider.kind);`
);
fs.copyFileSync(file, file + ".bak." + Date.now());
fs.writeFileSync(file, out, "utf8");
console.log("✅ Added DEBUG_OCR_PROVIDER log line");