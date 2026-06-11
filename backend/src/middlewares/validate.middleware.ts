import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Validate (and coerce) a request section against a shared Zod schema. The same
 * schema runs on the frontend, so the rules are enforced identically end-to-end.
 */
/**
 * Cross-cutting fields handled by SEPARATE middleware / services (the two-component
 * electronic signature and the reason-for-change), not by the domain Zod schema.
 * Zod strips unknown keys by default, so without this they would be silently
 * dropped from req.body and the e-signature / reason would never reach the service.
 */
const PRESERVED_BODY_KEYS = ['signature', 'reasonForChange'] as const;

export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const original = req[source] as Record<string, unknown> | undefined;
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    const parsed = result.data as Record<string, unknown>;
    if (source === 'body' && original && typeof original === 'object') {
      for (const key of PRESERVED_BODY_KEYS) {
        if (original[key] !== undefined && parsed[key] === undefined) parsed[key] = original[key];
      }
    }
    // Replace with the parsed/coerced value (with cross-cutting fields preserved).
    (req as unknown as Record<string, unknown>)[source] = parsed;
    next();
  };
}
