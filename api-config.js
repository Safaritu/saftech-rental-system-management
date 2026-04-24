(() => {
  // Set this once for production frontend (Cloudflare Pages).
  // Example: window.SAFTECH_BACKEND_URL = "https://abc.trycloudflare.com";
  const PROD_BACKEND_BASE = window.SAFTECH_BACKEND_URL || "";

  function normalizeBase(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  const { protocol, hostname, port, origin } = window.location;

  // Local development: HTML on 5500/5501, API on 3000.
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port && port !== "3000") {
    window.SAFTECH_API_URL = `${protocol}//${hostname}:3000/api`;
    return;
  }

  // Cloudflare Pages or any static host with external backend.
  if (PROD_BACKEND_BASE) {
    window.SAFTECH_API_URL = `${normalizeBase(PROD_BACKEND_BASE)}/api`;
    return;
  }

  // Fallback: same-origin API (works when frontend and backend share host).
  window.SAFTECH_API_URL = `${origin}/api`;
})();
