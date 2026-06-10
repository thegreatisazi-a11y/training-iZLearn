import { randomUUID } from 'crypto';
import dayjs from 'dayjs';

/** Unique certificate number: CERT-YYYYMMDD-{8-char UUID fragment}. */
export function generateCertificateNumber(issuedAt: Date = new Date()): string {
  const datePart = dayjs(issuedAt).format('YYYYMMDD');
  const fragment = randomUUID().split('-')[0].toUpperCase();
  return `CERT-${datePart}-${fragment}`;
}

/** Unique report reference number: REP-YYYYMMDDHHmmss-{6-char fragment}. */
export function generateReportReference(prefix = 'REP'): string {
  const ts = dayjs().format('YYYYMMDDHHmmss');
  const fragment = randomUUID().split('-')[0].slice(0, 6).toUpperCase();
  return `${prefix}-${ts}-${fragment}`;
}

/** Topic code: TRN-YYYY-#### (sequence supplied by the caller). */
export function generateTopicCode(sequence: number, year: number = new Date().getFullYear()): string {
  return `TRN-${year}-${String(sequence).padStart(4, '0')}`;
}
