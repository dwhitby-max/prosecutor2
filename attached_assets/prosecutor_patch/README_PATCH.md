# Prosecutor Patch

This patch updates the Replit run configuration so the app is reachable in Preview:
- Sets `.replit` `run = "npm start"`
- Ensures PORT=5000 and maps to external port 80

## How to apply in your OLD Repl
1) Upload this patch zip into the old Repl (Files panel).
2) Unzip it in the Shell:
   unzip -o Prosecutor_PATCH.zip
3) Stop & Run the Repl.

## If you still want dev mode
Change `run` back to `npm run dev` in `.replit`.
