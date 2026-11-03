/**
 * THE SUITE, A FILE A PROCESS: `bun test` runs every file one after another in
 * one process; this runs each in its own, several at once. Each process has its
 * own stores, so files cannot leak state into one another. The slowest files
 * start first, by the times the last run took (kept in node_modules/.cache).
 *
 * Run: `bun run test:par` — or `bun run test:par src/world` for a part of it.
 * `JOBS=n` sets how many at once (default: cores less two).
 */
import { availableParallelism } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(root, "node_modules/.cache/test-times.json");
const jobs = Number(process.env.JOBS) || Math.max(1, availableParallelism() - 2);
const only = process.argv.slice(2);

const files = [...new Bun.Glob("src/**/*.test.{ts,tsx}").scanSync(root)]
  .filter((f) => !only.length || only.some((o) => f.startsWith(o.replace(/^\.\//, ""))));
let times: Record<string, number> = {};
try { times = JSON.parse(readFileSync(CACHE, "utf8")); } catch { /* first run */ }
// Unknown files first: they might be slow.
files.sort((a, b) => (times[b] ?? Infinity) - (times[a] ?? Infinity));

type Result = { file: string; ok: boolean; secs: number; pass: number; fail: number; out: string };
const results: Result[] = [];
const start = performance.now();

async function runOne(file: string): Promise<Result> {
  const t = performance.now();
  const p = Bun.spawn(["bun", "test", `./${file}`], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0" } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  const all = out + err;
  const count = (k: string) => Number(new RegExp(`^\\s*(\\d+) ${k}$`, "m").exec(all)?.[1] ?? 0);
  return { file, ok: code === 0, secs: (performance.now() - t) / 1000, pass: count("pass"), fail: count("fail"), out: all };
}

let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, async () => {
  while (next < files.length) {
    const r = await runOne(files[next++]);
    results.push(r);
    process.stdout.write(`${r.ok ? "✓" : "✗"} ${r.file} ${r.secs.toFixed(1)}s\n`);
  }
}));

for (const r of results) times[r.file] = r.secs;
mkdirSync(dirname(CACHE), { recursive: true });
writeFileSync(CACHE, JSON.stringify(times));

const failed = results.filter((r) => !r.ok);
for (const r of failed) process.stdout.write(`\n──── ${r.file} ────\n${r.out}`);
const sum = (k: "pass" | "fail") => results.reduce((n, r) => n + r[k], 0);
const slowest = [...results].sort((a, b) => b.secs - a.secs).slice(0, 5).map((r) => `${r.file} ${r.secs.toFixed(0)}s`);
process.stdout.write(
  `\n${sum("pass")} pass, ${sum("fail")} fail, ${failed.length} of ${results.length} files failed — ${((performance.now() - start) / 1000).toFixed(0)}s with ${jobs} at once\n` +
  `slowest: ${slowest.join(", ")}\n`,
);
process.exit(failed.length ? 1 : 0);
