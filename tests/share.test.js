(function () {
  "use strict";

  const { tree: T, share: S } = window.TreeForge;

  function sample() {
    const root = T.createRoot("my-app");
    root.note = "demo";
    const src = T.createNode("folder", "src", "code");
    src.children.push(T.createNode("file", "app.js", "entry point"), T.createNode("file", "ünïcödé ✓.md"));
    root.children.push(src, T.createNode("file", "README.md"), T.createNode("folder", "empty"));
    return root;
  }

  test("pack/unpack round-trips structure and notes", () => {
    const root = sample();
    assert.deepEqual(T.toJSON(S.unpack(S.pack(root), 0)), T.toJSON(root));
    assert.deepEqual(S.pack(root.children[1]), "README.md");
    assert.deepEqual(S.pack(root.children[2]), ["empty", []]);
  });

  test("encode/decode round-trips through a URL-safe string", async () => {
    const root = sample();
    const options = { style: "ascii", summary: true };
    const payload = await S.encode(root, options);
    assert.match(payload, /^[dj][A-Za-z0-9_-]+$/);

    const decoded = await S.decode(payload);
    assert.deepEqual(T.toJSON(decoded.root), T.toJSON(root));
    assert.deepEqual(decoded.options, options);
  });

  test("compresses large trees", async () => {
    const root = T.createRoot("big");
    for (let i = 0; i < 500; i += 1) {
      root.children.push(T.createNode("file", `component-${i}.tsx`));
    }
    const payload = await S.encode(root);
    assert.equal(payload[0], "d");
    assert.ok(payload.length < JSON.stringify(S.pack(root)).length / 3);
  });

  test("decode rejects damaged links", async () => {
    await assert.rejects(S.decode(""));
    await assert.rejects(S.decode("xabc"));
    await assert.rejects(S.decode("dAAAA"));
    await assert.rejects(S.decode(`j${btoa('{"v":1}').replace(/=+$/, "")}`));
  });
})();
