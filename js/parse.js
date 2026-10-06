/*!
 * TreeForge — importers.
 * Reads `tree` output (Unicode, ASCII, Windows), indented or Markdown lists,
 * plain path lists and JSON (TreeForge exports, `tree -J`, nested objects).
 */
window.TreeForge = window.TreeForge || {};

window.TreeForge.parse = (function (T) {
  "use strict";

  const MAX_NODES = 20000;
  const MAX_DEPTH = 256;
  const BOX_DRAWING = /[\u2500-\u257F]/;
  const FOLDER_EMOJI = /^(?:\u{1F4C1}|\u{1F4C2}|\u{1F5C2})\uFE0F?\s*/u;
  const FILE_EMOJI = /^(?:\u{1F4C4}|\u{1F4C3}|\u{1F4DD}|\u{1F5CE}|\u{1F5D2})\uFE0F?\s*/u;

  // ------------------------------------------------------------------ text

  /**
   * Finds where the name starts on a line, skipping indentation, tree glyphs
   * (├── │ └── |-- `-- +--- \---) and list bullets (- * +).
   * Returns the visual column of the name and the rest of the line.
   */
  function measure(line) {
    let column = 0;
    let index = 0;
    let afterConnector = false;
    while (index < line.length) {
      const char = line[index];
      const next = line[index + 1];
      if (char === " " || char === "\u00A0") {
        column += 1;
        afterConnector = false;
      } else if (char === "\t") {
        column += 4 - (column % 4);
        afterConnector = false;
      } else if (
        BOX_DRAWING.test(char)
        || char === "|"
        || char === "\\"
        || (char === "+" && (next === "-" || next === " "))
        || (char === "`" && next === "-")
      ) {
        column += 1;
        afterConnector = true;
      } else if (char === "-" && afterConnector) {
        column += 1;
      } else if ((char === "-" || char === "*" || char === "+") && (next === " " || next === "\t")) {
        column += 1;
      } else {
        break;
      }
      index += 1;
    }
    return { column, rest: line.slice(index) };
  }

  function isNoise(line) {
    const text = line.trim();
    return /^(?:```|~~~)/.test(text)
      || /^\d+ director(?:y|ies)(?:, \d+ files?)?$/i.test(text)
      || /^folder path listing/i.test(text)
      || /^volume serial number/i.test(text)
      || /^no subfolders exist/i.test(text);
  }

  function cleanName(raw) {
    let name = raw.trim()
      .replace(/^\[([^\]]+)\]\([^)]*\)(\/?)$/, "$1$2")
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/^`+|`+$/g, "")
      .trim();
    if (FOLDER_EMOJI.test(name)) {
      name = name.replace(FOLDER_EMOJI, "");
      if (name && !/[\\/]$/.test(name)) {
        name += "/";
      }
    } else {
      name = name.replace(FILE_EMOJI, "");
    }
    return name;
  }

  /** "C:." → ".", "C:\Users\me\project" → "project" (first line of Windows `tree`). */
  function windowsRootName(name) {
    const parts = name.slice(2).split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : ".";
  }

  function parseText(text, options) {
    const settings = options || {};
    const limit = settings.limit || MAX_NODES;
    const root = T.createRoot(settings.rootName || "root");
    const lookups = new Map();
    const stack = [{ column: -1, node: root }];
    let count = 0;
    let truncated = false;
    let firstEntry = true;
    let explicitRoot = false;

    const childNamed = (folder, name) => {
      let map = lookups.get(folder.id);
      if (!map) {
        map = new Map(folder.children.map((child) => [child.name, child]));
        lookups.set(folder.id, map);
      }
      return map.get(name);
    };
    const addChild = (folder, child) => {
      folder.children.push(child);
      childNamed(folder, child.name);
      lookups.get(folder.id).set(child.name, child);
    };

    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim() || isNoise(line)) {
        continue;
      }
      const { column, rest } = measure(line);
      const parts = T.splitNote(rest);
      let name = cleanName(parts.name);
      if (!name) {
        continue;
      }
      if (firstEntry && /^[A-Za-z]:(?:[\\/.]|$)/.test(name)) {
        name = windowsRootName(name);
      }

      while (stack.length > 1 && stack[stack.length - 1].column >= column) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].node;
      const { segments, trailingSlash } = T.splitPath(name);

      if (!segments.length) {
        // "." (or "./") stands for the folder the tree was printed from.
        if (firstEntry) {
          explicitRoot = true;
          if (parts.note) {
            parent.note = parts.note;
          }
        }
        firstEntry = false;
        stack.push({ column, node: parent });
        continue;
      }
      firstEntry = false;

      T.makeFolder(parent);
      let node = parent;
      for (let i = 0; i < segments.length; i += 1) {
        const wantsFolder = i < segments.length - 1 || trailingSlash;
        let child = childNamed(node, segments[i]);
        if (!child) {
          if (count >= limit) {
            truncated = true;
            break;
          }
          child = T.createNode(wantsFolder ? "folder" : "file", segments[i]);
          addChild(node, child);
          count += 1;
        } else if (wantsFolder) {
          T.makeFolder(child);
        }
        node = child;
      }
      if (truncated) {
        break;
      }
      if (parts.note) {
        node.note = parts.note;
      }
      // Absurdly deep input is flattened instead of growing without bound.
      if (stack.length < MAX_DEPTH) {
        stack.push({ column, node });
      }
    }

    // A single top-level folder ("my-app/" with everything below it) becomes the root.
    let result = root;
    if (!explicitRoot && root.children.length === 1 && T.isFolder(root.children[0])) {
      result = root.children[0];
    }
    return { root: result, truncated, count };
  }

  // ------------------------------------------------------------------ paths

  function globToRegExp(pattern) {
    const source = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${source}$`);
  }

  /** "node_modules, .git, *.log" → name => boolean. */
  function compileIgnore(patterns) {
    const list = (Array.isArray(patterns) ? patterns : String(patterns || "").split(/[,\n]/))
      .map((pattern) => String(pattern).trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
    const exact = new Set();
    const wildcards = [];
    for (const pattern of list) {
      if (/[*?]/.test(pattern)) {
        wildcards.push(globToRegExp(pattern));
      } else {
        exact.add(pattern);
      }
    }
    return (name) => exact.has(name) || wildcards.some((regex) => regex.test(name));
  }

  /** Builds a sorted tree from relative paths such as "src/app.js" or "docs/". */
  function fromPaths(paths, options) {
    const settings = options || {};
    const isIgnored = typeof settings.ignore === "function" ? settings.ignore : compileIgnore(settings.ignore);
    const limit = settings.limit || MAX_NODES;
    const root = T.createRoot(settings.rootName || "root");
    const lookups = new Map([[root.id, new Map()]]);
    let count = 0;
    let truncated = false;

    outer: for (const path of paths) {
      const parts = T.splitPath(path);
      // Keep the folders above an ignored entry: "logs/debug.log" still yields "logs/".
      const cut = parts.segments.findIndex(isIgnored);
      const segments = cut === -1 ? parts.segments : parts.segments.slice(0, cut);
      const trailingSlash = cut === -1 ? parts.trailingSlash : true;
      if (!segments.length) {
        continue;
      }
      let parent = root;
      for (let i = 0; i < segments.length; i += 1) {
        const wantsFolder = i < segments.length - 1 || trailingSlash;
        const siblings = lookups.get(parent.id);
        let node = siblings.get(segments[i]);
        if (!node) {
          if (count >= limit) {
            truncated = true;
            break outer;
          }
          node = T.createNode(wantsFolder ? "folder" : "file", segments[i]);
          parent.children.push(node);
          siblings.set(node.name, node);
          count += 1;
        } else if (wantsFolder) {
          T.makeFolder(node);
        }
        if (T.isFolder(node) && !lookups.has(node.id)) {
          lookups.set(node.id, new Map(node.children.map((child) => [child.name, child])));
        }
        parent = node;
      }
    }
    if (settings.sort !== false) {
      T.sortTree(root);
    }
    return { root, truncated, count };
  }

  // ------------------------------------------------------------------ JSON

  const STRUCTURE_KEYS = ["name", "type", "children", "contents"];
  const FOLDER_TYPE = /^(?:folder|directory|dir)$/i;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isStructured(object) {
    return STRUCTURE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(object, key));
  }

  function isFolderLike(object) {
    return Array.isArray(object.children) || Array.isArray(object.contents) || FOLDER_TYPE.test(String(object.type || ""));
  }

  function fromString(value) {
    const { name, note } = T.splitNote(value);
    if (!name) {
      return null;
    }
    const folder = /[\\/]$/.test(name);
    return T.createNode(folder ? "folder" : "file", folder ? name.replace(/[\\/]+$/, "") || name : name, note);
  }

  function convertObject(object, depth, fallbackName) {
    const name = typeof object.name === "string" && object.name.trim() ? object.name.trim() : fallbackName;
    const list = Array.isArray(object.children) ? object.children : Array.isArray(object.contents) ? object.contents : null;
    const folder = list !== null || FOLDER_TYPE.test(String(object.type || ""));
    const note = [object.note, object.comment, object.description].find((value) => typeof value === "string") || "";
    const node = T.createNode(folder ? "folder" : "file", name, note);
    if (folder && list && depth < MAX_DEPTH) {
      node.children = convertList(list, depth + 1);
    }
    return node;
  }

  function convertList(items, depth) {
    const nodes = [];
    items.forEach((item, index) => {
      if (typeof item === "string") {
        const node = fromString(item);
        if (node) {
          nodes.push(node);
        }
      } else if (isPlainObject(item)) {
        if (item.type === "report") {
          return;
        }
        if (isStructured(item)) {
          nodes.push(convertObject(item, depth, `item-${index + 1}`));
        } else {
          nodes.push(...convertMap(item, depth));
        }
      }
    });
    return nodes;
  }

  /** { "src": { "app.js": "entry point" }, "README.md": null } */
  function convertMap(object, depth) {
    return Object.keys(object).map((key) => {
      const value = object[key];
      const folderKey = /[\\/]$/.test(key.trim());
      const name = key.trim().replace(/[\\/]+$/, "") || key;
      if (Array.isArray(value)) {
        const node = T.createNode("folder", name);
        if (depth < MAX_DEPTH) {
          node.children = convertList(value, depth + 1);
        }
        return node;
      }
      if (isPlainObject(value)) {
        if (isStructured(value)) {
          return convertObject({ name, ...value }, depth, name);
        }
        const node = T.createNode("folder", name);
        if (depth < MAX_DEPTH) {
          node.children = convertMap(value, depth + 1);
        }
        return node;
      }
      return T.createNode(folderKey ? "folder" : "file", name, typeof value === "string" ? value : "");
    });
  }

  function fromJSON(data, options) {
    const rootName = (options && options.rootName) || "root";
    let value = data;

    if (Array.isArray(value)) {
      const items = value.filter((item) => !(isPlainObject(item) && item.type === "report"));
      if (items.length === 1 && isPlainObject(items[0]) && isStructured(items[0]) && isFolderLike(items[0])) {
        value = items[0];
      } else {
        const root = T.createRoot(rootName);
        root.children = convertList(items, 1);
        return root;
      }
    }

    if (!isPlainObject(value)) {
      throw new Error("That JSON doesn't describe a file tree.");
    }

    if (!isStructured(value)) {
      const root = T.createRoot(rootName);
      root.children = convertMap(value, 1);
      return root;
    }

    const node = convertObject(value, 0, rootName);
    if (!T.isFolder(node)) {
      const root = T.createRoot(rootName);
      root.children.push(node);
      return root;
    }
    if (node.name === "." || node.name === "./") {
      node.name = rootName;
    }
    return node;
  }

  // ------------------------------------------------------------------ entry

  /** Detects the format and returns { root, kind: "json" | "text", truncated }. */
  function parseInput(text, options) {
    const source = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    const trimmed = source.trim();
    if (!trimmed) {
      throw new Error("Nothing to import yet.");
    }
    if (trimmed[0] === "{" || trimmed[0] === "[") {
      let data;
      let failure = null;
      try {
        data = JSON.parse(trimmed);
      } catch (error) {
        failure = error;
      }
      if (!failure) {
        return { root: fromJSON(data, options), kind: "json", truncated: false };
      }
      if (trimmed[0] === "{") {
        throw new Error(`That looks like JSON but it couldn't be read (${failure.message}).`);
      }
    }
    const result = parseText(source, options);
    if (!result.count && !result.root.children.length) {
      throw new Error("Couldn't find any files or folders in that text.");
    }
    return { root: result.root, kind: "text", truncated: result.truncated };
  }

  return {
    MAX_NODES,
    measure,
    parseText,
    parseInput,
    fromJSON,
    fromPaths,
    compileIgnore
  };
})(window.TreeForge.tree);
