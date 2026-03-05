import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App';

// Polyfill Buffer globally for OP_NET SDK
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).Buffer = Buffer;
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
