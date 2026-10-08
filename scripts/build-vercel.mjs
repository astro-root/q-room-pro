const configuredApiBase = process.env.QROOM_API_BASE || "";
if (configuredApiBase) {
  let apiUrl;
  try { apiUrl = new URL(configuredApiBase); } catch { throw new Error("QROOM_API_BASE はバックエンドの HTTPS オリジンを指定してください"); }
  if (apiUrl.protocol !== "https:" || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password) {
    throw new Error("QROOM_API_BASE はパスを含まない HTTPS オリジンを指定してください");
  }
} else {
  process.env.QROOM_VERCEL_API_UNCONFIGURED = "1";
}

await import("./build-web.mjs");
