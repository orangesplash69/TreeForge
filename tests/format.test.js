"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/tree.js");
const F = require("../js/format.js");

function sample() {
  const root = T.createRoot("root");
  const src = T.createNode("folder", "src");
  src.children.push(T.createNode("file", "app.js", "entry point"), T.createNode("file", "utils.js"));
  root.children.push(src, T.createNode("file", "package.json"));
  return root;
}

const lines = (...rows) => rows.join("\n");

test("unicode output matches the tree command", () => {
  assert.equal(
    F.formatTree(sample(), { showNotes: false }),
    lines(
      "root/",
      "├── src/",
      "│   ├── app.js",
      "│   └── utils.js",
      "└── package.json"
    )
  );
});

test("notes are aligned in one column", () => {
  const root = sample();
  root.children[1].note = "deps";
  assert.equal(
    F.formatTree(root),
    lines(
      "root/",
      "├── src/",
      "│   ├── app.js    # entry point",
      "│   └── utils.js",
      "└── package.json  # deps"
    )
  );
});

test("ascii style", () => {
  assert.equal(
    F.formatTree(sample(), { style: "ascii", showNotes: false }),
    lines(
      "root/",
      "|-- src/",
      "|   |-- app.js",
      "|   `-- utils.js",
      "`-- package.json"
    )
  );
});

test("indent style with and without the root", () => {
  assert.equal(
    F.formatTree(sample(), { style: "indent", showNotes: false }),
    lines("root/", "  src/", "    app.js", "    utils.js", "  package.json")
  );
  assert.equal(
    F.formatTree(sample(), { style: "indent", showNotes: false, showRoot: false }),
    lines("src/", "  app.js", "  utils.js", "package.json")
  );
});

test("markdown style uses code spans and dashes for notes", () => {
  const root = sample();
  root.children[1].name = "__init__.py";
  assert.equal(
    F.formatTree(root, { style: "markdown" }),
    lines(
      "- `root/`",
      "  - `src/`",
      "    - `app.js` — entry point",
      "    - `utils.js`",
      "  - `__init__.py`"
    )
  );
  root.children[1].name = "we`ird";
  assert.match(F.formatTree(root, { style: "markdown", showRoot: false }), /- `` we`ird ``$/);
});

test("trailing slash, root and summary options", () => {
  assert.equal(
    F.formatTree(sample(), { trailingSlash: false, showRoot: false, showNotes: false, summary: true }),
    lines("├── src", "│   ├── app.js", "│   └── utils.js", "└── package.json", "", "1 directory, 3 files")
  );
  assert.equal(F.formatTree(T.createRoot("x"), { showRoot: false }), "");
  assert.equal(F.formatTree(T.createRoot("x"), { showRoot: false, summary: true }), "0 directories, 0 files");
});

test("a root named '.' is printed without a slash", () => {
  assert.equal(F.formatTree(T.createRoot("."), {}), ".");
});

test("normalizeOptions ignores unknown or mistyped values", () => {
  assert.deepEqual(F.normalizeOptions({ style: "fancy", showRoot: "no", summary: true, extra: 1 }), {
    ...F.DEFAULT_OPTIONS,
    summary: true
  });
  assert.deepEqual(F.normalizeOptions(null), F.DEFAULT_OPTIONS);
});

test("toMarkdown fences text styles and leaves markdown lists alone", () => {
  assert.equal(F.toMarkdown("a/\n└── b", "unicode"), "```text\na/\n└── b\n```\n");
  assert.equal(F.toMarkdown("- `a`", "markdown"), "- `a`\n");
  assert.equal(F.toMarkdown("x```y", "unicode"), "````text\nx```y\n````\n");
  assert.equal(F.toMarkdown("", "unicode"), "");
});
