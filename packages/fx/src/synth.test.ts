import { expect, test } from 'vitest';
import { renderSynth } from './synth.ts';
import { pack } from './fx.fixtures.ts';

test('synth sounds have the right length and stay in range', () => {
  for (const name of Object.keys(pack.sounds)) {
    const s = pack.sounds[name]!;
    if (!('synth' in s)) continue;
    const pcm = renderSynth(s.synth, 48000);
    expect(pcm.length).toBe(Math.round((s.synth.ms / 1000) * 48000));
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(1);
    expect(Math.abs(pcm[0]!)).toBeLessThan(0.05);
  }
});
