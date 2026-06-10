import { validateUpload, sanitizeFilename, hasDangerousDoubleExtension } from '../utils/fileUtils';

const MB = 1024 * 1024;

describe('file upload security (Module 15 §6)', () => {
  it('accepts a valid PDF (extension + MIME match)', () => {
    expect(validateUpload({ originalname: 'sop.pdf', mimetype: 'application/pdf', size: 100 }, 10 * MB)).toEqual({ ext: 'pdf' });
  });

  it('rejects a disallowed extension', () => {
    expect(() => validateUpload({ originalname: 'evil.exe', mimetype: 'application/octet-stream', size: 1 }, 10 * MB)).toThrow();
  });

  it('rejects MIME/extension mismatch', () => {
    expect(() => validateUpload({ originalname: 'sop.pdf', mimetype: 'image/png', size: 1 }, 10 * MB)).toThrow();
  });

  it('rejects disguised double extensions', () => {
    expect(hasDangerousDoubleExtension('report.pdf.exe')).toBe(true);
    expect(hasDangerousDoubleExtension('invoice.exe.pdf')).toBe(true);
    expect(hasDangerousDoubleExtension('clean.pdf')).toBe(false);
  });

  it('rejects oversize files', () => {
    expect(() => validateUpload({ originalname: 'big.mp4', mimetype: 'video/mp4', size: 200 * MB }, 100 * MB)).toThrow();
  });

  it('sanitizes path traversal in filenames', () => {
    const safe = sanitizeFilename('../../etc/passwd');
    expect(safe.includes('/')).toBe(false);
    expect(safe.includes('\\')).toBe(false);
  });
});
