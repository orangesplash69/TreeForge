"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/tree.js");
const F = require("../js/format.js");
const P = require("../js/parse.js");

const lines = (...rows) => rows.join("\n");
const plain = (root, options) => F.formatTree(root, { showNotes: false, ...options });

const EXPECTED = lines(
  "my-app/",
  "├── src/",
  "│   ├── components/",
  "│   │   └── Button.jsx",
  "│   └── app.js",
  "└── README.md"
);

test("re-imports its own output exactly", () => {
  const { root } = P.parseText(EXPECTED);
  assert.equal(plain(root), EXPECTED);

  const withNotes = lines("my-app/", "├── src/        # code", "│   └── app.js  # entry", "└── README.md");
  assert.equal(F.formatTree(P.parseText(withNotes).root), withNotes);
});

test("reads plain `tree` output where the root is '.' and folders have no slash", () => {
  const input = lines(
    ".",
    "├── src",
    "│   ├── components",
    "│   │   └── Button.jsx",
    "│   └── app.js",
    "└── README.md",
    "",
    "3 directories, 3 files"
  );
  const { root } = P.parseText(input, { rootName: "my-app" });
  assert.equal(plain(root), EXPECTED);
});

test("keeps an explicit '.' root even with a single child folder", () => {
  const { root } = P.parseText(lines(".", "└── src", "    └── a.js"), { rootName: "proj" });
  assert.equal(root.name, "proj");
  assert.equal(root.children[0].name, "src");
});

test("reads `tree --charset ascii` output", () => {
  const input = lines(
    "my-app",
    "|-- src",
    "|   |-- components",
    "|   |   `-- Button.jsx",
    "|   `-- app.js",
    "`-- README.md"
  );
  assert.equal(plain(P.parseText(input).root), EXPECTED);
});

test("reads Windows `tree /f` and `tree /f /a` output", () => {
  const unicode = lines(
    "Folder PATH listing for volume OS",
    "Volume serial number is 1234-ABCD",
    "C:\\CODE\\MY-APP",
    "│   README.md",
    "│",
    "└───src",
    "    │   app.js",
    "    │",
    "    └───components",
    "            Button.jsx"
  );
  const ascii = lines(
    "C:.",
    "|   README.md",
    "|",
    "\\---src",
    "    |   app.js",
    "    |",
    "    \\---components",
    "            Button.jsx"
  );
  const expected = (name) => lines(
    `${name}/`,
    "├── README.md",
    "└── src/",
    "    ├── app.js",
    "    └── components/",
    "        └── Button.jsx"
  );
  assert.equal(plain(P.parseText(unicode).root), expected("MY-APP"));
  assert.equal(plain(P.parseText(ascii, { rootName: "proj" }).root), expected("proj"));
});

test("reads indented lists with spaces or tabs", () => {
  const spaces = lines("my-app/", "  src/", "    components/", "      Button.jsx", "    app.js", "  README.md");
  const tabs = spaces.replace(/ {2}/g, "\t");
  assert.equal(plain(P.parseText(spaces).root), EXPECTED);
  assert.equal(plain(P.parseText(tabs).root), EXPECTED);
});

test("reads Markdown lists with code spans, bold and emoji markers", () => {
  const input = lines(
    "```",
    "- **my-app/**",
    "  - `src/` — source",
    "    * 📁 components",
    "      + 📄 Button.jsx",
    "    - app.js",
    "  - [README.md](README.md)",
    "```"
  );
  const { root } = P.parseText(input);
  assert.equal(plain(root), EXPECTED);
  assert.equal(root.children[0].note, "source");
});

test("reads path lists and merges shared folders", () => {
  const input = lines(
    "./src/components/Button.jsx",
    "src/app.js",
    "README.md",
    "docs/",
    "/src/app.js"
  );
  const { root } = P.parseText(input, { rootName: "my-app" });
  assert.equal(
    plain(root),
    lines(
      "my-app/",
      "├── src/",
      "│   ├── components/",
      "│   │   └── Button.jsx",
      "│   └── app.js",
      "├── README.md",
      "└── docs/"
    )
  );
});

test("a single top-level folder becomes the root", () => {
  const { root } = P.parseText(lines("src/a.js", "src/b.js"));
  assert.equal(root.name, "src");
  assert.deepEqual(root.children.map((child) => child.name), ["a.js", "b.js"]);
});

test("respects the node limit", () => {
  const input = Array.from({ length: 50 }, (_, i) => `file-${i}.txt`).join("\n");
  const result = P.parseText(input, { limit: 10 });
  assert.equal(result.truncated, true);
  assert.equal(result.root.children.length, 10);
});

test("parseInput detects JSON and text", () => {
  const legacy = { name: "root", type: "folder", children: [{ name: "a.txt", type: "file" }, { name: "src", type: "folder", children: [] }] };
  const json = P.parseInput(JSON.stringify(legacy));
  assert.equal(json.kind, "json");
  assert.deepEqual(T.toJSON(json.root), legacy);

  const text = P.parseInput(EXPECTED);
  assert.equal(text.kind, "text");

  assert.throws(() => P.parseInput("   \n "), /Nothing to import/);
  assert.throws(() => P.parseInput("{ nope"), /looks like JSON/);
  assert.throws(() => P.parseInput("```\n```"), /Couldn't find/);
  // Something starting with "[" that isn't JSON is still read as text.
  assert.equal(P.parseInput("[docs](docs)/\n  a.md").root.name, "docs");
});

test("fromJSON reads `tree -J` output", () => {
  const data = [
    { type: "directory", name: ".", contents: [
      { type: "file", name: "README.md" },
      { type: "directory", name: "src", contents: [{ type: "file", name: "app.js" }] }
    ] },
    { type: "report", directories: 1, files: 2 }
  ];
  const root = P.fromJSON(data, { rootName: "proj" });
  assert.equal(plain(root), lines("proj/", "├── README.md", "└── src/", "    └── app.js"));
});

test("fromJSON reads nested objects, string lists and notes", () => {
  const root = P.fromJSON({
    src: { "app.js": "entry point", lib: ["a.js", "b/"] },
    "README.md": null,
    "assets/": true
  }, { rootName: "proj" });
  assert.equal(
    F.formatTree(root),
    lines(
      "proj/",
      "├── src/",
      "│   ├── app.js  # entry point",
      "│   └── lib/",
      "│       ├── a.js",
      "│       └── b/",
      "├── README.md",
      "└── assets/"
    )
  );

  const list = P.fromJSON(["a.txt", { name: "b", children: [] }, { type: "file", comment: "nameless" }]);
  assert.deepEqual(list.children.map((child) => [child.name, child.type, child.note]), [
    ["a.txt", "file", ""],
    ["b", "folder", ""],
    ["item-3", "file", "nameless"]
  ]);

  const single = P.fromJSON({ name: "only.txt", type: "file" });
  assert.equal(single.type, "folder");
  assert.equal(single.children[0].name, "only.txt");

  assert.throws(() => P.fromJSON(42), /doesn't describe/);
});

test("compileIgnore matches names and globs", () => {
  const ignored = P.compileIgnore("node_modules, .git/, *.log, temp?");
  assert.equal(ignored("node_modules"), true);
  assert.equal(ignored(".git"), true);
  assert.equal(ignored("debug.log"), true);
  assert.equal(ignored("temp1"), true);
  assert.equal(ignored("temp12"), false);
  assert.equal(ignored("src"), false);
  assert.equal(P.compileIgnore("")("anything"), false);
});

test("fromPaths builds a sorted tree and skips ignored entries", () => {
  const { root, count } = P.fromPaths(
    ["src/b.js", "src/a.js", "node_modules/x/index.js", "README.md", "logs/today.log", ".git/HEAD", "empty/"],
    { rootName: "proj", ignore: "node_modules, .git, *.log" }
  );
  assert.equal(
    plain(root),
    lines("proj/", "├── empty/", "├── logs/", "├── src/", "│   ├── a.js", "│   └── b.js", "└── README.md")
  );
  assert.equal(count, 6);

  const limited = P.fromPaths(["a", "b", "c"], { limit: 2 });
  assert.equal(limited.truncated, true);
  assert.equal(limited.root.children.length, 2);
});
