import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string, salt?: string): string {
  const s = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(password, s, 64).toString('hex');
  return `${s}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}