#!/usr/bin/env bash
# NOMA — сборка и запуск одной командой (Linux / macOS)
#   ./start.sh          — собрать фронтенд и запустить всё на http://localhost:8000
#   ./start.sh --demo   — то же + демо-данные
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PY="$ROOT/backend/.venv/bin/python"

[ -x "$PY" ] || python3 -m venv "$ROOT/backend/.venv"
"$PY" -m pip install -q -r "$ROOT/backend/requirements.txt"

(cd "$ROOT/frontend" && { [ -d node_modules ] || npm install; } && npm run build)

if [ "${1:-}" = "--demo" ]; then
  (cd "$ROOT/backend" && "$PY" seed_demo.py)
fi

echo "→ NOMA запущен: http://localhost:8000"
exec "$PY" -m uvicorn app.main:app --app-dir "$ROOT/backend" --host 0.0.0.0 --port 8000
