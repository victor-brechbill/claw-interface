import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "apple-touch-icon-v2.svg",
        "icon-192x192-v2.svg",
        "icon-512x512-v2.svg",
      ],
      manifest: {
        name: "Agent Dashboard",
        short_name: "Agent",
        description: "Agent Dashboard - Kanban board and system management",
        theme_color: "#c9a0dc",
        background_color: "#0d1117",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icon-192x192-v2.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon-512x512-v2.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          {
            src: "icon-192x192-v2.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512x512-v2.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Skip waiting and claim clients immediately for auto-update
        skipWaiting: true,
        clientsClaim: true,

        // Cloudflare challenge detection - don't cache challenge pages
        navigateFallbackDenylist: [
          /^\/cdn-cgi\//,
          /challenge-platform/,
          /__cf_/,
        ],

        // Runtime caching strategies
        // Disable navigate fallback - let network handle navigation
        // This fixes Cloudflare Access conflicts on pull-to-refresh
        navigateFallback: null,

        runtimeCaching: [
          // Network-first for navigation requests (HTML pages)
          // Critical for Cloudflare Access compatibility
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages-cache",
              networkTimeoutSeconds: 10,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Network-first for API calls (dynamic content)
          {
            urlPattern: /^https?:\/\/[^/]+\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Cache-first for static assets (images, fonts, etc.)
          // Exclude icon files - they're handled by precache with revision hashes
          {
            urlPattern: /^(?!.*icon-).*\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          // Cache-first for fonts
          {
            urlPattern: /\.(?:woff|woff2|ttf|otf|eot)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "font-cache",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          // Stale-while-revalidate for JS/CSS (good balance)
          {
            urlPattern: /\.(?:js|css)$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],

        // Don't cache Cloudflare challenge responses
        navigateFallbackAllowlist: [/^(?!\/__cf_)/],

        // Glob patterns for precaching
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],

        // Don't precache source maps or manifest (manifest fetch fails behind Cloudflare Access)
        globIgnores: ["**/*.map", "**/manifest.webmanifest"],
      },
      devOptions: {
        enabled: false, // Disable in dev to avoid caching issues
      },
    }),
  ],
  build: {
    outDir: "build",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3080",
        changeOrigin: true,
      },
    },
  },
});
