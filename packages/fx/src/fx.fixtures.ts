import { readFileSync } from 'node:fs';
import { parseCuePack, type CueSheet } from '@ph/shared';

export const pack = parseCuePack(
  JSON.parse(readFileSync(new URL('../../../resources/packs/default/pack.json', import.meta.url), 'utf8')),
);

export function sheet(pattern: string): CueSheet {
  const s = pack.sheets.find((x) => x.pattern === pattern);
  if (!s) throw new Error(`no sheet ${pattern}`);
  return s;
}
