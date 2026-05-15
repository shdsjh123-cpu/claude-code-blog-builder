#!/bin/sh
set -eu

cd "$(dirname "$0")"

: "${PORT:=3000}"
export PORT

echo "Starting dashboard at http://127.0.0.1:${PORT}/"
echo "Press Ctrl+C to stop."
echo

npm run dashboard
