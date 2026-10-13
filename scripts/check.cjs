const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..", "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
const files = [
  ...manifest.content_scripts.flatMap((entry) => [
    ...entry.js,
    ...(entry.css || []),
  ]),
  ...Object.values(manifest.icons),
  manifest.action.default_popup,
  ...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
];
for (const file of files)
  if (!fs.existsSync(path.join(root, file)))
    throw new Error(`Missing manifest asset: ${file}`);
for (const file of fs.readdirSync(root).filter((file) => file.endsWith(".js")))
  new vm.Script(fs.readFileSync(path.join(root, file), "utf8"), {
    filename: file,
  });
if (manifest.permissions.join(",") !== "storage")
  throw new Error("Unexpected permissions");
if (
  manifest.content_scripts.some((entry) =>
    entry.matches.some((match) => match !== "https://crawl.nemelex.cards/*"),
  )
)
  throw new Error("Unexpected site access");
console.log("Manifest assets, JavaScript syntax and minimal permissions: OK");
