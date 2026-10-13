const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(
    root,
    `.${pathname === "/" ? "/demo/index.html" : pathname}`,
  );
  if (
    !file.startsWith(root + path.sep) ||
    !["extension", "demo"].includes(
      path.relative(root, file).split(path.sep)[0],
    )
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (error, bytes) => {
    if (error) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    res.end(bytes);
  });
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1", () =>
  console.log(`Demo: http://127.0.0.1:${server.address().port}`),
);
