import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
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
