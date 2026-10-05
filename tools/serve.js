#!/usr/bin/env node
/*
 * Tiny static file server for local testing (no dependencies).
 * TreeForge also works by opening index.html directly; serving it over
 * http://localhost additionally enables offline mode and "Install app".
 *
 *   node tools/serve.js [port]
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = path.join(root, pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (pathname.endsWith("/")) {
      file = path.join(file, "index.html");
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache"
      });
      response.end(data);
    });
  })
  .listen(port, () => {
    console.log(`TreeForge running at http://localhost:${port}/`);
  });
