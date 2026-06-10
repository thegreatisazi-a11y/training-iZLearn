import type { AuthUser } from './index';

declare global {
  namespace Express {
    interface Request {
      /** Populated by auth.middleware for protected routes. */
      user?: AuthUser;
      /** Mandatory reason-for-change captured by reasonForChange.middleware. */
      auditReason?: string;
    }
  }
}

export {};
