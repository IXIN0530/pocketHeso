import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RestView, TreeView } from '@ph/core';
import { TreeSheet } from './tree-sheet.tsx';
import { restBannerLines, shouldShowRestBanner } from './rest-banner.tsx';
import { useEngine } from '../stores/engine.ts';

const noop = () => {};

const tree = (points = 10): TreeView => ({
  rank: 1,
  regularRate: 1,
  points,
  pointsEarned: 10,
  mult: 1.1,
  openBoostMs: 0,
  bantou: { owned: false, on: false },
  tierOpen: [true, false, false, false, false],
  nodes: [
    { id: 'kanban', tier: 1, cost: 3, req: [], state: 'owned', timing: 'now' },
    { id: 'starter1', tier: 1, cost: 4, req: ['kanban'], state: 'owned', timing: 'open' },
    { id: 'open_dash1', tier: 1, cost: 5, req: ['starter1'], state: 'buyable', timing: 'open' },
  ],
  unlocks: [],
  nextClosePoints: 0,
});

const rest: RestView = { since: 1000, autoOpenAt: 1000 + 1800000, pendingBalls: 0 };

test('帯の表示条件: 休業中だけ出す', () => {
  expect(shouldShowRestBanner(null)).toBe(false);
  expect(shouldShowRestBanner(undefined)).toBe(false);
  expect(shouldShowRestBanner(rest)).toBe(true);
});

test('帯の文言: 「休業中　開店する ›」＋ pending があれば「開店時に +n玉」', () => {
  expect(restBannerLines(rest)).toEqual(['休業中　開店する ›']);
  expect(restBannerLines({ ...rest, pendingBalls: 123456 })).toEqual(['休業中　開店する ›', '開店時に +12.3万玉']);
});

test('閉店 → シートが開く: 休業中はカウントダウンと「開店する」が出る', () => {
  const html = renderToStaticMarkup(<TreeSheet tree={tree()} rest={rest} at={1000 + 1000} onDismiss={noop} />);
  expect(html).toContain('休業中　自動で開店まで 29:59');
  expect(html).toContain('開店する');
  // timing open の小札は休業中は「開店から」
  expect(html).toContain('開店から');
  expect(html).not.toContain('次の開店から');
});

test('休業中でない時はカウントダウン・開店ボタンが出ず、小札は「次の開店から」', () => {
  const html = renderToStaticMarkup(<TreeSheet tree={tree()} rest={null} at={0} onDismiss={noop} />);
  expect(html).not.toContain('休業中');
  expect(html).not.toContain('開店する</button>');
  expect(html).toContain('次の開店から');
});

test('買う → 開店の順でも timing の小札が出る（詳細にも）', () => {
  useEngine.setState({ projection: null });
  const html = renderToStaticMarkup(<TreeSheet tree={tree()} rest={rest} at={1000} onDismiss={noop} />);
  // 行と詳細の両方で timing が分かる
  expect(html.match(/開店から/g)?.length).toBeGreaterThanOrEqual(2);
});
