#!/usr/bin/env bash
# Kiểm tra máy dev đủ công cụ. Chạy: bash scripts/check-prereqs.sh
ok=0
chk() { # tên, lệnh lấy version, ghi chú
  if v=$(eval "$2" 2>/dev/null | head -1); then printf "  [OK]   %-12s %s\n" "$1" "$v"
  else printf "  [THIẾU] %-11s %s\n" "$1" "$3"; ok=1; fi
}
echo "== Công cụ bắt buộc =="
chk node   "node -v"                 "cài Node 20+ (nvm install 20)"
chk pnpm   "pnpm -v"                 "corepack enable && corepack prepare pnpm@9.15.9 --activate"
chk docker "docker --version"        "cài Docker Desktop (Windows: bật WSL2 integration)"
chk compose "docker compose version" "cần Docker Compose v2"
chk git    "git --version"           "cài git"
chk make   "make --version"          "Windows: dùng WSL2 (sudo apt install make)"
echo "== Khuyến nghị =="
chk gh          "gh --version"          "https://cli.github.com (dùng cho script tạo issue)"
chk k6          "k6 version"            "cần từ tuần 2 (Tuấn)"
chk cloudflared "cloudflared --version" "cần để nhận IPN VNPay (Tuấn)"
node_major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
[ "$node_major" -ge 20 ] 2>/dev/null || { echo "  [CẢNH BÁO] Node < 20"; ok=1; }
exit $ok
