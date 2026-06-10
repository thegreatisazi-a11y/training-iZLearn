import { z } from 'zod';
import { nonEmptyString, reasonForChange } from './common';

export const updateConfigSchema = z.object({
  value: z.string(),
  reasonForChange,
});
export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;

export const bulkUpdateConfigSchema = z.object({
  items: z.array(z.object({ key: nonEmptyString, value: z.string() })).min(1),
  reasonForChange,
});
export type BulkUpdateConfigInput = z.infer<typeof bulkUpdateConfigSchema>;

/** Canonical config keys with defaults — seeded on first run. */
export const DEFAULT_SYSTEM_CONFIG: Record<string, { value: string; description: string }> = {
  'password.min_length': { value: '8', description: 'Minimum password length' },
  'password.expiry_days': { value: '90', description: 'Days until a password expires' },
  'password.history_count': { value: '5', description: 'Number of previous passwords that may not be reused' },
  'session.timeout_minutes': { value: '15', description: 'Inactivity timeout before the screen locks' },
  'auth.max_failed_attempts': { value: '5', description: 'Failed logins before the account locks' },
  'auth.lockout_minutes': { value: '30', description: 'Lockout duration after too many failed logins' },
  'reminder.days_before_due': { value: '7,3,1', description: 'Comma-separated reminder thresholds (days before due)' },
  'org.name': { value: 'izLearn Pharmaceuticals Ltd.', description: 'Organisation name shown on reports & certificates' },
  'org.logo_path': { value: '/assets/logo.png', description: 'Path to the organisation logo' },
  'org.signatory_name': { value: 'Head of Quality Assurance', description: 'Authorised signatory printed on certificates' },
  'org.signatory_title': { value: 'QA Director', description: 'Title of the authorised signatory' },
  'system.timezone': { value: 'Asia/Kolkata', description: 'Display timezone for dates/times' },
  'ldap.enabled': { value: 'false', description: 'Enable Active Directory / LDAP authentication' },
  'ldap.url': { value: 'ldap://ad.example.com:389', description: 'LDAP server URL' },
  'ldap.base_dn': { value: 'dc=example,dc=com', description: 'LDAP base DN' },
  'ldap.bind_dn': { value: 'cn=service,dc=example,dc=com', description: 'LDAP bind DN' },
  'ldap.bind_password': { value: '', description: 'LDAP bind password' },
  'ldap.sync_cron': { value: '0 2 * * *', description: 'Cron for the daily AD sync job' },
  'smtp.host': { value: 'localhost', description: 'SMTP host' },
  'smtp.port': { value: '587', description: 'SMTP port' },
  'smtp.user': { value: '', description: 'SMTP username' },
  'smtp.password': { value: '', description: 'SMTP password' },
  'smtp.from': { value: 'izLearn <no-reply@example.com>', description: 'Default From address' },
  'backup.auto_enabled': { value: 'true', description: 'Enable scheduled database backups' },
  'backup.cron_expression': { value: '0 1 * * *', description: 'Cron for automatic backups' },
  'backup.destination_path': { value: '/app/backups', description: 'Directory where backups are written' },
  'upload.max_size_mb': { value: '500', description: 'Maximum upload size in MB (training videos; hard ceiling 1 GB)' },
  'security.allowed_origins': { value: 'http://localhost:5173', description: 'Comma-separated CORS whitelist' },
  'security.allowed_ip_ranges': { value: '', description: 'UR-80: comma-separated client IP prefixes allowed to access the app (empty = no restriction)' },
  'assessment.default_question_count': { value: '10', description: 'Default number of questions per assessment' },
  'assessment.require_assignment': { value: 'false', description: 'UR-43: require an active training assignment before a quiz is accessible' },
};
