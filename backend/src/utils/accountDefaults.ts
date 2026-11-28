import { randomInt } from 'crypto';

/** Capitalize name initials without lowercasing names such as McDonald. */
export function normalizePersonName(name: string): string {
  return name.trim().split(/\s+/u).map((part) => part.replace(/\p{L}/u, (letter) => letter.toUpperCase())).join(' ');
}

/** Short, cryptographically random temporary credentials; omit easily confused characters. */
export function generateTemporaryPassword(minLength = 8): string {
  const groups = ['ABCDEFGHJKMNPQRSTUVWXYZ', 'abcdefghjkmnpqrstuvwxyz', '23456789', '!@#'];
  const length = Math.max(8, Number.isFinite(minLength) ? Math.ceil(minLength) : 8);
  const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)];
  const characters = groups.map(pick);
  const alphabet = groups.join('');
  while (characters.length < length) characters.push(pick(alphabet));
  for (let index = characters.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return characters.join('');
}
