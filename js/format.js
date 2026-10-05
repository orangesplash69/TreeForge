/*!
 * TreeForge — text output.
 * Turns a tree into `tree`-style text (Unicode or ASCII), an indented list or a Markdown list.
 */
(function (global, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tree.js"));
  } else {
    global.TreeForge = global.TreeForge || {};
    global.TreeForge.format = factory(global.TreeForge.tree);
  }
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  const GLYPHS = {
    unicode: { tee: "├── ", elbow: "└── ", pipe: "│   ", gap: "    " },
    ascii: { tee: "|-- ", elbow: "`-- ", pipe: "|   ", gap: "    " },
    indent: { tee: "", elbow: "", pipe: "  ", gap: "  " }
  };

  const STYLES = ["unicode", "ascii", "indent", "markdown"];

  const DEFAULT_OPTIONS = Object.freeze({
    style: "unicode",
    showRoot: true,
    trailingSlash: true,
    showNotes: true,
    summary: false
  });

  const BOOLEAN_OPTIONS = ["showRoot", "trailingSlash", "showNotes", "summary"];

  // Notes on very long lines don't drag every other note to the far right.
  const NOTE_COLUMN_LIMIT = 60;

  function normalizeOptions(input) {
    const source = input && typeof input === "object" ? input : {};
    const options = { ...DEFAULT_OPTIONS };
    if (STYLES.includes(source.style)) {
      options.style = source.style;
    }
    for (const key of BOOLEAN_OPTIONS) {
      if (typeof source[key] === "boolean") {
        options[key] = source[key];
      }
    }
    return options;
  }

  function displayName(node, options) {
    const { name } = node;
    if (!options.trailingSlash || !T.isFolder(node) || /[\\/]$/.test(name) || name === "." || name === "..") {
      return name;
    }
    return `${name}/`;
  }

  function codeSpan(text) {
    const runs = text.match(/`+/g) || [];
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    const fence = "`".repeat(longest + 1);
    return longest ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
  }

  function collectLines(root, options) {
    const lines = [];
    const markdown = options.style === "markdown";
    const glyphs = GLYPHS[options.style] || GLYPHS.unicode;
    const label = (node) => (markdown ? codeSpan(displayName(node, options)) : displayName(node, options));

    if (options.showRoot) {
      lines.push({ text: markdown ? `- ${label(root)}` : label(root), note: root.note });
    }

    const visit = (children, prefix, level) => {
      children.forEach((child, index) => {
        const last = index === children.length - 1;
        const text = markdown
          ? `${"  ".repeat(level)}- ${label(child)}`
          : `${prefix}${last ? glyphs.elbow : glyphs.tee}${label(child)}`;
        lines.push({ text, note: child.note });
        if (T.isFolder(child) && child.children.length) {
          visit(child.children, prefix + (last ? glyphs.gap : glyphs.pipe), level + 1);
        }
      });
    };

    // The indent style has no branch glyphs, so children need an explicit offset under the root.
    const startPrefix = options.style === "indent" && options.showRoot ? glyphs.pipe : "";
    visit(root.children, startPrefix, options.showRoot ? 1 : 0);
    return lines;
  }

  function lineWidth(text) {
    let width = 0;
    for (const _char of text) {
      width += 1;
    }
    return width;
  }

  function formatTree(root, input) {
    const options = normalizeOptions(input);
    const markdown = options.style === "markdown";
    const lines = collectLines(root, options);

    let column = 0;
    if (options.showNotes && !markdown) {
      for (const line of lines) {
        if (line.note) {
          column = Math.max(column, Math.min(lineWidth(line.text), NOTE_COLUMN_LIMIT));
        }
      }
    }

    let text = lines
      .map((line) => {
        if (!options.showNotes || !line.note) {
          return line.text;
        }
        if (markdown) {
          return `${line.text} — ${line.note}`;
        }
        const padding = Math.max(2, column - lineWidth(line.text) + 2);
        return `${line.text}${" ".repeat(padding)}# ${line.note}`;
      })
      .join("\n");

    if (options.summary) {
      const { folders, files } = T.countNodes(root);
      const summary = `${folders} ${folders === 1 ? "directory" : "directories"}, ${files} ${files === 1 ? "file" : "files"}`;
      text = text ? `${text}\n\n${summary}` : summary;
    }
    return text;
  }

  /** Wraps output in a fenced code block (Markdown lists are already Markdown). */
  function toMarkdown(text, style) {
    if (!text) {
      return "";
    }
    if (style === "markdown") {
      return `${text}\n`;
    }
    const runs = text.match(/`{3,}/g) || [];
    const fence = "`".repeat(runs.reduce((max, run) => Math.max(max, run.length), 2) + 1);
    return `${fence}text\n${text}\n${fence}\n`;
  }

  return {
    STYLES,
    DEFAULT_OPTIONS,
    normalizeOptions,
    formatTree,
    toMarkdown
  };
});
