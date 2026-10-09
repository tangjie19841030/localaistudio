import type { PageMetrics } from "@studio/schema-core";

/** The part of PageMetrics that can only be measured inside the browser. */
export type CollectedPage = Pick<
  PageMetrics,
  "docScrollWidth" | "docClientWidth" | "elements" | "a11y" | "seo"
>;

/**
 * Browser-context collector for `page.evaluate`, as a plain STRING expression.
 *
 * Why a string and not a typed function: esbuild/tsx (keepNames) rewrites nested
 * function expressions into `__name(fn, "fn")`, and that helper does not exist in
 * the page — passing the compiled function to page.evaluate fails with
 * "ReferenceError: __name is not defined". A string is transport-safe and also
 * cannot accidentally close over module scope. Its shape is pinned by
 * `CollectedPage` at the call site and exercised by visual-collect.test.ts
 * against a fake DOM.
 *
 * It only MEASURES. Every judgement (overflow / truncation / overlap thresholds)
 * lives in schema-core's `auditPages`, so it stays unit-testable without a browser.
 *
 * Caps: MAX_ELEMENTS=500 keeps the JSON payload bounded on huge pages; only
 * elements that can actually produce an issue are considered (non-empty text →
 * truncation, interactive → overlap). MAX_DEPTH=4 keeps selectors short/stable.
 */
export const COLLECT_SCRIPT = `(() => {
  var MAX_ELEMENTS = 500;
  var MAX_DEPTH = 4;
  var MAX_TEXT = 200;
  var INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

  function segment(el) {
    var tag = el.tagName.toLowerCase();
    var parent = el.parentElement;
    if (!parent) return tag;
    var sameTag = [];
    var children = parent.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].tagName === el.tagName) sameTag.push(children[i]);
    }
    if (sameTag.length < 2) return tag;
    return tag + ":nth-of-type(" + (sameTag.indexOf(el) + 1) + ")";
  }

  function selectorOf(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.tagName !== "HTML" && parts.length < MAX_DEPTH) {
      parts.unshift(segment(cur));
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function ancestorsOf(el) {
    var out = [];
    var cur = el.parentElement;
    while (cur && cur.tagName !== "HTML") {
      out.push(selectorOf(cur));
      cur = cur.parentElement;
    }
    return out;
  }

  var root = document.documentElement;
  var body = document.body;
  var all = body ? body.querySelectorAll("*") : [];
  var elements = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var interactive = el.matches(INTERACTIVE);
    var text = (el.textContent || "").trim().slice(0, MAX_TEXT);
    if (!interactive && text === "") continue;
    var r = el.getBoundingClientRect();
    var holder = el.closest("[data-studio-id]");
    var metric = {
      selector: selectorOf(el),
      text: text,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      interactive: interactive,
      ancestorSelectors: ancestorsOf(el)
    };
    // closest(): a truncated <h3> inside a Section still maps back to the Schema node.
    // Omitted (not "") when there is no data-studio-id ancestor.
    var studioId = holder ? holder.getAttribute("data-studio-id") : null;
    if (studioId) metric.studioId = studioId;
    elements.push(metric);
    if (elements.length >= MAX_ELEMENTS) break;
  }

  return {
    docScrollWidth: root.scrollWidth,
    docClientWidth: root.clientWidth,
    elements: elements,
    a11y: collectA11y(),
    seo: collectSeo()
  };

  function collectA11y() {
    var out = [];
    if (!body) return out;
    function push(el, kind, level, name, text) {
      var entry = {
        selector: selectorOf(el),
        kind: kind,
        text: text,
        accessibleName: name
      };
      if (typeof level === "number") entry.level = level;
      var holder = el.closest("[data-studio-id]");
      var sid = holder ? holder.getAttribute("data-studio-id") : null;
      if (sid) entry.studioId = sid;
      out.push(entry);
    }
    function trim(el) { return (el.textContent || "").trim().slice(0, MAX_TEXT); }
    function imgName(el) { return (el.getAttribute("alt") || "").trim(); }
    function controlName(el) {
      var aria = (el.getAttribute("aria-label") || "").trim();
      if (aria) return aria;
      var by = el.getAttribute("aria-labelledby");
      if (by) {
        var ref = document.getElementById(by);
        if (ref) return trim(ref);
      }
      if (el.id) {
        var label = document.querySelector('label[for="' + el.id + '"]');
        if (label) return trim(label);
      }
      var tag = el.tagName;
      if (tag === "BUTTON" || el.getAttribute("role") === "button") return trim(el);
      if (tag === "INPUT") {
        var ph = (el.getAttribute("placeholder") || "").trim();
        if (ph) return ph;
      }
      return "";
    }
    function linkName(el) {
      var aria = (el.getAttribute("aria-label") || "").trim();
      if (aria) return aria;
      return trim(el);
    }
    var imgs = body.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      push(im, "image", undefined, imgName(im), "");
      if (out.length >= MAX_ELEMENTS) break;
    }
    var headings = body.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (var j = 0; j < headings.length; j++) {
      var hd = headings[j];
      var lvl = parseInt(hd.tagName.substring(1), 10);
      var txt = trim(hd);
      push(hd, "heading", lvl, txt, txt);
      if (out.length >= MAX_ELEMENTS) break;
    }
    var controls = body.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [role="button"]');
    for (var k = 0; k < controls.length; k++) {
      var c = controls[k];
      var ct = trim(c);
      push(c, "control", undefined, controlName(c), ct);
      if (out.length >= MAX_ELEMENTS) break;
    }
    var links = body.querySelectorAll("a[href]");
    for (var l = 0; l < links.length; l++) {
      var ln = links[l];
      var lt = trim(ln);
      push(ln, "link", undefined, linkName(ln), lt);
      if (out.length >= MAX_ELEMENTS) break;
    }
    return out;
  }

  function collectSeo() {
    var title = (document.title || "").trim();
    var descEl = document.querySelector('meta[name="description"]');
    var description = descEl ? (descEl.getAttribute("content") || "").trim() : "";
    var htmlEl = document.documentElement;
    var lang = htmlEl ? ((htmlEl.getAttribute("lang") || "").trim()) : "";
    var viewportEl = document.querySelector('meta[name="viewport"]');
    var h1s = body ? body.querySelectorAll("h1") : [];
    return {
      title: title,
      description: description,
      lang: lang,
      viewportMeta: !!viewportEl,
      h1Count: h1s.length
    };
  }
})()`;
