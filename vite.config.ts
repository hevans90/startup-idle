import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";

import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
  build: {
    sourcemap: true,
  },
});
