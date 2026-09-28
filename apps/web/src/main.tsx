import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app.tsx';
import './global.css';

// P0 スパイクは `?spike=<name>` でのみ読み込む（本体バンドルに混ぜない）。正式版には含めない（D-087、lazy import ごと落とす）。
const spike = __DEV_TOOLS__ ? new URLSearchParams(window.location.search).get('spike') : null;
const SpikeRoot = __DEV_TOOLS__ ? lazy(() => import('./spikes/spike-root.tsx')) : null;

// iOS Safari は touchstart の受け手が無いと :active（押した時の縮み）を出さない。
document.addEventListener('touchstart', () => {}, { passive: true });

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    {__DEV_TOOLS__ && spike && SpikeRoot ? (
      <Suspense>
        <SpikeRoot name={spike} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
