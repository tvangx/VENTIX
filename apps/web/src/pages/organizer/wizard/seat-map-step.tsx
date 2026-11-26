import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { SeatMapCanvas } from "@/components/seat-map/seat-map-canvas";
import { Button } from "@/components/ui/button";
import { tierTones } from "@/lib/catalog/sale";
import { useCreateSeatMap, type TicketClass } from "@/lib/organizer/api";
import { isVersionConflict, organizerErrorMessage } from "@/lib/organizer/errors";
import { parseIntegerInput } from "@/lib/organizer/forms";
import { gaClasses, seatedClasses, seatMapMatches } from "@/lib/organizer/readiness";
import {
  buildLayout,
  checkPlans,
  suggestPlan,
  type BlockPlan,
} from "@/lib/organizer/seat-map-builder";
import {
  checkDraft,
  draftFromLayout,
  gaDraftFrom,
  khuSeats,
  LABEL_MAX,
  NAME_MAX,
  newKey,
  nextName,
  rowAfter,
  type Draft,
  type DraftBlock,
  type DraftGaArea,
  type DraftKhu,
  type DraftRow,
  type EditorIssue,
  moveItem,
} from "@/lib/organizer/seat-map-editor";
import { TIER_COLORS } from "@/lib/seatmap/colors";
import { buildGeometry, type SeatMapGeometry } from "@/lib/seatmap/geometry";
import { parseAnyLayout } from "@/lib/seatmap/layout";
import type { SeatStatus } from "@/lib/seatmap/selection";
import { cn } from "@/lib/utils";
import { FormAlert, StepHeading } from "./form-parts";
import type { StepProps } from "./wizard-page";

// Bước sơ đồ: trình chỉnh Block → Khu → hàng (vé có ghế) và khu đứng (vé GA, `ga_areas` của
// issue #98) trong phạm vi hợp đồng layout của event-service.
// "Tạo nhanh" sinh bản nháp ghế đều đặn từ số lượng của từng hạng; sau đó sửa tự do từng phần.

const NO_STATUS: ReadonlyMap<string, SeatStatus> = new Map();
const NO_SELECTION: ReadonlySet<string> = new Set();
const noop = () => undefined;
/** Sơ đồ có nhiều khu hơn mức này thì khu mở sẵn bị thu gọn để trang nhẹ. */
const OPEN_ALL_MAX = 4;

const input =
  "h-10 w-full min-w-0 rounded-[10px] border-0 border-b-[3px] border-input bg-field px-2.5 text-[15px] text-foreground outline-none focus-visible:border-link focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-dashed disabled:opacity-60";

function quickDraft(classes: TicketClass[]): Draft {
  return draftFromLayout(buildLayout(classes.map((c) => suggestPlan(c.id, c.capacity))));
}

function openKeys(draft: Draft): ReadonlySet<string> {
  const khus = draft.flatMap((b) => b.khus);
  return new Set(khus.length <= OPEN_ALL_MAX ? khus.map((k) => k.key) : []);
}

/** Chưa có hạng vé: chưa làm sơ đồ được, chỉ dẫn quay lại bước Hạng vé. */
export function NoSeatMapStep({
  onNext,
  onBack,
  goTo,
}: StepProps & { goTo: (step: "classes") => void }) {
  return (
    <>
      <StepHeading title="Sơ đồ">
        Sự kiện chưa có hạng vé nên chưa làm sơ đồ được. Quay lại bước Hạng vé để thêm hạng.
      </StepHeading>
      <div className="flex flex-wrap justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          ← Hạng vé
        </Button>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" size="lg" onClick={() => goTo("classes")}>
            Sửa hạng vé
          </Button>
          <Button type="button" size="lg" onClick={onNext}>
            Tiếp →
          </Button>
        </div>
      </div>
    </>
  );
}

export function SeatMapStep({
  organizerId,
  bundle,
  readOnly,
  onNext,
  onBack,
  onConflict,
}: StepProps) {
  const seated = seatedClasses(bundle);
  const standing = gaClasses(bundle);
  const create = useCreateSeatMap(organizerId, bundle.event.id);
  const [apiError, setApiError] = useState<string | null>(null);
  const saved = bundle.seatMap ? parseAnyLayout(bundle.seatMap.layout) : null;
  const [draft, setDraft] = useState<Draft>(() =>
    saved && (saved.zones.length > 0 || seated.length === 0)
      ? draftFromLayout(saved)
      : quickDraft(seated),
  );
  const [gaAreas, setGaAreas] = useState<DraftGaArea[]>(() => gaDraftFrom(saved, standing));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => openKeys(draft));

  const { check, geometry } = useMemo(() => {
    const classes = bundle.ticketClasses
      .filter((c) => c.kind === "SEATED")
      .map((c) => ({ id: c.id, name: c.name, capacity: c.capacity }));
    const result = checkDraft(draft, classes, gaAreas);
    const layout = result.layout;
    return {
      check: result,
      geometry: layout ? buildGeometry(layout) : null,
    };
  }, [draft, gaAreas, bundle.ticketClasses]);
  const classColors = useMemo(() => {
    const tones = tierTones(bundle.ticketClasses);
    return new Map([...tones].map(([id, tone]) => [id, TIER_COLORS[tone]]));
  }, [bundle.ticketClasses]);

  const layoutJson = check.layout ? JSON.stringify(check.layout) : null;
  const savedJson = bundle.seatMap ? JSON.stringify(bundle.seatMap.layout) : null;
  // Bản nháp còn lỗi cũng tính là khác bản đã lưu (nút Lưu hiện nhưng tắt).
  const unsaved = layoutJson === null || layoutJson !== savedJson;
  const matches = seatMapMatches(bundle);
  const fallbackClass = seated[0]?.id ?? "";

  // ---------- Sửa bản nháp (bất biến) ----------
  const setBlock = (bi: number, fn: (b: DraftBlock) => DraftBlock) =>
    setDraft((d) => d.map((b, i) => (i === bi ? fn(b) : b)));
  const setKhu = (bi: number, ki: number, fn: (k: DraftKhu) => DraftKhu) =>
    setBlock(bi, (b) => ({ ...b, khus: b.khus.map((k, i) => (i === ki ? fn(k) : k)) }));
  const setRow = (bi: number, ki: number, ri: number, changes: Partial<DraftRow>) =>
    setKhu(bi, ki, (k) => ({
      ...k,
      rows: k.rows.map((r, i) => (i === ri ? { ...r, ...changes } : r)),
    }));
  const toggle = (key: string, value: boolean) =>
    setOpen((s) => {
      if (s.has(key) === value) return s;
      const next = new Set(s);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });

  const addBlock = () => {
    const name = nextName(
      draft.map((b) => b.name),
      (n) => `Block ${n <= 26 ? String.fromCharCode(64 + n) : n}`,
    );
    const khu: DraftKhu = { key: newKey(), name: `${name.replace(/^Block\s*/, "")}1`, rows: [] };
    khu.rows.push(rowAfter(khu, fallbackClass));
    setDraft((d) => [...d, { key: newKey(), name, khus: [khu] }]);
    toggle(khu.key, true);
  };
  const addKhu = (bi: number) => {
    const block = draft[bi];
    if (!block) return;
    const prefix = block.name.replace(/^Block\s*/i, "").trim();
    const name = nextName(
      block.khus.map((k) => k.name),
      (n) => `${prefix}${n}`,
    );
    // Khu mới chép các hàng của khu cuối để đỡ nhập lại.
    const template = block.khus[block.khus.length - 1];
    const khu: DraftKhu = {
      key: newKey(),
      name,
      rows: (template?.rows ?? []).map((r) => ({ ...r, key: newKey() })),
    };
    if (khu.rows.length === 0) khu.rows.push(rowAfter(khu, fallbackClass));
    setBlock(bi, (b) => ({ ...b, khus: [...b.khus, khu] }));
    toggle(khu.key, true);
  };
  const addRows = (bi: number, ki: number, count: number) =>
    setKhu(bi, ki, (k) => {
      const rows = [...k.rows];
      for (let i = 0; i < count; i += 1) rows.push(rowAfter({ ...k, rows }, fallbackClass));
      return { ...k, rows };
    });

  const save = () => {
    if (!check.layout) return;
    setApiError(null);
    create.mutate(check.layout, {
      onError: (error) => {
        if (isVersionConflict(error)) onConflict(organizerErrorMessage(error));
        else setApiError(organizerErrorMessage(error));
      },
    });
  };

  const issuesAt = (pred: (i: EditorIssue) => boolean) => check.issues.filter(pred);
  const mapIssues = issuesAt((i) => i.path.level === "map");
  const gaIssue = (ai: number) =>
    check.issues.find((i) => i.path.level === "ga" && i.path.area === ai);

  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Sơ đồ">
        {seated.length > 0
          ? "Vé có ghế: sơ đồ gồm các Block, mỗi Block chia thành các Khu, mỗi Khu có các hàng ghế. Mỗi hàng có số ghế và hạng vé riêng. Tổng ghế của mỗi hạng phải bằng số lượng vé của hạng. Block trên cùng gần sân khấu nhất; trong một Block, khu trên cùng ở bên trái. Dùng nút ↑↓ để đổi vị trí. "
          : ""}
        {standing.length > 0
          ? "Vé đứng: mỗi hạng vé đứng là một khu đứng. Đặt tên khu nói rõ vị trí để khán giả biết khu nằm ở đâu."
          : ""}
      </StepHeading>

      {standing.length > 0 ? (
        <section aria-label="Khu đứng" className="flex flex-col gap-3 bg-card p-4 md:p-5">
          <h3 className="m-0 text-lg font-bold">Khu đứng</h3>
          <p className="m-0 text-[15px]">
            Ví dụ: “Khu đứng A – sát sân khấu, bên trái”, “Fanzone – giữa sân”. Khu đứng nằm sát sân
            khấu; khu trên cùng của danh sách ở bên trái sơ đồ.
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {gaAreas.map((area, ai) => {
              const ticketClass = standing.find((c) => c.id === area.ticketClassId);
              const issue = gaIssue(ai);
              return (
                <li key={area.ticketClassId} className="flex flex-col gap-1">
                  <div className="flex items-end gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-full"
                          style={{
                            background: classColors.get(area.ticketClassId) ?? "transparent",
                          }}
                        />
                        Khu đứng của hạng {ticketClass?.name ?? ""} ·{" "}
                        {(ticketClass?.capacity ?? 0).toLocaleString("vi-VN")} vé
                      </span>
                      <input
                        className={input}
                        value={area.name}
                        maxLength={NAME_MAX}
                        disabled={readOnly}
                        aria-invalid={issue ? true : undefined}
                        onChange={(e) =>
                          setGaAreas((list) =>
                            list.map((a, i) => (i === ai ? { ...a, name: e.target.value } : a)),
                          )
                        }
                      />
                    </label>
                    {readOnly || gaAreas.length < 2 ? null : (
                      <MoveButtons
                        index={ai}
                        count={gaAreas.length}
                        upLabel={`Đưa khu đứng ${area.name.trim() || ai + 1} sang trái`}
                        downLabel={`Đưa khu đứng ${area.name.trim() || ai + 1} sang phải`}
                        onMove={(step) => setGaAreas((list) => moveItem(list, ai, step))}
                      />
                    )}
                  </div>
                  {issue ? <p className="m-0 text-sm font-bold">{issue.message}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {seated.length > 0 && standing.length > 0 ? (
        <h3 className="m-0 text-lg font-bold">Khu có ghế</h3>
      ) : null}

      {readOnly || seated.length === 0 ? null : (
        <QuickGenerate
          classes={seated}
          onGenerate={(plans) => {
            const next = draftFromLayout(buildLayout(plans));
            setDraft(next);
            setOpen(openKeys(next));
          }}
        />
      )}

      <ul aria-label="Các block" className="m-0 flex list-none flex-col gap-4 p-0">
        {draft.map((block, bi) => {
          const blockIssues = issuesAt((i) => i.path.level === "block" && i.path.block === bi);
          const label = block.name.trim() || `block ${bi + 1}`;
          return (
            <li key={block.key}>
              <div
                role="group"
                aria-label={label}
                className="flex flex-col gap-3 bg-card p-4 md:p-5"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 text-sm font-semibold">
                    Tên block
                    <input
                      className={cn(input, "h-11 text-base font-bold")}
                      value={block.name}
                      maxLength={NAME_MAX}
                      disabled={readOnly}
                      aria-invalid={blockIssues.length > 0 || undefined}
                      onChange={(e) => setBlock(bi, (b) => ({ ...b, name: e.target.value }))}
                    />
                  </label>
                  <span className="pb-2 text-[15px]">
                    {block.khus.length} khu ·{" "}
                    {block.khus.reduce((s, k) => s + khuSeats(k), 0).toLocaleString("vi-VN")} ghế
                  </span>
                  {readOnly || draft.length < 2 ? null : (
                    <MoveButtons
                      index={bi}
                      count={draft.length}
                      upLabel={`Đưa ${label} lên trước (gần sân khấu hơn)`}
                      downLabel={`Đưa ${label} ra sau (xa sân khấu hơn)`}
                      onMove={(step) => setDraft((d) => moveItem(d, bi, step))}
                    />
                  )}
                  {readOnly ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setDraft((d) => d.filter((_, i) => i !== bi))}
                    >
                      Xóa {label}
                    </Button>
                  )}
                </div>
                <Issues items={blockIssues} />

                <ul
                  aria-label={`Các khu của ${label}`}
                  className="m-0 flex list-none flex-col gap-2 p-0"
                >
                  {block.khus.map((khu, ki) => (
                    <li key={khu.key} className="flex items-start gap-2">
                      <KhuEditor
                        khu={khu}
                        classes={seated}
                        classColors={classColors}
                        readOnly={readOnly}
                        open={open.has(khu.key)}
                        onToggle={(v) => toggle(khu.key, v)}
                        issues={issuesAt(
                          (i) =>
                            (i.path.level === "khu" || i.path.level === "row") &&
                            i.path.block === bi &&
                            i.path.khu === ki,
                        )}
                        onName={(name) => setKhu(bi, ki, (k) => ({ ...k, name }))}
                        onRow={(ri, changes) => setRow(bi, ki, ri, changes)}
                        onRemoveRow={(ri) =>
                          setKhu(bi, ki, (k) => ({ ...k, rows: k.rows.filter((_, i) => i !== ri) }))
                        }
                        onAddRows={(n) => addRows(bi, ki, n)}
                        onRemove={() =>
                          setBlock(bi, (b) => ({ ...b, khus: b.khus.filter((_, i) => i !== ki) }))
                        }
                      />
                      {readOnly || block.khus.length < 2 ? null : (
                        <MoveButtons
                          index={ki}
                          count={block.khus.length}
                          upLabel={`Đưa khu ${khu.name.trim() || ki + 1} sang trái`}
                          downLabel={`Đưa khu ${khu.name.trim() || ki + 1} sang phải`}
                          onMove={(step) =>
                            setBlock(bi, (b) => ({ ...b, khus: moveItem(b.khus, ki, step) }))
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
                {readOnly ? null : (
                  <div>
                    <Button type="button" size="sm" variant="secondary" onClick={() => addKhu(bi)}>
                      + Thêm khu vào {label}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {readOnly || seated.length === 0 ? null : (
        <div>
          <Button type="button" variant="secondary" onClick={addBlock}>
            + Thêm block
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {seated.length > 0 ? (
          <p data-testid="seat-totals" className="m-0 font-semibold">
            Tổng {check.totalSeats.toLocaleString("vi-VN")} ghế
            {seated.map((c) => (
              <span key={c.id} className="font-normal">
                {" · "}
                {c.name} {(check.seatsByClass.get(c.id) ?? 0).toLocaleString("vi-VN")}/
                {c.capacity.toLocaleString("vi-VN")}
              </span>
            ))}
          </p>
        ) : null}
        <Issues items={mapIssues} />
      </div>

      {geometry ? (
        <div className="relative h-[320px] overflow-hidden rounded-[24px] md:h-[420px]">
          <SeatMapCanvas
            geometry={geometry}
            classColors={classColors}
            statuses={NO_STATUS}
            selected={NO_SELECTION}
            onSeatPress={noop}
            label={previewLabel(geometry)}
            className="size-full"
          />
        </div>
      ) : seated.length > 0 || draft.length > 0 ? (
        <p className="m-0 bg-card px-4 py-6 text-center">Sửa hết lỗi để xem trước sơ đồ.</p>
      ) : null}

      <p role="status" className="m-0 font-semibold">
        {bundle.seatMap
          ? unsaved
            ? `Có thay đổi chưa lưu. Đang dùng sơ đồ phiên bản ${bundle.seatMap.version}.`
            : `Đã lưu sơ đồ phiên bản ${bundle.seatMap.version}.`
          : "Chưa lưu sơ đồ nào."}
        {bundle.seatMap && !matches && !unsaved
          ? " Sơ đồ đã lưu không còn khớp hạng vé (ghế hoặc khu đứng), sửa rồi lưu lại."
          : ""}
      </p>
      <FormAlert message={apiError} />

      <div className="flex flex-wrap justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          ← Hạng vé
        </Button>
        <div className="flex flex-wrap gap-3">
          {!readOnly && unsaved ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={save}
              disabled={!check.layout || create.isPending}
            >
              {create.isPending ? "Đang lưu…" : "Lưu sơ đồ"}
            </Button>
          ) : null}
          <Button type="button" size="lg" disabled={!matches || unsaved} onClick={onNext}>
            Tiếp →
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Hai nút đổi chỗ với phần tử kề bên; thứ tự trong layout là vị trí trên sơ đồ. */
function MoveButtons({
  index,
  count,
  upLabel,
  downLabel,
  onMove,
}: {
  index: number;
  count: number;
  upLabel: string;
  downLabel: string;
  onMove: (step: -1 | 1) => void;
}) {
  return (
    <span className="inline-flex shrink-0 gap-1">
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label={upLabel}
        title={upLabel}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label={downLabel}
        title={downLabel}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
    </span>
  );
}

function previewLabel(geometry: SeatMapGeometry): string {
  const parts = [];
  if (geometry.seats.length > 0) {
    parts.push(
      `${geometry.seats.length.toLocaleString("vi-VN")} ghế, ${geometry.zones.length} block`,
    );
  }
  if (geometry.gaAreas.length > 0) {
    parts.push(`khu đứng ${geometry.gaAreas.map((area) => area.name).join(", ")}`);
  }
  return `Xem trước sơ đồ: ${parts.join("; ")}.`;
}

function Issues({ items }: { items: EditorIssue[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((issue, i) => (
        <li key={i} className="font-bold">
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function KhuEditor({
  khu,
  classes,
  classColors,
  readOnly,
  open,
  onToggle,
  issues,
  onName,
  onRow,
  onRemoveRow,
  onAddRows,
  onRemove,
}: {
  khu: DraftKhu;
  classes: TicketClass[];
  classColors: ReadonlyMap<string, string>;
  readOnly: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  issues: EditorIssue[];
  onName: (name: string) => void;
  onRow: (row: number, changes: Partial<DraftRow>) => void;
  onRemoveRow: (row: number) => void;
  onAddRows: (count: number) => void;
  onRemove: () => void;
}) {
  const [addCount, setAddCount] = useState("1");
  const title = khu.name.trim() || "(chưa đặt tên)";
  const rowIssue = (ri: number, field: "label" | "seats" | "class") =>
    issues.find((i) => i.path.level === "row" && i.path.row === ri && i.path.field === field);
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className={cn(
        "min-w-0 flex-1 bg-background",
        issues.length > 0 && "outline-2 -outline-offset-2 outline-foreground outline-dashed",
      )}
    >
      <summary className="cursor-pointer px-4 py-3 font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        Khu {title}
        <span className="font-normal">
          {" "}
          · {khu.rows.length} hàng · {khuSeats(khu).toLocaleString("vi-VN")} ghế
          {issues.length > 0 ? ` · ${issues.length} lỗi` : ""}
        </span>
      </summary>
      {open ? (
        <div role="group" aria-label={`Khu ${title}`} className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-[1_1_180px] flex-col gap-1 text-sm font-semibold">
              Tên khu
              <input
                className={input}
                value={khu.name}
                maxLength={NAME_MAX}
                disabled={readOnly}
                aria-invalid={issues.some((i) => i.path.level === "khu") || undefined}
                onChange={(e) => onName(e.target.value)}
              />
            </label>
            {readOnly ? null : (
              <Button type="button" size="sm" variant="outline" onClick={onRemove}>
                Xóa khu {title}
              </Button>
            )}
          </div>
          <Issues items={issues.filter((i) => i.path.level === "khu")} />

          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-[22%] pb-1 font-semibold">
                  Hàng
                </th>
                <th scope="col" className="w-[22%] pb-1 font-semibold">
                  Số ghế
                </th>
                <th scope="col" className="pb-1 font-semibold">
                  Hạng vé
                </th>
                <th scope="col" className="w-11 pb-1">
                  <span className="sr-only">Xóa</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {khu.rows.map((row, ri) => {
                const errors = [
                  rowIssue(ri, "label"),
                  rowIssue(ri, "seats"),
                  rowIssue(ri, "class"),
                ].filter((x): x is EditorIssue => x !== undefined);
                const name = row.label.trim() || `${ri + 1}`;
                return (
                  <tr key={row.key} className="align-top">
                    <td className="py-1 pr-2">
                      <input
                        aria-label={`Nhãn hàng thứ ${ri + 1}`}
                        className={input}
                        value={row.label}
                        maxLength={LABEL_MAX}
                        disabled={readOnly}
                        aria-invalid={rowIssue(ri, "label") ? true : undefined}
                        onChange={(e) => onRow(ri, { label: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        aria-label={`Số ghế hàng ${name}`}
                        className={input}
                        inputMode="numeric"
                        value={row.seats}
                        disabled={readOnly}
                        aria-invalid={rowIssue(ri, "seats") ? true : undefined}
                        onChange={(e) => onRow(ri, { seats: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-full"
                          style={{
                            background: classColors.get(row.ticketClassId) ?? "transparent",
                          }}
                        />
                        <select
                          aria-label={`Hạng vé hàng ${name}`}
                          className={cn(input, "cursor-pointer")}
                          value={row.ticketClassId}
                          disabled={readOnly}
                          aria-invalid={rowIssue(ri, "class") ? true : undefined}
                          onChange={(e) => onRow(ri, { ticketClassId: e.target.value })}
                        >
                          <option value="">Chọn hạng</option>
                          {classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {errors.map((e, i) => (
                        <p key={i} className="m-0 pt-1 text-sm font-bold">
                          {e.message}
                        </p>
                      ))}
                    </td>
                    <td className="py-1">
                      {readOnly ? null : (
                        <button
                          type="button"
                          aria-label={`Xóa hàng ${name}`}
                          onClick={() => onRemoveRow(ri)}
                          className="size-10 cursor-pointer rounded-full border-2 border-foreground bg-transparent text-base text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                        >
                          <X aria-hidden="true" className="mx-auto size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {readOnly ? null : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex w-28 flex-col gap-1 text-sm font-semibold">
                Số hàng thêm
                <input
                  className={input}
                  inputMode="numeric"
                  value={addCount}
                  onChange={(e) => setAddCount(e.target.value)}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const n = parseIntegerInput(addCount) ?? 0;
                  if (n >= 1) onAddRows(Math.min(n, 200));
                }}
              >
                + Thêm hàng vào khu {title}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </details>
  );
}

type QuickField = "khuCount" | "rowsPerKhu" | "seatsPerRow";
const QUICK_LABEL: Record<QuickField, string> = {
  khuCount: "Số khu",
  rowsPerKhu: "Hàng mỗi khu",
  seatsPerRow: "Ghế mỗi hàng",
};

/** Tạo nhanh bản nháp đều đặn: mỗi hạng một Block, chia đều khu/hàng/ghế (thay bản đang sửa). */
function QuickGenerate({
  classes,
  onGenerate,
}: {
  classes: TicketClass[];
  onGenerate: (plans: BlockPlan[]) => void;
}) {
  const [values, setValues] = useState<Record<string, Record<QuickField, string>>>(() =>
    Object.fromEntries(
      classes.map((c) => {
        const p = suggestPlan(c.id, c.capacity);
        return [
          c.id,
          {
            khuCount: String(p.khuCount),
            rowsPerKhu: String(p.rowsPerKhu),
            seatsPerRow: String(p.seatsPerRow),
          },
        ];
      }),
    ),
  );
  const plans: BlockPlan[] = classes.map((c) => {
    const v = values[c.id];
    const n = (f: QuickField) => parseIntegerInput(v?.[f] ?? "") ?? 0;
    return {
      ticketClassId: c.id,
      khuCount: n("khuCount"),
      rowsPerKhu: n("rowsPerKhu"),
      seatsPerRow: n("seatsPerRow"),
    };
  });
  const issues = checkPlans(
    plans,
    classes.map((c) => ({ id: c.id, name: c.name, capacity: c.capacity })),
  );
  return (
    <details className="border-[3px] border-dashed border-foreground">
      <summary className="cursor-pointer px-4 py-3 font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        Tạo nhanh từ hạng vé
      </summary>
      <div role="group" aria-label="Tạo nhanh" className="flex flex-col gap-3 px-4 pb-4">
        <p className="m-0 text-[15px]">
          Mỗi hạng có chỗ ngồi thành một Block chia đều. Bấm tạo sẽ thay sơ đồ đang sửa, sau đó sửa
          tiếp từng phần.
        </p>
        {classes.map((c) => (
          <div key={c.id} className="flex flex-wrap items-end gap-2">
            <b className="w-full text-[15px]">
              {c.name} · {c.capacity.toLocaleString("vi-VN")} vé
            </b>
            {(Object.keys(QUICK_LABEL) as QuickField[]).map((f) => (
              <label key={f} className="flex w-32 flex-col gap-1 text-sm font-semibold">
                {QUICK_LABEL[f]}
                <input
                  className={input}
                  inputMode="numeric"
                  value={values[c.id]?.[f] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [c.id]: {
                        ...(v[c.id] ?? { khuCount: "", rowsPerKhu: "", seatsPerRow: "" }),
                        [f]: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        ))}
        {issues.length > 0 ? (
          <p className="m-0 font-bold">
            Số khu × hàng × ghế của mỗi hạng phải bằng số vé và trong giới hạn.
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            size="sm"
            disabled={issues.length > 0}
            onClick={() => onGenerate(plans)}
          >
            Tạo sơ đồ nhanh
          </Button>
        </div>
      </div>
    </details>
  );
}
