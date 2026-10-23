#!/usr/bin/env bash
# Owner: R1. One-time GitHub repo settings. Run after the first push, as a repo admin.
# Usage: ./scripts/gh-setup.sh OWNER/REPO     (requires the GitHub CLI: gh auth login)
set -euo pipefail
REPO="${1:?usage: gh-setup.sh OWNER/REPO}"

# Squash merge only, delete branches after merge
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true >/dev/null

# Protect main: PR required, 1 approval, required checks, no force push or deletion
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["build-test", "gitleaks", "pr-rules"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

# Labels used by the workflow
gh label create ownership-approved --repo "$REPO" --color 0e8a16 \
  --description "Path owner approved a cross-owner change" 2>/dev/null || true
gh label create change-request --repo "$REPO" --color 1d76db 2>/dev/null || true

echo "Done. main is protected on $REPO."
