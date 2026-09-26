import { describe, expect, it } from 'vitest';
import { SoundBus } from './sound-bus.ts';

/** iOS の AudioContext の近似: 操作の外の resume は解決されずに保留され、操作の中の resume だけが running にする。 */
function fakeIosContext(state: { gesture: boolean }) {
  const node = () => ({ connect: () => {}, gain: { value: 1 }, start: () => {}, buffer: null as unknown });
  const ctx = {
    state: 'suspended' as AudioContextState,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resumeCalls: 0,
    createGain: node,
    createBufferSource: node,
    createBuffer: () => ({ getChannelData: () => new Float32Array(1), duration: 0 }),
    resume() {
      ctx.resumeCalls++;
      if (!state.gesture) return new Promise<void>(() => {});
      ctx.state = 'running';
      return Promise.resolve();
    },
  };
  return ctx;
}

describe('SoundBus.unlock', () => {
  it('操作の外で先に呼ばれて resume が保留されても、次の操作で解錠できる', () => {
    const state = { gesture: false };
    const ctx = fakeIosContext(state);
    const bus = new SoundBus(() => ctx as unknown as AudioContext);
    bus.unlock(); // touch の pointerdown（操作に数えられない）
    expect(ctx.state).toBe('suspended');
    state.gesture = true;
    bus.unlock(); // touchend
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.state).toBe('running');
    expect(bus.ready).toBe(true);
  });

  it('running なら resume を呼ばない', () => {
    const ctx = fakeIosContext({ gesture: true });
    const bus = new SoundBus(() => ctx as unknown as AudioContext);
    bus.unlock();
    bus.unlock();
    expect(ctx.resumeCalls).toBe(1);
  });

  it('解錠に失敗したままなら少し後に ready でなくなる（保留中の再生を溜めない）', async () => {
    const ctx = fakeIosContext({ gesture: false });
    const bus = new SoundBus(() => ctx as unknown as AudioContext);
    bus.unlock();
    expect(bus.ready).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(bus.ready).toBe(false);
  });
});
