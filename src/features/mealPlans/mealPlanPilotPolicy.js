// Shared local-pilot rules only. No storage, clock reads, or collection side effects.
export const LOCAL_PILOT_POLICY = 'local-pilot-35d-v1';
export const LOCAL_PILOT_RETENTION_MS = 35 * 24 * 60 * 60 * 1000;

/** Return null rather than leaking raw input or changing a caller's error contract. */
export function parsePilotInstant(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}

export function createPilotVersion() {
  // Consent epochs and deletion barriers must remain random, never account hashes.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
