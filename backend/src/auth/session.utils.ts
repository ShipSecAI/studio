import * as crypto from 'crypto';

// Session cookie configuration
export const SESSION_COOKIE_NAME = 'shipsec_session';
export const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// Secret for signing session tokens (use env var in production)
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-session-secret';

export interface SessionPayload {
  username: string;
  ts: number;
}

/**
 * Create a signed session token for local auth.
 */
export function createSessionToken(username: string): string {
  const payload = JSON.stringify({ username, ts: Date.now() });
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64');
}

/**
 * Verify and decode a session token.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot === -1) return null;

    const payload = decoded.slice(0, lastDot);
    const signature = decoded.slice(lastDot + 1);

    const hmac = crypto.createHmac('sha256', SESSION_SECRET);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    if (signature !== expectedSignature) return null;

    return JSON.parse(payload);
  } catch {
    return null;
  }
}
