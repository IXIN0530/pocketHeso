// iOS ショートカット連携（spec/31）: 起動 URL とペアリング鍵。

/** ショートカット名（利用者は変えない。resources/shortcut/README.md）。 */
export const SHORTCUT_NAME = 'PocketHeso Sync';
export const PAIRING_KEY_LENGTH = 16;
/** 手で打ち直しても紛れにくい文字（0/o・1/l/i を除く）。 */
export const PAIRING_KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** 配布版ショートカットの iCloud リンク（P8-T3 で記入するまでは空文字）。 */
export const SHORTCUT_ICLOUD_URL = '';

/** 配布版ショートカットの iCloud リンク（VITE_SHORTCUT_URL があればそれ、無ければ定数）。 */
export function shortcutIcloudUrl(): string {
  const env = (import.meta.env.VITE_SHORTCUT_URL as string | undefined)?.trim();
  if (env) {
    return env;
  }
  return SHORTCUT_ICLOUD_URL;
}

/** ショートカット起動 URL（鍵をテキスト入力で渡す。spec/31 の毎回の流れ）。 */
export function shortcutUrl(key: string, name: string = SHORTCUT_NAME): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(key)}`;
}

/** ショートカットを開く（PWA は裏に回る。戻ってから「貼り付けて受け取る」）。 */
export function runShortcut(key: string, name: string = SHORTCUT_NAME): void {
  window.location.href = shortcutUrl(key, name);
}

/** 準備（shortcutReadyAt なし）と毎回（あり）のどちらか。 */
export function isShortcutReady(shortcutReadyAt: number | undefined): boolean {
  return shortcutReadyAt !== undefined;
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
