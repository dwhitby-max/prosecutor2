import express from "express";

export const statutesRouter = express.Router();

statutesRouter.get("/ut/:citation", async (req, res) => {
  try {
    const citation = String(req.params.citation || "").trim().replace(/[–—]/g, "-");
    const m = citation.match(/^(\d{1,3})-(\d{1,4}[a-z]?)-(.+)$/i);
    if (!m) return res.status(400).json({ ok: false, error: "Bad citation format" });

    const title = m[1];
    const chapter = m[2];
    const section = m[3];

    const url = `https://le.utah.gov/xcode/Title${title}/Chapter${chapter}/${title}-${chapter}-S${section}.html`;

    const r = await fetch(url);
    const html = await r.text();
    if (!r.ok) return res.status(404).json({ ok: false, error: `HTTP ${r.status}`, url });

    // Convert HTML -> plain text (removes nav/headers)
    const text = htmlToText(html);
    if (!text) return res.status(500).json({ ok: false, error: "Could not parse statute text", url });

    return res.json({ ok: true, citation, url, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: msg });
  }
});

function htmlToText(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+\n/g, "\n\n")
    .trim();

  return t;
}