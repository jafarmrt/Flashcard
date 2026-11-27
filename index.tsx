import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { startFresh } from './services/freshStart';

// Register Service Worker for PWA (bypass HTTP cache on SW checks and re-check on foreground)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js', { type: 'module', updateViaCache: 'none' })
      .then(registration => {
        const checkUpdate = () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => undefined);
          }
        };
        document.addEventListener('visibilitychange', checkUpdate);
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// Old data is cleared before anything opens the database.
startFresh().finally(() => root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
));