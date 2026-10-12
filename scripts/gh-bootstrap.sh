#!/usr/bin/env bash
# Thiết lập label + bảo vệ nhánh main. Cần quyền admin repo và `gh auth login`.
# Lưu ý: repo PRIVATE gói Free của GitHub KHÔNG hỗ trợ branch protection -> dùng repo public
# hoặc GitHub Pro/Team/Student Pack. Script sẽ báo lỗi ở bước đó nếu không được hỗ trợ.
set -euo pipefail
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "Repo: $REPO"

label() { gh label create "$1" --color "$2" --description "$3" --force --repo "$REPO" >/dev/null && echo "label $1"; }
label "owner:tuan" "1d76db" "Tuấn phụ trách"
label "owner:son"  "5319e7" "Sơn phụ trách"
label "owner:vu"   "0e8a16" "Vũ phụ trách"
for w in 1 2 3 4 5 6; do label "week:$w" "fbca04" "Tuần $w"; done
label "priority:must"   "b60205" "Bắt buộc"
label "priority:should" "d93f0b" "Nên có"
label "priority:could"  "c2e0c6" "Có thể cắt"
label "blocked" "000000" "Đang bị chặn"

echo "Bảo vệ nhánh main..."
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["build", "security"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "OK. Lưu ý: check 'build' và 'security' chỉ chọn được sau lần chạy CI đầu tiên."
