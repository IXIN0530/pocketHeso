import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parseCuePack } from '@ph/shared';
import packJson from '../../../../resources/packs/default/pack.json';

const pack = parseCuePack(packJson);

it('sakibare は mp3 のファイル素材で、ファイルが public/sounds に在る', () => {
  const asset = pack.sounds.sakibare!;
  expect('file' in asset).toBe(true);
  if (!('file' in asset)) return;
  expect(asset.file).toBe('../../sounds/sakibare.mp3');
  expect(existsSync(resolve(__dirname, '../../public/sounds/sakibare.mp3'))).toBe(true);
});

it('sakibare シートの音は1回だけ', () => {
  const sheet = pack.sheets.find((s) => s.pattern === 'sakibare')!;
  expect(sheet.cues.filter((c) => c.kind === 'sound' && c.asset === 'sakibare')).toHaveLength(1);
});
