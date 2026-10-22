/** Role names are labels, not authorization identities. Used only for matching. */
export function normalizeRoleName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US').replace(/[\s_]+/g, ' ');
}
