import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const localHtmlPath = path.join(dist, "local.html");
const outputPath = path.join(root, "exports", "standalone", "whistle-local-owner-workbench.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function dataUri(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

if (!fs.existsSync(localHtmlPath)) {
  throw new Error("dist/local.html not found. Run npm run build before exporting.");
}

let html = read(localHtmlPath);
html = html.replaceAll(
  'href="/assets/brand/logo-mark.svg"',
  'href="' + dataUri(path.join(root, "public", "assets", "brand", "logo-mark.svg"), "image/svg+xml") + '"'
);

const cssMatches = [...html.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)];
for (const match of cssMatches) {
  const assetPath = path.join(dist, match[1].replace(/^\//, ""));
  html = html.replace(match[0], `<style>\n${read(assetPath)}\n</style>`);
}

const moduleSources = new Map();
const moduleDataUris = new Map();
const modulePreloadMatches = [...html.matchAll(/<link rel="modulepreload" crossorigin href="([^"]+)">/g)];
for (const match of modulePreloadMatches) {
  const href = match[1];
  const assetPath = path.join(dist, href.replace(/^\//, ""));
  moduleSources.set(path.basename(href), read(assetPath));
  html = html.replace(match[0], "");
}

const scriptMatches = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)];
for (const match of scriptMatches) {
  const src = match[1];
  const assetPath = path.join(dist, src.replace(/^\//, ""));
  moduleSources.set(path.basename(src), read(assetPath));
}

function replaceModuleSpecifier(js, fileName, replacement) {
  return js
    .replaceAll(`"./${fileName}"`, `"${replacement}"`)
    .replaceAll(`'./${fileName}'`, `'${replacement}'`)
    .replaceAll(`"/assets/${fileName}"`, `"${replacement}"`)
    .replaceAll(`'/assets/${fileName}'`, `'${replacement}'`);
}

function hasModuleSpecifier(js, fileName) {
  return (
    js.includes(`"./${fileName}"`) ||
    js.includes(`'./${fileName}'`) ||
    js.includes(`"/assets/${fileName}"`) ||
    js.includes(`'/assets/${fileName}'`)
  );
}

function moduleDataUri(fileName, stack = []) {
  const cached = moduleDataUris.get(fileName);
  if (cached) return cached;

  if (stack.includes(fileName)) {
    throw new Error(`Circular module dependency: ${[...stack, fileName].join(" -> ")}`);
  }

  let js = moduleSources.get(fileName);
  if (!js) {
    throw new Error(`Missing module source for ${fileName}`);
  }

  for (const dependency of moduleSources.keys()) {
    if (dependency === fileName || !hasModuleSpecifier(js, dependency)) continue;
    js = replaceModuleSpecifier(js, dependency, moduleDataUri(dependency, [...stack, fileName]));
  }

  const dataUrl = `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
  moduleDataUris.set(fileName, dataUrl);
  return dataUrl;
}

html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_tag, src) => {
  const assetPath = path.join(dist, src.replace(/^\//, ""));
  let js = read(assetPath);
  for (const fileName of moduleSources.keys()) {
    js = replaceModuleSpecifier(js, fileName, moduleDataUri(fileName));
  }
  return `<script type="module">\n${js}\n</script>`;
});

const runtimeScript = `<script>
window.__WHISTLE_ASSETS__ = {
  logo: "${dataUri(path.join(root, "public", "assets", "brand", "whistle-fake-logo.svg"), "image/svg+xml")}",
  emblem: "${dataUri(path.join(root, "public", "assets", "brand", "whistle-civic-mark.svg"), "image/svg+xml")}",
  portrait: "${dataUri(path.join(root, "public", "assets", "brand", "whistle-service-portrait.svg"), "image/svg+xml")}"
};
</script>`;

html = html.replace("<body>", `<body>\n    ${runtimeScript}`);
html = html.replace(/<script type="module" src="\/src\/local-main\.tsx"><\/script>/, "");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html);
console.log(`Wrote ${outputPath}`);
