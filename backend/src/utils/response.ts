import { Response } from 'express';

/** Application error with an HTTP status code and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  static unprocessable(message: string, details?: unknown) {
    return new AppError(422, 'UNPROCESSABLE_ENTITY', message, details);
  }
  static notImplemented(message = 'Not implemented') {
    return new AppError(501, 'NOT_IMPLEMENTED', message);
  }
}

export function sendSuccess<T>(res: Response, data: T, message?: string, status = 200) {
  return res.status(status).json({ success: true, data, message });
}

export function sendCreated<T>(res: Response, data: T, message?: string) {
  return res.status(201).json({ success: true, data, message });
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export function sendPaginated<T>(res: Response, data: T[], meta: PageMeta) {
  return res.status(200).json({
    success: true,
    data,
    page: meta.page,
    pageSize: meta.pageSize,
    total: meta.total,
    totalPages: Math.max(1, Math.ceil(meta.total / meta.pageSize)),
  });
}

/** Wrap an async Express handler so thrown/rejected errors reach the error middleware. */
import { Request, NextFunction, RequestHandler } from 'express';
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
