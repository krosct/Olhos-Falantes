import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";

const apiPort = process.env.API_PORT ?? "8000";
const apiTarget = process.env.API_PROXY_TARGET ?? `http://127.0.0.1:${apiPort}`;
const webPort = Number(process.env.WEB_PORT ?? 5173);
const listenOnLan = process.env.WEB_HOST === "1";
const useHttps = process.env.DEV_HTTPS === "1";

export default defineConfig({
  plugins: [
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,webmanifest}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true
      },
      manifest: {
        name: "Olhos Falantes",
        short_name: "Olhos Falantes",
        description: "Fotografe uma cena e ouca uma descricao curta dela.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#ffffff",
        theme_color: "#0f766e",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      }
    })
  ],
  server: {
    host: listenOnLan ? true : "127.0.0.1",
    port: webPort,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true }
    }
  },
  preview: {
    host: listenOnLan ? true : "127.0.0.1",
    port: webPort,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true }
    }
  }
});
