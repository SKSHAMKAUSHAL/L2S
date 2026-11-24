#!/usr/bin/env bash
# scripts/check-secrets.sh
# Scans repository for leaked secrets (Groq, Google OAuth, Firebase, Private Keys).
# Exit with status 1 if any pattern matches.

node "$(dirname "$0")/check_secrets.js"
exit $?
