const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("./check.cjs");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const target = path.join(dist, `webjuk-desk-${version}.zip`);
fs.rmSync(target, { force: true });
execFileSync("/usr/bin/zip", ["-r", target, ".", "-x", "*.DS_Store"], {
  cwd: path.join(root, "extension"),
  stdio: "ignore",
});
console.log(`Packaged: ${target}`);
