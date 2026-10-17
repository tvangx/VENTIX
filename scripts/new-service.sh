#!/usr/bin/env bash
# Tạo service mới từ services/_template.
# Dùng: bash scripts/new-service.sh <name> <port> [--force-name]
#   <name>        một trong: identity event booking payment ticket resale merch notification finance ai
#   <port>        cổng dev (xem AGENTS.md mục 1)
#   --force-name  bỏ kiểm tra danh sách tên (chỉ để thử, ví dụ `demo`)
set -euo pipefail

ALLOWED_NAMES="identity event booking payment ticket resale merch notification finance ai"

die() { echo "error: $*" >&2; exit 1; }

NAME="${1:-}"
PORT="${2:-}"
FORCE="${3:-}"

[ -n "$NAME" ] && [ -n "$PORT" ] || die "usage: bash scripts/new-service.sh <name> <port> [--force-name]"
[ -z "$FORCE" ] || [ "$FORCE" = "--force-name" ] || die "unknown option: $FORCE"

[[ "$NAME" =~ ^[a-z][a-z0-9]*$ ]] || die "name must match ^[a-z][a-z0-9]*$ (lowercase letters/digits): '$NAME'"
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "port must be a number in 1024-65535: '$PORT'"

if [ "$FORCE" != "--force-name" ]; then
  case " $ALLOWED_NAMES " in
    *" $NAME "*) ;;
    *) die "name '$NAME' is not one of: $ALLOWED_NAMES (use --force-name only for experiments)" ;;
  esac
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/services/_template"
TARGET="$ROOT/services/$NAME"

[ -d "$TEMPLATE" ] || die "template not found: $TEMPLATE"
[ ! -e "$TARGET" ] || die "services/$NAME already exists"

if grep -rqsx "PORT=$PORT" "$ROOT"/services/*/.env.example 2>/dev/null; then
  die "port $PORT is already used by another service"
fi

mkdir -p "$TARGET"
# tar thay cho rsync/cp -r vì Git Bash trên Windows không có rsync; loại bỏ build artefact.
(cd "$TEMPLATE" && tar --exclude=node_modules --exclude=dist --exclude=.turbo --exclude=.env --exclude=openapi.json -cf - .) \
  | (cd "$TARGET" && tar -xf -)

# Thay placeholder trong mọi file text. Ghi qua file tạm để chạy được cả GNU lẫn BSD sed
# và giữ nguyên LF (không để sed -i đổi kết thúc dòng).
while IFS= read -r file; do
  sed -e "s#@ticketing/service-template#@ticketing/$NAME#g" \
      -e "s#__SERVICE__#$NAME#g" \
      -e "s#__PORT__#$PORT#g" "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
done < <(grep -rIlE '__SERVICE__|__PORT__|@ticketing/service-template' "$TARGET" --exclude-dir=node_modules)

echo "Created services/$NAME (package @ticketing/$NAME, port $PORT)"
echo
echo "Next steps:"
echo "  1. pnpm install"
echo "  2. cp services/$NAME/.env.example services/$NAME/.env   # (.env không được commit)"
echo "  3. make up   # DB '${NAME}_db' có sẵn nếu '$NAME' nằm trong infra/postgres/init"
echo "  4. pnpm --filter @ticketing/$NAME dev   # GET http://localhost:$PORT/health/ready"
echo "  Xem docs/dev/new-service.md"
