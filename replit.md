# Utah Case Screener - Full Stack Application

## Overview
A full-stack web application for legal case screening and analysis. The system allows users to upload PDF documents, extracts text, analyzes content for code violations, and maintains a database of cases. It uses AI (Gemini AI) to generate case summaries and legal analyses.

## User Preferences
- **Protected Sections (DO NOT MODIFY WITHOUT PERMISSION)**: "Current Case Charges", "Applicable Utah State Code", and "Criminal Records" are working correctly and should NOT be changed without explicit user approval.
- **Utah Statute Text Fetching (DO NOT MODIFY)**: The logic in `server/src/analysis/statutes.ts` for fetching actual Utah state code text is critical and should not be modified.
- **CRITICAL: Only Versioned Page Content is Valid**: Do not remove the versioned page fetching logic, add back the main page fallback, remove or weaken the `validateStatuteContent()` validation, or cache/return content without validation passing first.
- **Always run tests before modifying statute validation**: `cd server && npm test`
- **Never modify CRITICAL_NAV_PHRASES without running full test suite**.
- **IMPORTANT: Avoid Generic Single Words in Validation**: Do not add single words like "search", "menu", "home", "contact", "accessibility" to validation rules as they can appear in legitimate legal text.
- **OCR Correction Mapping**: Common OCR misreads should be corrected in the charge extraction (e.g., "57-37A" → "58-37A").

## System Architecture

### Technology Stack
- **Frontend:** React, Vite, Tailwind CSS, TypeScript
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **PDF Processing:** `pdf-parse` / `pdfjs-dist`
- **Authentication:** Replit Auth (Google/GitHub/Apple/email sign-in)

### Key Features
- **AI-Powered Analysis:** Gemini AI generates case summary narratives and legal analyses, comparing case facts against statutory requirements.
- **Charge Type Classification:** Violations are classified as 'current' (from Patrol Screening Sheet) or 'historical' (from fallback text scanning).
- **Comprehensive Data Storage:** Database schema includes `cases`, `documents`, `violations`, `criminalRecords`, `caseImages`, `users`, `companies`, and `sessions`.
- **Statute Text Fetching:** Robust system for fetching and validating Utah state code text from `le.utah.gov`, including Playwright fallback for dynamically loaded content and strict content validation (`validateStatuteContent()`) to prevent navigation HTML leaks.
- **Analysis Summary:** Extracts "Officer's Actions" from PDF documents, handling page headers and section identification.
- **Error Handling & Performance:** Strict TypeScript, typed API responses, comprehensive error handling, and performance monitoring for database queries and API calls.
- **Frontend Routing:** Dashboard, upload, detailed analysis, admin, and company views.

### Authentication & Authorization
- **Authentication:** Replit Auth integration with session management using PostgreSQL-backed sessions.
- **User Roles:** Four account types with hierarchical permissions:
  - `user` - Basic access to view and manage assigned cases
  - `services` - Can upload cases and assign them to company users
  - `company` - Company admin with access to all users and cases in their organization
  - `admin` - Full system access including user/company management
- **Company Association:** Users can be associated with companies for organization-level access control.
- **Role-based Navigation:** Sidebar dynamically shows/hides menu items based on user role.
- **Protected Endpoints:** All case management endpoints require authentication.

### System Design
- **Type Safety:** All code uses TypeScript with strict type checking, avoiding `any` types.
- **Database Operations:** Drizzle ORM with extensive logging for performance monitoring.
- **Security:** Environment variables for sensitive configuration; no hardcoded secrets. Role-based access control on API endpoints.
- **Statute Text Revert Fix:** Implemented `AbortController`, sequence tracking, state protection, and single-fetch polling to prevent statute text from reverting due to race conditions or stale data. Multi-layer validation and parser guards are in place to ensure data integrity.

## External Dependencies
- **Gemini AI:** Used for generating case summaries and legal analyses.
- **PostgreSQL:** Primary database for all application data.
- **`pdf-parse` / `pdfjs-dist`:** Libraries for PDF document text extraction.
- **`le.utah.gov`:** External website for fetching Utah state code text.
- **Playwright:** Used as a headless browser for fetching dynamically rendered statute content when direct parsing fails.
- **Replit Auth:** Authentication provider supporting Google, GitHub, Apple, and email sign-in.

## Key Files
- `server/src/index.ts` - Main server entry point (58 lines, bootstraps route modules)
- `server/src/routes/cases.ts` - Case management API routes (upload, analysis, CRUD, charge extraction)
- `server/src/routes/admin.ts` - Admin dashboard API routes
- `server/src/routes/statutes.ts` - Utah statute lookup API routes
- `server/replit_integrations/auth/` - Authentication integration (Replit Auth)
- `shared/models/auth.ts` - User, Company, and Session schemas
- `client/src/hooks/use-auth.ts` - Frontend authentication hook
- `client/src/components/layout/app-shell.tsx` - Main layout with role-based navigation
- `client/src/pages/admin.tsx` - Admin dashboard for user/company management
- `client/src/pages/company.tsx` - Company dashboard for organization-level view

## Recent Changes (December 2024)

### Charge Extraction Improvements
- **Screening Sheet Isolation**: Added `extractScreeningSheetSection()` function to identify and isolate only the Patrol Screening Sheet section from documents, preventing charges from criminal history sections bleeding into current case charges.
- **Section Boundaries**: Stops extraction at markers like "Criminal History", "Utah BCI", "NCIC", "Identification Cautions".
- **Expanded Charge Suffixes**: VALID_SUFFIXES now includes common abbreviations (RETA, FAIL, NCIC, JURI, POSS, etc.).
- **Known Charges Dictionary**: Expanded to include proper display names for common Utah codes (41-6a-401.3, 53-3-217, 77-7-21, etc.).

### Defendant Name Parsing
- **Minimum First Name Length**: Added 3-character minimum validation for first names to prevent partial matches like "ROBERTS, CH" from overwriting complete names like "Roberts, Chandee".

### Statute Display
- **API Field Alignment**: Fixed field name mismatch in `/api/statutes/:citation` endpoint (returns `statuteText` instead of `text`).

### TypeScript Compatibility
- **React 18 Types**: Downgraded to @types/react@18.3.14 for compatibility with lucide-react icons. The app uses React 19 runtime but React 18 types until upstream libraries add full React 19 type support.
