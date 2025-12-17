# Utah Case Screener (Rebuilt)

## Run locally / Replit
1) `npm install`
2) (optional OCR) set env vars:
   - OCR_PROVIDER=google_vision
   - GOOGLE_VISION_API_KEY=...
3) `npm run build:all`
4) `npm start`

Server serves client build automatically.

## Endpoints
- POST /api/cases/upload (multipart: pdfs[])
- POST /api/cases/preview (multipart: pdfs[])
- GET  /api/cases
- GET  /api/cases/:id
Static uploads: /uploads/...
