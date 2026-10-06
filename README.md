# 🌳 TreeForge

Build a file and folder structure visually and turn it into a clean ASCII tree, like the one the `tree` command prints. Paste it into a README, a pull request, docs or a chat.

```
my-project/
├── src/
│   ├── components/
│   │   └── Button.jsx
│   ├── app.js  # entry point
│   └── utils.js
├── package.json
└── README.md
```

TreeForge is 100% static HTML, CSS and JavaScript: no backend, no build step, no npm, no dependencies, nothing to run in the background. It runs entirely in your browser, and nothing you type, paste or open is uploaded anywhere.

---

## 🌐 Live demo

👉 https://orangesplash.de/treeforge/

---

## ✨ Features

**Editing**
* Visual tree editor: add, rename, duplicate, delete, collapse and expand
* Drag and drop to move items, or use the keyboard (`Alt` + arrows)
* Notes: type `app.js # entry point` while renaming. Notes show up as aligned comments in the output.
* Paths: type `src/lib/util.js` to create the missing folders in one go, or end a name with `/` to turn it into a folder
* Sort A–Z (folders first) for the whole tree or one folder
* Undo / redo for every change
* Full keyboard support (press `?` in the app for the list)

**Output**
* Styles: Unicode (`├──`), ASCII (`|--`), plain indentation, or a Markdown list
* Options: show/hide the root, trailing `/` on folders, notes, and a `tree`-style summary line
* Copy as plain text or as a Markdown code block
* Download as `.txt`, `.md` or `.json`

**Import**
* Paste existing `tree` output (Linux/macOS, `--charset ascii`, Windows `tree /f` and `/a`), indented lists, Markdown lists, plain path lists (`src/app.js`), or JSON
* JSON can be TreeForge's own export, `tree -J` output, or a nested object like `{ "src": { "app.js": null } }`
* Open or drop a real folder to read its structure, with an ignore list (`node_modules, .git, *.log`, …)

**Everything else**
* Autosaves in your browser (`localStorage`). Nothing is sent to a server.
* Share links: the whole tree is compressed into the link itself (`#tree=…`), so sharing needs no server either
* Light and dark theme (follows your system, with a manual toggle)
* Installable as an app (PWA) that works offline
* Stays fast with large trees: the editor only renders visible rows, and imports are capped at 20,000 items

---

## 🚀 Installation

There is nothing to build, install or start. Pick whichever suits you:

### 1. Just open it

Download or clone the repository and double-click `index.html`. Everything except offline mode and "Install app" works straight from disk. Browsers only allow those two on websites.

### 2. Put it on any web space

Upload the files as-is to any web server or static host, such as shared hosting via FTP, Apache, nginx, GitHub Pages, Netlify or Cloudflare Pages. It can live in a subfolder (for example `/treeforge/`); all paths are relative. No PHP, Node, database or server configuration is needed.

Files to upload:

```
index.html
manifest.webmanifest
sw.js
css/
js/
icons/
```

(`tests/` and `README.md` aren't needed by the app and can be left out.)

### 3. Install it as an app

Open the hosted version (over `https://`) and click **Install** in the toolbar, or use your browser's *Install app* / *Add to Home Screen*. It then opens in its own window and works offline.

---

## ⌨️ Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `↑` `↓` | Move the selection |
| `←` `→` | Collapse / expand, or go to parent / first child |
| `Enter` / `F2` | Rename |
| `N` / `Shift` `N` | New file / new folder |
| `Delete` | Delete |
| `Space` | Collapse or expand a folder |
| `Alt` `↑` `↓` | Move up / down |
| `Alt` `←` `→` | Move out of a folder / into the folder above |
| `Shift` `F10` or right-click | More actions |
| `Ctrl` `Z` / `Ctrl` `Shift` `Z` | Undo / redo (`⌘` on macOS) |
| `?` | Shortcuts and tips |

---

## 📄 JSON format

**Export JSON** writes plain nested objects, and **Import** reads them back. The format is compatible with files exported by the previous version of TreeForge.

```json
{
  "name": "my-project",
  "type": "folder",
  "children": [
    { "name": "src", "type": "folder", "children": [
      { "name": "app.js", "type": "file", "note": "entry point" }
    ] },
    { "name": "README.md", "type": "file" }
  ]
}
```

---

## 🛠 Development

Plain HTML, CSS and JavaScript with no tooling. The scripts are classic (non-module) scripts, so the app also works from `file://`. Edit a file, reload the page, done.

```
index.html            page markup and icon sprite
css/app.css           styles and light/dark theme tokens
js/tree.js            tree model: create, move, rename, sort… (pure, no DOM)
js/format.js          tree → text (Unicode, ASCII, indent, Markdown)
js/parse.js           text / JSON / paths → tree (importers)
js/share.js           share-link encoding (compressed, URL-safe)
js/app.js             user interface
sw.js                 service worker for offline use
manifest.webmanifest  app manifest for installing
tests/index.html      unit tests — open in a browser to run them
```

To run the tests, open `tests/index.html` in your browser (directly from disk works too). The page lists every test and shows a pass/fail summary at the top.

If you add, rename or remove a file the app loads, update the `ASSETS` list in `sw.js` and bump its `VERSION`.

---

## 🔒 Privacy

* No backend, no analytics, no external requests. Fonts and icons are built in.
* Your tree is saved only in your own browser's local storage.
* Folders you open are read locally; only names are used, never file contents.
* Share links carry the tree in the part of the URL after `#`, which browsers don't send to the server.

---

## 📜 License

MIT
