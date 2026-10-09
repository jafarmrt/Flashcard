import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No API keys are defined for the browser: AI calls go through the server.
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    // The dev server must never hand out the session secret or user data.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '.session_secret', '.data_store.json', '*.tmp'] },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
