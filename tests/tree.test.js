"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/tree.js");

/** Builds a tree from a compact spec: "name" = file, ["name", [...children]] = folder. */
function build(spec, rootName = "root") {
  const root = T.createRoot(rootName);
  const add = (parent, item) => {
    if (typeof item === "string") {
      parent.children.push(T.createNode("file", item));
      return;
    }
    const folder = T.createNode("folder", item[0]);
    parent.children.push(folder);
    item[1].forEach((child) => add(folder, child));
  };
  spec.forEach((item) => add(root, item));
  return root;
}

const names = (folder) => folder.children.map((child) => child.name);
const find = (root, name) => {
  let found = null;
  T.walk(root, (node) => {
    if (node.name === name) {
      found = node;
      return false;
    }
    return true;
  });
  return found;
};

test("createNode only gives folders a children array and strips line breaks", () => {
  const file = T.createNode("file", "a\nb.txt", "  note\twith tab ");
  assert.equal(file.name, "a b.txt");
  assert.equal(file.note, "note with tab");
  assert.equal("children" in file, false);
  assert.deepEqual(T.createNode("folder", "src").children, []);
  assert.notEqual(T.createNode("file", "x").id, T.createNode("file", "x").id);
});

test("walk and flatten visit nodes in display order", () => {
  const root = build([["src", ["a.js", ["lib", ["b.js"]]]], "README.md"]);
  const order = [];
  T.walk(root, (node, parent, index, depth) => {
    order.push(`${depth}:${node.name}`);
  });
  assert.deepEqual(order, ["0:root", "1:src", "2:a.js", "2:lib", "3:b.js", "1:README.md"]);

  const lib = find(root, "lib");
  const visible = T.flatten(root, new Set([lib.id])).map((row) => row.node.name);
  assert.deepEqual(visible, ["root", "src", "a.js", "lib", "README.md"]);

  // The root can never be collapsed away.
  assert.equal(T.flatten(root, new Set([root.id])).length, 6);
});

test("countNodes excludes the root", () => {
  const root = build([["src", ["a.js", ["lib", []]]], "README.md"]);
  assert.deepEqual(T.countNodes(root), { folders: 2, files: 2 });
  assert.deepEqual(T.countNodes(T.createRoot()), { folders: 0, files: 0 });
});

test("uniqueName adds a counter before the extension", () => {
  const siblings = [T.createNode("file", "a.txt"), T.createNode("file", "a-2.txt"), T.createNode("folder", "lib.v1")];
  assert.equal(T.uniqueName("b.txt", siblings), "b.txt");
  assert.equal(T.uniqueName("a.txt", siblings), "a-3.txt");
  assert.equal(T.uniqueName("lib.v1", siblings, null, true), "lib.v1-2");
  assert.equal(T.uniqueName(".gitignore", [T.createNode("file", ".gitignore")]), ".gitignore-2");
  assert.equal(T.uniqueName("a.txt", siblings, siblings[0]), "a.txt");
});

test("moveNode reorders within a folder", () => {
  const root = build(["a", "b", "c"]);
  const [a, , c] = root.children;
  assert.ok(T.moveNode(root, a.id, root.id, 3));
  assert.deepEqual(names(root), ["b", "c", "a"]);
  assert.ok(T.moveNode(root, c.id, root.id, 0));
  assert.deepEqual(names(root), ["c", "b", "a"]);
  assert.equal(T.moveNode(root, c.id, root.id, 0), null, "moving onto itself is a no-op");
  assert.equal(T.moveNode(root, c.id, root.id, 1), null, "dropping right after itself is a no-op");
});

test("moveNode moves across folders, renames clashes and refuses cycles", () => {
  const root = build([["src", ["util.js", ["deep", []]]], ["lib", ["util.js"]]]);
  const src = find(root, "src");
  const lib = find(root, "lib");
  const libUtil = lib.children[0];

  const result = T.moveNode(root, libUtil.id, src.id, 0);
  assert.equal(result.renamed, true);
  assert.deepEqual(names(src), ["util-2.js", "util.js", "deep"]);
  assert.deepEqual(names(lib), []);

  assert.equal(T.moveNode(root, src.id, src.id), null, "into itself");
  assert.equal(T.moveNode(root, src.id, find(root, "deep").id), null, "into a descendant");
  assert.equal(T.moveNode(root, root.id, src.id), null, "the root never moves");
  assert.equal(T.moveNode(root, src.id, src.children[0].id), null, "files can't contain items");
});

test("moveBy, indent and outdent", () => {
  const root = build(["a", ["box", ["inside"]], "c"]);
  const [a, box, c] = root.children;

  assert.ok(T.moveBy(root, a.id, 1));
  assert.deepEqual(names(root), ["box", "a", "c"]);
  assert.ok(T.moveBy(root, c.id, -1));
  assert.deepEqual(names(root), ["box", "c", "a"]);
  assert.equal(T.moveBy(root, box.id, -1), null, "already first");

  assert.ok(T.indent(root, c.id));
  assert.deepEqual(names(box), ["inside", "c"]);
  assert.equal(T.indent(root, box.id), null, "nothing above");
  assert.equal(T.indent(root, box.children[0].id), null, "first child can't indent");

  assert.ok(T.outdent(root, c.id));
  assert.deepEqual(names(root), ["box", "c", "a"]);
  assert.equal(T.outdent(root, c.id), null, "already at the top level");
});

test("duplicateNode deep-copies with new ids next to the original", () => {
  const root = build([["src", ["a.js"]], "z"]);
  const src = root.children[0];
  const copy = T.duplicateNode(root, src.id);
  assert.deepEqual(names(root), ["src", "src-2", "z"]);
  assert.deepEqual(names(copy), ["a.js"]);
  assert.notEqual(copy.children[0].id, src.children[0].id);
  copy.children[0].name = "changed.js";
  assert.equal(src.children[0].name, "a.js");
  assert.equal(T.duplicateNode(root, root.id), null);
});

test("sortTree puts folders first and sorts naturally", () => {
  const root = build(["file10.txt", "file2.txt", ["zeta", ["b", "A"]], "Alpha.md", ["beta", []]]);
  T.sortTree(root);
  assert.deepEqual(names(root), ["beta", "zeta", "Alpha.md", "file2.txt", "file10.txt"]);
  assert.deepEqual(names(find(root, "zeta")), ["A", "b"]);

  const shallow = build([["b", ["z", "a"]], ["a", []]]);
  T.sortTree(shallow, false);
  assert.deepEqual(names(shallow), ["a", "b"]);
  assert.deepEqual(names(find(shallow, "b")), ["z", "a"]);
});

test("splitNote and splitPath", () => {
  assert.deepEqual(T.splitNote("app.js  # entry point"), { name: "app.js", note: "entry point" });
  assert.deepEqual(T.splitNote("api.ts // routes"), { name: "api.ts", note: "routes" });
  assert.deepEqual(T.splitNote("db.sql <-- schema"), { name: "db.sql", note: "schema" });
  assert.deepEqual(T.splitNote("C#-notes.md"), { name: "C#-notes.md", note: "" });
  assert.deepEqual(T.splitNote("#hash.txt"), { name: "#hash.txt", note: "" });
  assert.deepEqual(T.splitNote("a # b # c"), { name: "a", note: "b # c" });

  assert.deepEqual(T.splitPath("./src//lib/"), { segments: ["src", "lib"], trailingSlash: true });
  assert.deepEqual(T.splitPath("src\\app.js"), { segments: ["src", "app.js"], trailingSlash: false });
  assert.deepEqual(T.splitPath("."), { segments: [], trailingSlash: false });
});

test("renameNode handles plain names, notes and conflicts", () => {
  const root = build(["a.js", "b.js"]);
  const [a] = root.children;

  assert.deepEqual(T.renameNode(root, a.id, "main.js # entry"), { ok: true, node: a, moved: false });
  assert.equal(a.name, "main.js");
  assert.equal(a.note, "entry");

  const clash = T.renameNode(root, a.id, "b.js");
  assert.equal(clash.ok, false);
  assert.match(clash.error, /already exists/);
  assert.equal(a.name, "main.js", "a failed rename leaves the tree untouched");

  assert.equal(T.renameNode(root, a.id, "   ").ok, false);
  assert.equal(T.renameNode(root, a.id, "main.js").ok, true);
  assert.equal(a.note, "", "dropping the # part clears the note");
});

test("renameNode with slashes creates folders and moves the item", () => {
  const root = build(["first", "x.js", "last"]);
  const x = root.children[1];
  const result = T.renameNode(root, x.id, "src/lib/util.js");
  assert.equal(result.ok, true);
  assert.equal(result.moved, true);
  assert.deepEqual(names(root), ["first", "src", "last"], "the new folder takes the item's place");
  assert.deepEqual(names(find(root, "lib")), ["util.js"]);

  // Re-uses existing folders and checks for conflicts inside them.
  const y = T.createNode("file", "y.js");
  root.children.push(y);
  assert.equal(T.renameNode(root, y.id, "src/lib/util.js").ok, false);
  assert.equal(T.renameNode(root, y.id, "first/y.js").ok, false, "first is a file");
  assert.equal(T.renameNode(root, y.id, "src/lib/y.js").ok, true);
  assert.deepEqual(names(find(root, "lib")), ["util.js", "y.js"]);
});

test("renameNode: trailing slash makes a folder, a folder can be nested under a new name", () => {
  const root = build(["notes", ["src", ["a.js"]]]);
  const notes = root.children[0];
  T.renameNode(root, notes.id, "docs/");
  assert.equal(notes.type, "folder");
  assert.equal(notes.name, "docs");

  const src = find(root, "src");
  assert.equal(T.renameNode(root, src.id, "src/app").ok, true, "own name doesn't count as a clash");
  const outer = root.children[1];
  assert.equal(outer.name, "src");
  assert.notEqual(outer.id, src.id);
  assert.deepEqual(names(outer), ["app"]);
  assert.deepEqual(names(src), ["a.js"]);
});

test("renameNode on the root keeps slashes but trims a trailing one", () => {
  const root = build([]);
  T.renameNode(root, root.id, "~/projects/app/ # my app");
  assert.equal(root.name, "~/projects/app");
  assert.equal(root.note, "my app");
  assert.equal(T.renameNode(root, root.id, "").ok, false);
});

test("toJSON drops ids and isValidTree validates restored data", () => {
  const root = build([["src", ["a.js"]]]);
  root.children[0].note = "code";
  assert.deepEqual(T.toJSON(root), {
    name: "root",
    type: "folder",
    children: [{ name: "src", type: "folder", note: "code", children: [{ name: "a.js", type: "file" }] }]
  });

  assert.equal(T.isValidTree(JSON.parse(JSON.stringify(root))), true);
  assert.equal(T.isValidTree({ name: "x", type: "folder", children: [] }), false, "missing id");
  const duplicate = JSON.parse(JSON.stringify(root));
  duplicate.children[0].children[0].id = duplicate.children[0].id;
  assert.equal(T.isValidTree(duplicate), false, "duplicate ids");
  assert.equal(T.isValidTree({ id: "a", name: "x", type: "folder" }), false, "folder without children");
  assert.equal(T.isValidTree(null), false);
});
