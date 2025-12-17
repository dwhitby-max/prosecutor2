import crypto from 'node:crypto';
export function id() {
    return crypto.randomUUID();
}
