/** Build-time product policy, separate from a user's optional analytics consent. */
export function isLocalPilotBuild(env = import.meta.env) {
  return String(env?.VITE_LOCAL_PILOT_ENABLED ?? '').trim().toLowerCase() === 'true';
}
