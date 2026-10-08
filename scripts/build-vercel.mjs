const configuredApiBase = process.env.QROOM_API_BASE || "";
let apiUrl;
try { apiUrl = new URL(configuredApiBase); } catch { throw new Error("QROOM_API_BASE に、デプロイ済みバックエンドの HTTPS オリジンを設定してください"); }
if (apiUrl.protocol !== "https:" || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password) {
  throw new Error("QROOM_API_BASE はパスを含まない HTTPS オリジンを指定してください");
}

await import("./build-web.mjs");
