import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";
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

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), svgr(), preloadMap()],
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
  },
});
