import express from "express";
import { lookupUtahCode } from "../analysis/statutes.js";

export const statutesRouter = express.Router();

statutesRouter.get("/ut/:citation", async (req, res) => {
  try {
    const citation = String(req.params.citation || "").trim().replace(/[–—]/g, "-");
    const m = citation.match(/^(\d{1,3}[a-z]?)-(\d{1,4}[a-z]?)-(.+)$/i);
    if (!m) return res.status(400).json({ ok: false, error: "Bad citation format" });

    const result = await lookupUtahCode(citation);
    
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 
                     result.reason === 'rate_limited' ? 429 : 500;
      return res.status(status).json({ 
        ok: false, 
        error: result.details || result.reason,
        url: result.urlTried 
      });
    }

    return res.json({ 
      ok: true, 
      citation: result.citation, 
      url: result.url, 
      statuteText: result.text,
      title: result.title,
      source: result.source
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: msg });
  }
});
