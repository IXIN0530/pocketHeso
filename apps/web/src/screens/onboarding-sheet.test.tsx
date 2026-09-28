import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AboutSheet, OnboardingSheet, REPO_URL, hasSaveData, shouldShowOnboarding, stepsFor } from './onboarding-sheet.tsx';
import { YOLP_CREDIT } from '../platform/yolp.ts';
import { loadSettings, openStorage, putSetting } from '../platform/storage.ts';
import { appendClaims } from '../platform/storage.ts';

const noop = () => {};

test('新規だけ案内が出て、閉じた後（onboardedAt あり）や既存セーブでは出ない', () => {
  expect(shouldShowOnboarding(undefined, false)).toBe(true);
  expect(shouldShowOnboarding(123, false)).toBe(false);
  expect(shouldShowOnboarding(undefined, true)).toBe(false);
  expect(shouldShowOnboarding(123, true)).toBe(false);
  expect(hasSaveData([], [])).toBe(false);
  expect(hasSaveData([1], [])).toBe(true);
  expect(hasSaveData([], [1])).toBe(true);
});

test('案内を閉じる（onboardedAt 保存）と次の起動では出ない。既存セーブでも出ない', async () => {
  const db = await openStorage('t-onboarding');
  expect(shouldShowOnboarding((await loadSettings(db)).onboardedAt, hasSaveData([], []))).toBe(true);
  await putSetting(db, 'onboardedAt', 456);
  expect(shouldShowOnboarding((await loadSettings(db)).onboardedAt, hasSaveData([], []))).toBe(false);
  db.close();

  const db2 = await openStorage('t-onboarding-save');
  await appendClaims(db2, [
    {
      claimId: 'health:2026-09-28:1',
      receivedAt: 1,
      source: 'health',
      kind: 'steps',
      day: '2026-09-28',
      amount: 1000,
      trust: 1,
      grant: { claimId: 'health:2026-09-28:1', at: 1, fuelMs: 600000, medals: 0 },
    },
  ]);
  const keys = await db2.getAllKeys('claims', undefined, 1);
  expect(shouldShowOnboarding((await loadSettings(db2)).onboardedAt, hasSaveData(keys, []))).toBe(false);
  db2.close();
});

test('案内は3枚（ホーム画面起動中は2枚）でスキップ可、施設案内は端末外に出さない旨', () => {
  expect(stepsFor(false).map(([t]) => t)).toEqual(['良い行動で玉を増やすゲーム', 'ホーム画面に追加', '行動の受け取り方']);
  expect(stepsFor(true).map(([t]) => t)).toEqual(['良い行動で玉を増やすゲーム', '行動の受け取り方']);
  const first = renderToStaticMarkup(<OnboardingSheet standalone={false} onDone={noop} />);
  expect(first).toContain('良い行動で玉を増やすゲーム');
  expect(first).toContain('次へ');
  expect(first).toContain('スキップ');
});

test('このアプリについて: 外部送信の範囲・YOLP クレジット・セーブ・ソース', () => {
  const html = renderToStaticMarkup(<AboutSheet onDismiss={noop} />);
  expect(html).toContain('端末の外に送りません');
  expect(html).toContain('施設を探す時だけ');
  expect(html).toContain(YOLP_CREDIT.text);
  expect(html).toContain('書き出して');
  expect(html).toContain(REPO_URL);
});
