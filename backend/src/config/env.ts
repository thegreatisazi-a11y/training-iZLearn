import dotenv from 'dotenv';

dotenv.config();

function required(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) {
    // In production a missing critical secret should hard-fail at boot.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return '';
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '4000', 10),

  databaseUrl: required('DATABASE_URL', 'mongodb://localhost:27017/izlearn'),

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '8h',
  },

  bcryptCost: parseInt(process.env.BCRYPT_COST || '12', 10),

  storage: {
    root: process.env.STORAGE_ROOT || './storage',
    materials: process.env.STORAGE_MATERIALS || './storage/materials',
    documents: process.env.STORAGE_DOCUMENTS || './storage/documents',
    certificates: process.env.STORAGE_CERTIFICATES || './storage/certificates',
    reports: process.env.STORAGE_REPORTS || './storage/reports',
    backups: process.env.BACKUP_DESTINATION || './storage/backups',
    tmp: process.env.STORAGE_TMP || './storage/tmp',
  },

  mongo: {
    dumpBin: process.env.MONGODUMP_BIN || 'mongodump',
    restoreBin: process.env.MONGORESTORE_BIN || 'mongorestore',
  },

  /**
   * Cloudflare R2 (S3-compatible) object storage. When R2_BUCKET + credentials are
   * present the storage service uploads/serves files from R2 (required on Render,
   * whose disk is ephemeral); otherwise it falls back to the local `storage` dirs
   * (fine for local dev). Endpoint defaults to the account's R2 S3 API host.
   */
  r2: {
    bucket: process.env.R2_BUCKET || '',
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    endpoint:
      process.env.R2_ENDPOINT ||
      (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
    get enabled() {
      return Boolean(process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
    },
  },

  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  logLevel: process.env.LOG_LEVEL || 'info',
};

export type Env = typeof env;
