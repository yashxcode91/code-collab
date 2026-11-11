import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted Geist sans & monospace variable fonts bundled for sharp code/UI typography
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import App from './App';
import './index.css';

// Mount the root React tree into `#root` inside `apps/web/index.html`
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
