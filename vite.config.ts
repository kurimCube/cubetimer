import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/cubetimer/",
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: ["apple-touch-icon.png", "favicon.svg"],
      manifest: {
        name: "軽量キューブタイマー",
        short_name: "キューブタイマー",
        description: "3×3・7×7対応の軽量オフラインキューブタイマー",
        lang: "ja",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#f5f7fb",
        theme_color: "#f5f7fb",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html"
      },
      devOptions: { enabled: false }
    })
  ],
  build: {
    target: "es2022",
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"]
  }
});
