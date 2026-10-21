#!/bin/bash
# Ignored Build Step for the Vercel "dispatch" project.
#
# Vercel calls this before every build triggered by a push.
#   exit 0  -> skip the build (nothing in dispatch/ changed)
#   exit 1+ -> proceed with the build (dispatch/ changed, or we can't tell)
#
# Failing OPEN (building when unsure) on purpose: it is far better to build
# unnecessarily than to silently skip a real change.

PREVIOUS="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
COMMIT="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

# .. on the very first deployment (or a shallow-clone miss) there is nothing
# to compare against, so build.
if ! git rev-parse -q --verify "$PREVIOUS" >/dev/null 2>&1; then
  echo "build (no previous commit available to compare)"
  exit 1
fi

COUNT=$(git diff --name-only "$PREVIOUS" "$COMMIT" -- . | wc -l | tr -d ' ')

if [ "$COUNT" = "0" ]; then
  echo "🛑 skip: no files under dispatch/ changed since last deployment"
  exit 0
else
  echo "✅ build: $COUNT file(s) under dispatch/ changed"
  exit 1
fi
