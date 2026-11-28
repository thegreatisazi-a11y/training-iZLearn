import { generateTemporaryPassword, normalizePersonName } from '../utils/accountDefaults';
import { validatePasswordPolicy } from '../utils/passwordUtils';

describe('new account defaults', () => {
  it.each([
    ['rahul shah', 'Rahul Shah'],
    ['  rahul   shah  ', 'Rahul Shah'],
    ['alice McDonald', 'Alice McDonald'],
    ['ravi KUMAR', 'Ravi Kumar'],
    ['élise durand', 'Élise Durand'],
  ])('capitalizes name initials: %s', (input, expected) => {
    expect(normalizePersonName(input)).toBe(expected);
  });

  it('generates short passwords that satisfy all current complexity requirements', () => {
    for (let index = 0; index < 100; index++) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(8);
      expect(password).not.toMatch(/[01IOil\s]/);
      expect(() => validatePasswordPolicy(password, { minLength: 8 })).not.toThrow();
    }
  });

  it('respects a higher configured minimum without lowering the eight-character default', () => {
    expect(generateTemporaryPassword(12)).toHaveLength(12);
    expect(generateTemporaryPassword(20)).toHaveLength(20);
    expect(generateTemporaryPassword(4)).toHaveLength(8);
  });
});
