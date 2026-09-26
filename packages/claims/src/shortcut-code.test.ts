import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { planGrants, type ClaimRecord } from './ledger.ts';
import { parseClaimRules } from './rules.ts';
import { sha256Hex } from './sha256.ts';
import { parseShortcutCode } from './shortcut-code.ts';
import { FIXTURE_KEY, SHORTCUT_FIXTURES } from './shortcut-code.fixtures.ts';

const MIN = 60000;
const real = SHORTCUT_FIXTURES[0]!;
const realNow = Date.parse(real.genIso) + 5 * MIN;

/** ショートカットと同じ手順でコードを作る（署名は node:crypto で独立に計算）。 */
function make(json: string, key = FIXTURE_KEY): string {
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return 'PH1.' + b64 + '.' + createHash('sha256').update(key + b64).digest('hex').slice(0, 16);
}

function body(days: unknown[], gen = '2026-09-26T08:00:00+09:00'): string {
  return JSON.stringify({ v: 1, gen, tz: '+09:00', days });
}

const at = Date.parse('2026-09-26T08:00:00+09:00');

describe('sha256', () => {
  test('matches node:crypto across block boundaries', () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const b = randomBytes(len);
      expect(sha256Hex(new Uint8Array(b))).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });
});

describe('real-device fixtures', () => {
  // P4-T2 Accept: 実機由来 3件以上。揃うまで todo として出力に残す（STATUS Blockers）。
  if (SHORTCUT_FIXTURES.length >= 3) {
    test('at least 3 fixtures', () => {
      expect(SHORTCUT_FIXTURES.length).toBeGreaterThanOrEqual(3);
    });
  } else {
    test.todo('実機由来 fixture が3件未満（' + SHORTCUT_FIXTURES.length + '件）');
  }

  for (const f of SHORTCUT_FIXTURES) {
    test(f.name, () => {
      const now = Date.parse(f.genIso) + 5 * MIN;
      const r = parseShortcutCode(f.code, FIXTURE_KEY, now);
      expect(r).toEqual({ k: 'health', receivedAt: now, today: f.today, days: f.days, warnings: [] });
      // 貼り付け時の前後の空白・改行は許容。
      expect(parseShortcutCode('  ' + f.code + '\n', FIXTURE_KEY + '\n', now).k).toBe('health');
    });
  }

  test('feeds planGrants', () => {
    const economy = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
    const r = parseShortcutCode(real.code, FIXTURE_KEY, realNow);
    if (r.k !== 'health') {
      throw new Error(r.message);
    }
    const recs = planGrants([], r, parseClaimRules(economy));
    expect(recs.filter((x) => x.kind === 'steps').map((x) => x.day)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
  });

  test('sequential real codes add only the increase', () => {
    const economy = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
    const rules = parseClaimRules(economy);
    let ledger: ClaimRecord[] = [];
    const steps: [string, number][][] = [];
    for (const f of SHORTCUT_FIXTURES) {
      const r = parseShortcutCode(f.code, FIXTURE_KEY, Date.parse(f.genIso) + MIN);
      if (r.k !== 'health') {
        throw new Error(r.message);
      }
      const recs = planGrants(ledger, r, rules);
      steps.push(recs.filter((x) => x.kind === 'steps').map((x) => [x.day, x.grant.fuelMs]));
      ledger = ledger.concat(recs);
    }
    // 1,000歩 = 10分 = 600ms/歩、1万歩超は半分。09-24 は 10,368 → 12,702 歩、09-26 の2回目は 2,300 → 2,410 歩の差分だけ。
    const t = (n: number): number => (n <= 10000 ? n : 10000 + (n - 10000) / 2) * 600;
    expect(steps).toEqual([
      [['2026-09-22', t(10340)], ['2026-09-23', t(10231)], ['2026-09-24', t(10368)]],
      [['2026-09-24', t(12702) - t(10368)], ['2026-09-25', t(3123)], ['2026-09-26', t(2300)]],
      [['2026-09-26', t(2410) - t(2300)]],
    ]);
  });
});

describe('errors are distinct', () => {
  const codeOf = (text: string, key = FIXTURE_KEY, now = realNow): string => {
    const r = parseShortcutCode(text, key, now);
    return r.k === 'error' ? r.code : 'ok';
  };

  test('broken code → format', () => {
    const c = real.code;
    const dot = c.lastIndexOf('.');
    expect(codeOf(c.slice(0, 40))).toBe('format'); // 途中で切れた
    expect(codeOf(c.slice(0, dot - 20) + c.slice(dot))).toBe('format'); // 本体の一部が欠けた
    expect(codeOf(c.slice(0, -1))).toBe('format'); // sig が欠けた
    expect(codeOf(c.replace('PH1.', 'PH2.'))).toBe('format');
    expect(codeOf('')).toBe('format');
    expect(codeOf('こんにちは')).toBe('format');
    expect(codeOf(make('{"v":1,'))).toBe('format');
    expect(codeOf(make('[1]'))).toBe('format');
    expect(codeOf(make(JSON.stringify({ v: 1, gen: 'yesterday', days: [] })))).toBe('format');
    expect(codeOf(make(JSON.stringify({ v: 1, gen: '2026-09-24T17:13:57', days: [] })))).toBe('format'); // オフセット無し
  });

  test('other key → signature', () => {
    expect(codeOf(real.code, 'abcdefghijklmnoq')).toBe('signature');
    expect(codeOf(real.code, '')).toBe('signature');
    expect(codeOf(make(body([]), 'zzzzzzzzzzzzzzzz'), FIXTURE_KEY, at)).toBe('signature');
  });

  test('old code → stale (±30 min)', () => {
    const gen = Date.parse(real.genIso);
    expect(codeOf(real.code, FIXTURE_KEY, gen + 30 * MIN)).toBe('ok');
    expect(codeOf(real.code, FIXTURE_KEY, gen + 30 * MIN + 1)).toBe('stale');
    expect(codeOf(real.code, FIXTURE_KEY, gen - 30 * MIN)).toBe('ok');
    expect(codeOf(real.code, FIXTURE_KEY, gen - 30 * MIN - 1)).toBe('stale');
    expect(codeOf(real.code, FIXTURE_KEY, gen + 24 * 60 * MIN)).toBe('stale');
  });

  test('unknown version → version', () => {
    expect(codeOf(make(JSON.stringify({ v: 2, gen: '2026-09-26T08:00:00+09:00', days: [] })), FIXTURE_KEY, at)).toBe('version');
  });
});

describe('tolerant parsing', () => {
  const ok = (text: string, now = at) => {
    const r = parseShortcutCode(text, FIXTURE_KEY, now);
    if (r.k !== 'health') {
      throw new Error(r.code);
    }
    return r;
  };

  test('gen offsets and today is the device-local date', () => {
    const r = ok(make(body([], '2026-09-25T23:30:00Z')));
    expect(r.today).toBe('2026-09-25');
    expect(ok(make(body([], '2026-09-26T08:00:00.123+0900'))).today).toBe('2026-09-26');
    expect(ok(make(body([], '2026-09-25T18:00:00-05:00'))).today).toBe('2026-09-25');
  });

  test('base64 with line breaks and uppercase sig', () => {
    const b64 = Buffer.from(body([{ d: '2026-09-26', steps: 1, distM: 1 }])).toString('base64');
    const wrapped = b64.replace(/(.{76})/g, '$1\r\n');
    const sig = createHash('sha256').update(FIXTURE_KEY + wrapped).digest('hex').slice(0, 16);
    expect(ok('PH1.' + wrapped + '.' + sig.toUpperCase()).days).toEqual([{ day: '2026-09-26', steps: 1, distanceM: 1 }]);
  });

  test('numeric strings, fractions and empty values', () => {
    const r = ok(make(body([{ d: '2026-09-26', steps: '8234', distM: 6120.7 }])));
    expect(r.days).toEqual([{ day: '2026-09-26', steps: 8234, distanceM: 6120 }]);
    const e = ok(make('{"v":1,"gen":"2026-09-26T08:00:00+09:00","tz":"+09:00","days":[{"d":"2026-09-26","steps":,"distM":}]}'));
    expect(e.days).toEqual([{ day: '2026-09-26', steps: 0, distanceM: 0 }]);
    expect(e.warnings).toHaveLength(1);
  });

  test('out-of-range items are dropped with warnings', () => {
    const r = ok(
      make(
        body([
          { d: '2026-09-26', steps: 100000, distM: 100001 },
          { d: '2026-09-25', steps: 100001, distM: 10 },
          { d: '2026-09-25', steps: 5, distM: 5 },
          { d: '2026-02-30', steps: 5 },
          { d: '2026-09-24', steps: -1 },
          { d: '2026-09-24', steps: 7 },
          { d: '2026-09-23', steps: 9 },
        ]),
      ),
    );
    expect(r.days).toEqual([
      { day: '2026-09-26', steps: 100000 },
      { day: '2026-09-25', steps: 5, distanceM: 5 },
      { day: '2026-09-24', steps: 7 },
    ]);
    expect(r.warnings).toHaveLength(5);
  });
});
