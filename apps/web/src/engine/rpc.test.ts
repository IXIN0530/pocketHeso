import { expect, test } from 'vitest';
import { expose, wrap, type Port } from './rpc.ts';

test('RPC: 結果とエラー文が返り、呼び出しは届いた順に1つずつ実行される', async () => {
  const { port1, port2 } = new MessageChannel();
  const log: string[] = [];
  const api = {
    async slow(x: number) {
      log.push(`start ${x}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`end ${x}`);
      return x * 2;
    },
    fail() {
      throw new Error('だめ');
    },
  };
  expose(api, port1 as unknown as Port);
  const remote = wrap<typeof api>(port2 as unknown as Port);
  port1.start();
  port2.start();
  const [a, b] = await Promise.all([remote.slow(1), remote.slow(2)]);
  expect([a, b]).toEqual([2, 4]);
  expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  await expect(remote.fail()).rejects.toThrow('だめ');
  port1.close();
  port2.close();
});
