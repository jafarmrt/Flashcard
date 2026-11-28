// End-to-end checks of the main paths at phone size, against the real
// server and a built app. `npm run e2e` builds the app, starts the server
// on port 3100 with a throwaway data folder and runs e2e/*.spec.ts.
//
// The server gets empty values for the cloud store, AI and Telegram
// settings: dotenv does not override variables that are set, so a local
// .env with the real Upstash keys is never used and no test account lands
// in the real store, nor does a bot start polling.
import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PORT = 3100;
const DATA_DIR = path.join(os.tmpdir(), 'lingua-cards-e2e');
fs.mkdirSync(DATA_DIR, { recursive: true }); // the server does not make it

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npx tsx server.ts',
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      ALLOW_REGISTRATION: 'true',
      SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-000',
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      GEMINI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      MW_API_KEY: '',
      MW_LEARNERS_API_KEY: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_POLLING: '',
      CRON_SECRET: '',
    },
  },
});
