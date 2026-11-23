import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";
import { readFileSync } from "node:fs";
import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";

/**
 * THE MAP'S CODE, ASKED FOR WITH THE PAGE. The map is in a chunk of its own, and Pixi's renderer in chunks of its
 * own behind that: left alone each is asked for only when the one before has been fetched and run — three round
 * trips, one after another, before anything can be drawn. Named in the page's head they are fetched beside the
 * entry script. (The WebGL renderer is not: it is the fall-back.)
 */
const preloadMap = (): Plugin => ({
  name: "preload-map",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(_html, ctx) {
      const chunks = Object.values(ctx.bundle ?? {}).flatMap((c) => (c.type === "chunk" ? [c] : []));
      const byFile = new Map(chunks.map((c) => [c.fileName, c]));
      const closure = (roots: typeof chunks) => {
        const seen = new Set<string>();
        const walk = (f: string) => { if (seen.has(f)) return; seen.add(f); for (const i of byFile.get(f)?.imports ?? []) walk(i); };
        for (const r of roots) walk(r.fileName);
        return seen;
      };
      const have = closure(chunks.filter((c) => c.isEntry));
      const wanted = closure(chunks.filter((c) => /^(company-map|WebGPURenderer|browserAll|webworkerAll)$/.test(c.name)));
      return [...wanted].filter((f) => !have.has(f)).map((f): HtmlTagDescriptor => ({
        tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `/${f}` }, injectTo: "head",
      }));
    },
  },
});

/**
 * A shader's text without what only a person reads: the comments and the blank lines of every template marked
 * `/* wgsl *\/` or `/* glsl *\/`. A quarter of the shaders' text is the reasons written beside it, and all of it
 * was sent to every player. Only the text between the `${...}` is touched; a comment takes what it runs through
 * to its line's end, an interpolation in it included.
 */
export function stripShaderText(code: string): string {
  const tag = /\/\*\s*(?:wgsl|glsl)\s*\*\/\s*`/g;
  let out = "", from = 0;
  for (let m = tag.exec(code); m; m = tag.exec(code)) {
    let i = m.index + m[0].length, text = "", line = "", inComment = false;
    // (The indentation kept: the water's corner pass cuts a function out of its shader by where a line is a
    // brace alone at the margin. Only the comments, the blank lines and what trails a line go.)
    const flush = () => { const t = line.replace(/\s+$/, ""); if (t.trim()) text += (text ? "\n" : "") + t; line = ""; };
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "\\") { if (!inComment) line += c + code[i + 1]; i++; continue; }
      if (c === "`") break;
      if (c === "\n") { inComment = false; flush(); continue; }
      if (c === "$" && code[i + 1] === "{") {
        // An interpolation, kept whole: its own braces, strings and templates counted through.
        let depth = 0, j = i + 1;
        for (; j < code.length; j++) {
          const d = code[j];
          if (d === "{") depth++;
          else if (d === "}") { depth--; if (depth === 0) break; }
          else if (d === "'" || d === '"' || d === "`") { const q = d; for (j++; j < code.length && code[j] !== q; j++) if (code[j] === "\\") j++; }
        }
        if (!inComment) line += code.slice(i, j + 1);
        i = j;
        continue;
      }
      if (inComment) continue;
      if (c === "/" && code[i + 1] === "/") { inComment = true; continue; }
      line += c;
    }
    const endsLine = line === "" && code[i - 1] === "\n";
    flush();
    // (And a last line's end kept where it had one: what is joined on after starts a line of its own.)
    if (endsLine && text) text += "\n";
    out += code.slice(from, m.index + m[0].length) + (code[m.index + m[0].length] === "\n" && text ? "\n" : "") + text;
    from = i;
    tag.lastIndex = i + 1;
  }
  return out + code.slice(from);
}

const stripShaders = (): Plugin => ({
  name: "strip-shader-text",
  apply: "build",
  enforce: "pre",
  transform(code, id) {
    if (!/\/src\/.*\.tsx?$/.test(id) || !/\/\*\s*(?:wgsl|glsl)\s*\*\//.test(code)) return null;
    return { code: stripShaderText(code), map: null };
  },
});

/**
 * THE HOUSES' PICTURES, NAMED IN THE PAGE: the map is not drawn until they are in, and they were asked for only
 * once their list had been fetched and read — a round trip later than they need be. (The page's own script still
 * asks for the list and then for these: it finds them fetched, or on their way.)
 */
const preloadHouses = (): Plugin => ({
  name: "preload-houses",
  apply: "build",
  transformIndexHtml() {
    const base = "isometric_assets/derived";
    const sheet = JSON.parse(readFileSync(`public/${base}/houses.json`, "utf8")) as { pages: string[] };
    return ["houses.json", ...sheet.pages].map((f): HtmlTagDescriptor => ({
      tag: "link", attrs: { rel: "preload", as: "fetch", crossorigin: "anonymous", href: `/${base}/${f}` }, injectTo: "head-prepend",
    }));
  },
});

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [stripShaders(), react(), tailwindcss(), svgr(), preloadMap(), preloadHouses()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  /**
   * Pixi loads its two renderers dynamically and we normally only ever ask for
   * one, so the dep optimiser never sees the other — and the first page that
   * asks for WebGL gets a 504 on a chunk that does not exist yet, which looks
   * exactly like a blank map. Named here so both are bundled up front.
   */
  optimizeDeps: {
    include: ["pixi.js/webworker", "pixi.js"],
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    sourcemap: true,
    target: ["es2021", "chrome105", "safari15"],
    rollupOptions: {
      output: {
        /**
         * REACT IN A CHUNK OF ITS OWN, apart from the game's code: it changes only when the dependency does, so after
         * a deploy a returning player's browser has it already. (Only React: Pixi and the rest named here pulled
         * what they load on demand — the other renderers, the console's animations — into what everyone fetches.)
         */
        manualChunks(id) {
          return /\/node_modules\/(react|react-dom|react-reconciler|scheduler)\//.test(id) ? "vendor-react" : undefined;
        },
      },
    },
  },
});
