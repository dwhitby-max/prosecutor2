# Utah Case Screener - Full Stack Application

## Overview
A full-stack web application for legal case screening and analysis. The system allows users to upload PDF documents, extracts text from them, analyzes the content for code violations, and maintains a database of cases and their analysis results.

## Architecture

### Technology Stack
- **Frontend:** React + Vite + Tailwind CSS + TypeScript
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **PDF Processing:** pdf-parse / pdfjs-dist

### Project Structure
```
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components (shadcn/ui based)
│   │   ├── pages/          # Route pages (wouter routing)
│   │   └── lib/            # Utilities
│   └── index.html
├── server/                 # Express backend
│   ├── src/
│   │   ├── analysis/       # PDF text extraction and analysis
│   │   └── index.ts        # Main server entry point
│   ├── storage.ts          # Database storage interface
│   ├── db.ts               # Drizzle database connection
│   └── routes.ts           # API routes (alternative entry)
├── shared/                 # Shared types and schema
│   └── schema.ts           # Drizzle database schema
└── drizzle.config.ts       # Drizzle configuration
```

### Database Schema
Located in `shared/schema.ts`:
- **cases** - Main case records with defendant info and status (includes `caseSummaryNarrative` and `legalAnalysis` for AI-generated content)
- **documents** - Uploaded PDF documents linked to cases
- **violations** - Code violations identified in cases (includes `chargeType` field: 'current' or 'historical')
- **criminalRecords** - Criminal history records for defendants
- **caseImages** - Extracted images from PDF documents (base64 encoded)

### AI-Powered Analysis
After case documents are processed, Gemini AI generates:
- **Case Summary Narrative**: A 3-5 paragraph professional summary of the incident, involved parties, officer observations, evidence, and outcome
- **Legal Analysis**: For each charge, compares case facts against statutory requirements with conclusions (SUPPORTED/QUESTIONABLE/INSUFFICIENT EVIDENCE)

Located in `server/src/analysis/legalAnalysis.ts`

### Charge Type Classification
Violations are classified as 'current' or 'historical' based on their source:
- **current**: Charges extracted from the Patrol Screening Sheet charge table (real charges in this case)
- **historical**: Citations detected via fallback text scanning (may include criminal history references)

The frontend filters to only display 'current' charges in the "Current Case Charges" section.

### API Endpoints
- `GET /api/cases` - List all cases
- `GET /api/cases/:id` - Get case with full details (violations, criminal records, documents)
- `POST /api/cases/upload` - Upload PDFs, extract text, create case, run analysis
- `GET /api/statutes?citation=...&jurisdiction=...` - First-class endpoint for statute data (returns {citation, title, statuteText, sourceUrl})

### Frontend Routes
- `/` - Dashboard with case list and statistics
- `/upload` - Upload new case documents
- `/analysis/:id` - View detailed case analysis

## Development

### Running the Application
The application runs via the "Start application" workflow which executes `npm run dev`.

### Database Migrations
Use Drizzle Kit for schema changes:
```bash
npx drizzle-kit push
```

### Building for Production
```bash
npm run build:client  # Build React frontend
npm run build:server  # Compile TypeScript server
```

## Compliance

### Development Principles Compliance
This application follows the Development Principles and Working Agreements Document:

**TypeScript & Type Safety:**
- All code written in TypeScript with strict type checking
- Typed API responses using `ApiResponse<T>` interface
- Proper type annotations for all function parameters and returns

**Database Operations:**
- Drizzle ORM for all database interactions
- Comprehensive logging with timing for performance monitoring (warns if >2s)
- All storage operations logged with operation type, table, duration, and context

**Error Handling:**
- Typed error responses across all API endpoints
- Meaningful error messages for users
- Proper exception handling with fallback messages

**Performance Monitoring:**
- Database query timing logged for performance analysis
- Slow query detection (>2000ms triggers WARN level)
- API call timing tracked for optimization

### Data Integrity
- All case data is stored in PostgreSQL database
- No mock or placeholder data in production paths
- Real PDF text extraction and analysis pipeline
- Proper error handling with meaningful messages

### Security
- No secrets or API keys exposed in code
- Environment variables used for sensitive configuration
- Database connection via secure DATABASE_URL

## Critical Implementation Details

### Protected Sections (DO NOT MODIFY WITHOUT PERMISSION)
The following sections are working correctly and should NOT be changed without explicit user approval:
- **Current Case Charges** - Charge extraction from Patrol Screening Sheet
- **Applicable Utah State Code** - Statute text fetching and display
- **Criminal Records** - Criminal history parsing and display

### Analysis Summary Section
The Analysis Summary section extracts the "Officer's Actions" from the "General Offense Hardcopy" section:
- Located in `server/src/analysis/evaluate.ts` - `extractCaseSynopsis()` function
- Strips page headers (dates, page numbers, department headers) before extraction
- Searches for "General Offense Hardcopy" or "General Offense Harcopy" section
- Extracts content from "Officer's Actions" within that section
- Falls back to searching for "Officer's Actions" anywhere in document

### Utah Statute Text Fetching (DO NOT MODIFY)
Located in `server/src/analysis/statutes.ts` - this is the logic for fetching actual Utah state code text.

**IMPORTANT:** The Utah Legislature website (le.utah.gov) loads content dynamically via JavaScript. The main pages only contain navigation HTML. To get actual statute text:

1. Fetch the main page (e.g., `58-37-S8.html`)
2. Extract the `versionDefault` JavaScript variable which contains the versioned page ID
3. Fetch the versioned page (e.g., `C58-37-S8_2025050720250507.html`) which has the actual content
4. Parse the `#secdiv` div which contains the statute text in nested tables

**Key Functions:**
- `lookupUtahCode()` - Main entry point, handles caching and versioned page fetching
- `parseVersionedUtahLegHtml()` - Parses the versioned content page to extract statute text from #secdiv
- `buildUtahLegUrl()` - Constructs the URL from a citation like "58-37-8"

**CRITICAL: Only Versioned Page Content is Valid**
The main page (e.g., `58-37-S8.html`) is a JavaScript shell that loads content dynamically.
- MAIN_PAGE = navigation HTML only (no statute content) - NEVER cache or return
- VERSIONED_PAGE = actual statute text in #secdiv - ONLY source of valid content
- Playwright fallback = headless browser for JS-rendered pages when versioned fetch fails

**Content Validation (CRITICAL - DO NOT REMOVE):**
The `validateStatuteContent()` function ensures only real statute text is cached/returned:
- Rejects text <400 chars (increased from 200 for better quality)
- Rejects if 3+ navigation keywords found (Find a Bill, House Bills, Skip to content, Search, Menu, Home, Contact, etc.)
- Requires statute structure markers: subsection numbers like (1), (a), or legal keywords
- Auto-deletes cached entries that fail validation
- Returns parse_error instead of navigation HTML (fail-closed behavior)

**Debug Logging:**
Set `DEBUG_STATUTE_EXTRACTION=true` to save raw HTML and extracted text to `tmp/statute_debug/`.

**Playwright Fallback:**
When regular fetch + parsing fails validation, the system automatically falls back to Playwright headless browser:
- Set `USE_PLAYWRIGHT_FALLBACK=false` to disable (enabled by default)
- Uses Chromium with networkidle wait for JS-rendered pages
- Targets #secdiv selector, falls back to cleaned body text
- Browser is pooled and auto-closes after 60s idle
- Located in `server/src/analysis/playwrightFetcher.ts`

**DO NOT:**
- Remove the versioned page fetching logic
- Add back the main page fallback (parseUtahLegHtml was removed - it only returned navigation HTML)
- Remove or weaken the validateStatuteContent() validation
- Cache or return content without validation passing first

### OCR Correction Mapping
Common OCR misreads should be corrected in the charge extraction:
- "57-37A" → "58-37A" (common OCR misread of 5 as 7)

### Statute Text Revert Issue - Root Cause and Fix

**Root Cause:**
The "statute text reverting to navigation HTML" issue was caused by a race condition in the frontend polling logic:
1. When a case had status "processing", the frontend polled every 3 seconds
2. The useEffect had `data?.status` in the dependency array, causing it to re-run when data changed
3. Overlapping fetch requests could return stale responses that overwrote valid statute text
4. The polling loop made double fetches (one to check status, another to update data)

**Fix Applied:**
1. **AbortController**: All fetch requests now use AbortController to cancel pending requests when a new one starts
2. **Sequence tracking**: Each fetch gets a sequence number; stale responses (lower sequence) are discarded
3. **State protection**: New data that would lose statute text (has text → no text) is blocked from updating state
4. **Single fetch per poll**: Changed to single fetch per polling cycle instead of double fetching
5. **Proper cleanup**: Component unmount cancels all pending requests and clears timeouts

**Regression Tests (server/src/analysis/statutes.test.ts):**
- 70 tests validating statute content requirements
- Tests minimum length (>400 chars for Utah, >100 chars for WVC)
- Tests navigation phrase rejection (multi-word phrases like "Skip to content", "Utah State Legislature", "Find a Bill")
- Tests statute structure markers requirement (subsection markers like (1), (a) required for Utah only)
- Tests that legitimate legal terms like "search warrant", "home detention" are allowed
- Tests jurisdiction-aware validation (Utah strict, WVC lenient)
- Run with: `cd server && npx vitest run src/analysis/statutes.test.ts --config vitest.config.ts`

**CRITICAL: How to Protect This Fix from Future Changes:**
1. **Always run tests before modifying statute validation**: `cd server && npm test`
2. **Never modify CRITICAL_NAV_PHRASES without running full test suite**
3. **Multi-layer validation protects against navigation HTML leak:**
   - `validateStatuteContent()` - Primary validation for Utah statutes
   - `isValidStatuteTextAny()` - Jurisdiction-aware wrapper (UT strict, WVC lenient)
   - `isValidStatuteTextWvc()` - Lenient validation for West Valley City
4. **Validation runs at 4 checkpoints:**
   - Before caching in PostgreSQL (statutes.ts `saveToCache()`)
   - When retrieving from PostgreSQL cache (statutes.ts `getCachedStatute()`)
   - When retrieving from SQLite cache (evaluate.ts `cachedStatute()`)
   - Before storing in violations table (index.ts)

**Parser Guard (parseVersionedUtahLegHtml):**
- Strips nav/header/footer/script/style elements BEFORE text extraction
- Accepts table rows with 2+ columns (not just exactly 2)
- Final guard rejects output containing PARSER_GUARD_PHRASES (multi-word nav phrases only)
- Requires (1) style subsection markers in output
- Minimum 400 character length requirement
- Returns null on any guard failure → triggers Playwright fallback

**IMPORTANT: Avoid Generic Single Words in Validation**
Single words like "search", "menu", "home", "contact", "accessibility" were removed from validation:
- They appear in legitimate legal text (e.g., "search warrant", "home detention", "contact with victim")
- Only multi-word navigation phrases are checked (e.g., "skip to content", "find a bill")

### Statute Text Instrumentation
To debug any future issues, comprehensive instrumentation is in place:

**Frontend (client/src/pages/analysis.tsx):**
- `logStatuteState()` - Logs all violation statute text status with timestamps
- `[EFFECT id]` - Tracks useEffect lifecycle for StrictMode double-run detection
- `[FETCH source seq=N]` - Logs every fetch with source (INITIAL/POLL) and sequence number
- `[STATE_UPDATE source action=X]` - Logs all state updates with action taken:
  - `INITIAL` - First data set
  - `BLOCKED` - Prevented statute text loss (prevCount > 0, newCount = 0)
  - `MERGE` - Preserved individual violation statute text when some were lost
  - `REPLACE` - Normal update
- `[RENDER #N]` - Tracks render count with current statute text count
- `[MARK_COMPLETE]` - Logs when marking case complete, confirms text preservation

**State Protection Logic:**
1. Never allow full statute text loss (prevCount > 0 → newCount = 0)
2. Merge strategy: preserve individual violation text when partial loss detected
3. AbortController cancels stale requests, sequence tracking discards stale responses
4. useEffect cleanup prevents updates after unmount

**Backend (server/src/index.ts):**
- GET /api/cases/:id logs each response with statute text status
- Shows hasStatuteText, hasStatuteUrl, and 50-char preview

**Cache Validation (server/src/analysis/statutes.ts):**
- getCachedStatute() validates content before returning
- Deletes bad cache entries that fail validation
- 3-layer validation prevents navigation HTML from being stored or returned
