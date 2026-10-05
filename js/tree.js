/*!
 * TreeForge — tree model.
 * Pure data helpers shared by the app and the Node test-suite. No DOM access.
 *
 * A node looks like { id, type: "folder" | "file", name, note, children? }.
 * Only folders carry a `children` array. The root is always a folder.
 */
(function (global, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    global.TreeForge = global.TreeForge || {};
    global.TreeForge.tree = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ID_PREFIX = Math.random().toString(36).slice(2, 10);
  let idCounter = 0;

  function newId() {
    idCounter += 1;
    return `${ID_PREFIX}-${idCounter.toString(36)}`;
  }

  // Names and notes are single-line by definition; anything else breaks the output.
  function cleanText(value) {
    return String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ");
  }

  function createNode(type, name, note) {
    const node = {
      id: newId(),
      type: type === "folder" ? "folder" : "file",
      name: cleanText(name),
      note: cleanText(note).trim()
    };
    if (node.type === "folder") {
      node.children = [];
    }
    return node;
  }

  function createRoot(name) {
    return createNode("folder", name || "root");
  }

  function isFolder(node) {
    return Boolean(node) && node.type === "folder";
  }

  function makeFolder(node) {
    if (!isFolder(node)) {
      node.type = "folder";
      node.children = [];
    }
    return node;
  }

  /**
   * Depth-first, pre-order walk without recursion.
   * `visit(node, parent, index, depth)` may return false to stop the walk.
   */
  function walk(root, visit) {
    const stack = [{ node: root, parent: null, index: -1, depth: 0 }];
    while (stack.length) {
      const entry = stack.pop();
      if (visit(entry.node, entry.parent, entry.index, entry.depth) === false) {
        return;
      }
      if (isFolder(entry.node)) {
        const { children } = entry.node;
        for (let i = children.length - 1; i >= 0; i -= 1) {
          stack.push({ node: children[i], parent: entry.node, index: i, depth: entry.depth + 1 });
        }
      }
    }
  }

  /** Maps every id to { node, parent, index, depth }. */
  function indexTree(root) {
    const map = new Map();
    walk(root, (node, parent, index, depth) => {
      map.set(node.id, { node, parent, index, depth });
    });
    return map;
  }

  /** Visible rows for the editor: like a walk, but skips the contents of collapsed folders. */
  function flatten(root, collapsed) {
    const rows = [];
    const stack = [{ node: root, parent: null, index: 0, depth: 0 }];
    while (stack.length) {
      const entry = stack.pop();
      rows.push(entry);
      const open = entry.parent === null || !(collapsed && collapsed.has(entry.node.id));
      if (isFolder(entry.node) && open) {
        const { children } = entry.node;
        for (let i = children.length - 1; i >= 0; i -= 1) {
          stack.push({ node: children[i], parent: entry.node, index: i, depth: entry.depth + 1 });
        }
      }
    }
    return rows;
  }

  function locate(root, id) {
    let found = null;
    walk(root, (node, parent, index, depth) => {
      if (node.id === id) {
        found = { node, parent, index, depth };
        return false;
      }
      return true;
    });
    return found;
  }

  /** True when `id` is `node` itself or anywhere inside it. */
  function contains(node, id) {
    return locate(node, id) !== null;
  }

  /** Folder and file counts, excluding the root (same as the `tree` command). */
  function countNodes(root) {
    let folders = 0;
    let files = 0;
    walk(root, (node, parent) => {
      if (!parent) {
        return;
      }
      if (isFolder(node)) {
        folders += 1;
      } else {
        files += 1;
      }
    });
    return { folders, files };
  }

  function splitExtension(name) {
    const dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) {
      return [name, ""];
    }
    return [name.slice(0, dot), name.slice(dot)];
  }

  /** Returns `name`, or `name-2`, `name-3`, … (before the extension) if a sibling already uses it. */
  function uniqueName(name, siblings, exclude, folder) {
    const taken = new Set();
    for (const sibling of siblings) {
      if (sibling !== exclude) {
        taken.add(sibling.name);
      }
    }
    if (!taken.has(name)) {
      return name;
    }
    const [stem, extension] = folder ? [name, ""] : splitExtension(name);
    let counter = 2;
    while (taken.has(`${stem}-${counter}${extension}`)) {
      counter += 1;
    }
    return `${stem}-${counter}${extension}`;
  }

  function insertChild(parent, node, index) {
    const { children } = makeFolder(parent);
    const at = index === undefined ? children.length : Math.max(0, Math.min(index, children.length));
    children.splice(at, 0, node);
    return node;
  }

  function removeNode(root, id) {
    const loc = locate(root, id);
    if (!loc || !loc.parent) {
      return null;
    }
    loc.parent.children.splice(loc.index, 1);
    return loc;
  }

  /**
   * Moves a node into `parentId` at `index` (an index into the target's children
   * *before* the node is taken out). Renames the node if the new folder already
   * has an item with that name. Returns { node, renamed } or null if nothing moved.
   */
  function moveNode(root, id, parentId, index) {
    const loc = locate(root, id);
    const target = locate(root, parentId);
    if (!loc || !loc.parent || !target || !isFolder(target.node) || contains(loc.node, parentId)) {
      return null;
    }
    const siblings = target.node.children;
    const sameParent = target.node === loc.parent;
    let at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
    if (sameParent && loc.index < at) {
      at -= 1;
    }
    if (sameParent && loc.index === at) {
      return null;
    }
    loc.parent.children.splice(loc.index, 1);
    let renamed = false;
    if (!sameParent) {
      const name = uniqueName(loc.node.name, siblings, null, isFolder(loc.node));
      renamed = name !== loc.node.name;
      loc.node.name = name;
    }
    siblings.splice(at, 0, loc.node);
    return { node: loc.node, renamed };
  }

  /** Moves a node up (-1) or down (+1) among its siblings. */
  function moveBy(root, id, delta) {
    const loc = locate(root, id);
    if (!loc || !loc.parent) {
      return null;
    }
    const target = loc.index + delta;
    if (target < 0 || target >= loc.parent.children.length) {
      return null;
    }
    return moveNode(root, id, loc.parent.id, delta > 0 ? target + 1 : target);
  }

  /** Moves a node out of its folder, right after that folder. */
  function outdent(root, id) {
    const loc = locate(root, id);
    if (!loc || !loc.parent) {
      return null;
    }
    const parentLoc = locate(root, loc.parent.id);
    if (!parentLoc || !parentLoc.parent) {
      return null;
    }
    return moveNode(root, id, parentLoc.parent.id, parentLoc.index + 1);
  }

  /** Moves a node into the folder directly above it (as its last item). */
  function indent(root, id) {
    const loc = locate(root, id);
    if (!loc || !loc.parent || loc.index === 0) {
      return null;
    }
    const previous = loc.parent.children[loc.index - 1];
    if (!isFolder(previous)) {
      return null;
    }
    return moveNode(root, id, previous.id);
  }

  /** Deep copy with fresh ids. */
  function cloneNode(node) {
    const copy = createNode(node.type, node.name, node.note);
    if (isFolder(node)) {
      copy.children = node.children.map(cloneNode);
    }
    return copy;
  }

  function duplicateNode(root, id) {
    const loc = locate(root, id);
    if (!loc || !loc.parent) {
      return null;
    }
    const copy = cloneNode(loc.node);
    copy.name = uniqueName(loc.node.name, loc.parent.children, null, isFolder(copy));
    loc.parent.children.splice(loc.index + 1, 0, copy);
    return copy;
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  function compareNodes(a, b) {
    if (a.type !== b.type) {
      return isFolder(a) ? -1 : 1;
    }
    return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  /** Sorts folders first, then natural A→Z. */
  function sortTree(node, recursive) {
    if (!isFolder(node)) {
      return node;
    }
    if (recursive === false) {
      node.children.sort(compareNodes);
      return node;
    }
    walk(node, (current) => {
      if (isFolder(current)) {
        current.children.sort(compareNodes);
      }
    });
    return node;
  }

  const NOTE_PATTERN = /\s+(?:#|\/\/|<-+|←|—)\s*(.*)$/;

  /** Splits "app.js  # entry point" into { name: "app.js", note: "entry point" }. */
  function splitNote(text) {
    const value = String(text == null ? "" : text);
    const match = NOTE_PATTERN.exec(value);
    if (!match) {
      return { name: value.trim(), note: "" };
    }
    return { name: value.slice(0, match.index).trim(), note: match[1].trim() };
  }

  /** "src/lib/" → { segments: ["src", "lib"], trailingSlash: true }. */
  function splitPath(text) {
    const value = String(text == null ? "" : text).trim();
    return {
      segments: value.split(/[\\/]+/).map((part) => part.trim()).filter((part) => part && part !== "."),
      trailingSlash: /[\\/]$/.test(value)
    };
  }

  /**
   * Applies what the user typed in the rename field:
   *  - "name # note" sets a note,
   *  - "a/b/name" creates (or reuses) folders a and b and moves the item into them,
   *  - a trailing "/" turns a file into a folder.
   * Returns { ok: true, node, moved } or { ok: false, error } without touching the tree.
   */
  function renameNode(root, id, input) {
    const loc = locate(root, id);
    if (!loc) {
      return { ok: false, error: "That item no longer exists." };
    }
    const { node } = loc;
    const { name, note } = splitNote(input);

    if (!loc.parent) {
      const rootName = name.length > 1 ? name.replace(/[\\/]+$/, "") : name;
      if (!rootName) {
        return { ok: false, error: "Name can't be empty." };
      }
      node.name = cleanText(rootName);
      node.note = cleanText(note);
      return { ok: true, node, moved: false };
    }

    const { segments, trailingSlash } = splitPath(name);
    if (!segments.length) {
      return { ok: false, error: "Name can't be empty." };
    }
    const leaf = segments[segments.length - 1];
    const folders = segments.slice(0, -1);

    // Dry run: follow the folders that already exist to see where the item will land.
    let cursor = loc.parent;
    let pathExists = true;
    for (const segment of folders) {
      const match = cursor.children.find((child) => child !== node && child.name === segment);
      if (!match) {
        pathExists = false;
        break;
      }
      if (!isFolder(match)) {
        return { ok: false, error: `"${segment}" is a file, not a folder.` };
      }
      cursor = match;
    }
    if (pathExists && cursor.children.some((child) => child !== node && child.name === leaf)) {
      return { ok: false, error: `"${leaf}" already exists in this folder.` };
    }

    let parent = loc.parent;
    for (const segment of folders) {
      let next = parent.children.find((child) => child !== node && child.name === segment);
      if (!next) {
        next = createNode("folder", segment);
        // The first new folder takes the item's place; deeper ones are simply appended.
        const at = parent === loc.parent ? parent.children.indexOf(node) : parent.children.length;
        parent.children.splice(at, 0, next);
      }
      parent = next;
    }
    const moved = parent !== loc.parent;
    if (moved) {
      loc.parent.children.splice(loc.parent.children.indexOf(node), 1);
      parent.children.push(node);
    }
    node.name = cleanText(leaf);
    node.note = cleanText(note);
    if (trailingSlash) {
      makeFolder(node);
    }
    return { ok: true, node, moved };
  }

  /** Plain JSON for export: no ids, notes only when present. */
  function toJSON(node) {
    const out = { name: node.name, type: node.type };
    if (node.note) {
      out.note = node.note;
    }
    if (isFolder(node)) {
      out.children = node.children.map(toJSON);
    }
    return out;
  }

  /** Checks a tree restored from storage before trusting it. */
  function isValidTree(root) {
    if (!root || typeof root !== "object" || root.type !== "folder") {
      return false;
    }
    const seen = new Set();
    let valid = true;
    walk(root, (node) => {
      const ok = Boolean(node)
        && typeof node === "object"
        && typeof node.id === "string"
        && !seen.has(node.id)
        && typeof node.name === "string"
        && (node.note === undefined || typeof node.note === "string")
        && (node.type === "file" || (node.type === "folder" && Array.isArray(node.children)));
      if (!ok) {
        valid = false;
        return false;
      }
      seen.add(node.id);
      return true;
    });
    return valid;
  }

  return {
    newId,
    createNode,
    createRoot,
    isFolder,
    makeFolder,
    walk,
    indexTree,
    flatten,
    locate,
    contains,
    countNodes,
    splitExtension,
    uniqueName,
    insertChild,
    removeNode,
    moveNode,
    moveBy,
    outdent,
    indent,
    cloneNode,
    duplicateNode,
    compareNodes,
    sortTree,
    splitNote,
    splitPath,
    renameNode,
    toJSON,
    isValidTree
  };
});
