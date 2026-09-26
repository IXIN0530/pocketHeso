// iOS ショートカット連携（spec/31）: 起動 URL とペアリング鍵。

/** ショートカット名（利用者は変えない。resources/shortcut/README.md）。 */
export const SHORTCUT_NAME = 'PocketHeso Sync';
export const PAIRING_KEY_LENGTH = 16;
/** 手で打ち直しても紛れにくい文字（0/o・1/l/i を除く）。 */
export const PAIRING_KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function shortcutUrl(name: string = SHORTCUT_NAME): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}

/** ショートカットを開く（PWA は裏に回る。戻ってから「貼り付けて受け取る」）。 */
export function runShortcut(name: string = SHORTCUT_NAME): void {
  window.location.href = shortcutUrl(name);
}

/** ペアリング鍵（16文字）。偏りが出ないよう、文字数の倍数を超えるバイトは捨てて引き直す。 */
export function generatePairingKey(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const n = PAIRING_KEY_ALPHABET.length;
  const limit = 256 - (256 % n);
  let key = '';
  while (key.length < PAIRING_KEY_LENGTH) {
    for (const b of randomBytes(PAIRING_KEY_LENGTH)) {
      if (b < limit && key.length < PAIRING_KEY_LENGTH) {
        key += PAIRING_KEY_ALPHABET[b % n];
      }
    }
  }
  return key;
}
