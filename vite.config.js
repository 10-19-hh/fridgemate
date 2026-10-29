import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { getAdSenseConfig, isValidAdSenseClient } from './src/utils/adsenseConfig.js';
import { getWebmasterVerificationTags } from './src/utils/webmasterVerification.js';
import { isLocalPilotBuild } from './src/utils/pilotMode.js';
import { assertPilotPreviewTarget, getBuildOutputDirectory } from './scripts/lib/localPilotBuild.js';

function adsenseHeadPlugin(env) {
  const config = getAdSenseConfig(env);

  if (config.requested && !isValidAdSenseClient(config.client)) {
    throw new Error(
      'VITE_ADSENSE_CLIENT must use the ca-pub-XXXXXXXXXXXXXXXX format when AdSense verification is enabled.'
    );
  }

  return {
    name: 'fridgemate-adsense-head',
    transformIndexHtml() {
      if (!config.verificationEnabled) return [];

      return [
        {
          tag: 'meta',
          attrs: { name: 'google-adsense-account', content: config.client },
          injectTo: 'head'
        }
      ];
    }
  };
}

function webmasterVerificationHeadPlugin(env) {
  const tags = getWebmasterVerificationTags(env);

  return {
    name: 'fridgemate-webmaster-verification',
    transformIndexHtml() {
      return tags.map(({ metaName, content }) => ({
        tag: 'meta',
        attrs: { name: metaName, content },
        injectTo: 'head'
      }));
    }
  };
}

function validateGoogleAnalyticsConfig(env) {
  const measurementId = env.VITE_GA_MEASUREMENT_ID?.trim();

  if (measurementId && !/^G-[A-Z0-9]+$/.test(measurementId)) {
    throw new Error('VITE_GA_MEASUREMENT_ID must use the G-XXXXXXXXXX format.');
  }
}

export default defineConfig(({ mode }) => {
  const explicitPilot = isLocalPilotBuild(process.env);
  const env = explicitPilot ? process.env : loadEnv(mode, process.cwd(), '');
  const pilot = isLocalPilotBuild(env);
  if (pilot && !explicitPilot) {
    throw new Error('A dotenv-only pilot flag is unsupported. Use npm run build:pilot for an isolated pilot build.');
  }
  if (pilot) assertPilotPreviewTarget({ ...env, ...process.env });
  validateGoogleAnalyticsConfig(env);

  return {
    envDir: pilot ? false : undefined,
    build: { outDir: getBuildOutputDirectory(env) },
    plugins: [react(), adsenseHeadPlugin(env), webmasterVerificationHeadPlugin(env)]
  };
});
