#!/usr/bin/env bash
set -euo pipefail

if [[ -n "$(git status --short)" ]]; then
  echo "Working tree is not clean. Commit or stash your changes first." >&2
  exit 1
fi

git fetch origin
git switch dev
git pull --ff-only origin dev
git merge --ff-only origin/main
git push origin dev

echo "dev is now synced to origin/main."
