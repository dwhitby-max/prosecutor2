import crypto from 'node:crypto';

export function id(): string {
  return crypto.randomUUID();
}
