import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { startFresh } from './services/freshStart';

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { type: 'module' })
      .then(registration => {
        console.log('SW registered: ', registration);
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