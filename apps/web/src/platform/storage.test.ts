import 'fake-indexeddb/auto';
import type { ClaimRecord, OwnPlace } from '@ph/claims';
import { expect, test } from 'vitest';
import {
  appendClaims,
  closeSessionWithClaims,
  loadLedger,
  loadPlaces,
  loadSettings,
  openStorage,
  putPlace,
  putSetting,
  type StoredSession,
} from './storage.ts';

const rec = (claimId: string, receivedAt: number): ClaimRecord => ({
  claimId,
  receivedAt,
  source: 'health',
  kind: 'steps',
  day: '2026-09-26',
  amount: 1000,
  trust: 1,
  grant: { claimId, at: receivedAt, fuelMs: 600000, medals: 0 },
});

const session: StoredSession = {
  session: { sessionId: 's', place: { k: 'yolp', gid: 'g' }, startAt: 1, startAccuracyM: 10, day: '2026-09-26' },
  yolpCalls: 1,
};

test('ledger is append-only and read in receivedAt order', async () => {
  const db = await openStorage('t-ledger');
  await appendClaims(db, [rec('b', 20), rec('a', 30)]);
  await appendClaims(db, [rec('c', 10)]);
  expect((await loadLedger(db)).map((r) => r.claimId)).toEqual(['c', 'b', 'a']);
  // 同じ claimId を含む追記は全体が取り消される。
  await expect(appendClaims(db, [rec('d', 40), rec('a', 50)])).rejects.toThrow();
  expect((await loadLedger(db)).map((r) => r.claimId)).toEqual(['c', 'b', 'a']);
});

test('settings, places and closing a session with its claims', async () => {
  const db = await openStorage('t-settings');
  expect(await loadSettings(db)).toEqual({ pairingKey: undefined, session: undefined, locationNoticeAck: undefined });
  await putSetting(db, 'pairingKey', 'abcdefghjkmnpqrs');
  await putSetting(db, 'session', session);
  expect(await loadSettings(db)).toEqual({ pairingKey: 'abcdefghjkmnpqrs', session, locationNoticeAck: undefined });
  const place: OwnPlace = { placeId: 'p', name: 'ジム', kind: 'ジム', lat: 35, lon: 139, radiusM: 80 };
  await putPlace(db, place);
  expect(await loadPlaces(db)).toEqual([place]);
  await closeSessionWithClaims(db, [rec('checkin:s', 5)]);
  expect((await loadSettings(db)).session).toBeUndefined();
  expect((await loadLedger(db)).map((r) => r.claimId)).toEqual(['checkin:s']);
  // 二重確定は失敗し、セッションも残らない（既に閉じている）。
  await putSetting(db, 'session', session);
  await expect(closeSessionWithClaims(db, [rec('checkin:s', 6)])).rejects.toThrow();
  expect((await loadSettings(db)).session).toEqual(session);
});
