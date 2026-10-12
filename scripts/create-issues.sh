#!/usr/bin/env bash
# Tạo GitHub Issue cho toàn bộ task trong scripts/issues.tsv.
# Cần: gh CLI đã đăng nhập (gh auth login), chạy trong thư mục repo đã có remote.
# Dùng:
#   export GH_TUAN=<github-username> GH_SON=<...> GH_VU=<...>
#   DRY_RUN=1 bash scripts/create-issues.sh      # xem trước, không tạo
#   bash scripts/create-issues.sh                # tạo thật
#   ONLY_WEEK=1 bash scripts/create-issues.sh    # chỉ tạo tuần 1
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GH_TUAN:?}" "${GH_SON:?}" "${GH_VU:?}"
declare -A ASSIGNEE=( [tuan]="$GH_TUAN" [son]="$GH_SON" [vu]="$GH_VU" )

tail -n +2 scripts/issues.tsv | while IFS=$'\t' read -r id week owner title days deps dod prio; do
  [ -n "${ONLY_WEEK:-}" ] && [ "$week" != "$ONLY_WEEK" ] && continue
  case " ${SKIP_IDS:-T-101 T-104} " in *" $id "*) continue ;; esac   # task đã xong ở Phase 0
  body="**Ước lượng:** ${days} ngày công
**Phụ thuộc:** ${deps}
**Tuần:** ${week}

### Tiêu chí hoàn thành (DoD)
- [ ] ${dod}
- [ ] Đạt DoD chung (CONTRIBUTING.md mục 4)

Nguồn: docs/architecture/plan-6-weeks.md"
  args=(--title "${id} ${title}" --body "$body" --label "owner:${owner},week:${week},priority:${prio}" --assignee "${ASSIGNEE[$owner]}")
  if [ -n "${DRY_RUN:-}" ]; then
    echo "[dry-run] ${id} | tuần ${week} | ${owner} | ${prio} | ${title}"
  else
    gh issue create "${args[@]}" >/dev/null && echo "created ${id}"
    sleep 1   # tránh rate limit
  fi
done
