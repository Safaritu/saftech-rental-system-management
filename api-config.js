(() => {
  // --- SAFTECH RESOLUTIONS CONFIGURATION ---
  // This connects your Cloudflare frontend to your Render backend
  const PROD_BACKEND_BASE = "https://saftech-rental-system-management.onrender.com";

  function normalizeBase(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  const { protocol, hostname, port, origin } = window.location;

  // 1. Local development check
  // If you are running HTML on 5500/5501 locally, it still looks for your local Node server on 3000
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port && port !== "3000") {
    window.SAFTECH_API_URL = `${protocol}//${hostname}:3000/api`;
    console.log("Saftech API Mode: Local Development");
    return;
  }

  // 2. Production (Live) Mode
  // This uses your Render URL when the site is live on Cloudflare
  if (PROD_BACKEND_BASE) {
    window.SAFTECH_API_URL = `${normalizeBase(PROD_BACKEND_BASE)}/api`;
    console.log("Saftech API Mode: Live Production (Render)");
    return;
  }

  // 3. Fallback
  window.SAFTECH_API_URL = `${origin}/api`;
})();
