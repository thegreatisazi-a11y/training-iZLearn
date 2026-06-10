#!/usr/bin/env bash
# Verify an izLearn database backup against its SHA-256 sidecar (Module 16).
# Usage: ./scripts/verify-backup.sh /path/to/izlearn-YYYYMMDD-HHmmss.sql
set -euo pipefail

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup-file.sql>" >&2
  exit 2
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 2
fi
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [[ ! -f "$CHECKSUM_FILE" ]]; then
  echo "Checksum sidecar not found: $CHECKSUM_FILE" >&2
  exit 2
fi

EXPECTED="$(awk '{print $1}' "$CHECKSUM_FILE")"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
fi

if [[ "$EXPECTED" == "$ACTUAL" ]]; then
  echo "OK: checksum matches ($ACTUAL)"
  exit 0
else
  echo "FAIL: checksum mismatch" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  actual:   $ACTUAL" >&2
  exit 1
fi
