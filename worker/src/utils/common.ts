const te = new TextEncoder();
const td = new TextDecoder();

export function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (str.length % 4)) % 4;
  str += '='.repeat(pad);
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function strToB64url(s: string): string {
  return bytesToB64url(te.encode(s));
}

export function b64urlToStr(str: string): string {
  return td.decode(b64urlToBytes(str));
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(message));
  return bytesToB64url(new Uint8Array(sig));
}

export async function hmacVerify(
  secret: string,
  message: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      te.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = b64urlToBytes(signatureB64);
    return await crypto.subtle.verify('HMAC', key, sigBytes, te.encode(message));
  } catch {
    return false;
  }
}

export const newId = (): string => crypto.randomUUID();

export const now = (): string => new Date().toISOString();
