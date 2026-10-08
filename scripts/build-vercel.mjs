const configuredApiBase = process.env.QROOM_API_BASE || "";
let apiUrl;
try { apiUrl = new URL(configuredApiBase); } catch { throw new Error("Vercelデプロイには QROOM_API_BASE=https://api.example.com が必要です"); }
if (apiUrl.protocol !== "https:" || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password) {
  throw new Error("QROOM_API_BASE はパスを含まない HTTPS オリジンを指定してください");
}

await import("./build-web.mjs");
