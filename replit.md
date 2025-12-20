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

### Key Features
- **AI-Powered Analysis:** Gemini AI generates case summary narratives and legal analyses, comparing case facts against statutory requirements.
- **Charge Type Classification:** Violations are classified as 'current' (from Patrol Screening Sheet) or 'historical' (from fallback text scanning).
- **Comprehensive Data Storage:** Database schema includes `cases`, `documents`, `violations`, `criminalRecords`, and `caseImages`.
- **Statute Text Fetching:** Robust system for fetching and validating Utah state code text from `le.utah.gov`, including Playwright fallback for dynamically loaded content and strict content validation (`validateStatuteContent()`) to prevent navigation HTML leaks.
- **Analysis Summary:** Extracts "Officer's Actions" from PDF documents, handling page headers and section identification.
- **Error Handling & Performance:** Strict TypeScript, typed API responses, comprehensive error handling, and performance monitoring for database queries and API calls.
- **Frontend Routing:** Dashboard, upload, and detailed analysis views.

### System Design
- **Type Safety:** All code uses TypeScript with strict type checking, avoiding `any` types.
- **Database Operations:** Drizzle ORM with extensive logging for performance monitoring.
- **Security:** Environment variables for sensitive configuration; no hardcoded secrets.
- **Statute Text Revert Fix:** Implemented `AbortController`, sequence tracking, state protection, and single-fetch polling to prevent statute text from reverting due to race conditions or stale data. Multi-layer validation and parser guards are in place to ensure data integrity.

## External Dependencies
- **Gemini AI:** Used for generating case summaries and legal analyses.
- **PostgreSQL:** Primary database for all application data.
- **`pdf-parse` / `pdfjs-dist`:** Libraries for PDF document text extraction.
- **`le.utah.gov`:** External website for fetching Utah state code text.
- **Playwright:** Used as a headless browser for fetching dynamically rendered statute content when direct parsing fails.