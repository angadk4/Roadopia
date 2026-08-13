#!/bin/sh
# M11-T08 — nightly public-schema pg_dump shipped to Cloudflare R2 (spec §75).
#
# Runs on the VPS from cron (M12 wires the schedule + credentials):
#   15 4 * * *  /opt/roadopia/backup/backup.sh >> /var/log/roadopia-backup.log 2>&1
#
# Required env (from /opt/roadopia/backup/.env, chmod 600 — NEVER in the repo):
#   DATABASE_URL              pooled or direct Postgres URL
#   R2_ENDPOINT               https://<account>.r2.cloudflarestorage.com
#   R2_BUCKET                 e.g. roadopia-backups
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   R2 token pair
#
# Retention: 30 days (spec §75), enforced here by prefix-date deletion so the
# job has no lifecycle-rule dependency. Restore procedure = the T09 drill:
#   pg_restore -d <fresh-db> --no-owner --schema=public <dump>
# (verified 2026-08-13: full row parity on 133k+ rows; auth-schema errors are
# expected noise when restoring into a bare DB).

set -eu

STAMP="$(date -u +%Y-%m-%d)"
OUT="/tmp/roadopia-${STAMP}.dump"

pg_dump "${DATABASE_URL}" --schema=public -Fc -f "${OUT}"

aws s3 cp "${OUT}" "s3://${R2_BUCKET}/nightly/roadopia-${STAMP}.dump" \
  --endpoint-url "${R2_ENDPOINT}"
rm -f "${OUT}"

# prune anything older than 30 days
CUTOFF="$(date -u -d '30 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-30d +%Y-%m-%d)"
aws s3 ls "s3://${R2_BUCKET}/nightly/" --endpoint-url "${R2_ENDPOINT}" \
  | awk '{print $4}' \
  | while read -r key; do
      [ -n "${key}" ] || continue
      day="$(printf '%s' "${key}" | sed -n 's/^roadopia-\([0-9-]\{10\}\)\.dump$/\1/p')"
      if [ -n "${day}" ] && [ "${day}" \< "${CUTOFF}" ]; then
        aws s3 rm "s3://${R2_BUCKET}/nightly/${key}" --endpoint-url "${R2_ENDPOINT}"
      fi
    done

echo "backup ok: roadopia-${STAMP}.dump"
