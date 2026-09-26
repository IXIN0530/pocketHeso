import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app.tsx';
import './global.css';

// P0 スパイクは `?spike=<name>` でのみ読み込む（本体バンドルに混ぜない）。
const spike = new URLSearchParams(window.location.search).get('spike');
const SpikeRoot = lazy(() => import('./spikes/spike-root.tsx'));

// iOS Safari は touchstart の受け手が無いと :active（押した時の縮み）を出さない。
document.addEventListener('touchstart', () => {}, { passive: true });

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    {spike ? (
      <Suspense>
        <SpikeRoot name={spike} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
