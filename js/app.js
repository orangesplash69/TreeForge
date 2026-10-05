/*!
 * TreeForge — user interface.
 * Everything runs in the browser: state lives in memory and in localStorage only.
 */
(function () {
  "use strict";

  const { tree: T, format: F, parse: P, share: S } = window.TreeForge;

  const STORAGE_KEY = "treeforge:v2";
  const THEME_KEY = "treeforge:theme";
  const HISTORY_LIMIT = 200;
  const HISTORY_CHAR_BUDGET = 40e6; // ~80 MB of snapshots, so huge trees keep fewer steps
  const AUTO_COLLAPSE_THRESHOLD = 200;
  const DEFAULT_IGNORE = "node_modules, .git, .DS_Store, Thumbs.db, __pycache__, .venv, .idea";
  const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const KEY_LABELS = { mod: IS_MAC ? "⌘" : "Ctrl", alt: IS_MAC ? "⌥" : "Alt", shift: IS_MAC ? "⇧" : "Shift" };
  const SVG_NS = "http://www.w3.org/2000/svg";

  const $ = (id) => document.getElementById(id);
  const ui = {
    tree: $("tree"),
    stats: $("stats"),
    output: $("output"),
    outputMeta: $("outputMeta"),
    options: $("options"),
    menu: $("menu"),
    toast: $("toast"),
    dropOverlay: $("dropOverlay"),
    importBtn: $("importBtn"),
    exportBtn: $("exportBtn"),
    undo: $("undoBtn"),
    redo: $("redoBtn"),
    newTree: $("newBtn"),
    install: $("installBtn"),
    theme: $("themeBtn"),
    help: $("helpBtn"),
    addFile: $("addFileBtn"),
    addFolder: $("addFolderBtn"),
    collapseAll: $("collapseAllBtn"),
    expandAll: $("expandAllBtn"),
    sort: $("sortBtn"),
    copy: $("copyBtn"),
    copyMarkdown: $("copyMdBtn"),
    importDialog: $("importDialog"),
    importText: $("importText"),
    importPreview: $("importPreview"),
    importSummary: $("importSummary"),
    importConfirm: $("importConfirm"),
    openFolder: $("openFolderBtn"),
    openFile: $("openFileBtn"),
    ignore: $("ignoreInput"),
    fileInput: $("fileInput"),
    folderInput: $("folderInput"),
    helpDialog: $("helpDialog")
  };

  const state = {
    root: null,
    selectedId: null,
    editingId: null,
    editNote: false,
    freshId: null, // a just-added item that is still waiting for its first name
    freshEntry: null,
    collapsed: new Set(),
    options: F.normalizeOptions(),
    ignore: DEFAULT_IGNORE
  };

  // Undo history: serialized snapshots of the tree plus the selection at that time.
  const timeline = { past: [], future: [] };

  let index = new Map();
  let rows = [];
  let rowPosition = new Map();
  let rowEls = new Map();
  let visibleIds = [];
  let rowHeight = 32;
  let drag = null; // { id, target, marked } while a row is being dragged
  const OVERSCAN = 10;
  const canvas = document.createElement("div");
  canvas.className = "tree__canvas";
  ui.tree.appendChild(canvas);
  let outputText = "";

  // ================================================================= helpers

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function span(className, text) {
    const element = document.createElement("span");
    element.className = className;
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function plural(count, word, many) {
    return `${count.toLocaleString()} ${count === 1 ? word : many || `${word}s`}`;
  }

  function describeCounts(root) {
    const { folders, files } = T.countNodes(root);
    return `${plural(folders, "folder")}, ${plural(files, "file")}`;
  }

  function shortcutLabel(spec) {
    return spec
      .split("+")
      .map((part) => KEY_LABELS[part.toLowerCase()] || part)
      .join(IS_MAC ? "" : "+");
  }

  const FILE_KINDS = {
    code: "js mjs cjs jsx ts tsx py rb go rs java kt kts c h cc cpp hpp cs php swift sh bash zsh fish ps1 vue svelte astro html htm css scss sass less sql lua dart scala ex exs erl hs ml clj r jl pl zig nim wasm",
    config: "json jsonc json5 yml yaml toml xml ini cfg conf env lock properties editorconfig gitignore gitattributes npmrc nvmrc dockerignore prettierrc eslintrc babelrc csv tsv",
    doc: "md mdx markdown txt rst adoc org pdf doc docx odt rtf tex license",
    image: "png jpg jpeg gif svg webp ico avif bmp tiff heic psd ai fig sketch"
  };
  const KIND_BY_EXTENSION = new Map();
  for (const [kind, list] of Object.entries(FILE_KINDS)) {
    for (const extension of list.split(" ")) {
      KIND_BY_EXTENSION.set(extension, kind);
    }
  }

  function fileKind(name) {
    const lower = name.toLowerCase();
    if (/^(license|licence|readme|changelog|contributing|authors)(\.|$)/.test(lower)) {
      return "doc";
    }
    if (/^(dockerfile|makefile|procfile|gemfile|rakefile|vagrantfile)$/.test(lower)) {
      return "config";
    }
    const dot = lower.lastIndexOf(".");
    return KIND_BY_EXTENSION.get(dot === -1 ? lower : lower.slice(dot + 1)) || "";
  }

  function fileBaseName() {
    const slug = state.root.name.replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
    return `${slug || "tree"}-tree`;
  }

  function sampleTree() {
    return P.parseText([
      "my-project/",
      "├── src/",
      "│   ├── components/",
      "│   │   └── Button.jsx",
      "│   ├── app.js         # entry point",
      "│   └── utils.js",
      "├── public/",
      "│   └── favicon.svg",
      "├── package.json",
      "└── README.md"
    ].join("\n")).root;
  }

  // ================================================================= rendering

  function render(options) {
    const settings = options || {};
    const focusTree = settings.focus || ui.tree.contains(document.activeElement);
    index = T.indexTree(state.root);
    if (!index.has(state.selectedId)) {
      state.selectedId = state.root.id;
    }
    if (state.editingId && !index.has(state.editingId)) {
      state.editingId = null;
    }
    reveal(state.selectedId);
    renderTree();
    renderOutput();
    renderChrome();
    if (focusTree) {
      focusSelection();
    }
    schedulePersist();
  }

  /** Expands every folder above `id` so it is visible. */
  function reveal(id) {
    let loc = index.get(id);
    while (loc && loc.parent) {
      state.collapsed.delete(loc.parent.id);
      loc = index.get(loc.parent.id);
    }
  }

  // The tree is virtualized: rows have a fixed height, so only the rows in view
  // (plus a margin) exist in the DOM. That keeps editing instant even with
  // thousands of expanded items.

  function readRowHeight() {
    return parseFloat(getComputedStyle(ui.tree).getPropertyValue("--row-h")) || 32;
  }

  function renderTree() {
    rows = T.flatten(state.root, state.collapsed);
    rowPosition = new Map();
    visibleIds = new Array(rows.length);
    rows.forEach((entry, position) => {
      rowPosition.set(entry.node.id, position);
      visibleIds[position] = entry.node.id;
    });
    rowHeight = readRowHeight();
    canvas.style.height = `${rows.length * rowHeight}px`;
    rowEls = new Map();
    canvas.replaceChildren();
    renderWindow();
  }

  /** Adds rows that scrolled into view and drops the ones that left it. */
  function renderWindow() {
    const offset = canvas.offsetTop;
    const { scrollTop, clientHeight } = ui.tree;
    const first = Math.max(0, Math.floor((scrollTop - offset) / rowHeight) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((scrollTop - offset + clientHeight) / rowHeight) + OVERSCAN);

    const wanted = new Set();
    for (let position = first; position < last; position += 1) {
      wanted.add(rows[position].node.id);
    }
    // The selected, edited and dragged rows always stay, so focus and drag events survive scrolling.
    for (const id of [state.selectedId, state.editingId, drag && drag.id]) {
      if (id && rowPosition.has(id)) {
        wanted.add(id);
      }
    }

    const active = document.activeElement;
    for (const [id, element] of rowEls) {
      if (!wanted.has(id) && !element.contains(active)) {
        element.remove();
        rowEls.delete(id);
      }
    }
    for (const id of wanted) {
      if (rowEls.has(id)) {
        continue;
      }
      const position = rowPosition.get(id);
      const element = buildRow(rows[position]);
      element.style.top = `${position * rowHeight}px`;
      element.dataset.position = String(position);
      rowEls.set(id, element);
      // Keep DOM order equal to visual order for assistive technology.
      let before = null;
      for (const child of canvas.children) {
        if (Number(child.dataset.position) > position) {
          before = child;
          break;
        }
      }
      canvas.insertBefore(element, before);
    }
  }

  function scrollToRow(position) {
    const top = canvas.offsetTop + position * rowHeight;
    const bottom = top + rowHeight;
    if (top < ui.tree.scrollTop) {
      ui.tree.scrollTop = position === 0 ? 0 : top;
    } else if (bottom > ui.tree.scrollTop + ui.tree.clientHeight) {
      ui.tree.scrollTop = bottom - ui.tree.clientHeight;
    }
  }

  function buildRow(entry) {
    const { node, parent, depth } = entry;
    const isRoot = !parent;
    const folder = T.isFolder(node);
    const hasChildren = folder && node.children.length > 0;
    const expanded = folder && (isRoot || !state.collapsed.has(node.id));
    const selected = node.id === state.selectedId;
    const editing = node.id === state.editingId;

    const row = document.createElement("div");
    row.className = `row ${folder ? "row--folder" : "row--file"}`;
    row.classList.toggle("row--root", isRoot);
    row.classList.toggle("is-selected", selected);
    row.classList.toggle("is-editing", editing);
    row.dataset.id = node.id;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-setsize", String(parent ? parent.children.length : 1));
    row.setAttribute("aria-posinset", String(parent ? entry.index + 1 : 1));
    row.setAttribute("aria-selected", String(selected));
    row.setAttribute("aria-label", `${node.name}${folder ? " folder" : ""}${node.note ? `, ${node.note}` : ""}`);
    if (hasChildren) {
      row.setAttribute("aria-expanded", String(expanded));
    }
    row.tabIndex = selected ? 0 : -1;
    row.draggable = !isRoot && !editing;
    row.style.setProperty("--depth", String(depth));

    row.appendChild(span("row__indent"));

    const twisty = span("row__twisty");
    if (hasChildren && !isRoot) {
      twisty.dataset.action = "toggle";
      twisty.appendChild(icon("chevron-right"));
    }
    row.appendChild(twisty);

    const glyph = icon(folder ? (expanded && hasChildren ? "folder-open" : "folder") : "file");
    glyph.classList.add("row__icon");
    if (!folder) {
      const kind = fileKind(node.name);
      if (kind) {
        glyph.dataset.kind = kind;
      }
    }
    row.appendChild(glyph);

    if (editing) {
      const input = document.createElement("input");
      input.className = "row__input";
      input.type = "text";
      input.value = node.note ? `${node.name} # ${node.note}` : node.name;
      input.spellcheck = false;
      input.autocomplete = "off";
      input.dataset.id = node.id;
      input.setAttribute("aria-label", `Name for ${node.name}. Add “ # ” and text for a note.`);
      row.appendChild(input);
      return row;
    }

    const label = span("row__label");
    const name = span("row__name", node.name);
    if (folder) {
      name.appendChild(span("row__slash", "/"));
    }
    label.appendChild(name);
    if (node.note) {
      label.appendChild(span("row__note", node.note));
    }
    row.appendChild(label);

    if (selected) {
      row.appendChild(buildActions(node, isRoot));
    }
    return row;
  }

  const ROW_ACTIONS = {
    "add-file": { icon: "file-plus", label: "New file" },
    "add-folder": { icon: "folder-plus", label: "New folder" },
    rename: { icon: "pencil", label: "Rename" },
    delete: { icon: "trash", label: "Delete", danger: true },
    menu: { icon: "more", label: "More actions" }
  };

  function buildActions(node, isRoot) {
    const names = T.isFolder(node) ? ["add-file", "add-folder", "rename"] : ["rename"];
    if (!isRoot) {
      names.push("delete");
    }
    names.push("menu");

    // Mouse shortcuts only: keyboard and screen-reader users get the same actions
    // through shortcuts and the context menu (Shift+F10).
    const wrap = span("row__actions");
    wrap.setAttribute("aria-hidden", "true");
    for (const name of names) {
      const config = ROW_ACTIONS[name];
      const button = document.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.className = `row__action${config.danger ? " row__action--danger" : ""}`;
      button.dataset.action = name;
      button.title = config.label;
      button.appendChild(icon(config.icon));
      wrap.appendChild(button);
    }
    return wrap;
  }

  /** Row buttons are created lazily (on hover or selection) to keep big trees light. */
  function ensureActions(row) {
    if (!row || row.querySelector(".row__actions") || row.classList.contains("is-editing")) {
      return;
    }
    const loc = index.get(row.dataset.id);
    if (loc) {
      row.appendChild(buildActions(loc.node, !loc.parent));
    }
  }

  function renderOutput() {
    outputText = F.formatTree(state.root, state.options);
    ui.output.textContent = outputText;
    const lineCount = outputText ? outputText.split("\n").length : 0;
    ui.outputMeta.textContent = `${plural(lineCount, "line")} · ${plural(outputText.length, "char")}`;
  }

  function renderChrome() {
    const focused = document.activeElement;
    ui.stats.textContent = describeCounts(state.root);
    ui.undo.disabled = timeline.past.length === 0;
    ui.redo.disabled = timeline.future.length === 0;
    const hasFolders = state.root.children.some((child) => T.isFolder(child));
    ui.collapseAll.disabled = !hasFolders;
    ui.expandAll.disabled = !Array.from(state.collapsed).some((id) => index.has(id));
    ui.sort.disabled = state.root.children.length < 2 && !hasFolders;
    // A focused button that just became disabled drops keyboard focus on <body>; keep it in the tree.
    if (focused instanceof HTMLButtonElement && focused.disabled) {
      focusSelection();
    }
  }

  function focusSelection() {
    const position = rowPosition.get(state.selectedId);
    if (position === undefined) {
      return;
    }
    scrollToRow(position);
    renderWindow();
    const row = rowEls.get(state.selectedId);
    if (!row) {
      return;
    }
    const input = row.querySelector(".row__input");
    if (input) {
      input.focus();
      const loc = index.get(state.selectedId);
      if (state.editNote) {
        if (!loc.node.note) {
          input.value += " # ";
        }
        input.setSelectionRange(input.value.indexOf(" # ") + 3, input.value.length);
      } else if (state.freshId === loc.node.id || T.isFolder(loc.node) || !loc.parent) {
        input.select();
      } else {
        input.setSelectionRange(0, T.splitExtension(loc.node.name)[0].length);
      }
      state.editNote = false;
    } else {
      row.focus({ preventScroll: true });
    }
  }

  /** Changes the selection without rebuilding the tree. */
  function select(id, options) {
    if (!index.has(id)) {
      return;
    }
    if (state.selectedId !== id) {
      const previous = rowEls.get(state.selectedId);
      if (previous) {
        previous.classList.remove("is-selected");
        previous.setAttribute("aria-selected", "false");
        previous.tabIndex = -1;
      }
      state.selectedId = id;
      const next = rowEls.get(id);
      if (next) {
        next.classList.add("is-selected");
        next.setAttribute("aria-selected", "true");
        next.tabIndex = 0;
        ensureActions(next);
      }
      schedulePersist();
    }
    if (options && options.focus) {
      focusSelection();
    }
  }

  // ================================================================= history

  function pushHistory(entry) {
    timeline.past.push(entry);
    let size = timeline.past.reduce((total, item) => total + item.root.length, 0);
    while (timeline.past.length > 1 && (timeline.past.length > HISTORY_LIMIT || size > HISTORY_CHAR_BUDGET)) {
      size -= timeline.past.shift().root.length;
    }
  }

  function snapshot() {
    return { root: JSON.stringify(state.root), selectedId: state.selectedId };
  }

  /**
   * Runs `change`, records an undo step if the tree changed, then re-renders.
   * `change` may return false to cancel. With `amend`, the change is folded into
   * the previous step (used when naming a just-added item).
   * Returns whether the tree changed.
   */
  function mutate(change, options) {
    const settings = options || {};
    const before = JSON.stringify(state.root);
    const selectedBefore = state.selectedId;
    if (change() === false) {
      return false;
    }
    const changed = JSON.stringify(state.root) !== before;
    if (changed) {
      if (!settings.amend) {
        pushHistory({ root: before, selectedId: selectedBefore });
      }
      timeline.future.length = 0;
    }
    render({ focus: settings.focus !== false });
    return changed;
  }

  function applySnapshot(entry) {
    state.root = JSON.parse(entry.root);
    state.selectedId = entry.selectedId;
    state.editingId = null;
    state.freshId = null;
    state.freshEntry = null;
    render();
  }

  function undo() {
    if (state.editingId) {
      if (state.freshId) {
        discardFresh();
        return;
      }
      endEditing(false);
    }
    const entry = timeline.past.pop();
    if (!entry) {
      return;
    }
    timeline.future.push(snapshot());
    applySnapshot(entry);
  }

  function redo() {
    if (state.editingId) {
      endEditing(false);
    }
    const entry = timeline.future.pop();
    if (!entry) {
      return;
    }
    pushHistory(snapshot());
    applySnapshot(entry);
  }

  /** An Undo button for toasts that only fires if nothing else happened since. */
  function undoAction() {
    const depth = timeline.past.length;
    return {
      label: "Undo",
      run: () => {
        if (timeline.past.length === depth) {
          undo();
        }
      }
    };
  }

  // ================================================================= tree actions

  function addNode(type, targetId) {
    const loc = index.get(targetId || state.selectedId) || index.get(state.root.id);
    const intoFolder = T.isFolder(loc.node);
    const parent = intoFolder ? loc.node : loc.parent;
    const at = intoFolder ? parent.children.length : loc.index + 1;
    const folder = type === "folder";
    const node = T.createNode(type, T.uniqueName(folder ? "new-folder" : "new-file.txt", parent.children, null, folder));
    mutate(() => {
      T.insertChild(parent, node, at);
      state.collapsed.delete(parent.id);
      state.selectedId = node.id;
      state.editingId = node.id;
      state.freshId = node.id;
    });
    state.freshEntry = timeline.past[timeline.past.length - 1] || null;
  }

  function startRename(id, options) {
    if (!index.has(id)) {
      return;
    }
    closeMenu(false);
    state.selectedId = id;
    state.editingId = id;
    state.editNote = Boolean(options && options.note);
    renderTree();
    focusSelection();
  }

  function endEditing(focus) {
    state.editingId = null;
    state.freshId = null;
    state.freshEntry = null;
    renderTree();
    if (focus) {
      focusSelection();
    }
  }

  /** Escape on a just-added item removes it again, as if it was never added. */
  function discardFresh() {
    const entry = state.freshEntry;
    const id = state.freshId;
    state.editingId = null;
    state.freshId = null;
    state.freshEntry = null;
    if (entry && timeline.past[timeline.past.length - 1] === entry) {
      timeline.past.pop();
      state.root = JSON.parse(entry.root);
      state.selectedId = entry.selectedId;
      render({ focus: true });
    } else if (id) {
      mutate(() => {
        T.removeNode(state.root, id);
      });
    }
  }

  function commitRename(id, value, viaBlur) {
    if (state.editingId !== id || !index.has(id)) {
      return;
    }
    const fresh = state.freshId === id;
    if (!value.trim()) {
      if (viaBlur) {
        endEditing(false);
      } else if (fresh) {
        discardFresh();
      } else {
        toast("Name can't be empty.", { type: "error" });
      }
      return;
    }
    let result = null;
    mutate(() => {
      result = T.renameNode(state.root, id, value);
      if (!result.ok) {
        return false;
      }
      state.editingId = null;
      state.freshId = null;
      state.freshEntry = null;
      return true;
    }, { amend: fresh, focus: !viaBlur });

    if (!result.ok) {
      toast(result.error, { type: "error" });
      if (viaBlur) {
        endEditing(false);
      } else {
        const input = rowEls.get(id) && rowEls.get(id).querySelector(".row__input");
        if (input) {
          input.focus();
        }
      }
    }
  }

  function deleteNode(id) {
    const loc = index.get(id);
    if (!loc || !loc.parent) {
      return;
    }
    const siblings = loc.parent.children;
    const next = siblings[loc.index + 1] || siblings[loc.index - 1] || loc.parent;
    const { name } = loc.node;
    mutate(() => {
      T.removeNode(state.root, id);
      state.selectedId = next.id;
    });
    toast(`Deleted “${name}”.`, { action: undoAction() });
  }

  function duplicateNode(id) {
    mutate(() => {
      const copy = T.duplicateNode(state.root, id);
      if (!copy) {
        return false;
      }
      state.selectedId = copy.id;
      return true;
    });
  }

  function moveSelected(kind) {
    const id = state.selectedId;
    const operations = {
      up: () => T.moveBy(state.root, id, -1),
      down: () => T.moveBy(state.root, id, 1),
      out: () => T.outdent(state.root, id),
      in: () => T.indent(state.root, id)
    };
    let result = null;
    mutate(() => {
      result = operations[kind]();
      return Boolean(result);
    });
    if (result && result.renamed) {
      toast(`Renamed to “${result.node.name}” to avoid a name clash.`);
    }
  }

  function sortNode(id) {
    const loc = index.get(id || state.root.id);
    if (!loc || !T.isFolder(loc.node)) {
      return;
    }
    const changed = mutate(() => {
      T.sortTree(loc.node, true);
    });
    toast(changed ? "Sorted A–Z, folders first." : "Already in order.", changed ? { action: undoAction() } : undefined);
  }

  function toggleFolder(id, expand) {
    const loc = index.get(id);
    if (!loc || !loc.parent || !T.isFolder(loc.node) || !loc.node.children.length) {
      return;
    }
    const collapsed = state.collapsed.has(id);
    const collapse = expand === undefined ? !collapsed : !expand;
    if (collapse === collapsed) {
      return;
    }
    if (collapse) {
      state.collapsed.add(id);
      if (state.selectedId !== id && T.contains(loc.node, state.selectedId)) {
        state.selectedId = id;
      }
    } else {
      state.collapsed.delete(id);
    }
    render();
  }

  function collapseFolders(root) {
    T.walk(root, (node, parent) => {
      if (parent && T.isFolder(node) && node.children.length) {
        state.collapsed.add(node.id);
      }
    });
  }

  function collapseAll() {
    collapseFolders(state.root);
    let loc = index.get(state.selectedId);
    while (loc && loc.parent && loc.parent !== state.root) {
      loc = index.get(loc.parent.id);
    }
    if (loc) {
      state.selectedId = loc.node.id;
    }
    render();
  }

  function expandAll() {
    state.collapsed.clear();
    render();
  }

  /** Swaps in a whole new tree (import, share link, new). Undoable. */
  function replaceTree(root, message) {
    const changed = mutate(() => {
      state.root = root;
      state.selectedId = root.id;
      state.editingId = null;
      state.collapsed.clear();
      const { folders, files } = T.countNodes(root);
      if (folders + files > AUTO_COLLAPSE_THRESHOLD) {
        collapseFolders(root);
      }
    });
    if (message) {
      toast(message, changed ? { action: undoAction() } : undefined);
    }
  }

  function newTree() {
    replaceTree(T.createRoot("root"), "Started a new tree.");
  }

  // ================================================================= tree events

  function rowFromEvent(event) {
    return event.target instanceof Element ? event.target.closest(".row") : null;
  }

  function onTreeClick(event) {
    if (event.target.closest(".row__input")) {
      return;
    }
    const row = rowFromEvent(event);
    if (!row) {
      return;
    }
    const id = row.dataset.id;
    const action = event.target.closest("[data-action]");
    if (!action) {
      select(id, { focus: true });
      return;
    }
    switch (action.dataset.action) {
      case "toggle":
        toggleFolder(id);
        break;
      case "add-file":
        addNode("file", id);
        break;
      case "add-folder":
        addNode("folder", id);
        break;
      case "rename":
        startRename(id);
        break;
      case "delete":
        deleteNode(id);
        break;
      case "menu":
        select(id);
        openNodeMenu(id, anchorBelow(action));
        break;
      default:
        break;
    }
  }

  function onTreeDoubleClick(event) {
    const row = rowFromEvent(event);
    if (row && !event.target.closest("[data-action], .row__input")) {
      startRename(row.dataset.id);
    }
  }

  function onTreeContextMenu(event) {
    const row = rowFromEvent(event);
    if (!row || event.target.closest(".row__input")) {
      return;
    }
    event.preventDefault();
    select(row.dataset.id);
    openNodeMenu(row.dataset.id, { x: event.clientX, y: event.clientY });
  }

  function onTreeKeyDown(event) {
    const input = event.target.closest(".row__input");
    if (input) {
      if (event.isComposing) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commitRename(input.dataset.id, input.value, false);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (state.freshId === input.dataset.id) {
          discardFresh();
        } else {
          endEditing(true);
        }
      }
      return;
    }

    const loc = index.get(state.selectedId);
    if (!loc) {
      return;
    }
    const { node } = loc;
    const id = node.id;
    const folder = T.isFolder(node);
    const expanded = folder && (!loc.parent || !state.collapsed.has(id));

    if (event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.altKey) {
      const moves = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "out", ArrowRight: "in" };
      if (moves[event.key]) {
        event.preventDefault();
        moveSelected(moves[event.key]);
      }
      return;
    }

    const position = visibleIds.indexOf(id);
    switch (event.key) {
      case "ArrowDown":
        select(visibleIds[Math.min(position + 1, visibleIds.length - 1)], { focus: true });
        break;
      case "ArrowUp":
        select(visibleIds[Math.max(position - 1, 0)], { focus: true });
        break;
      case "Home":
        select(visibleIds[0], { focus: true });
        break;
      case "End":
        select(visibleIds[visibleIds.length - 1], { focus: true });
        break;
      case "ArrowRight":
        if (folder && node.children.length) {
          if (expanded) {
            select(node.children[0].id, { focus: true });
          } else {
            toggleFolder(id, true);
          }
        }
        break;
      case "ArrowLeft":
        if (folder && expanded && loc.parent && node.children.length) {
          toggleFolder(id, false);
        } else if (loc.parent) {
          select(loc.parent.id, { focus: true });
        }
        break;
      case "Enter":
      case "F2":
        startRename(id);
        break;
      case " ":
        toggleFolder(id);
        break;
      case "Delete":
      case "Backspace":
        deleteNode(id);
        break;
      case "n":
      case "N":
        addNode(event.shiftKey ? "folder" : "file");
        break;
      case "ContextMenu":
        openNodeMenu(id, anchorBelow(rowEls.get(id), 28));
        break;
      case "F10":
        if (!event.shiftKey) {
          return;
        }
        openNodeMenu(id, anchorBelow(rowEls.get(id), 28));
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onTreeFocusOut(event) {
    const input = event.target.closest && event.target.closest(".row__input");
    // Switching windows shouldn't end the edit; the field gets focus back on return.
    if (!input || state.editingId !== input.dataset.id || !document.hasFocus()) {
      return;
    }
    const nextRow = event.relatedTarget instanceof Element ? event.relatedTarget.closest(".row") : null;
    commitRename(input.dataset.id, input.value, true);
    // The click on another row is lost when the tree re-renders, so select it here.
    if (nextRow && index.has(nextRow.dataset.id) && !state.editingId) {
      select(nextRow.dataset.id, { focus: true });
    }
  }

  // ----------------------------------------------------------------- drag & drop

  function onDragStart(event) {
    const row = rowFromEvent(event);
    if (!row || row.classList.contains("row--root") || state.editingId) {
      event.preventDefault();
      return;
    }
    closeMenu(false);
    const id = row.dataset.id;
    select(id);
    drag = { id, target: null, marked: null };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-treeforge", id);
    event.dataTransfer.setData("text/plain", index.get(id).node.name);
    requestAnimationFrame(() => row.classList.add("is-dragging"));
  }

  function dropTargetFor(event) {
    const dragged = index.get(drag.id);
    if (!dragged) {
      return null;
    }
    const row = rowFromEvent(event);
    let target;
    if (!row) {
      target = { parentId: state.root.id, index: state.root.children.length, row: null, position: "end" };
    } else {
      const loc = index.get(row.dataset.id);
      const folder = T.isFolder(loc.node);
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      const open = folder && loc.node.children.length > 0 && !state.collapsed.has(loc.node.id);
      if (!loc.parent || (folder && ratio > 0.25 && ratio < 0.75)) {
        target = { parentId: loc.node.id, index: loc.node.children.length, row, position: "inside" };
      } else if (ratio < 0.5) {
        target = { parentId: loc.parent.id, index: loc.index, row, position: "before", depth: loc.depth };
      } else if (open) {
        // Below an open folder means "first item inside it".
        target = { parentId: loc.node.id, index: 0, row, position: "after", depth: loc.depth + 1 };
      } else {
        target = { parentId: loc.parent.id, index: loc.index + 1, row, position: "after", depth: loc.depth };
      }
    }
    return T.contains(dragged.node, target.parentId) ? null : target;
  }

  function markDrop(target) {
    if (drag && drag.marked) {
      drag.marked.removeAttribute("data-drop");
      drag.marked.style.removeProperty("--drop-depth");
    }
    ui.tree.classList.remove("is-drop-end");
    if (!drag) {
      return;
    }
    drag.target = target;
    drag.marked = target ? target.row : null;
    if (!target) {
      return;
    }
    if (target.row) {
      target.row.dataset.drop = target.position;
      if (target.depth !== undefined) {
        target.row.style.setProperty("--drop-depth", String(target.depth));
      }
    } else {
      ui.tree.classList.add("is-drop-end");
    }
  }

  function onDragOver(event) {
    if (!drag) {
      return;
    }
    const target = dropTargetFor(event);
    markDrop(target);
    if (target) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }

  function onDragLeave(event) {
    if (drag && !(event.relatedTarget instanceof Node && ui.tree.contains(event.relatedTarget))) {
      markDrop(null);
    }
  }

  function endDrag() {
    markDrop(null);
    const dragging = ui.tree.querySelector(".is-dragging");
    if (dragging) {
      dragging.classList.remove("is-dragging");
    }
    drag = null;
  }

  function onDrop(event) {
    if (!drag) {
      return;
    }
    event.preventDefault();
    const { id, target } = drag;
    endDrag();
    if (!target) {
      return;
    }
    let result = null;
    mutate(() => {
      result = T.moveNode(state.root, id, target.parentId, target.index);
      if (!result) {
        return false;
      }
      state.selectedId = id;
      return true;
    });
    if (result && result.renamed) {
      toast(`Renamed to “${result.node.name}” to avoid a name clash.`);
    }
  }

  // ================================================================= menus

  const menuState = { returnFocus: null, anchor: null };

  function anchorBelow(element, offsetX) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + (offsetX || 0), y: rect.bottom + 4, top: rect.top, right: rect.right };
  }

  function openMenu(items, position, options) {
    const settings = options || {};
    closeMenu(false);
    ui.menu.replaceChildren();

    // Drop separators that would be leading, trailing or doubled.
    const cleaned = items.filter(Boolean).filter((item, i, list) => item !== "-" || (i > 0 && list[i - 1] !== "-"));
    while (cleaned[cleaned.length - 1] === "-") {
      cleaned.pop();
    }

    for (const item of cleaned) {
      if (item === "-") {
        const separator = document.createElement("div");
        separator.className = "menu__sep";
        separator.setAttribute("role", "separator");
        ui.menu.appendChild(separator);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = `menu__item${item.danger ? " menu__item--danger" : ""}`;
      button.setAttribute("role", "menuitem");
      button.tabIndex = -1;
      button.disabled = Boolean(item.disabled);
      button.appendChild(icon(item.icon || "blank"));
      button.appendChild(span("menu__label", item.label));
      if (item.shortcut) {
        button.appendChild(span("menu__shortcut", shortcutLabel(item.shortcut)));
      }
      button.addEventListener("click", () => {
        closeMenu(true);
        item.run();
      });
      ui.menu.appendChild(button);
    }

    ui.menu.hidden = false;
    const { width, height } = ui.menu.getBoundingClientRect();
    const margin = 8;
    let x = settings.alignRight && position.right !== undefined ? position.right - width : position.x;
    let y = position.y;
    x = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
    if (y + height > window.innerHeight - margin) {
      y = Math.max(margin, (position.top !== undefined ? position.top - 4 : y) - height);
    }
    ui.menu.style.left = `${Math.round(x)}px`;
    ui.menu.style.top = `${Math.round(y)}px`;

    menuState.returnFocus = settings.returnFocus || document.activeElement;
    menuState.anchor = settings.anchor || null;
    if (menuState.anchor) {
      menuState.anchor.setAttribute("aria-expanded", "true");
    }
    if (settings.label) {
      ui.menu.setAttribute("aria-label", settings.label);
    }
    const first = ui.menu.querySelector(".menu__item:not(:disabled)");
    if (first) {
      first.focus();
    }
  }

  function closeMenu(restoreFocus) {
    if (ui.menu.hidden) {
      return;
    }
    ui.menu.hidden = true;
    if (menuState.anchor) {
      menuState.anchor.setAttribute("aria-expanded", "false");
    }
    const target = menuState.returnFocus;
    menuState.returnFocus = null;
    menuState.anchor = null;
    if (restoreFocus && target && document.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }

  function onMenuKeyDown(event) {
    const items = Array.from(ui.menu.querySelectorAll(".menu__item:not(:disabled)"));
    const current = items.indexOf(document.activeElement);
    let next = null;
    switch (event.key) {
      case "ArrowDown":
        next = items[(current + 1) % items.length];
        break;
      case "ArrowUp":
        next = items[(current - 1 + items.length) % items.length];
        break;
      case "Home":
        next = items[0];
        break;
      case "End":
        next = items[items.length - 1];
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      case "Tab":
        event.preventDefault();
        closeMenu(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next) {
      next.focus();
    }
  }

  function openNodeMenu(id, position) {
    const loc = index.get(id);
    if (!loc) {
      return;
    }
    const isRoot = !loc.parent;
    const folder = T.isFolder(loc.node);
    const siblings = isRoot ? [] : loc.parent.children;
    const previous = siblings[loc.index - 1];
    const run = (fn) => () => {
      select(id);
      fn();
    };
    openMenu([
      folder && { label: "New file", icon: "file-plus", shortcut: "N", run: run(() => addNode("file", id)) },
      folder && { label: "New folder", icon: "folder-plus", shortcut: "Shift+N", run: run(() => addNode("folder", id)) },
      "-",
      { label: "Rename", icon: "pencil", shortcut: "F2", run: () => startRename(id) },
      { label: loc.node.note ? "Edit note" : "Add note", icon: "note", run: () => startRename(id, { note: true }) },
      !isRoot && { label: "Duplicate", icon: "duplicate", run: () => duplicateNode(id) },
      "-",
      !isRoot && { label: "Move up", icon: "arrow-up", shortcut: "Alt+↑", disabled: loc.index === 0, run: run(() => moveSelected("up")) },
      !isRoot && { label: "Move down", icon: "arrow-down", shortcut: "Alt+↓", disabled: loc.index === siblings.length - 1, run: run(() => moveSelected("down")) },
      !isRoot && { label: "Move out of folder", icon: "outdent", shortcut: "Alt+←", disabled: loc.depth < 2, run: run(() => moveSelected("out")) },
      !isRoot && { label: "Move into folder above", icon: "indent", shortcut: "Alt+→", disabled: !T.isFolder(previous), run: run(() => moveSelected("in")) },
      folder && { label: "Sort contents A–Z", icon: "sort", disabled: loc.node.children.length === 0, run: () => sortNode(id) },
      "-",
      !isRoot && { label: "Delete", icon: "trash", shortcut: "Delete", danger: true, run: () => deleteNode(id) }
    ], position, { returnFocus: rowEls.get(id), label: `Actions for ${loc.node.name}` });
  }

  function openExportMenu() {
    if (!ui.menu.hidden && menuState.anchor === ui.exportBtn) {
      closeMenu(true);
      return;
    }
    const style = state.options.style;
    openMenu([
      { label: "Copy tree", icon: "copy", run: copyOutput },
      { label: "Copy as Markdown", icon: "markdown", run: copyMarkdown },
      { label: "Copy share link", icon: "link", run: copyShareLink },
      "-",
      { label: "Download .txt", icon: "download", run: () => download(`${fileBaseName()}.txt`, outputText ? `${outputText}\n` : "", "text/plain") },
      { label: "Download .md", icon: "download", run: () => download(`${fileBaseName()}.md`, F.toMarkdown(outputText, style), "text/markdown") },
      { label: "Download .json", icon: "download", run: () => download(`${fileBaseName()}.json`, `${JSON.stringify(T.toJSON(state.root), null, 2)}\n`, "application/json") }
    ], anchorBelow(ui.exportBtn), { alignRight: true, anchor: ui.exportBtn, returnFocus: ui.exportBtn, label: "Export" });
  }

  // ================================================================= export

  function legacyCopy(text) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (error) {
      ok = false;
    }
    helper.remove();
    return ok;
  }

  async function copyText(text, message) {
    if (!text) {
      toast("Nothing to copy yet.", { type: "error" });
      return;
    }
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (error) {
      ok = legacyCopy(text);
    }
    toast(ok ? message : "Couldn't reach the clipboard — select the output and copy it manually.", ok ? undefined : { type: "error" });
  }

  function copyOutput() {
    copyText(outputText, "Copied to the clipboard.");
  }

  function copyMarkdown() {
    copyText(F.toMarkdown(outputText, state.options.style), "Copied as Markdown.");
  }

  async function buildShareLink() {
    const payload = await S.encode(state.root, state.options);
    return `${location.href.split("#")[0]}#tree=${payload}`;
  }

  async function copyShareLink() {
    const link = buildShareLink();
    try {
      // Passing a promise keeps Safari's "user gesture" alive while the link is compressed.
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": link.then((url) => new Blob([url], { type: "text/plain" })) })
        ]);
      } else {
        await navigator.clipboard.writeText(await link);
      }
      const url = await link;
      toast(url.length > 8000 ? "Share link copied. It's long — some apps may cut it off." : "Share link copied.");
    } catch (error) {
      try {
        const url = await link;
        if (legacyCopy(url)) {
          toast("Share link copied.");
        } else {
          window.history.replaceState(null, "", url);
          toast("Couldn't copy automatically — the link is now in the address bar.");
        }
      } catch (inner) {
        toast("Couldn't create a share link in this browser.", { type: "error" });
      }
    }
  }

  function download(filename, content, type) {
    if (!content) {
      toast("Nothing to download yet.", { type: "error" });
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Saved ${filename}.`);
  }

  // ================================================================= import

  const importState = { root: null };
  let importTimer = 0;

  function openImport() {
    closeMenu(false);
    ui.importText.value = "";
    ui.ignore.value = state.ignore;
    setImportPreview(null);
    ui.importDialog.showModal();
    ui.importText.focus();
  }

  function setImportPreview(root, summary, isError) {
    importState.root = root;
    ui.importSummary.textContent = summary || "";
    ui.importSummary.classList.toggle("is-error", Boolean(isError));
    if (root) {
      const text = F.formatTree(root, { ...state.options, showRoot: true });
      const lines = text.split("\n");
      ui.importPreview.textContent = lines.length > 400
        ? `${lines.slice(0, 400).join("\n")}\n… ${plural(lines.length - 400, "more line")}`
        : text;
    } else {
      ui.importPreview.textContent = "";
    }
    ui.importConfirm.disabled = !root;
  }

  function parseImportText() {
    const text = ui.importText.value;
    if (!text.trim()) {
      setImportPreview(null);
      return;
    }
    try {
      const result = P.parseInput(text, { rootName: state.root.name });
      const kind = result.kind === "json" ? "JSON" : "Text";
      setImportPreview(result.root, `${kind} · ${describeCounts(result.root)}${result.truncated ? " · cut off" : ""}`);
    } catch (error) {
      setImportPreview(null, error.message, true);
    }
  }

  /** Puts an imported tree into the dialog preview if it's open, otherwise straight into the editor. */
  function deliverImport(result, label) {
    const note = result.truncated ? ` (stopped at ${plural(P.MAX_NODES, "item")})` : "";
    if (ui.importDialog.open) {
      ui.importText.value = "";
      setImportPreview(result.root, `${label} · ${describeCounts(result.root)}${note}`);
      ui.importConfirm.focus();
    } else {
      replaceTree(result.root, `Imported ${label}${note}.`);
    }
  }

  function confirmImport() {
    if (!importState.root) {
      return;
    }
    const root = importState.root;
    ui.importDialog.close();
    replaceTree(root, "Imported.");
  }

  // ----------------------------------------------------------------- reading folders

  async function readFolder(rootName, rootDir, list, isIgnored) {
    const root = T.createRoot(rootName);
    const queue = [[rootDir, root]];
    let count = 0;
    let truncated = false;
    // Breadth-first, so hitting the limit still keeps the top of the tree.
    for (let i = 0; i < queue.length && !truncated; i += 1) {
      const [dir, node] = queue[i];
      for (const entry of await list(dir)) {
        if (isIgnored(entry.name)) {
          continue;
        }
        if (count >= P.MAX_NODES) {
          truncated = true;
          break;
        }
        count += 1;
        const child = T.createNode(entry.isDir ? "folder" : "file", entry.name);
        node.children.push(child);
        if (entry.isDir) {
          queue.push([entry.ref, child]);
        }
      }
    }
    T.sortTree(root);
    return { root, truncated, count };
  }

  async function listHandle(dir) {
    const entries = [];
    for await (const entry of dir.values()) {
      entries.push({ name: entry.name, isDir: entry.kind === "directory", ref: entry });
    }
    return entries;
  }

  async function listEntry(dir) {
    if (Array.isArray(dir)) {
      return dir.map((entry) => ({ name: entry.name, isDir: entry.isDirectory, ref: entry }));
    }
    const reader = dir.createReader();
    const entries = [];
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) {
        break;
      }
      for (const entry of batch) {
        entries.push({ name: entry.name, isDir: entry.isDirectory, ref: entry });
      }
    }
    return entries;
  }

  function chooseFolderFiles() {
    return new Promise((resolve) => {
      const input = ui.folderInput;
      const settle = (event) => {
        input.removeEventListener("change", settle);
        input.removeEventListener("cancel", settle);
        resolve(event.type === "change" ? Array.from(input.files || []) : null);
      };
      input.value = "";
      input.addEventListener("change", settle);
      input.addEventListener("cancel", settle);
      input.click();
    });
  }

  async function pickFolder() {
    const isIgnored = P.compileIgnore(state.ignore);
    if (typeof window.showDirectoryPicker === "function") {
      let handle = null;
      try {
        handle = await window.showDirectoryPicker({ id: "treeforge", mode: "read" });
      } catch (error) {
        if (error && error.name === "AbortError") {
          return;
        }
      }
      if (handle) {
        toast("Reading folder…");
        deliverImport(await readFolder(handle.name, handle, listHandle, isIgnored), `“${handle.name}”`);
        return;
      }
    }
    // Fallback for browsers without the File System Access API.
    const files = await chooseFolderFiles();
    if (!files) {
      return;
    }
    if (!files.length) {
      toast("That folder is empty.", { type: "error" });
      return;
    }
    const paths = files.map((file) => file.webkitRelativePath || file.name);
    const rootName = paths[0].split("/")[0] || "folder";
    const result = P.fromPaths(paths.map((path) => path.slice(path.indexOf("/") + 1)), { rootName, ignore: isIgnored });
    deliverImport(result, `“${rootName}”`);
  }

  function isFileDrag(event) {
    return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes("Files");
  }

  async function handleExternalDrop(dataTransfer) {
    // Entries must be grabbed synchronously, before the drop event finishes.
    const entries = Array.from(dataTransfer.items || [])
      .filter((item) => item.kind === "file" && typeof item.webkitGetAsEntry === "function")
      .map((item) => item.webkitGetAsEntry())
      .filter(Boolean);
    const files = Array.from(dataTransfer.files || []);
    const isIgnored = P.compileIgnore(state.ignore);

    try {
      if (entries.length === 1 && entries[0].isDirectory) {
        toast("Reading folder…");
        deliverImport(await readFolder(entries[0].name, entries[0], listEntry, isIgnored), `“${entries[0].name}”`);
        return;
      }
      const single = files.length === 1 ? files[0] : null;
      if (single && /\.(json|txt|md|markdown|tree)$/i.test(single.name)) {
        const text = await single.text();
        if (ui.importDialog.open) {
          ui.importText.value = text;
          parseImportText();
        } else {
          const result = P.parseInput(text, { rootName: state.root.name });
          replaceTree(result.root, `Imported ${single.name}.`);
        }
        return;
      }
      if (entries.length) {
        // Several files and folders at once: they become the contents of the current root's name.
        deliverImport(await readFolder(state.root.name, entries, listEntry, isIgnored), plural(entries.length, "dropped item"));
        return;
      }
      toast("Drop a folder, or a .json, .txt or .md file.", { type: "error" });
    } catch (error) {
      toast(error && error.message ? error.message : "Couldn't read what was dropped.", { type: "error" });
    }
  }

  function setupFileDrop() {
    let depth = 0;
    const hide = () => {
      depth = 0;
      ui.dropOverlay.hidden = true;
    };
    document.addEventListener("dragenter", (event) => {
      if (isFileDrag(event)) {
        depth += 1;
        ui.dropOverlay.hidden = false;
      }
    });
    document.addEventListener("dragleave", (event) => {
      if (isFileDrag(event)) {
        depth -= 1;
        if (depth <= 0) {
          hide();
        }
      }
    });
    document.addEventListener("dragover", (event) => {
      if (isFileDrag(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    document.addEventListener("drop", (event) => {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      hide();
      handleExternalDrop(event.dataTransfer);
    });
  }

  // ================================================================= toast

  let toastTimer = 0;

  function toast(message, options) {
    const settings = options || {};
    window.clearTimeout(toastTimer);
    ui.toast.replaceChildren(span("toast__text", message));
    if (settings.action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toast__action";
      button.textContent = settings.action.label;
      button.addEventListener("click", () => {
        hideToast();
        settings.action.run();
      });
      ui.toast.appendChild(button);
    }
    ui.toast.dataset.type = settings.type || "info";
    ui.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(hideToast, settings.action ? 6000 : 2800);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    ui.toast.classList.remove("is-visible");
  }

  // ================================================================= persistence

  let persistTimer = 0;
  let storageWarned = false;

  function schedulePersist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persistNow, 250);
  }

  function persistNow() {
    window.clearTimeout(persistTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        root: state.root,
        selectedId: state.selectedId,
        collapsed: Array.from(state.collapsed).filter((id) => index.has(id)),
        options: state.options,
        ignore: state.ignore
      }));
    } catch (error) {
      // Storage can be unavailable (private mode, blocked cookies) or full; the app still works.
      if (!storageWarned && error && error.name === "QuotaExceededError") {
        storageWarned = true;
        toast("This tree is too big to autosave in the browser. Export it to keep a copy.", { type: "error" });
      }
    }
  }

  function loadSaved() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (error) {
      return false;
    }
    if (!data || typeof data !== "object") {
      return false;
    }
    state.options = F.normalizeOptions(data.options);
    if (typeof data.ignore === "string") {
      state.ignore = data.ignore;
    }
    let root = null;
    if (T.isValidTree(data.root)) {
      root = data.root;
    } else {
      try {
        root = P.fromJSON(data.root);
      } catch (error) {
        return false;
      }
    }
    state.root = root;
    state.selectedId = typeof data.selectedId === "string" ? data.selectedId : root.id;
    state.collapsed = new Set(Array.isArray(data.collapsed) ? data.collapsed.filter((id) => typeof id === "string") : []);
    return true;
  }

  // ================================================================= share links

  async function loadFromHash() {
    const match = /^#tree=([\w-]+)/.exec(location.hash);
    if (!match) {
      return;
    }
    window.history.replaceState(null, "", location.pathname + location.search);
    try {
      const { root, options } = await S.decode(match[1]);
      if (options) {
        state.options = F.normalizeOptions({ ...state.options, ...options });
        syncOptionsForm();
      }
      replaceTree(root, "Opened a shared tree.");
    } catch (error) {
      toast("That share link is incomplete or damaged.", { type: "error" });
    }
  }

  // ================================================================= options, theme, install

  function syncOptionsForm() {
    for (const input of ui.options.querySelectorAll("input")) {
      if (input.type === "radio") {
        input.checked = state.options[input.name] === input.value;
      } else {
        input.checked = Boolean(state.options[input.name]);
      }
    }
  }

  function onOptionsChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    state.options = F.normalizeOptions({
      ...state.options,
      [input.name]: input.type === "radio" ? input.value : input.checked
    });
    renderOutput();
    schedulePersist();
  }

  function currentTheme() {
    const forced = document.documentElement.getAttribute("data-theme");
    if (forced === "light" || forced === "dark") {
      return forced;
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function updateThemeButton() {
    const dark = currentTheme() === "dark";
    const label = dark ? "Switch to light theme" : "Switch to dark theme";
    ui.theme.querySelector("use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
    ui.theme.setAttribute("aria-label", label);
    ui.theme.title = label;
    if (document.documentElement.hasAttribute("data-theme")) {
      const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        meta.setAttribute("content", color);
      }
    }
  }

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      // Not saved; the choice still applies until the page is closed.
    }
    updateThemeButton();
  }

  function setupInstall() {
    let deferred = null;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferred = event;
      ui.install.hidden = false;
    });
    ui.install.addEventListener("click", async () => {
      if (!deferred) {
        return;
      }
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      ui.install.hidden = true;
    });
    window.addEventListener("appinstalled", () => {
      ui.install.hidden = true;
      toast("TreeForge is installed.");
    });
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {
          // Offline support is optional; the app works without it.
        });
      });
    }
  }

  function applyKeyLabels() {
    for (const element of document.querySelectorAll("kbd[data-key]")) {
      element.textContent = KEY_LABELS[element.dataset.key] || element.textContent;
    }
    for (const element of document.querySelectorAll("[data-shortcut]")) {
      element.title = `${element.getAttribute("aria-label")} (${shortcutLabel(element.dataset.shortcut)})`;
    }
  }

  // ================================================================= wiring

  function isTypingTarget(target) {
    return target instanceof Element
      && Boolean(target.closest("textarea, select, [contenteditable=''], [contenteditable='true'], input:not([type='checkbox']):not([type='radio']):not([type='button'])"));
  }

  function onGlobalKeyDown(event) {
    if (event.defaultPrevented || isTypingTarget(event.target) || document.querySelector("dialog[open]")) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    } else if (mod && !event.altKey && key === "y") {
      event.preventDefault();
      redo();
    } else if (!mod && !event.altKey && event.key === "?") {
      event.preventDefault();
      closeMenu(false);
      ui.helpDialog.showModal();
    }
  }

  function bindEvents() {
    ui.tree.addEventListener("click", onTreeClick);
    ui.tree.addEventListener("dblclick", onTreeDoubleClick);
    ui.tree.addEventListener("contextmenu", onTreeContextMenu);
    ui.tree.addEventListener("keydown", onTreeKeyDown);
    ui.tree.addEventListener("focusout", onTreeFocusOut);
    ui.tree.addEventListener("mouseover", (event) => ensureActions(rowFromEvent(event)));
    ui.tree.addEventListener("dragstart", onDragStart);
    ui.tree.addEventListener("dragover", onDragOver);
    ui.tree.addEventListener("dragleave", onDragLeave);
    ui.tree.addEventListener("drop", onDrop);
    ui.tree.addEventListener("dragend", endDrag);
    // Clicking the empty area below the rows keeps keyboard focus in the tree.
    ui.tree.addEventListener("mousedown", (event) => {
      if (event.target === ui.tree || event.target === canvas) {
        event.preventDefault();
        focusSelection();
      }
    });

    ui.addFile.addEventListener("click", () => addNode("file"));
    ui.addFolder.addEventListener("click", () => addNode("folder"));
    ui.collapseAll.addEventListener("click", collapseAll);
    ui.expandAll.addEventListener("click", expandAll);
    ui.sort.addEventListener("click", () => sortNode(state.root.id));

    ui.undo.addEventListener("click", undo);
    ui.redo.addEventListener("click", redo);
    ui.newTree.addEventListener("click", newTree);
    ui.importBtn.addEventListener("click", openImport);
    ui.exportBtn.addEventListener("click", openExportMenu);
    ui.theme.addEventListener("click", toggleTheme);
    ui.help.addEventListener("click", () => ui.helpDialog.showModal());
    ui.copy.addEventListener("click", copyOutput);
    ui.copyMarkdown.addEventListener("click", copyMarkdown);

    ui.options.addEventListener("change", onOptionsChange);
    ui.options.addEventListener("submit", (event) => event.preventDefault());

    ui.importText.addEventListener("input", () => {
      window.clearTimeout(importTimer);
      importTimer = window.setTimeout(parseImportText, 120);
    });
    ui.importText.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        confirmImport();
      }
    });
    ui.importConfirm.addEventListener("click", confirmImport);
    ui.openFolder.addEventListener("click", () => {
      pickFolder().catch((error) => toast(error && error.message ? error.message : "Couldn't read that folder.", { type: "error" }));
    });
    ui.openFile.addEventListener("click", () => ui.fileInput.click());
    ui.fileInput.addEventListener("change", async () => {
      const [file] = ui.fileInput.files || [];
      ui.fileInput.value = "";
      if (!file) {
        return;
      }
      try {
        ui.importText.value = await file.text();
        parseImportText();
      } catch (error) {
        toast("Couldn't read that file.", { type: "error" });
      }
    });
    ui.ignore.addEventListener("input", () => {
      state.ignore = ui.ignore.value;
      schedulePersist();
    });

    ui.menu.addEventListener("keydown", onMenuKeyDown);
    document.addEventListener("pointerdown", (event) => {
      if (!ui.menu.hidden && !ui.menu.contains(event.target) && !(menuState.anchor && menuState.anchor.contains(event.target))) {
        closeMenu(false);
      }
    }, true);
    window.addEventListener("resize", () => {
      closeMenu(false);
      if (readRowHeight() !== rowHeight) {
        renderTree();
      } else {
        renderWindow();
      }
    });
    let windowFrame = 0;
    ui.tree.addEventListener("scroll", () => {
      if (!windowFrame) {
        windowFrame = requestAnimationFrame(() => {
          windowFrame = 0;
          renderWindow();
        });
      }
    }, { passive: true });
    window.addEventListener("blur", () => closeMenu(false));
    document.addEventListener("scroll", (event) => {
      if (!ui.menu.contains(event.target)) {
        closeMenu(false);
      }
    }, true);

    document.addEventListener("keydown", onGlobalKeyDown);
    window.addEventListener("hashchange", loadFromHash);
    window.addEventListener("pagehide", persistNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        persistNow();
      }
    });
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", updateThemeButton);

    setupFileDrop();
    setupInstall();
  }

  function init() {
    if (!loadSaved()) {
      state.root = sampleTree();
      state.selectedId = state.root.id;
    }
    syncOptionsForm();
    ui.ignore.value = state.ignore;
    applyKeyLabels();
    updateThemeButton();
    bindEvents();
    render();
    loadFromHash();
  }

  init();
})();
