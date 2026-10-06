/*!
 * TreeForge — tiny in-browser test runner.
 * Provides global `test(name, fn)` and `assert.*`, then runs everything on load
 * and shows the results on the page. No tools needed: just open tests/index.html.
 */
(function () {
  "use strict";

  const tests = [];

  class AssertionError extends Error {}

  function show(value) {
    if (value instanceof RegExp || typeof value === "function") {
      return String(value);
    }
    if (value === undefined) {
      return "undefined";
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  function fail(message, details) {
    throw new AssertionError(message ? `${message}\n${details}` : details);
  }

  function deepEqual(a, b) {
    if (Object.is(a, b)) {
      return true;
    }
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
      return false;
    }
    if (Array.isArray(a) !== Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
      return false;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length
      && keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }

  function checkError(error, expected, message) {
    if (expected instanceof RegExp && !expected.test(String(error))) {
      fail(message, `The error didn't match ${expected}:\n${String(error)}`);
    }
  }

  window.assert = {
    ok(value, message) {
      if (!value) {
        fail(message, `Expected a truthy value, got ${show(value)}`);
      }
    },
    equal(actual, expected, message) {
      if (!Object.is(actual, expected)) {
        fail(message, `Expected:\n${show(expected)}\nGot:\n${show(actual)}`);
      }
    },
    notEqual(actual, expected, message) {
      if (Object.is(actual, expected)) {
        fail(message, `Expected something other than ${show(expected)}`);
      }
    },
    deepEqual(actual, expected, message) {
      if (!deepEqual(actual, expected)) {
        fail(message, `Expected:\n${show(expected)}\nGot:\n${show(actual)}`);
      }
    },
    match(actual, pattern, message) {
      if (typeof actual !== "string" || !pattern.test(actual)) {
        fail(message, `Expected to match ${pattern}:\n${show(actual)}`);
      }
    },
    doesNotMatch(actual, pattern, message) {
      if (typeof actual !== "string" || pattern.test(actual)) {
        fail(message, `Expected not to match ${pattern}:\n${show(actual)}`);
      }
    },
    throws(fn, expected, message) {
      try {
        fn();
      } catch (error) {
        checkError(error, expected, message);
        return;
      }
      fail(message, "Expected the function to throw.");
    },
    async rejects(promise, expected, message) {
      try {
        await (typeof promise === "function" ? promise() : promise);
      } catch (error) {
        checkError(error, expected, message);
        return;
      }
      fail(message, "Expected the promise to reject.");
    }
  };

  window.test = function test(name, fn) {
    const script = document.currentScript;
    const suite = script ? script.src.split("/").pop().replace(/\.test\.js$/, "") : "tests";
    tests.push({ suite, name, fn });
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  async function run() {
    const results = document.getElementById("results");
    const summary = document.getElementById("summary");
    let passed = 0;
    let failed = 0;
    let currentSuite = null;
    let list = null;

    for (const entry of tests) {
      if (entry.suite !== currentSuite) {
        currentSuite = entry.suite;
        results.appendChild(element("h2", "", currentSuite));
        list = results.appendChild(element("ul", "results"));
      }
      const item = list.appendChild(element("li", "", entry.name));
      try {
        await entry.fn();
        passed += 1;
        item.className = "pass";
      } catch (error) {
        failed += 1;
        item.className = "fail";
        item.appendChild(element("pre", "", error instanceof AssertionError ? error.message : String(error && error.stack || error)));
      }
    }

    summary.textContent = `${passed} passed, ${failed} failed (${tests.length} tests)`;
    summary.className = failed ? "fail" : "pass";
    document.title = `${failed ? "✗" : "✓"} TreeForge tests`;
    window.testResults = { passed, failed, total: tests.length };
  }

  window.addEventListener("load", run);
})();
