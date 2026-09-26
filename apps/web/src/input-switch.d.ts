// Safari 17.4+ のスイッチ（`<input type="checkbox" switch>`）。React の型にまだ無い属性。
import 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 元の宣言と同じ型引数でないと合流できない
  interface InputHTMLAttributes<T> {
    switch?: '';
  }
}
