import { User } from '../../../shared/schema.js';

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
    }
  }
}

export interface CaseListItem {
  id: string;
  caseNumber: string;
  defendantName: string;
  status: string;
  uploadDate: Date;
  isMarkedComplete: boolean;
  companyId: string | null;
  uploadedByUserId: string | null;
  assignedToUserId: string | null;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export {};
