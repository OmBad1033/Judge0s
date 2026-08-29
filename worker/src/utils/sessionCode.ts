// Ambiguous characters 0/O and 1/I are excluded for easy manual entry.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateSessionCode(length = 6): string {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[arr[i] % ALPHABET.length];
  }
  return out;
}
