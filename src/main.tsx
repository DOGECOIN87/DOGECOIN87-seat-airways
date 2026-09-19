import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element to mount into.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  const register = () => void navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(register, { timeout: 2500 });
  } else {
    globalThis.setTimeout(register, 1500);
  }
}
