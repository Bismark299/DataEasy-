#!/bin/bash
# Post-merge setup: install dependencies after a task merge.
# DB schema changes are applied automatically at server boot
# (idempotent startup migrations in backend/server.js).
set -e

npm install --no-audit --no-fund
cd backend && npm install --no-audit --no-fund
