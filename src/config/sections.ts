/** Retired application sections. Financial history remains available to shared ledgers. */
export function isRemovedSection(section: unknown): boolean {
  if (typeof section !== 'string') return true;
  return /^(dealers?(?:_|$)|middleman(?:_|$)|brokerage(?:_|$)|subscriptions?(?:_|$)|competitions(?:_|$)|codes$)/.test(section);
}
