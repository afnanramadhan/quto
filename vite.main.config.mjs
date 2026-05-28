import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        "electron",
        "playwright",
        "playwright-core",
        "better-sqlite3",
        "fsevents",
      ],
    },
  },
});
