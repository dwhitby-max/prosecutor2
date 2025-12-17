import { db } from "../../db.js";
import { statuteCache } from "../../../shared/schema.js";
import { validateStatuteContent } from "../analysis/statutes.js";
import { eq } from "drizzle-orm";

async function purgeBadStatuteCache(): Promise<void> {
  console.log('[MIGRATION] Starting one-time purge of invalid statute cache entries...');
  
  const allCached = await db.select().from(statuteCache);
  console.log(`[MIGRATION] Found ${allCached.length} cached statute entries to validate`);
  
  let purged = 0;
  let valid = 0;
  
  for (const entry of allCached) {
    const validation = validateStatuteContent(entry.citation, entry.text);
    
    if (!validation.valid) {
      console.log(`[PURGE] Deleting invalid cache entry:`);
      console.log(`  id: ${entry.id}`);
      console.log(`  citation: ${entry.citation}`);
      console.log(`  url: ${entry.url}`);
      console.log(`  source: ${entry.source}`);
      console.log(`  fetchedAt: ${entry.fetchedAt.toISOString()}`);
      console.log(`  reason: ${validation.reason}`);
      console.log(`  first200: ${JSON.stringify(entry.text.slice(0, 200))}`);
      await db.delete(statuteCache).where(eq(statuteCache.id, entry.id));
      purged++;
    } else {
      valid++;
    }
  }
  
  console.log(`[MIGRATION] Complete: ${purged} purged, ${valid} valid entries remain`);
}

purgeBadStatuteCache()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[MIGRATION] Failed:', err);
    process.exit(1);
  });
