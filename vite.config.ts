import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";
import fs from "node:fs";
import path from "node:path";

import { defineConfig, type PluginOption } from "vite";

/**
 * DEV-ONLY road-tile labeller. `apply: "serve"` keeps it entirely out of
 * production builds, and the HTML lives in `dev/` (not `public/`) so it is
 * never copied into `dist/`. Serves:
 *   GET  /_roadlabel.html -> the labeller UI (from dev/roadlabel.html)
 *   GET  /api/roadlabels  -> current road-labels.json (or {})
 *   POST /api/roadlabels  -> overwrite road-labels.json with the body
 */
function roadLabeller(): PluginOption {
  const LABELS = path.resolve(process.cwd(), "road-labels.json");
  const HTML = path.resolve(process.cwd(), "dev/roadlabel.html");
  return {
    name: "dev-road-labeller",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/_roadlabel.html", (_req, res) => {
        try {
          res.setHeader("Content-Type", "text/html");
          res.end(fs.readFileSync(HTML, "utf8"));
        } catch {
          res.statusCode = 404;
          res.end("labeller not found");
        }
      });
      server.middlewares.use("/api/roadlabels", (req, res) => {
        if (req.method === "GET") {
          let data = "{}";
          try {
            data = fs.readFileSync(LABELS, "utf8");
          } catch {
            /* no file yet */
          }
          res.setHeader("Content-Type", "application/json");
          res.end(data);
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              JSON.parse(body || "{}"); // validate
              fs.writeFileSync(LABELS, body || "{}");
              res.setHeader("Content-Type", "application/json");
              res.end('{"ok":true}');
            } catch {
              res.statusCode = 400;
              res.end('{"ok":false}');
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), svgr(), roadLabeller()],
  build: {
    sourcemap: true,
  },
});
