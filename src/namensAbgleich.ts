/**
 * Erzeugt eine reihenfolge-unabhängige "Signatur" eines Namens, damit
 * "Christian Addicks" und "Addicks Christian" als derselbe Mitarbeiter
 * erkannt werden.
 */
export function namensSignatur(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .sort()
    .join(' ')
}
