import { ApiClientError, requestJson } from './apiClient';
import { isLocalPilotBuild } from '../utils/pilotMode.js';
import {
  createExternalAiRequestSignal,
  EXTERNAL_AI_ACTIONS
} from './externalAiRequest';

export class ImportCorrectionsApiError extends ApiClientError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ImportCorrectionsApiError';
  }
}

export function isRemoteImportLearningEnabled() {
  if (isLocalPilotBuild()) return false;
  return String(import.meta.env.VITE_ENABLE_REMOTE_IMPORT_LEARNING || '').toLowerCase() === 'true';
}

export function toCorrectionPayloadItem(item) {
  return {
    id: item.id,
    normalizedName: item.normalizedName || item.name,
    correctedName: item.name,
    category: item.category,
    storageType: item.storageType
  };
}

export function getImportCorrectionSuggestions(items = [], options = {}) {
  const externalAi = createExternalAiRequestSignal(
    EXTERNAL_AI_ACTIONS.importCorrectionSuggestions,
    options
  );

  if (!isRemoteImportLearningEnabled() || !externalAi) {
    return Promise.resolve({ suggestions: {} });
  }

  return requestJson(
    '/import/corrections/suggestions',
    {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: items.map(toCorrectionPayloadItem),
        externalAi
      })
    },
    { authMode: 'required', errorClass: ImportCorrectionsApiError }
  );
}

export function saveImportCorrectionsRemote(items = [], options = {}) {
  if (!isRemoteImportLearningEnabled()) {
    return Promise.resolve({ savedCount: 0 });
  }

  return requestJson(
    '/import/corrections',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: items.map(toCorrectionPayloadItem),
        externalAi: createExternalAiRequestSignal(
          EXTERNAL_AI_ACTIONS.importCorrectionEmbedding,
          options
        )
      })
    },
    { authMode: 'required', errorClass: ImportCorrectionsApiError }
  );
}
