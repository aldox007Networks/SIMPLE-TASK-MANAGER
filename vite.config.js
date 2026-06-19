import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icono-192.png", "icono-512.png"],
      manifest: {
        name: "Centro de Operaciones",
        short_name: "Operaciones",
        description: "Control y seguimiento de actividades",
        theme_color: "#13151a",
        background_color: "#13151a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icono-192.png", sizes: "192x192", type: "image/png" },
          { src: "icono-512.png", sizes: "512x512", type: "image/png" },
          { src: "icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
