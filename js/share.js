/*!
 * TreeForge — share links.
 * Packs a tree (plus output options) into a compact, URL-safe string that lives in
 * the link's #hash, so sharing needs no server. Uses deflate when the browser has it.
 */
(function (global, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tree.js"));
  } else {
    global.TreeForge = global.TreeForge || {};
    global.TreeForge.share = factory(global.TreeForge.tree);
  }
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  const VERSION = 1;
  const MAX_DEPTH = 512;

  // Files are "name" or ["name", "note"]; folders are ["name", [children], "note"?].
  function pack(node) {
    if (T.isFolder(node)) {
      const out = [node.name, node.children.map(pack)];
      if (node.note) {
        out.push(node.note);
      }
      return out;
    }
    return node.note ? [node.name, node.note] : node.name;
  }

  function unpack(value, depth) {
    if (typeof value === "string") {
      return T.createNode("file", value);
    }
    if (!Array.isArray(value) || typeof value[0] !== "string") {
      throw new Error("Invalid share data.");
    }
    if (Array.isArray(value[1])) {
      const folder = T.createNode("folder", value[0], typeof value[2] === "string" ? value[2] : "");
      if (depth < MAX_DEPTH) {
        folder.children = value[1].map((child) => unpack(child, depth + 1));
      }
      return folder;
    }
    return T.createNode("file", value[0], typeof value[1] === "string" ? value[1] : "");
  }

  function toBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(text) {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function transform(bytes, stream) {
    const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await response.arrayBuffer());
  }

  function canCompress() {
    if (typeof CompressionStream !== "function" || typeof DecompressionStream !== "function") {
      return false;
    }
    try {
      new CompressionStream("deflate-raw");
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Returns the payload for `#tree=…`: "d" + deflated base64url, or "j" + plain base64url. */
  async function encode(root, options) {
    const json = JSON.stringify({ v: VERSION, t: pack(root), o: options || undefined });
    const bytes = new TextEncoder().encode(json);
    if (canCompress()) {
      return `d${toBase64Url(await transform(bytes, new CompressionStream("deflate-raw")))}`;
    }
    return `j${toBase64Url(bytes)}`;
  }

  async function decode(payload) {
    const text = String(payload || "");
    const kind = text[0];
    if (kind !== "d" && kind !== "j") {
      throw new Error("Unknown share format.");
    }
    let bytes = fromBase64Url(text.slice(1));
    if (kind === "d") {
      bytes = await transform(bytes, new DecompressionStream("deflate-raw"));
    }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || !("t" in data)) {
      throw new Error("Invalid share data.");
    }
    let root = unpack(data.t, 0);
    if (!T.isFolder(root)) {
      const wrapper = T.createRoot("root");
      wrapper.children.push(root);
      root = wrapper;
    }
    return { root, options: data.o && typeof data.o === "object" ? data.o : null };
  }

  return { pack, unpack, encode, decode };
});
