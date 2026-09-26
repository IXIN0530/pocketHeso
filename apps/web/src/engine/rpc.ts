// Worker との薄い RPC（Comlink 風, spec/40）。メソッド名と引数を送り、結果かエラー文を返す。

/** Worker 側の関数を Promise で呼べる形にした型。 */
export type Remote<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

interface Request {
  readonly id: number;
  readonly method: string;
  readonly args: readonly unknown[];
}

type Response = { readonly id: number; readonly ok: true; readonly value: unknown } | { readonly id: number; readonly ok: false; readonly message: string };

/** target のメソッドを port から呼べるようにする（呼び出しは届いた順に1つずつ実行する）。 */
export function expose(target: Readonly<Record<string, (...args: never[]) => unknown>>, port: Port): void {
  let queue: Promise<unknown> = Promise.resolve();
  port.addEventListener('message', (e) => {
    const { id, method, args } = e.data as Request;
    const run = async (): Promise<Response> => {
      const fn = target[method];
      if (fn === undefined) {
        return { id, ok: false, message: `unknown method: ${method}` };
      }
      try {
        return { id, ok: true, value: await (fn as (...a: readonly unknown[]) => unknown)(...args) };
      } catch (err) {
        return { id, ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    };
    queue = queue.then(run).then((r) => port.postMessage(r));
  });
}

/** port の向こうの target を呼ぶ代理。 */
export function wrap<T>(port: Port): Remote<T> {
  let nextId = 1;
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  port.addEventListener('message', (e) => {
    const r = e.data as Response;
    const w = waiting.get(r.id);
    if (w === undefined) {
      return;
    }
    waiting.delete(r.id);
    if (r.ok) {
      w.resolve(r.value);
    } else {
      w.reject(new Error(r.message));
    }
  });
  return new Proxy({} as Remote<T>, {
    get(_t, method) {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          waiting.set(id, { resolve, reject });
          port.postMessage({ id, method: String(method), args } satisfies Request);
        });
    },
  });
}
