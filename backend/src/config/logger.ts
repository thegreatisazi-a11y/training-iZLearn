import winston from 'winston';
import { env } from './env';

const { combine, timestamp, json, printf, colorize, errors } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} ${level}: ${stack || message}${rest}`;
});

export const logger = winston.createLogger({
  level: env.logLevel,
  format: env.isProd
    ? combine(timestamp(), errors({ stack: true }), json())
    : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), devFormat),
  transports: [new winston.transports.Console()],
});

/** A CRITICAL alert is logged distinctly so it cannot be missed in production. */
export function critical(message: string, meta?: Record<string, unknown>) {
  logger.error(`[CRITICAL] ${message}`, meta);
}
