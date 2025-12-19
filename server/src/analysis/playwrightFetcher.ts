import { chromium, Browser, BrowserContext } from 'playwright';

let browserInstance: Browser | null = null;
let browserContext: BrowserContext | null = null;
let lastUsed = 0;
const BROWSER_IDLE_TIMEOUT = 60000;
const PAGE_TIMEOUT = 15000;

let idleCheckInterval: ReturnType<typeof setInterval> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    lastUsed = Date.now();
    return browserInstance;
  }
  
  console.log('[PLAYWRIGHT] Launching headless browser...');
  browserInstance = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  lastUsed = Date.now();
  
  if (!idleCheckInterval) {
    idleCheckInterval = setInterval(async () => {
      if (browserInstance && Date.now() - lastUsed > BROWSER_IDLE_TIMEOUT) {
        console.log('[PLAYWRIGHT] Closing idle browser');
        await closeBrowser();
        if (idleCheckInterval) {
          clearInterval(idleCheckInterval);
          idleCheckInterval = null;
        }
      }
    }, 10000);
  }
  
  return browserInstance;
}

async function getContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  
  if (browserContext) {
    return browserContext;
  }
  
  browserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  
  return browserContext;
}

export async function closeBrowser(): Promise<void> {
  if (browserContext) {
    await browserContext.close().catch(() => {});
    browserContext = null;
  }
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

export interface PlaywrightFetchResult {
  ok: boolean;
  text: string | null;
  error?: string;
}

export async function fetchWithPlaywright(url: string, selector?: string): Promise<PlaywrightFetchResult> {
  const startTime = Date.now();
  let page = null;
  
  try {
    console.log(`[PLAYWRIGHT] Fetching: ${url}`);
    
    const context = await getContext();
    page = await context.newPage();
    
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });
    
    let extractedText: string | null = null;
    
    if (selector) {
      try {
        const element = await page.$(selector);
        if (element) {
          extractedText = await element.innerText();
          console.log(`[PLAYWRIGHT] Extracted ${extractedText?.length || 0} chars from selector: ${selector}`);
        }
      } catch (selectorErr) {
        console.log(`[PLAYWRIGHT] Selector ${selector} not found, falling back to body`);
      }
    }
    
    if (!extractedText) {
      extractedText = await page.evaluate(() => {
        const nav = document.querySelectorAll('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .menu, #skipNav, #header, #footer, #leftNav, #topNav');
        nav.forEach(el => el.remove());
        
        const main = document.querySelector('#secdiv') || document.querySelector('#content') || document.querySelector('main') || document.body;
        return (main as HTMLElement).innerText || '';
      });
      console.log(`[PLAYWRIGHT] Extracted ${extractedText?.length || 0} chars from page body`);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[PLAYWRIGHT] Fetch completed in ${duration}ms`);
    
    const cleanedText = cleanExtractedText(extractedText);
    
    return { ok: true, text: cleanedText };
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[PLAYWRIGHT] Error: ${msg}`);
    return { ok: false, text: null, error: msg };
    
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

function cleanExtractedText(text: string | null): string | null {
  if (!text) return null;
  
  let cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim().toLowerCase();
    const navPhrases = [
      'skip to content',
      'skip to main',
      'skip to navigation',
      'all legislators',
      'find legislators',
      'view bills',
      'quick links',
      'house bills',
      'senate bills',
      'find a bill',
      'utah state legislature',
      'main navigation',
      'site navigation',
      // Only very specific navigation patterns
      'download as pdf',
      'download as rtf',
      'browse by title',
      'browse by chapter',
      'select a title from',
      'select a chapter from',
    ];
    return !navPhrases.some(phrase => trimmed.includes(phrase));
  });
  
  cleaned = filteredLines.join('\n');
  
  cleaned = cleaned
    .replace(/\s*(\(\d+\))\s*/g, '\n\n$1 ')
    .replace(/\s*(\([a-z]\))\s*/g, '\n  $1 ')
    .replace(/\s*(\([ivxIVX]+\))\s*/g, '\n    $1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return cleaned;
}
