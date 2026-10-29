import { isLocalPilotBuild } from './pilotMode.js';

const ADSENSE_CLIENT_PATTERN = /^ca-pub-\d{16}$/;
const ADSENSE_SLOT_PATTERN = /^\d+$/;

function parseBoolean(value) {
  return ['true', '1', 'on', 'yes'].includes(String(value || '').trim().toLowerCase());
}

export function getAdSenseConfig(env = import.meta.env) {
  const client = String(env.VITE_ADSENSE_CLIENT || '').trim();
  const verificationRequested = !isLocalPilotBuild(env) && parseBoolean(
    env.VITE_ADSENSE_VERIFICATION_ENABLED ?? env.VITE_ADSENSE_ENABLED
  );
  const servingRequested = !isLocalPilotBuild(env) && parseBoolean(env.VITE_ADSENSE_SERVING_ENABLED);
  const verificationEnabled = verificationRequested && ADSENSE_CLIENT_PATTERN.test(client);

  return {
    enabled: verificationEnabled && servingRequested,
    requested: verificationRequested,
    servingRequested,
    verificationEnabled,
    client,
    slots: {
      home: String(env.VITE_ADSENSE_HOME_SLOT || '').trim(),
      recipes: String(env.VITE_ADSENSE_RECIPES_SLOT || '').trim()
    }
  };
}

export function isValidAdSenseClient(client) {
  return ADSENSE_CLIENT_PATTERN.test(String(client || '').trim());
}

export function isValidAdSenseSlot(slot) {
  return ADSENSE_SLOT_PATTERN.test(String(slot || '').trim());
}
