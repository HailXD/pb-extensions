const OUTPUT_PATH = "0.8/Mangahub/source.js";
const MANIFEST_PATH = "0.8/versioning.json";
const SOURCE_INFO_PATH = "src/source-info.json";
const UPSTREAM_PATH = "vendor/mangahub-3.1.0.js";
const PATCH_FILES = ["src/mangahub.js"];
const LICENSE_FILES = [
  ["LICENSE", "0.8/Mangahub/includes/LICENSE"],
  ["THIRD_PARTY.md", "0.8/Mangahub/includes/THIRD_PARTY.md"]
];
const UPSTREAM_SDK_VERSION = "0.8.7";

const sourceInfo = await Bun.file(SOURCE_INFO_PATH).json();
const upstream = await Bun.file(UPSTREAM_PATH).text();
const patch = await Promise.all(PATCH_FILES.map((path) => Bun.file(path).text()));
const source = [
  upstream,
  "\n((ROOT) => {",
  `const SOURCE_INFO = ${JSON.stringify(sourceInfo)};`,
  ...patch,
  "})(this);\n"
].join("\n");

await Bun.write(OUTPUT_PATH, source);
await Bun.write(MANIFEST_PATH, JSON.stringify({
  buildTime: new Date().toISOString(),
  sources: [sourceInfo],
  builtWith: { toolchain: UPSTREAM_SDK_VERSION, types: UPSTREAM_SDK_VERSION }
}, null, 2) + "\n");
for (const [from, to] of LICENSE_FILES) await Bun.write(to, Bun.file(from));
console.info(`Packaged ${sourceInfo.id} ${sourceInfo.version} at ${OUTPUT_PATH}`);
