import { db } from "../../db.js";
import { statuteCache } from "../../../shared/schema.js";
import { eq, ilike, or } from "drizzle-orm";

async function purgeNavCache(): Promise<void> {
  console.log('[PURGE] Searching for cache rows with navigation content...');
  
  const allCached = await db.select().from(statuteCache);
  console.log(`[PURGE] Found ${allCached.length} total cached entries`);
  
  let purged = 0;
  
  for (const entry of allCached) {
    const lowerText = entry.text.toLowerCase();
    const hasSkipToContent = lowerText.includes('skip to content');
    const hasSearch = lowerText.includes('search');
    
    if (hasSkipToContent || hasSearch) {
      console.log(`[PURGE] Deleting navigation cache entry:`);
      console.log(`  id: ${entry.id}`);
      console.log(`  citation: ${entry.citation}`);
      console.log(`  url: ${entry.url}`);
      console.log(`  source: ${entry.source}`);
      console.log(`  fetchedAt: ${entry.fetchedAt.toISOString()}`);
      console.log(`  hasSkipToContent: ${hasSkipToContent}`);
      console.log(`  hasSearch: ${hasSearch}`);
      console.log(`  first200: ${JSON.stringify(entry.text.slice(0, 200))}`);
      
      await db.delete(statuteCache).where(eq(statuteCache.id, entry.id));
      purged++;
    }
  }
  
  console.log(`[PURGE] Complete: ${purged} rows purged, ${allCached.length - purged} rows remain`);
}

purgeNavCache()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[PURGE] Failed:', err);
    process.exit(1);
  });
