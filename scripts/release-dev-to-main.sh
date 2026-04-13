#!/usr/bin/env bash
set -euo pipefail

original_branch="$(git branch --show-current)"

if [[ -n "$(git status --short)" ]]; then
  echo "Working tree is not clean. Commit or stash your changes first." >&2
  exit 1
fi

git fetch origin

git switch dev
git pull --ff-only origin dev
git push origin dev

git switch main
git pull --ff-only origin main
git merge --ff-only dev
git push origin main

git switch dev
git merge --ff-only origin/main
git push origin dev

if [[ "$original_branch" != "dev" ]]; then
  git switch "$original_branch"
fi

echo "Released dev to main and synced dev back to origin/main."
