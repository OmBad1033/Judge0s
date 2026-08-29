import { hmacSign, hmacVerify, strToB64url, b64urlToStr } from '../utils/common';

export interface UserJwtPayload {
  sub: string;
  role: 'user';
  exp: number;
}

export interface ParticipantJwtPayload {
  sub: string;
  sid: string;
  exp: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;

export async function signUserJwt(userId: string, secret: string, ttlMs: number = 30 * DAY_MS): Promise<string> {
  const payload: UserJwtPayload = { sub: userId, role: 'user', exp: Date.now() + ttlMs };
  const message = JSON.stringify(payload);
  const sig = await hmacSign(secret, message);
  return `${strToB64url(message)}.${sig}`;
}

export async function verifyUserJwt(token: string, secret: string): Promise<UserJwtPayload | null> {
  const [enc, sig] = token.split('.');
  if (!enc || !sig) return null;
  const message = b64urlToStr(enc);
  if (!(await hmacVerify(secret, message, sig))) return null;
  try {
    const payload = JSON.parse(message) as UserJwtPayload;
    if (payload.role !== 'user' || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function signParticipantToken(
  participantId: string,
  sessionId: string,
  secret: string,
  ttlMs: number = 8 * 60 * 60 * 1000,
): Promise<string> {
  const payload: ParticipantJwtPayload = { sub: participantId, sid: sessionId, exp: Date.now() + ttlMs };
  const message = JSON.stringify(payload);
  const sig = await hmacSign(secret, message);
  return `${strToB64url(message)}.${sig}`;
}

export async function verifyParticipantToken(token: string, secret: string): Promise<ParticipantJwtPayload | null> {
  const [enc, sig] = token.split('.');
  if (!enc || !sig) return null;
  const message = b64urlToStr(enc);
  if (!(await hmacVerify(secret, message, sig))) return null;
  try {
    const payload = JSON.parse(message) as ParticipantJwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}