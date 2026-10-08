import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "www");
const staticFiles = ["index.html", "icon.svg", "manifest.webmanifest", "service-worker.js"];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const file of staticFiles) await cp(resolve(projectRoot, file), resolve(outputDirectory, file));
await cp(resolve(projectRoot, "src"), resolve(outputDirectory, "src"), { recursive: true });

const configuredApiBase = (process.env.QROOM_API_BASE || "").replace(/\/+$/, "");
const configuredWebBase = (process.env.QROOM_WEB_BASE || "").replace(/\/+$/, "");
const nativeBuild = process.env.QROOM_NATIVE_BUILD === "1";
if (nativeBuild) {
  let apiUrl;
  try { apiUrl = new URL(configuredApiBase); } catch { throw new Error("ネイティブビルドには QROOM_API_BASE=https://api.example.com が必要です"); }
  if (apiUrl.protocol !== "https:" || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password) {
    throw new Error("QROOM_API_BASE はパスを含まない HTTPS オリジンを指定してください");
  }
}
if (nativeBuild && configuredWebBase) {
  let webUrl;
  try { webUrl = new URL(configuredWebBase); } catch { throw new Error("QROOM_WEB_BASE は公開Webアプリの HTTPS オリジンを指定してください"); }
  if (webUrl.protocol !== "https:" || webUrl.pathname !== "/" || webUrl.search || webUrl.hash || webUrl.username || webUrl.password) {
    throw new Error("QROOM_WEB_BASE はパスを含まない HTTPS オリジンを指定してください");
  }
}
const runtimeConfig = `globalThis.QROOM_API_BASE = ${JSON.stringify(configuredApiBase)};\nglobalThis.QROOM_WEB_BASE = ${JSON.stringify(configuredWebBase)};\n${nativeBuild ? 'globalThis.QROOM_PLATFORM = { ...(globalThis.QROOM_PLATFORM || {}), isNative: true, apiBase: globalThis.QROOM_API_BASE, webBase: globalThis.QROOM_WEB_BASE };\n' : ""}`;
await writeFile(resolve(outputDirectory, "runtime-config.js"), runtimeConfig);

if (nativeBuild) {
  const { build } = await import("esbuild");
  await build({ entryPoints: [resolve(projectRoot, "src/native-entry.js")], bundle: true, format: "esm", platform: "browser", outfile: resolve(outputDirectory, "native-entry.js"), loader: { ".css": "empty" } });
  const indexPath = resolve(outputDirectory, "index.html");
  const html = await readFile(indexPath, "utf8");
  await writeFile(indexPath, html.replace('<script type="module" src="/src/main.js"></script>', '<script type="module" src="/native-entry.js"></script>'));
}
