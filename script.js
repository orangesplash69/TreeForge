const ROOT_PATH_KEY = "root";

const refs = {
  treeEditor: document.getElementById("treeEditor"),
  asciiOutput: document.getElementById("asciiOutput"),
  statsText: document.getElementById("statsText"),
  outputMeta: document.getElementById("outputMeta"),
  copyButton: document.getElementById("copyButton"),
  exportTxtButton: document.getElementById("exportTxtButton"),
  importJsonButton: document.getElementById("importJsonButton"),
  exportJsonButton: document.getElementById("exportJsonButton"),
  resetButton: document.getElementById("resetButton"),
  jsonImportInput: document.getElementById("jsonImportInput"),
  toast: document.getElementById("toast")
};

const icons = {
  folder: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h4.019a2.25 2.25 0 0 1 1.59.659l1.213 1.212a2.25 2.25 0 0 0 1.59.659H18A2.25 2.25 0 0 1 20.25 10v6A2.25 2.25 0 0 1 18 18.25H6A2.25 2.25 0 0 1 3.75 16V7.5Z"></path>
    </svg>
  `,
  file: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8.25 3.75h5.379a2.25 2.25 0 0 1 1.591.659l2.371 2.371a2.25 2.25 0 0 1 .659 1.591v9.879A2.25 2.25 0 0 1 16 20.25H8.25A2.25 2.25 0 0 1 6 18V6A2.25 2.25 0 0 1 8.25 3.75Z"></path>
      <path d="M14.25 3.75V8.25H18.75"></path>
    </svg>
  `,
  addFile: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8.25 3.75h5.379a2.25 2.25 0 0 1 1.591.659l2.371 2.371a2.25 2.25 0 0 1 .659 1.591v9.879A2.25 2.25 0 0 1 16 20.25H8.25A2.25 2.25 0 0 1 6 18V6A2.25 2.25 0 0 1 8.25 3.75Z"></path>
      <path d="M14.25 3.75V8.25H18.75"></path>
      <path d="M9 14.25H15"></path>
      <path d="M12 11.25V17.25"></path>
    </svg>
  `,
  addFolder: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h4.019a2.25 2.25 0 0 1 1.59.659l1.213 1.212a2.25 2.25 0 0 0 1.59.659H18A2.25 2.25 0 0 1 20.25 10v6A2.25 2.25 0 0 1 18 18.25H6A2.25 2.25 0 0 1 3.75 16V7.5Z"></path>
      <path d="M12 10.75V16.75"></path>
      <path d="M9 13.75H15"></path>
    </svg>
  `,
  rename: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m15.75 5.25 3 3"></path>
      <path d="M4.5 19.5 8.75 18.75 18 9.5a2.121 2.121 0 1 0-3-3L5.75 15.75 4.5 19.5Z"></path>
    </svg>
  `,
  delete: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4.5 7.5H19.5"></path>
      <path d="M9 7.5V5.625A1.875 1.875 0 0 1 10.875 3.75H13.125A1.875 1.875 0 0 1 15 5.625V7.5"></path>
      <path d="M7.5 7.5 8.25 18A2.25 2.25 0 0 0 10.494 20.25H13.506A2.25 2.25 0 0 0 15.75 18L16.5 7.5"></path>
    </svg>
  `
};

const actionConfig = {
  "add-file": { label: "Add file", icon: icons.addFile, className: "" },
  "add-folder": { label: "Add folder", icon: icons.addFolder, className: "" },
  rename: { label: "Rename", icon: icons.rename, className: "" },
  delete: { label: "Delete", icon: icons.delete, className: "node-action--danger" }
};

const state = {
  tree: createDefaultTree(),
  selectedPathKey: ROOT_PATH_KEY,
  editingPathKey: null,
  pendingFocus: null,
  dragSourcePathKey: null,
  activeDropTarget: null
};

let toastTimer = 0;

init();

function init() {
  bindToolbarEvents();
  bindTreeEvents();
  render();
}

function bindToolbarEvents() {
  refs.copyButton.addEventListener("click", handleCopyTree);
  refs.exportTxtButton.addEventListener("click", () => {
    downloadFile(generateAsciiTree(state.tree), "file-structure.txt", "text/plain;charset=utf-8");
    showToast("ASCII tree exported.");
  });
  refs.importJsonButton.addEventListener("click", () => refs.jsonImportInput.click());
  refs.exportJsonButton.addEventListener("click", () => {
    downloadFile(JSON.stringify(state.tree, null, 2), "file-structure.json", "application/json;charset=utf-8");
    showToast("JSON exported.");
  });
  refs.resetButton.addEventListener("click", () => {
    state.tree = createDefaultTree();
    state.selectedPathKey = ROOT_PATH_KEY;
    state.editingPathKey = null;
    state.pendingFocus = { pathKey: ROOT_PATH_KEY, editing: false };
    render();
    showToast("Structure reset.");
  });
  refs.jsonImportInput.addEventListener("change", handleJsonImport);
}

function bindTreeEvents() {
  refs.treeEditor.addEventListener("click", handleTreeClick);
  refs.treeEditor.addEventListener("dblclick", handleTreeDoubleClick);
  refs.treeEditor.addEventListener("keydown", handleTreeKeydown);
  refs.treeEditor.addEventListener("blur", handleRenameBlur, true);
  refs.treeEditor.addEventListener("dragstart", handleDragStart);
  refs.treeEditor.addEventListener("dragover", handleDragOver);
  refs.treeEditor.addEventListener("drop", handleDrop);
  refs.treeEditor.addEventListener("dragend", handleDragEnd);
  refs.treeEditor.addEventListener("dragleave", handleDragLeave);
}

function render() {
  renderTree();
  renderAsciiOutput();
  renderMeta();
  focusPendingTarget();
}

function renderTree() {
  refs.treeEditor.replaceChildren(createTreeNodeElement(state.tree, [], 0));
}

function renderAsciiOutput() {
  refs.asciiOutput.textContent = generateAsciiTree(state.tree);
}

function renderMeta() {
  const counts = countNodes(state.tree);
  refs.statsText.textContent = `${counts.folders} ${counts.folders === 1 ? "folder" : "folders"} • ${counts.files} ${counts.files === 1 ? "file" : "files"}`;

  const lineCount = refs.asciiOutput.textContent.split("\n").length;
  refs.outputMeta.textContent = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
}

function createTreeNodeElement(node, path, depth) {
  const pathKey = pathToKey(path);
  const isSelected = state.selectedPathKey === pathKey;
  const isEditing = state.editingPathKey === pathKey;
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-item";
  if (isSelected) {
    row.classList.add("is-selected");
  }
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(depth + 1));
  row.setAttribute("aria-selected", isSelected ? "true" : "false");
  if (node.type === "folder") {
    row.setAttribute("aria-expanded", "true");
  }
  row.dataset.path = pathKey;
  row.dataset.type = node.type;
  row.style.setProperty("--depth", String(depth));
  row.tabIndex = 0;
  row.draggable = path.length > 0 && !isEditing;

  const content = document.createElement("div");
  content.className = "tree-item__content";

  const grip = document.createElement("span");
  grip.className = "tree-item__grip";
  grip.textContent = ":::";
  content.appendChild(grip);

  const icon = document.createElement("span");
  icon.className = "tree-icon";
  icon.innerHTML = node.type === "folder" ? icons.folder : icons.file;
  content.appendChild(icon);

  if (isEditing) {
    const input = document.createElement("input");
    input.className = "rename-input";
    input.type = "text";
    input.value = node.name;
    input.dataset.path = pathKey;
    input.setAttribute("aria-label", `Rename ${node.type}`);
    content.appendChild(input);
  } else {
    const label = document.createElement("span");
    label.className = "tree-item__label";
    label.textContent = node.name;

    if (node.type === "folder") {
      const suffix = document.createElement("span");
      suffix.className = "tree-item__suffix";
      suffix.textContent = "/";
      label.appendChild(suffix);
    }

    content.appendChild(label);
  }

  row.appendChild(content);
  row.appendChild(createActions(pathKey, path.length === 0));
  wrapper.appendChild(row);

  if (node.type === "folder") {
    const children = document.createElement("div");
    children.className = "tree-children";
    children.dataset.ownerPath = pathKey;

    if (node.children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.style.setProperty("--depth", String(depth + 1));
      empty.textContent = "No items yet. Use the action buttons or drop nodes here.";
      children.appendChild(empty);
    } else {
      node.children.forEach((child, index) => {
        children.appendChild(createTreeNodeElement(child, [...path, index], depth + 1));
      });
    }

    wrapper.appendChild(children);
  }

  return wrapper;
}

function createActions(pathKey, isRoot) {
  const actions = document.createElement("div");
  actions.className = "tree-item__actions";

  const actionNames = isRoot
    ? ["add-file", "add-folder", "rename"]
    : ["add-file", "add-folder", "rename", "delete"];

  actionNames.forEach((actionName) => {
    const config = actionConfig[actionName];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `node-action ${config.className}`.trim();
    button.dataset.action = actionName;
    button.dataset.path = pathKey;
    button.setAttribute("aria-label", config.label);
    button.setAttribute("title", config.label);
    button.innerHTML = config.icon;
    actions.appendChild(button);
  });

  return actions;
}

function handleTreeClick(event) {
  const input = event.target.closest(".rename-input");
  if (input) {
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    const pathKey = actionButton.dataset.path;
    state.selectedPathKey = pathKey;

    if (action === "add-file") {
      addNode(pathKey, "file");
      return;
    }

    if (action === "add-folder") {
      addNode(pathKey, "folder");
      return;
    }

    if (action === "rename") {
      beginRename(pathKey);
      return;
    }

    if (action === "delete") {
      deleteNode(pathKey);
      return;
    }

    return;
  }

  const row = event.target.closest(".tree-item");
  if (!row) {
    return;
  }

  selectPath(row.dataset.path, true);
}

function handleTreeDoubleClick(event) {
  const row = event.target.closest(".tree-item");
  if (!row || event.target.closest("[data-action]") || event.target.closest(".rename-input")) {
    return;
  }

  beginRename(row.dataset.path);
}

function handleTreeKeydown(event) {
  const renameInput = event.target.closest(".rename-input");
  if (renameInput) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename(renameInput.dataset.path, renameInput.value);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }

    return;
  }

  const row = event.target.closest(".tree-item");
  if (!row) {
    return;
  }

  const pathKey = row.dataset.path;

  if (event.key === "Enter") {
    event.preventDefault();
    beginRename(pathKey);
  }

  if (event.key === "Delete" && pathKey !== ROOT_PATH_KEY) {
    event.preventDefault();
    deleteNode(pathKey);
  }
}

function handleRenameBlur(event) {
  const input = event.target.closest(".rename-input");
  if (!input) {
    return;
  }

  commitRename(input.dataset.path, input.value);
}

function handleDragStart(event) {
  const row = event.target.closest(".tree-item");
  if (!row || row.dataset.path === ROOT_PATH_KEY) {
    event.preventDefault();
    return;
  }

  state.dragSourcePathKey = row.dataset.path;
  row.classList.add("is-dragging");

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.path);
  }
}

function handleDragOver(event) {
  if (!state.dragSourcePathKey) {
    return;
  }

  const row = event.target.closest(".tree-item");
  if (row) {
    const position = getDropPosition(row, event.clientY);
    if (!isValidDrop(state.dragSourcePathKey, row.dataset.path, position)) {
      clearActiveDropTarget();
      return;
    }

    event.preventDefault();
    setActiveDropTarget({
      kind: "row",
      element: row,
      pathKey: row.dataset.path,
      position
    });
    return;
  }

  const children = event.target.closest(".tree-children");
  if (children) {
    const pathKey = children.dataset.ownerPath;
    if (!isValidDrop(state.dragSourcePathKey, pathKey, "inside")) {
      clearActiveDropTarget();
      return;
    }

    event.preventDefault();
    setActiveDropTarget({
      kind: "children",
      element: children,
      pathKey,
      position: "inside"
    });
    return;
  }

  if (isValidDrop(state.dragSourcePathKey, ROOT_PATH_KEY, "inside")) {
    event.preventDefault();
    setActiveDropTarget({
      kind: "root",
      element: refs.treeEditor,
      pathKey: ROOT_PATH_KEY,
      position: "inside"
    });
  }
}

function handleDrop(event) {
  if (!state.dragSourcePathKey) {
    return;
  }

  event.preventDefault();

  const target = state.activeDropTarget;
  if (target && moveNode(parsePathKey(state.dragSourcePathKey), parsePathKey(target.pathKey), target.position)) {
    render();
  }

  cleanupDragState();
}

function handleDragEnd() {
  cleanupDragState();
}

function handleDragLeave(event) {
  if (!state.dragSourcePathKey) {
    return;
  }

  if (!refs.treeEditor.contains(event.relatedTarget)) {
    clearActiveDropTarget();
  }
}

function addNode(referencePathKey, type) {
  const referencePath = parsePathKey(referencePathKey);
  const parentPath = resolveAddParentPath(referencePath);
  const parentNode = getNodeByPath(parentPath);

  if (!parentNode || parentNode.type !== "folder") {
    return;
  }

  const newNode = createNode(type, parentNode.children);
  parentNode.children.push(newNode);

  const newPath = [...parentPath, parentNode.children.length - 1];
  const newPathKey = pathToKey(newPath);

  state.selectedPathKey = newPathKey;
  state.editingPathKey = newPathKey;
  state.pendingFocus = { pathKey: newPathKey, editing: true };
  render();
}

function deleteNode(pathKey) {
  if (pathKey === ROOT_PATH_KEY) {
    return;
  }

  const path = parsePathKey(pathKey);
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parentNode = getNodeByPath(parentPath);

  if (!parentNode || parentNode.type !== "folder") {
    return;
  }

  parentNode.children.splice(index, 1);
  state.editingPathKey = null;
  state.selectedPathKey = pathToKey(parentPath);
  state.pendingFocus = { pathKey: state.selectedPathKey, editing: false };
  render();
}

function beginRename(pathKey) {
  state.selectedPathKey = pathKey;
  state.editingPathKey = pathKey;
  state.pendingFocus = { pathKey, editing: true };
  render();
}

function commitRename(pathKey, nextName) {
  if (state.editingPathKey !== pathKey) {
    return;
  }

  const trimmedName = nextName.trim();
  if (!trimmedName) {
    state.pendingFocus = { pathKey, editing: true };
    render();
    showToast("Name cannot be empty.", true);
    return;
  }

  const node = getNodeByPath(parsePathKey(pathKey));
  if (!node) {
    return;
  }

  node.name = trimmedName;
  state.editingPathKey = null;
  state.selectedPathKey = pathKey;
  state.pendingFocus = { pathKey, editing: false };
  render();
}

function cancelRename() {
  if (!state.editingPathKey) {
    return;
  }

  const pathKey = state.editingPathKey;
  state.editingPathKey = null;
  state.pendingFocus = { pathKey, editing: false };
  render();
}

function selectPath(pathKey, focusSelected) {
  const changed = state.selectedPathKey !== pathKey;
  state.selectedPathKey = pathKey;

  if (focusSelected) {
    state.pendingFocus = { pathKey, editing: false };
  }

  if (changed) {
    render();
  } else if (focusSelected) {
    focusPendingTarget();
  }
}

function moveNode(sourcePath, targetPath, position) {
  if (!sourcePath.length || isPathPrefix(sourcePath, targetPath)) {
    return false;
  }

  const sourceParentPath = sourcePath.slice(0, -1);
  const sourceIndex = sourcePath[sourcePath.length - 1];
  const sourceParent = getNodeByPath(sourceParentPath);

  if (!sourceParent || sourceParent.type !== "folder") {
    return false;
  }

  let destinationParentPath;
  let destinationIndex;

  if (position === "inside") {
    const targetNode = getNodeByPath(targetPath);
    if (!targetNode || targetNode.type !== "folder") {
      return false;
    }

    destinationParentPath = targetPath;
    destinationIndex = targetNode.children.length;
  } else {
    if (!targetPath.length) {
      return false;
    }

    destinationParentPath = targetPath.slice(0, -1);
    const targetIndex = targetPath[targetPath.length - 1];
    destinationIndex = position === "before" ? targetIndex : targetIndex + 1;
  }

  if (arePathsEqual(sourceParentPath, destinationParentPath) && sourceIndex < destinationIndex) {
    destinationIndex -= 1;
  }

  if (arePathsEqual(sourceParentPath, destinationParentPath) && sourceIndex === destinationIndex) {
    return false;
  }

  const destinationParent = getNodeByPath(destinationParentPath);
  if (!destinationParent || destinationParent.type !== "folder") {
    return false;
  }

  const [movedNode] = sourceParent.children.splice(sourceIndex, 1);
  destinationParent.children.splice(destinationIndex, 0, movedNode);

  const nextPathKey = pathToKey([...destinationParentPath, destinationIndex]);
  state.selectedPathKey = nextPathKey;
  state.editingPathKey = null;
  state.pendingFocus = { pathKey: nextPathKey, editing: false };
  return true;
}

async function handleCopyTree() {
  const asciiTree = generateAsciiTree(state.tree);

  try {
    await navigator.clipboard.writeText(asciiTree);
    showToast("ASCII tree copied to clipboard.");
  } catch (error) {
    fallbackCopy(asciiTree);
    showToast("ASCII tree copied to clipboard.");
  }
}

function handleJsonImport(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state.tree = normalizeRootTree(parsed);
      state.selectedPathKey = ROOT_PATH_KEY;
      state.editingPathKey = null;
      state.pendingFocus = { pathKey: ROOT_PATH_KEY, editing: false };
      render();
      showToast("JSON imported.");
    } catch (error) {
      showToast("Invalid JSON file.", true);
    } finally {
      refs.jsonImportInput.value = "";
    }
  };
  reader.onerror = () => {
    showToast("Could not read the selected file.", true);
    refs.jsonImportInput.value = "";
  };
  reader.readAsText(file);
}

function createDefaultTree() {
  return {
    name: "root",
    type: "folder",
    children: []
  };
}

function createNode(type, siblings) {
  const baseName = type === "folder" ? "new-folder" : "new-file.txt";
  const node = {
    name: createUniqueName(baseName, siblings),
    type
  };

  if (type === "folder") {
    node.children = [];
  }

  return node;
}

function createUniqueName(baseName, siblings) {
  const usedNames = new Set(siblings.map((item) => item.name));
  if (!usedNames.has(baseName)) {
    return baseName;
  }

  const dotIndex = baseName.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const prefix = hasExtension ? baseName.slice(0, dotIndex) : baseName;
  const extension = hasExtension ? baseName.slice(dotIndex) : "";

  let counter = 1;
  let candidate = `${prefix}-${counter}${extension}`;
  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${prefix}-${counter}${extension}`;
  }

  return candidate;
}

function normalizeRootTree(candidate) {
  const normalized = normalizeNode(candidate, "root");
  normalized.type = "folder";
  normalized.children = Array.isArray(normalized.children) ? normalized.children : [];
  return normalized;
}

function normalizeNode(candidate, fallbackName) {
  if (!candidate || typeof candidate !== "object") {
    return {
      name: fallbackName,
      type: "file"
    };
  }

  const nextName = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim()
    : fallbackName;

  const nextType = candidate.type === "folder" ? "folder" : "file";

  if (nextType === "folder") {
    const rawChildren = Array.isArray(candidate.children) ? candidate.children : [];
    return {
      name: nextName,
      type: "folder",
      children: rawChildren.map((child, index) => normalizeNode(child, `item-${index + 1}`))
    };
  }

  return {
    name: nextName,
    type: "file"
  };
}

function resolveAddParentPath(path) {
  const node = getNodeByPath(path);
  if (node && node.type === "folder") {
    return path;
  }

  return path.slice(0, -1);
}

function getNodeByPath(path) {
  let current = state.tree;

  for (const index of path) {
    if (!current || current.type !== "folder" || !current.children[index]) {
      return null;
    }

    current = current.children[index];
  }

  return current;
}

function countNodes(node) {
  if (node.type === "file") {
    return { folders: 0, files: 1 };
  }

  return node.children.reduce(
    (totals, child) => {
      const next = countNodes(child);
      return {
        folders: totals.folders + next.folders,
        files: totals.files + next.files
      };
    },
    { folders: 1, files: 0 }
  );
}

function generateAsciiTree(rootNode) {
  const lines = [`${rootNode.name}/`];

  function traverse(children, prefix) {
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const line = `${prefix}${branch}${child.name}${child.type === "folder" ? "/" : ""}`;
      lines.push(line);

      if (child.type === "folder" && child.children.length > 0) {
        traverse(child.children, `${prefix}${isLast ? "    " : "│   "}`);
      }
    });
  }

  traverse(rootNode.children, "");
  return lines.join("\n");
}

function getDropPosition(row, pointerY) {
  const rect = row.getBoundingClientRect();
  const ratio = (pointerY - rect.top) / rect.height;
  const isFolder = row.dataset.type === "folder";

  if (ratio < 0.25) {
    return "before";
  }

  if (ratio > 0.75) {
    return "after";
  }

  return isFolder ? "inside" : ratio < 0.5 ? "before" : "after";
}

function isValidDrop(sourcePathKey, targetPathKey, position) {
  const sourcePath = parsePathKey(sourcePathKey);
  const targetPath = parsePathKey(targetPathKey);

  if (!sourcePath.length) {
    return false;
  }

  if (position === "inside" && arePathsEqual(sourcePath, targetPath)) {
    return false;
  }

  if (isPathPrefix(sourcePath, targetPath)) {
    return false;
  }

  if (position === "inside") {
    const targetNode = getNodeByPath(targetPath);
    return Boolean(targetNode && targetNode.type === "folder");
  }

  return targetPath.length > 0;
}

function setActiveDropTarget(nextTarget) {
  const sameTarget = state.activeDropTarget
    && state.activeDropTarget.element === nextTarget.element
    && state.activeDropTarget.position === nextTarget.position
    && state.activeDropTarget.kind === nextTarget.kind;

  if (sameTarget) {
    return;
  }

  clearActiveDropTarget();
  state.activeDropTarget = nextTarget;

  if (nextTarget.kind === "row") {
    nextTarget.element.classList.add(`is-drop-${nextTarget.position}`);
    return;
  }

  if (nextTarget.kind === "children") {
    nextTarget.element.classList.add("is-drop-zone");
    return;
  }

  refs.treeEditor.classList.add("is-root-drop");
}

function clearActiveDropTarget() {
  if (!state.activeDropTarget) {
    refs.treeEditor.classList.remove("is-root-drop");
    return;
  }

  if (state.activeDropTarget.kind === "row") {
    state.activeDropTarget.element.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside");
  }

  if (state.activeDropTarget.kind === "children") {
    state.activeDropTarget.element.classList.remove("is-drop-zone");
  }

  if (state.activeDropTarget.kind === "root") {
    refs.treeEditor.classList.remove("is-root-drop");
  }

  state.activeDropTarget = null;
}

function cleanupDragState() {
  clearActiveDropTarget();
  const draggingRow = refs.treeEditor.querySelector(".is-dragging");
  if (draggingRow) {
    draggingRow.classList.remove("is-dragging");
  }
  state.dragSourcePathKey = null;
}

function focusPendingTarget() {
  if (!state.pendingFocus) {
    return;
  }

  const pending = state.pendingFocus;
  state.pendingFocus = null;

  requestAnimationFrame(() => {
    if (pending.editing) {
      const input = refs.treeEditor.querySelector(`.rename-input[data-path="${pending.pathKey}"]`);
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }

    const row = refs.treeEditor.querySelector(`.tree-item[data-path="${pending.pathKey}"]`);
    if (row) {
      row.focus({ preventScroll: false });
    }
  });
}

function fallbackCopy(text) {
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "true");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function showToast(message, isError) {
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  refs.toast.classList.toggle("is-error", Boolean(isError));
  refs.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    refs.toast.classList.remove("is-visible");
    window.setTimeout(() => {
      refs.toast.hidden = true;
    }, 180);
  }, 1900);
}

function pathToKey(path) {
  return path.length === 0 ? ROOT_PATH_KEY : path.join(".");
}

function parsePathKey(pathKey) {
  if (!pathKey || pathKey === ROOT_PATH_KEY) {
    return [];
  }

  return pathKey.split(".").map(Number);
}

function arePathsEqual(first, second) {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((value, index) => value === second[index]);
}

function isPathPrefix(candidatePrefix, fullPath) {
  if (candidatePrefix.length > fullPath.length) {
    return false;
  }

  return candidatePrefix.every((value, index) => value === fullPath[index]);
}
