import { validatePasswordPolicy } from '../utils/passwordUtils';

describe('password policy (Module 1)', () => {
  it('accepts a compliant password', () => {
    expect(() => validatePasswordPolicy('Abcd123!', { minLength: 8 })).not.toThrow();
  });

  it('rejects passwords missing complexity classes', () => {
    expect(() => validatePasswordPolicy('alllowercase1!', { minLength: 8 })).toThrow();
    expect(() => validatePasswordPolicy('NOLOWER123!', { minLength: 8 })).toThrow();
    expect(() => validatePasswordPolicy('NoDigits!', { minLength: 8 })).toThrow();
    expect(() => validatePasswordPolicy('NoSpecial1', { minLength: 8 })).toThrow();
  });

  it('rejects passwords shorter than the configured minimum', () => {
    expect(() => validatePasswordPolicy('Ab1!', { minLength: 8 })).toThrow();
  });
});
