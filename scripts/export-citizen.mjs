import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const appHtmlPath = path.join(dist, "citizen.html");
const outputPath = path.join(root, "exports", "standalone", "whistle-workable.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function dataUri(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function inlineReferencedAssets(source) {
  const replacements = new Map([
    ["/whistle-fake-logo.svg", dataUri(path.join(root, "public", "assets", "brand", "whistle-fake-logo.svg"), "image/svg+xml")],
    ["/whistle-civic-mark.svg", dataUri(path.join(root, "public", "assets", "brand", "whistle-civic-mark.svg"), "image/svg+xml")],
    ["/whistle-service-portrait.svg", dataUri(path.join(root, "public", "assets", "brand", "whistle-service-portrait.svg"), "image/svg+xml")],
    ["/assets/brand/whistle-fake-logo.svg", dataUri(path.join(root, "public", "assets", "brand", "whistle-fake-logo.svg"), "image/svg+xml")],
    ["/assets/brand/whistle-civic-mark.svg", dataUri(path.join(root, "public", "assets", "brand", "whistle-civic-mark.svg"), "image/svg+xml")],
    ["/assets/brand/whistle-service-portrait.svg", dataUri(path.join(root, "public", "assets", "brand", "whistle-service-portrait.svg"), "image/svg+xml")],
  ]);

  let output = source;
  for (const [assetPath, assetUri] of replacements) {
    output = output
      .replaceAll(`"${assetPath}"`, JSON.stringify(assetUri))
      .replaceAll(`'${assetPath}'`, JSON.stringify(assetUri))
      .replaceAll(assetPath, assetUri);
  }
  return output;
}

if (!fs.existsSync(appHtmlPath)) {
  throw new Error("dist/citizen.html not found. Run npm run build before exporting.");
}

let html = read(appHtmlPath);
html = html.replaceAll(
  'href="/assets/brand/logo-mark.svg"',
  'href="' + dataUri(path.join(root, "public", "assets", "brand", "logo-mark.svg"), "image/svg+xml") + '"'
);

html = html.replace(/<link rel="manifest" href="\/manifest\.webmanifest" \/>/, "");
html = inlineReferencedAssets(html);

const runtimeScript = `<script>
window.__WHISTLE_API_DISABLED__ = true;
window.__WHISTLE_CITIZEN_ASSET_POLICY__ = ${JSON.stringify({
  logo: {
    approved: true,
    src: dataUri(path.join(root, "public", "assets", "brand", "whistle-fake-logo.svg"), "image/svg+xml"),
    label: "Whistle prototype logo",
    fallbackLabel: "Whistle",
  },
  emblem: {
    approved: true,
    src: dataUri(path.join(root, "public", "assets", "brand", "whistle-civic-mark.svg"), "image/svg+xml"),
    label: "Neutral civic service mark",
    fallbackLabel: "Civic",
  },
  portrait: {
    approved: true,
    src: dataUri(path.join(root, "public", "assets", "brand", "whistle-service-portrait.svg"), "image/svg+xml"),
    label: "Neutral citizen-service illustration",
    fallbackLabel: "Service",
  },
  disclaimer: {
    approved: true,
    text: "MVP1 uses neutral Whistle-owned placeholder assets. Official marks, emblems, and public-figure likenesses are not used unless separately approved.",
  },
})};
</script>`;

html = html.replace("<body>", `<body>\n    ${runtimeScript}`);

const cssMatches = [...html.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)];
for (const match of cssMatches) {
  const assetPath = path.join(dist, match[1].replace(/^\//, ""));
  const css = inlineReferencedAssets(read(assetPath));
  html = html.replace(match[0], `<style>\n${css}\n</style>`);
}

const moduleSources = new Map();
const moduleDataUris = new Map();
const modulePreloadMatches = [...html.matchAll(/<link rel="modulepreload" crossorigin href="([^"]+)">/g)];
for (const match of modulePreloadMatches) {
  const href = match[1];
  const assetPath = path.join(dist, href.replace(/^\//, ""));
  const js = inlineReferencedAssets(read(assetPath));
  moduleSources.set(path.basename(href), js);
  html = html.replace(match[0], "");
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
    throw new Error(`Circular modulepreload dependency: ${[...stack, fileName].join(" -> ")}`);
  }

  let js = moduleSources.get(fileName);
  if (!js) {
    throw new Error(`Missing modulepreload source for ${fileName}`);
  }

  for (const dependency of moduleSources.keys()) {
    if (dependency === fileName) continue;
    if (!hasModuleSpecifier(js, dependency)) continue;
    js = replaceModuleSpecifier(js, dependency, moduleDataUri(dependency, [...stack, fileName]));
  }

  const dataUrl = `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
  moduleDataUris.set(fileName, dataUrl);
  return dataUrl;
}

const scriptMatches = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)];
for (const match of scriptMatches) {
  const assetPath = path.join(dist, match[1].replace(/^\//, ""));
  let js = inlineReferencedAssets(read(assetPath));
  for (const fileName of moduleSources.keys()) {
    js = replaceModuleSpecifier(js, fileName, moduleDataUri(fileName));
  }
  html = html.replace(match[0], `<script type="module">\n${js}\n</script>`);
}

html = html.replace(/<script type="module" src="\/src\/main\.tsx"><\/script>/, "");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html);
console.log(`Wrote ${outputPath}`);
