# 共通: コマンドを実行し全文を logs/<name>.log に保存、末尾40行だけ表示する。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/logs"

run_logged() {
  local name="$1"; shift
  local log="$ROOT/logs/$name.log"
  local status=0
  "$@" >"$log" 2>&1 || status=$?
  tail -n 40 "$log"
  if [[ $status -eq 0 ]]; then
    echo "✅ $name OK (log: logs/$name.log)"
  else
    echo "❌ $name FAILED ($status) (log: logs/$name.log)"
  fi
  return $status
}
