# Utah Case Screener - Full Stack Application

## Overview
A full-stack web application for legal case screening and analysis. The system allows users to upload PDF documents, extracts text, analyzes content for code violations using AI, and maintains a database of cases and their analysis results. Its purpose is to streamline legal case review, provide detailed incident summaries, and conduct legal analysis against statutory requirements. The project aims to enhance efficiency and accuracy in legal screening processes.

## User Preferences
- **Protected Sections:** The "Current Case Charges", "Applicable Utah State Code", and "Criminal Records" sections are working correctly and should NOT be changed without explicit user approval.
- **Statute Text Revert Fix Protection:** Always run tests before modifying statute validation (`cd server && npm test`). Never modify `CRITICAL_NAV_PHRASES` without running the full test suite.
- **Code Style:** All code must be written in TypeScript with strict type checking, and no `any` types are allowed in production code.
- **Workflow:** For refactoring large files, user approval is required before implementation.
- **Do Not:** Remove the versioned page fetching logic, add back the main page fallback, remove or weaken the `validateStatuteContent()` validation, or cache/return content without validation passing first. Avoid generic single words in validation.

## System Architecture

### Technology Stack
- **Frontend:** React, Vite, Tailwind CSS, TypeScript
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **PDF Processing:** `pdf-parse` / `pdfjs-dist`

### Core Features & Design
- **AI-Powered Analysis (Gemini AI):**
    - Generates a 3-5 paragraph "Case Summary Narrative" summarizing incidents, parties, evidence, and outcomes.
    - Provides "Legal Analysis" for each charge, comparing facts against statutory requirements with conclusions (SUPPORTED/QUESTIONABLE/INSUFFICIENT EVIDENCE).
- **Charge Type Classification:** Violations are classified as 'current' (from Patrol Screening Sheet) or 'historical' (from fallback text scanning/criminal history). The frontend prioritizes 'current' charges.
- **Dynamic Statute Text Fetching:** Fetches Utah state code from `le.utah.gov`, handling dynamic content loading by extracting `versionDefault` and fetching the versioned page. Includes robust content validation (`validateStatuteContent()`) to prevent caching navigation HTML and ensures statute structure markers.
- **Playwright Fallback:** Automatically uses a headless browser (Playwright) for JavaScript-rendered pages if direct fetching and validation fail.
- **OCR Correction:** Includes specific corrections for common OCR misreads (e.g., "57-37A" to "58-37A").
- **Robust Error Handling:** Typed error responses, meaningful messages, and proper exception handling.
- **Performance Monitoring:** Database query timing and API call timing are tracked, with warnings for slow operations.

### Data Model (`shared/schema.ts`)
- `cases`: Main case records, including AI-generated `caseSummaryNarrative` and `legalAnalysis`.
- `documents`: Uploaded PDF documents linked to cases.
- `violations`: Identified code violations, including `chargeType`.
- `criminalRecords`: Defendant criminal history.
- `caseImages`: Extracted images (base64 encoded).

### UI/UX
- Frontend built with React, utilizing `shadcn/ui` for components and `wouter` for routing.
- Dashboard provides case lists and statistics.
- Dedicated pages for document upload and detailed case analysis.

## External Dependencies
- **PostgreSQL:** Primary database for all application data.
- **Gemini AI:** Used for generating case summary narratives and legal analysis.
- **Utah Legislature Website (le.utah.gov):** Source for fetching Utah state statute text.
- **Playwright:** Utilized as a fallback headless browser for dynamic content fetching from `le.utah.gov`.