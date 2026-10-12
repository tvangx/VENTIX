#!/usr/bin/env python3
"""Đọc docs/architecture/plan-6-weeks.md -> scripts/issues.tsv (mỗi task = 1 dòng).
Chạy lại mỗi khi sửa plan:  python3 scripts/gen-issues.py"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
plan = root / "docs/architecture/plan-6-weeks.md"
out = root / "scripts/issues.tsv"

OWNER = {"Tuấn": "tuan", "Sơn": "son", "Vũ": "vu"}
COULD = {"S-502"}
SHOULD_KW = ("resale", "escrow", "notification", "finance", "hóa đơn", "invoice", "tra cứu", "thông báo", "audit")

week = owner = None
rows = []
for line in plan.read_text(encoding="utf-8").splitlines():
    m = re.match(r"^### TUẦN (\d+)", line)
    if m:
        week, owner = int(m.group(1)), None
        continue
    m = re.match(r"^#### (Tuấn|Sơn|Vũ)\s*$", line)
    if m:
        owner = OWNER[m.group(1)]
        continue
    if re.match(r"^\| [TSV]-\d+[a-z]? \|", line):
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) != 5:
            sys.exit(f"Dòng không đủ 5 cột (có thể chứa dấu |): {line[:80]}")
        tid, title, days, deps, dod = parts
        title = title.replace("**", "")
        text = (title + " " + dod).lower()
        prio = "could" if tid in COULD else ("should" if any(k in text for k in SHOULD_KW) else "must")
        rows.append((tid, week, owner, title, days.replace(",", "."), deps, dod, prio))

with out.open("w", encoding="utf-8") as f:
    f.write("id\tweek\towner\ttitle\tdays\tdeps\tdod\tpriority\n")
    for r in rows:
        f.write("\t".join(str(x).replace("\t", " ") for x in r) + "\n")
print(f"{len(rows)} task -> {out.relative_to(root)}")
