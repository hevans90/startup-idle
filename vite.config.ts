import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";
import fs from "node:fs";
import path from "node:path";

import { defineConfig, type PluginOption } from "vite";

/**
 * DEV-ONLY authoring tools (road-tile + building-kit labellers). `apply: "serve"`
 * keeps them out of production builds, and the HTML lives in `dev/` (not
 * `public/`) so it's never copied into `dist/`. Each tool gets:
 *   GET  /_<name>.html  -> the tool UI (from dev/<file>)
 *   GET  /api/<name>    -> current <name>.json (or {})
 *   POST /api/<name>    -> overwrite <name>.json with the body
 */
function devTools(): PluginOption {
  const TOOLS = [
    { route: "_roadlabel.html", html: "dev/roadlabel.html", api: "roadlabels", file: "road-labels.json" },
    { route: "_buildinglab.html", html: "dev/buildinglab.html", api: "buildingkits", file: "building-kits.json" },
  ];
  const at = (p: string) => path.resolve(process.cwd(), p);
  return {
    name: "dev-tools",
    apply: "serve",
    configureServer(server) {
      for (const t of TOOLS) {
        server.middlewares.use("/" + t.route, (_req, res) => {
          try {
            res.setHeader("Content-Type", "text/html");
            res.end(fs.readFileSync(at(t.html), "utf8"));
          } catch {
            res.statusCode = 404;
            res.end("tool not found");
          }
        });
        server.middlewares.use("/api/" + t.api, (req, res) => {
          if (req.method === "GET") {
            let data = "{}";
            try {
              data = fs.readFileSync(at(t.file), "utf8");
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
                fs.writeFileSync(at(t.file), body || "{}");
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
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), svgr(), devTools()],
  build: {
    sourcemap: true,
  },
});
