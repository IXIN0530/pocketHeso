// 操作の触覚（spec/40）。iOS Safari は navigator.vibrate に対応しないため、iOS 18+ の
// `<input type="checkbox" switch>` を切り替えた時にシステムが出す触覚を借りる（タップの中でだけ効く）。
// 実機で効くかは platform-limits に記録する。使えない端末では何もしない。
import { usePrefs } from '../stores/prefs.ts';

let label: HTMLLabelElement | null = null;

function switchLabel(): HTMLLabelElement {
  if (label === null) {
    label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    document.body.append(label);
  }
  return label;
}

/** 軽い触覚を1回（ボタン・タブ・選択の切り替え）。 */
export function tick(): void {
  if (typeof document === 'undefined' || !usePrefs.getState().haptics) return;
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(8);
    return;
  }
  switchLabel().click();
}
