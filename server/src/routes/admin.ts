import express, { Response, Request } from 'express';
import { storage } from '../../storage.js';

export const adminRouter = express.Router();

adminRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await storage.getAdminStats();
    res.json({ ok: true, data: stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('Admin stats error:', msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await storage.getAllUsers();
    res.json({ ok: true, data: { users } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('Admin users error:', msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

adminRouter.get('/processing-report', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;
    const report = await storage.getProcessingTimeReport(start, end);
    res.json({ ok: true, data: report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('Processing report error:', msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

adminRouter.get('/cases-by-date', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      res.status(400).json({ ok: false, error: 'startDate and endDate are required' });
      return;
    }
    const cases = await storage.getCasesByDateRange(
      new Date(startDate as string),
      new Date(endDate as string)
    );
    res.json({ ok: true, data: { cases } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('Cases by date error:', msg);
    res.status(500).json({ ok: false, error: msg });
  }
});
