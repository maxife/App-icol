import './styles/tokens.css';
import './styles/global.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { processBootstrapUrlReset } from './providers/bootstrapUrlParams';

// Synchronous ?resetMock=1 bootstrap BEFORE React mounting (PROJECT.md §4)
processBootstrapUrlReset(window);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Élément racine #root introuvable dans index.html.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
