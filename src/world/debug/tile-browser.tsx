/**
 * Tile browser — every frame in every atlas, ~940 of them.
 *
 * Thumbnails are `<div>`s with a scaled `background-position` onto the sheet
 * PNG, so the whole browser costs four image loads rather than 940. Rows are
 * WINDOWED: only what fits the scroll viewport is in the DOM, which is what
 * keeps a 940-item grid responsive.
 *
 * Picking a frame appends it to the terrain palette if it is new (see
 * `useFrame`) and selects it, so any frame is immediately paintable — that is
 * the point of the browser rather than a curated list.
 */
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";

import { useWorldStore } from "../../state/world.store";
import {
  frameSizes, loadAtlasIndex, loadSheetSizes, thumbStyle, type FrameEntry,
} from "./atlas-index";

const BOX = 40;           // thumbnail box, px
const COLS = 5;
const ROW_H = BOX + 16;   // box + label
const VIEW_H = 260;       // scroll viewport, px

export function TileBrowser() {
  const [entries, setEntries] = useState<FrameEntry[]>([]);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<string>("landscape");
  const [size, setSize] = useState<string>("all");
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const palette = useWorldStore((s) => s.palette);
  const material = useWorldStore((s) => s.material);
  const selectFrame = useWorldStore((s) => s.selectFrame);
  const activeFrame = palette[material] ?? null;

  useEffect(() => {
    let alive = true;
    void loadAtlasIndex().then(async (e) => {
      if (!alive) return;
      setEntries(e);
      const s = await loadSheetSizes(e);
      if (alive) setSizes(s);
    });
    return () => { alive = false; };
  }, []);

  const sheets = useMemo(
    () => ["all", ...new Set(entries.map((e) => e.sheet))],
    [entries],
  );
  const sizeOptions = useMemo(() => ["all", ...frameSizes(entries)], [entries]);

  // Fuse over names only — the useful query here is a frame number or a sheet.
  const fuse = useMemo(
    () => new Fuse(entries, { keys: ["name"], threshold: 0.35, ignoreLocation: true }),
    [entries],
  );

  const filtered = useMemo(() => {
    let list = q.trim() ? fuse.search(q.trim()).map((r) => r.item) : entries;
    if (sheet !== "all") list = list.filter((e) => e.sheet === sheet);
    if (size !== "all") list = list.filter((e) => `${e.w}×${e.h}` === size);
    return list;
  }, [entries, fuse, q, sheet, size]);

  // windowing
  const rows = Math.ceil(filtered.length / COLS);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - 1);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + VIEW_H) / ROW_H) + 1);
  const visible = filtered.slice(firstRow * COLS, lastRow * COLS);

  // reset scroll when the result set changes, or the window points at nothing
  useEffect(() => {
    setScrollTop(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [q, sheet, size]);

  return (
    <div>
      <p className="mb-1 text-gray-400">
        tiles <span className="text-gray-600">
          ({filtered.length}{filtered.length !== entries.length ? ` of ${entries.length}` : ""})
        </span>
      </p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search frames…"
        className="mb-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1
                   font-mono text-gray-200 placeholder:text-gray-600"
      />

      <div className="mb-1 flex flex-wrap gap-1">
        {sheets.map((s) => (
          <button key={s} type="button" onClick={() => setSheet(s)}
            className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono ${
              sheet === s
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
            }`}>{s}</button>
        ))}
      </div>
      <div className="mb-1 flex flex-wrap gap-1">
        {sizeOptions.slice(0, 6).map((s) => (
          <button key={s} type="button" onClick={() => setSize(s)}
            className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono ${
              size === s
                ? "border-sky-500 bg-sky-500/20 text-sky-300"
                : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
            }`}>{s}</button>
        ))}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="overflow-y-auto rounded border border-gray-800 bg-gray-950/60"
        style={{ height: VIEW_H }}
      >
        {/* spacer keeps the scrollbar honest while only a window is rendered */}
        <div style={{ height: rows * ROW_H, position: "relative" }}>
          <div
            style={{
              position: "absolute", top: firstRow * ROW_H, left: 0, right: 0,
              display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 2,
            }}
          >
            {visible.map((e) => {
              const on = activeFrame === e.name;
              return (
                <button
                  key={`${e.sheet}/${e.name}`}
                  type="button"
                  title={e.name}
                  onClick={() => selectFrame(e.name)}
                  className={`flex cursor-pointer flex-col items-center justify-end rounded border p-0.5 ${
                    on ? "border-emerald-400 bg-emerald-500/20" : "border-transparent hover:bg-gray-800"
                  }`}
                  style={{ height: ROW_H - 2 }}
                >
                  <div style={sizes[e.sheetUrl] ? thumbStyle(e, BOX, sizes[e.sheetUrl]) : { width: BOX, height: BOX }} />
                  <span className="font-mono text-[9px] leading-none text-gray-500">{e.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeFrame && (
        <p className="mt-1 truncate font-mono text-emerald-300" title={activeFrame}>
          painting: {activeFrame}
        </p>
      )}
    </div>
  );
}
