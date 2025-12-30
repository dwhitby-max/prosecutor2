import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { setupAuth, registerAuthRoutes } from '../replit_integrations/auth/index.js';
import { statutesRouter } from './routes/statutes.js';
import { casesRouter } from './routes/cases.js';
import { adminRouter } from './routes/admin.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

(async () => {
  await setupAuth(app);
  registerAuthRoutes(app);
})();

app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = duration > 2000 ? 'WARN' : 'INFO';
    if (req.path.startsWith('/api')) {
      console.log(`[${logLevel}] ${req.method} ${req.path} completed in ${duration}ms (status: ${res.statusCode})`);
    }
  });
  next();
});

const serverUploadsDir = path.join(process.cwd(), 'server', 'uploads');
const rootUploadsDir = path.join(process.cwd(), 'uploads');
const uploadsDir = fs.existsSync(path.join(serverUploadsDir, 'cases')) ? serverUploadsDir : rootUploadsDir;
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(path.join(uploadsDir, 'cases'), { recursive: true });
console.log('[UPLOADS] Using uploads directory:', uploadsDir);
app.use('/uploads', express.static(uploadsDir));

app.use('/api/statutes', statutesRouter);
app.use('/api/cases', casesRouter);
app.use('/api/admin', adminRouter);

const clientDist = path.join(process.cwd(), '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    } else {
      next();
    }
  });
}

const port = Number(process.env.PORT ?? '5000');
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on ${port}`);
});
