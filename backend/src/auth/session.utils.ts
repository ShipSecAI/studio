import * as crypto from 'crypto';

// Session cookie configuration
export const SESSION_COOKIE_NAME = 'shipsec_session';
export const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET is required in production for session authentication');
    }
    return 'local-dev-session-secret';
  }
  return secret;
}

export interface SessionPayload {
  username: string;
  ts: number;
}

/**
 * Create a signed session token for local auth.
 */
export function createSessionToken(username: string): string {
  const secret = getSessionSecret();
  const payload = JSON.stringify({ username, ts: Date.now() });
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const signature = hmac.digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64');
}

/**
 * Verify and decode a session token.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const secret = getSessionSecret();
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot === -1) return null;

    const payload = decoded.slice(0, lastDot);
    const signature = decoded.slice(lastDot + 1);

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    if (signature.length !== expectedSignature.length) return null;
    const signatureMatch = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
    if (!signatureMatch) return null;

    const parsed = JSON.parse(payload) as SessionPayload;
    if (typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > SESSION_COOKIE_MAX_AGE) return null;
    return parsed;
  } catch {
    return null;
  }
}
