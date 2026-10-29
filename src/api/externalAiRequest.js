import { isLocalPilotBuild } from '../utils/pilotMode.js';

export const EXTERNAL_AI_DISCLOSURE_VERSION = '2026-08-30';

export const EXTERNAL_AI_ACTIONS = Object.freeze({
  semanticRecipes: 'semantic_recipe_recommendations',
  importCorrectionSuggestions: 'import_correction_suggestions',
  importCorrectionEmbedding: 'import_correction_embedding',
  aiRecipeSuggestions: 'ai_recipe_suggestions'
});

export function isExternalAiUiEnabled() {
  if (isLocalPilotBuild()) return false;
  return String(import.meta.env.VITE_ENABLE_EXTERNAL_AI_DATA_PROCESSING || '').toLowerCase() === 'true';
}

// This signal records a single disclosed click. The server still enforces its own
// operator activation gate; this client value is not treated as a security boundary.
export function createExternalAiRequestSignal(action, { userInitiated = false } = {}) {
  if (!isExternalAiUiEnabled() || userInitiated !== true) return null;

  return {
    action,
    disclosureVersion: EXTERNAL_AI_DISCLOSURE_VERSION,
    userInitiated: true
  };
}
