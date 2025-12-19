import { db } from "../../db.js";
import { statuteCache } from "../../../shared/schema.js";
import { eq, and, gt, desc } from "drizzle-orm";
import * as cheerio from 'cheerio';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchWithPlaywright } from './playwrightFetcher.js';

const USE_PLAYWRIGHT_FALLBACK = process.env.USE_PLAYWRIGHT_FALLBACK !== 'false';

// Debug temp file logging for statute extraction troubleshooting
const DEBUG_STATUTE_EXTRACTION = process.env.DEBUG_STATUTE_EXTRACTION === 'true';

function saveDebugFiles(citation: string, rawHtml: string, extractedText: string | null): void {
  if (!DEBUG_STATUTE_EXTRACTION) return;
  
  try {
    const tmpDir = path.join(process.cwd(), 'tmp', 'statute_debug');
    fs.mkdirSync(tmpDir, { recursive: true });
    
    const safeFilename = citation.replace(/[^a-zA-Z0-9-]/g, '_');
    const timestamp = Date.now();
    
    // Save first 2000 chars of raw HTML
    const htmlFile = path.join(tmpDir, `${safeFilename}_${timestamp}_raw.html`);
    fs.writeFileSync(htmlFile, rawHtml.slice(0, 2000));
    console.log(`[DEBUG] Saved raw HTML (first 2000 chars) to: ${htmlFile}`);
    
    // Save extracted text
    const textFile = path.join(tmpDir, `${safeFilename}_${timestamp}_extracted.txt`);
    fs.writeFileSync(textFile, extractedText || '(NULL - extraction failed)');
    console.log(`[DEBUG] Saved extracted text to: ${textFile}`);
  } catch (e) {
    console.log(`[DEBUG] Failed to save debug files: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}

function logHtmlAnalysis(citation: string, html: string, source: string): void {
  const htmlLen = html.length;
  const citationParts = citation.match(/^(\d{1,3}[a-z]?)-(\d{1,4}[a-z]?)-(.+)$/i);
  
  const searchPhrases = [
    { name: 'Title', pattern: /title/i },
    { name: 'Section', pattern: /section/i },
    { name: 'Chapter', pattern: /chapter/i },
    { name: 'secdiv', pattern: /#secdiv|id="secdiv"|id='secdiv'/i },
    { name: 'Subsection (1)', pattern: /\(1\)/ },
    { name: 'Subsection (a)', pattern: /\(a\)/ },
    { name: 'versionDefault', pattern: /versionDefault/i },
  ];
  
  if (citationParts) {
    searchPhrases.push({ name: `Citation ${citation}`, pattern: new RegExp(citation.replace(/-/g, '[-\\s]?'), 'i') });
    searchPhrases.push({ name: `Title ${citationParts[1]}`, pattern: new RegExp(`title\\s*${citationParts[1]}`, 'i') });
  }
  
  console.log(`[HTML_ANALYSIS] ${source} for ${citation}: ${htmlLen} chars`);
  
  const found: string[] = [];
  const notFound: string[] = [];
  
  for (const phrase of searchPhrases) {
    if (phrase.pattern.test(html)) {
      found.push(phrase.name);
    } else {
      notFound.push(phrase.name);
    }
  }
  
  console.log(`  Found: ${found.join(', ') || 'NONE'}`);
  if (notFound.length > 0) {
    console.log(`  Missing: ${notFound.join(', ')}`);
  }
  
  const first200 = html.slice(0, 200).replace(/\s+/g, ' ');
  console.log(`  Preview: "${first200}..."`);
}

export type StatuteSource = 'utah_legislature' | 'west_valley_city_municipal_codes';

export type StatuteLookupResult =
  | { ok: true; source: StatuteSource; citation: string; title: string | null; text: string; url: string; fetchedAtIso: string; cached?: boolean }
  | { ok: false; citation: string; reason: 'not_found' | 'network_error' | 'parse_error' | 'rate_limited' | 'unsupported'; details: string; urlTried: string | null };

const CACHE_TTL_HOURS = 48;

// Navigation keywords that indicate we got the wrong content
// NOTE: These are multi-word phrases to avoid false positives on legal text
// Single words like "Search", "Menu", "Home", "Contact" removed - they appear in statutes
const NAVIGATION_KEYWORDS = [
  'Find a Bill',
  'House Bills',
  'Senate Bills', 
  'Session Information',
  'Legislative Meetings',
  'Interim Meetings',
  'Utah State Legislature',
  'Bills, Memorials',
  'Quick Links',
  'Legislative Schedule',
  'Skip to content',
  'Skip to Content',
  'Main Navigation',
  'Site Navigation',
  'All Legislators',
  'Find Legislators',
  'Keyword Search',
  'Browse by',
];

// Minimum length for valid statute text (increased for better quality)
const MIN_STATUTE_LENGTH = 400;

// Critical navigation phrases that IMMEDIATELY disqualify text as statute content
// If ANY of these appear (case-insensitive), the text is navigation HTML, not statute content
// All comparisons done in lowercase
// Navigation phrases that indicate this is NOT real statute content
// NOTE: Avoid single generic words like "search", "home", "contact" that appear in legal text
// (e.g., "search warrant", "home detention", "contact with victim")
const CRITICAL_NAV_PHRASES = [
  'skip to content',
  'skip to main content',
  'skip to navigation',
  'skip navigation',
  'accessibility settings',
  'use the settings button',
  'all legislators',
  'find legislators',
  'view bills',
  'find a bill',
  'utah state legislature',
  'main navigation',
  'site navigation',
  'navigation menu',
  'main menu',
  'site menu',
  'my account',
  'site map',
  'privacy policy',
  'terms of use',
  'house bills',
  'senate bills',
  'quick links',
  // Additional specific navigation phrases from le.utah.gov
  // NOTE: Only include phrases that are DEFINITELY navigation, not legal terms
  'download as pdf',
  'download as rtf',
  'select a title from',
  'select a chapter from',
  'browse by title',
  'browse by chapter',
  'click to view',
  'click to download',
  'click to expand',
  'expand all sections',
  'collapse all sections',
  'legislative calendar',
  'bill status',
  'bill tracking',
];

// Validates that statute text is actual statute content, not navigation HTML
export function validateStatuteContent(citation: string, text: string): { valid: boolean; reason?: string } {
  if (!text || text.length < MIN_STATUTE_LENGTH) {
    return { valid: false, reason: `Text too short (<${MIN_STATUTE_LENGTH} chars, got ${text?.length || 0})` };
  }
  
  // All comparisons done in lowercase
  const lowerText = text.toLowerCase();
  
  // CRITICAL: Reject if ANY critical navigation phrase is found
  for (const phrase of CRITICAL_NAV_PHRASES) {
    if (lowerText.includes(phrase)) {
      return { valid: false, reason: `Contains critical navigation phrase: "${phrase}"` };
    }
  }
  
  // Check for general navigation keywords - if too many, it's navigation HTML
  let navKeywordCount = 0;
  for (const keyword of NAVIGATION_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      navKeywordCount++;
    }
  }
  
  if (navKeywordCount >= 3) {
    return { valid: false, reason: `Contains ${navKeywordCount} navigation keywords` };
  }
  
  // REQUIRED: Must contain subsection markers like (1), (a), (i), etc.
  // Statute keywords alone are not sufficient
  const hasSubsectionMarkers = /\(\d+\)|\([a-z]\)|\([ivx]+\)/i.test(text);
  
  if (!hasSubsectionMarkers) {
    return { valid: false, reason: 'Missing required subsection markers like (1), (a), (i)' };
  }
  
  // Check that citation appears in the text (normalized comparison)
  const normCitation = citation.replace(/[^0-9a-z]/gi, '').toLowerCase();
  const normText = text.replace(/[^0-9a-z]/gi, '').toLowerCase();
  
  // For Utah codes like 58-37-8, also check for variations
  const citationParts = citation.match(/^(\d+[a-z]?)-(\d+[a-z]?)-(.+)$/i);
  let citationFound = normText.includes(normCitation);
  
  if (!citationFound && citationParts) {
    // Check for spaced version like "58-37-8" appearing as text
    const spacedCitation = `${citationParts[1]}${citationParts[2]}${citationParts[3]}`.toLowerCase();
    citationFound = normText.includes(spacedCitation);
  }
  
  // Don't require citation match - some statutes have different formats in the body
  // But do log it for debugging
  if (!citationFound) {
    console.log(`[DEBUG] Citation ${citation} not found in statute text, but continuing validation`);
  }
  
  return { valid: true };
}

// Simple boolean wrapper for validation - returns true only for valid statute text
export function isValidStatuteText(text: string | null | undefined): boolean {
  if (!text || text.length < MIN_STATUTE_LENGTH) return false;
  
  // All comparisons done in lowercase
  const lowerText = text.toLowerCase();
  
  // Reject if ANY critical navigation phrase is found
  for (const phrase of CRITICAL_NAV_PHRASES) {
    if (lowerText.includes(phrase)) return false;
  }
  
  // REQUIRED: Must have subsection markers - keywords alone not sufficient
  const hasSubsectionMarkers = /\(\d+\)|\([a-z]\)|\([ivx]+\)/i.test(text);
  
  return hasSubsectionMarkers;
}

async function getCachedStatute(citation: string): Promise<StatuteLookupResult | null> {
  try {
    const cutoffTime = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);
    const cached = await db.select().from(statuteCache)
      .where(and(
        eq(statuteCache.citation, citation),
        gt(statuteCache.fetchedAt, cutoffTime)
      ))
      .orderBy(desc(statuteCache.fetchedAt))
      .limit(1);
    
    if (cached.length > 0) {
      const entry = cached[0];
      
      // Validate cached content - reject navigation HTML that was incorrectly cached
      const validation = validateStatuteContent(entry.citation, entry.text);
      if (!validation.valid) {
        console.log(`[WARN] Cached statute failed validation. Deleting bad cache entry.`);
        console.log(`  id: ${entry.id}`);
        console.log(`  citation: ${entry.citation}`);
        console.log(`  url: ${entry.url}`);
        console.log(`  source: ${entry.source}`);
        console.log(`  fetchedAt: ${entry.fetchedAt.toISOString()}`);
        console.log(`  reason: ${validation.reason}`);
        console.log(`  first200: ${JSON.stringify(entry.text.slice(0, 200))}`);
        // Delete the bad cache entry by row id
        try {
          await db.delete(statuteCache).where(eq(statuteCache.id, entry.id));
          console.log(`[INFO] Deleted bad cache entry id=${entry.id}`);
        } catch (deleteErr) {
          console.log(`[ERROR] Failed to delete bad cache entry id=${entry.id}: ${deleteErr}`);
        }
        return null; // Force fresh fetch
      }
      
      return {
        ok: true,
        source: entry.source as StatuteSource,
        citation: entry.citation,
        title: entry.title,
        text: entry.text,
        url: entry.url,
        fetchedAtIso: entry.fetchedAt.toISOString(),
        cached: true,
      };
    }
  } catch (e) {
    // Cache miss or error - proceed with live fetch
  }
  return null;
}

async function saveToCache(source: StatuteSource, citation: string, title: string | null, text: string, url: string): Promise<void> {
  // Validate before caching - never cache navigation HTML
  const validation = validateStatuteContent(citation, text);
  if (!validation.valid) {
    console.log(`[ERROR] Refusing to cache invalid statute content. NOT writing to DB.`);
    console.log(`  citation: ${citation}`);
    console.log(`  url: ${url}`);
    console.log(`  source: ${source}`);
    console.log(`  reason: ${validation.reason}`);
    console.log(`  first200: ${JSON.stringify(text.slice(0, 200))}`);
    return;
  }
  
  try {
    await db.insert(statuteCache)
      .values({ citation, source, title, text, url, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: statuteCache.citation,
        set: { source, title, text, url, fetchedAt: new Date() }
      });
    console.log(`[INFO] Cached valid statute for ${citation} (${text.length} chars)`);
  } catch (e) {
    console.log(`[ERROR] Failed to cache statute for ${citation}: ${e}`);
  }
}

async function tryPlaywrightFallback(
  citation: string, 
  url: string, 
  startTime: number
): Promise<StatuteLookupResult | null> {
  try {
    console.log(`[PLAYWRIGHT] Attempting headless browser fetch for ${citation}`);
    const result = await fetchWithPlaywright(url, '#secdiv');
    
    if (!result.ok || !result.text) {
      console.log(`[PLAYWRIGHT] Failed to fetch: ${result.error || 'no text'}`);
      return null;
    }
    
    const validation = validateStatuteContent(citation, result.text);
    if (!validation.valid) {
      console.log(`[PLAYWRIGHT] Extracted text failed validation: ${validation.reason}`);
      saveDebugFiles(citation + '_playwright', 'N/A (headless browser)', result.text);
      return null;
    }
    
    const title = firstLine(result.text);
    await saveToCache('utah_legislature', citation, title, result.text, url);
    
    const duration = Date.now() - startTime;
    console.log(`[PLAYWRIGHT] Statute lookup (headless) for ${citation} completed in ${duration}ms, ${result.text.length} chars`);
    
    return {
      ok: true,
      source: 'utah_legislature',
      citation,
      title,
      text: result.text,
      url,
      fetchedAtIso: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.log(`[PLAYWRIGHT] Error during fallback: ${msg}`);
    return null;
  }
}

export async function lookupUtahCode(citation: string): Promise<StatuteLookupResult> {
  const startTime = Date.now();
  const norm = normalize(citation);
  
  // Check cache first
  const cached = await getCachedStatute(norm);
  if (cached) {
    const duration = Date.now() - startTime;
    console.log(`[INFO] Statute lookup (cached) for ${norm} completed in ${duration}ms`);
    return cached;
  }
  
  const url = buildUtahLegUrl(norm);
  if (!url) return { ok: false, citation: norm, reason: 'unsupported', details: 'Unsupported Utah citation format.', urlTried: null };
  
  try {
    // First fetch the main page to get the current version
    const mainRes = await fetch(url);
    
    if (mainRes.status === 404) return { ok: false, citation: norm, reason: 'not_found', details: 'Section not found.', urlTried: url };
    if (mainRes.status === 429) return { ok: false, citation: norm, reason: 'rate_limited', details: 'Rate limited.', urlTried: url };
    if (!mainRes.ok) return { ok: false, citation: norm, reason: 'network_error', details: `HTTP ${mainRes.status}`, urlTried: url };
    
    const mainHtml = await mainRes.text();
    
    // Log HTML analysis for debugging
    logHtmlAnalysis(norm, mainHtml, 'MAIN_PAGE');
    
    // Extract the current version from the JavaScript variable
    // versionDefault="C58-37-S8_2025050720250507";
    const versionMatch = mainHtml.match(/versionDefault\s*=\s*["']([^"']+)["']/);
    
    if (versionMatch) {
      // Fetch the versioned content page which has the actual statute text
      const versionedUrl = url.replace(/[^/]+\.html$/, versionMatch[1] + '.html');
      console.log('Fetching versioned statute:', versionedUrl);
      
      const versionRes = await fetch(versionedUrl);
      if (versionRes.ok) {
        const versionHtml = await versionRes.text();
        
        // Log HTML analysis for versioned page
        logHtmlAnalysis(norm, versionHtml, 'VERSIONED_PAGE');
        
        const parsed = parseVersionedUtahLegHtml(versionHtml);
        
        // Debug logging: save raw HTML and extracted text to temp files
        saveDebugFiles(norm, versionHtml, parsed);
        
        if (parsed && parsed.length > 100) {
          // CRITICAL: Validate content before returning - reject navigation HTML
          const validation = validateStatuteContent(norm, parsed);
          if (validation.valid) {
            const title = firstLine(parsed);
            await saveToCache('utah_legislature', norm, title, parsed, versionedUrl);
            const duration = Date.now() - startTime;
            const logLevel = duration > 2000 ? 'WARN' : 'INFO';
            console.log(`[${logLevel}] Statute lookup (live) for ${norm} completed in ${duration}ms, ${parsed.length} chars`);
            return { ok: true, source: 'utah_legislature', citation: norm, title, text: parsed, url: versionedUrl, fetchedAtIso: new Date().toISOString() };
          } else {
            console.log(`[WARN] Versioned statute for ${norm} failed validation: ${validation.reason}. Will not cache or return.`);
          }
        }
      }
    }
    
    // REMOVED: Main page fallback - it only contains navigation HTML, never real statute content
    // The main page is a shell that loads content via JavaScript - we cannot parse it
    // Only versioned page (#secdiv) or Playwright headless browser can get real content
    
    console.log(`[WARN] Versioned page extraction failed for ${norm}. Trying Playwright fallback...`);
    
    if (USE_PLAYWRIGHT_FALLBACK) {
      const playwrightResult = await tryPlaywrightFallback(norm, url, startTime);
      if (playwrightResult) {
        return playwrightResult;
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[ERROR] All extraction methods failed for ${norm} in ${duration}ms.`);
    return { ok: false, citation: norm, reason: 'parse_error', details: 'Failed to extract statute text. Versioned page not found and Playwright fallback failed.', urlTried: url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error';
    const duration = Date.now() - startTime;
    console.log(`[ERROR] Statute lookup failed for ${norm} in ${duration}ms: ${msg}`);
    return { ok: false, citation: norm, reason: 'network_error', details: msg, urlTried: url };
  }
}

function buildUtahLegUrl(citation: string): string | null {
  // Parse citation like "58-37-8", "76-5-109", "58-37a-5", or "78A-6-1101"
  // Title can be alphanumeric (78A, 26B), Chapter can have letters (37a), Section can be any string
  const m = citation.match(/^(\d{1,3}[a-z]?)-(\d{1,4}[a-z]?)-(.+)$/i);
  if (!m) return null;
  
  const titleNum = m[1].toUpperCase(); // Utah uses uppercase for title letters (78A not 78a)
  const chapterNum = m[2];
  const sectionNum = m[3];
  
  // Build URL: https://le.utah.gov/xcode/Title{title}/Chapter{chapter}/{title}-{chapter}-S{section}.html
  return `https://le.utah.gov/xcode/Title${titleNum}/Chapter${chapterNum}/${titleNum}-${chapterNum}-S${sectionNum}.html`;
}

// Parse the versioned statute content page (has simpler structure with actual content)
// Final guard phrases that indicate navigation content leaked through
// NOTE: These must be specific to navigation - avoid broad words like "search", "home", "contact"
// that appear in legitimate legal text (e.g., "search warrant", "home detention", "contact with victim")
const PARSER_GUARD_PHRASES = [
  'skip to content',
  'skip to main',
  'skip to navigation',
  'main menu',
  'site menu',
  'navigation menu',
  'utah state legislature',
  'all legislators',
  'find legislators',
  'find a bill',
  'view bills',
  'accessibility settings',
  'use the settings button',
  // Additional nav phrases - only very specific navigation patterns
  'download as pdf',
  'download as rtf',
  'browse by title',
  'browse by chapter',
  'select a title from',
  'select a chapter from',
];

function parseVersionedUtahLegHtml(html: string): string | null {
  if (!html || html.trim().length === 0) return null;
  
  try {
    const $ = cheerio.load(html);
    
    // The versioned page has statute content in #secdiv
    const secdiv = $('#secdiv');
    
    if (!secdiv.length) {
      console.log('[PARSER] No #secdiv found');
      return null;
    }
    
    // CRITICAL: Strip nav/header/footer/script/style elements BEFORE extracting text
    // Also remove TOC, breadcrumbs, and any data-nav elements
    secdiv.find('nav, header, footer, script, style, noscript, iframe, .nav, .menu, .header, .footer, #toc, .toc, .breadcrumb, .breadcrumbs, [data-nav], .download, .downloads, .history, .links, .sidebar, .navigation, .table-of-contents').remove();
    
    // Get the section title from the first bold elements
    const boldElements = secdiv.find('b');
    let title = '';
    
    // The title is usually in format: "58-37-8." followed by "Prohibited acts -- Penalties."
    if (boldElements.length >= 2) {
      const sectionNum = boldElements.eq(0).text().trim();
      const sectionTitle = boldElements.eq(1).text().trim();
      if (sectionNum.match(/^\d+-\d+[a-z]?-\S+\.?\s*$/i)) {
        title = `${sectionNum} ${sectionTitle}`;
      } else if (sectionTitle.match(/^\d+-\d+[a-z]?-\S+\.?\s*$/i)) {
        const nextTitle = boldElements.eq(2)?.text().trim() || '';
        title = `${sectionTitle} ${nextTitle}`;
      }
    }
    
    // Extract content from the nested tables - each td with width:99% contains actual statute text
    const contentParts: string[] = [];
    if (title) contentParts.push(title);
    
    // Process the secdiv to extract text in order
    // The structure is: nested tables where subsection markers are in one td and content in adjacent td
    secdiv.find('tr').each((_, tr) => {
      const $tr = $(tr);
      const tds = $tr.children('td');
      
      // Accept rows with 2+ columns where first column is a marker
      if (tds.length >= 2) {
        const marker = $(tds[0]).text().trim();
        
        // Check if this is a subsection marker
        if (marker.match(/^\(\d+\)$/) || marker.match(/^\([a-z]\)$/i) || marker.match(/^\([ivxIVX]+\)$/) || marker.match(/^\([A-Z]\)$/)) {
          // Pull content from td[1] (or concatenate remaining tds)
          const content = $(tds[1]).clone();
          
          // Remove nested tables from content (they're processed separately)
          content.find('table').remove();
          const contentText = content.text().trim().replace(/\s+/g, ' ');
          
          if (contentText.length > 5) {
            contentParts.push(`${marker} ${contentText}`);
          }
        }
      }
    });
    
    if (contentParts.length <= 1) {
      console.log('[PARSER] Not enough content parts extracted from table structure');
      return null;
    }
    
    // Format with proper line breaks
    let result = contentParts[0] + '\n\n'; // Title
    
    for (let i = 1; i < contentParts.length; i++) {
      const part = contentParts[i];
      // Main subsections get double newlines
      if (part.match(/^\(\d+\)\s/)) {
        result += '\n' + part;
      } else if (part.match(/^\([a-z]\)\s/i)) {
        result += '\n  ' + part;
      } else if (part.match(/^\([ivxIVX]+\)\s/) || part.match(/^\([A-Z]\)\s/)) {
        result += '\n    ' + part;
      } else {
        result += '\n' + part;
      }
    }
    
    result = result.trim();
    
    // FINAL GUARD: Validate output before returning
    const lowerResult = result.toLowerCase();
    
    // Check for navigation phrases that indicate bad content
    for (const phrase of PARSER_GUARD_PHRASES) {
      if (lowerResult.includes(phrase)) {
        console.log(`[PARSER] Output contains guard phrase "${phrase}" - rejecting`);
        return null;
      }
    }
    
    // Must have subsection markers like (1), (a), etc.
    if (!/\(\d+\)/.test(result)) {
      console.log('[PARSER] Output lacks (1) style subsection markers - rejecting');
      return null;
    }
    
    // Must meet minimum length
    if (result.length < 400) {
      console.log(`[PARSER] Output too short (${result.length} chars < 400) - rejecting`);
      return null;
    }
    
    return result;
  } catch (e) {
    console.error('[PARSER] Error parsing versioned Utah Legislature HTML:', e);
    return null;
  }
}

// REMOVED: Broad #secdiv.text() fallback - it returned navigation HTML without structure checks
// If table parsing fails, we return null and let lookupUtahCode try Playwright fallback

// REMOVED: parseUtahLegHtml() - This function only extracted navigation HTML from the main page
// The main page is a JavaScript shell that loads content dynamically - there's NO statute content to parse
// Only the versioned page (#secdiv) or Playwright can get real statute text

export async function lookupWvcCode(citation: string): Promise<StatuteLookupResult> {
  const startTime = Date.now();
  const norm = normalize(citation);
  
  // Check cache first
  const cached = await getCachedStatute(norm);
  if (cached) {
    const duration = Date.now() - startTime;
    console.log(`[INFO] WVC code lookup (cached) for ${norm} completed in ${duration}ms`);
    return cached;
  }
  
  const url = `https://westvalleycity.municipal.codes/Code/${encodeURIComponent(norm)}`;
  const result = await fetchHtmlAsText('west_valley_city_municipal_codes', norm, url);
  
  // Save to cache if successful
  if (result.ok) {
    await saveToCache('west_valley_city_municipal_codes', norm, result.title, result.text, result.url);
    const duration = Date.now() - startTime;
    const logLevel = duration > 2000 ? 'WARN' : 'INFO';
    console.log(`[${logLevel}] WVC code lookup (live) for ${norm} completed in ${duration}ms`);
  } else {
    const duration = Date.now() - startTime;
    console.log(`[WARN] WVC code lookup failed for ${norm} in ${duration}ms: ${result.reason}`);
  }
  
  return result;
}

function normalize(c: string): string {
  return c.trim().replace(/\s+/g, '').replace(/–/g, '-').replace(/—/g, '-');
}

async function fetchHtmlAsText(source: StatuteSource, citation: string, url: string): Promise<StatuteLookupResult> {
  try {
    const res = await fetch(url);
    if (res.status === 404) return { ok: false, citation, reason: 'not_found', details: 'Not found.', urlTried: url };
    if (res.status === 429) return { ok: false, citation, reason: 'rate_limited', details: 'Rate limited.', urlTried: url };
    const html = await res.text();
    if (!res.ok) return { ok: false, citation, reason: 'network_error', details: `HTTP ${res.status}`, urlTried: url };

    const parsed = htmlToText(html);
    if (!parsed) return { ok: false, citation, reason: 'parse_error', details: 'Failed to parse HTML.', urlTried: url };

    const title = firstLine(parsed);
    return { ok: true, source, citation, title, text: parsed, url, fetchedAtIso: new Date().toISOString() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, citation, reason: 'network_error', details: msg, urlTried: url };
  }
}

function htmlToText(html: string): string | null {
  if (html.trim().length === 0) return null;
  
  // Remove script, style, nav elements first
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  
  t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\s*\/p\s*>/gi, '\n').replace(/<\s*\/li\s*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ');
  
  // Clean up whitespace
  t = t.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  
  // Find the start of actual statute content (Utah Code Section XX-XX-X)
  const statuteStart = t.match(/Utah Code Section \d+-\d+[a-z]?-\d+/i);
  if (statuteStart && statuteStart.index !== undefined) {
    t = t.substring(statuteStart.index);
  }
  
  // Remove navigation-like content at the start
  const lines = t.split('\n');
  const filteredLines: string[] = [];
  let foundContent = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip very short lines at the beginning
    if (!foundContent && trimmed.length < 10) continue;
    // Skip obvious navigation items
    if (/^(Accessibility|Skip to Content|Settings|Login|Legislature|House Home|Senate Home|All Legislators|View Bills|Browse by Session)$/i.test(trimmed)) continue;
    
    // Start capturing after we see the section title
    if (trimmed.match(/Utah Code Section|^\d+-\d+[a-z]?-\d+/i)) {
      foundContent = true;
    }
    
    if (foundContent || trimmed.length > 30) {
      filteredLines.push(trimmed);
      foundContent = true;
    }
  }
  
  const result = filteredLines.join('\n').trim();
  return result.length > 20 ? result : null;
}

function firstLine(text: string): string | null {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length > 0 ? lines[0].slice(0, 200) : null;
}
