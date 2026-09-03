import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 根任务并行运行 server/web 测试时的负载余量：放宽单测超时并限制并发 worker。
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
    maxWorkers: 2,
    fileParallelism: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: "工作计划",
        short_name: "工作计划",
        description: "工作计划、月度目标与提醒管理",
        lang: "zh-CN",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f6f8fb",
        theme_color: "#f6f8fb",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/health\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "frappe-gantt-style": path.join(appDir, "node_modules/frappe-gantt/dist/frappe-gantt.css"),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ["wp-test.lxj.ink"],
    proxy: {
      "/api": "http://localhost:3002",
      "/health": "http://localhost:3002",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
