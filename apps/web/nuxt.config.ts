export default defineNuxtConfig({
  compatibilityDate: "2026-08-07",
  ssr: false,
  css: ["~/assets/css/main.css"],
  devtools: { enabled: false },
  nitro: { preset: "static" },
  runtimeConfig: {
    public: {
      identityOrigin:
        process.env.NUXT_PUBLIC_IDENTITY_ORIGIN ??
        "https://identity.staging.shape-of-you.ru"
    }
  },
  typescript: {
    strict: true,
    typeCheck: true
  },
  vite: {
    server: {
      proxy: {
        "/.well-known": "http://127.0.0.1:3001",
        "/live": "http://127.0.0.1:3001",
        "/oauth": "http://127.0.0.1:3001",
        "/ready": "http://127.0.0.1:3001",
        "/v1": "http://127.0.0.1:3001"
      }
    }
  },
  app: {
    head: {
      htmlAttrs: { lang: "en" },
      title: "Shape of You",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content: "A calm, secure home for your fitness history and decisions."
        },
        { name: "referrer", content: "no-referrer" },
        { name: "color-scheme", content: "dark" }
      ]
    }
  }
});
