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
const options = { cwd: path.join(root, "extension"), stdio: "inherit" };
if (process.platform === "win32") {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem",
    "$archive = [System.IO.Compression.ZipFile]::Open($env:WEBJUK_PACKAGE_TARGET, [System.IO.Compression.ZipArchiveMode]::Create)",
    "try {",
    "  Get-ChildItem -LiteralPath . -Recurse -File -Force | Where-Object Name -ne '.DS_Store' | ForEach-Object {",
    "    $relative = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\\', '/')",
    "    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null",
    "  }",
    "} finally { $archive.Dispose() }",
  ].join("\n");
  execFileSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    command,
  ], { ...options, env: { ...process.env, WEBJUK_PACKAGE_TARGET: target } });
} else {
  execFileSync("zip", ["-r", target, ".", "-x", "*.DS_Store"], options);
}
console.log(`Packaged: ${target}`);
