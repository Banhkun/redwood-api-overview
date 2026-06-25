#!/usr/bin/env node
// Runs at Netlify build time.
// Fetches the Redwood package-tree page and writes pkg-tree.json
// so the browser never has to parse it at runtime.

import { writeFileSync } from "fs";
import { parseArgs } from "util";

const BASE =
  "https://documentation.runmyjobs.cloud/2025.3/Content/apidocs/com/redwood/scheduler/api/model/";

const { values: args } = parseArgs({
  options: { out: { type: "string", default: "pkg-tree.json" } },
});

// ── parser (mirrors the browser-side logic) ──────────────────────

function parseLi(el, doc) {
  // el is a plain object produced by the lightweight HTML walker below
  const directLinks = el.children.filter((c) => c.tag === "a");
  const childUl = el.children.find((c) => c.tag === "ul");

  let name = "";
  let href = null;
  let kind = "class";
  let alsoExtends = [];

  if (directLinks.length > 0) {
    const primary =
      directLinks.find((a) => (a.cls || "").includes("type-name-link")) ||
      directLinks[0];
    name = text(primary).trim();
    href = primary.attrs?.href ?? null;
    const title = primary.attrs?.title ?? "";
    kind = /interface/i.test(title) ? "interface" : "class";
    alsoExtends = directLinks
      .filter((a) => a !== primary)
      .map((a) => ({ name: text(a).trim(), href: a.attrs?.href ?? null }))
      .filter((a) => a.name);
  } else {
    const clone = textWithoutUl(el);
    name = clone
      .trim()
      .replace(/^com\.redwood\.scheduler\.api\.model\./, "");
    kind = "external";
  }

  const children = childUl
    ? childUl.children
        .filter((c) => c.tag === "li")
        .map((c) => parseLi(c, doc))
    : [];

  return { name, href, kind, alsoExtends, children };
}

function text(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;
  return (node.children || []).map(text).join("");
}

function textWithoutUl(node) {
  if (node.type === "text") return node.value;
  if (node.tag === "ul") return "";
  return (node.children || []).map(textWithoutUl).join("");
}

function parsePackageTree(html) {
  const doc = parseHtml(html);
  const result = { classHierarchy: [], interfaceHierarchy: [] };

  function assign(h2node, ulnode) {
    if (!h2node || !ulnode) return;
    const label = text(h2node).toLowerCase();
    const roots = ulnode.children
      .filter((c) => c.tag === "li")
      .map((c) => parseLi(c, doc));
    if (label.includes("interface")) result.interfaceHierarchy = roots;
    else result.classHierarchy = roots;
  }

  // Try <section class="hierarchy"> first
  const sections = findAll(doc, (n) =>
    n.tag === "section" && (n.cls || "").includes("hierarchy"),
  );

  if (sections.length > 0) {
    for (const sec of sections) {
      const h2 = findFirst(sec, (n) => n.tag === "h2");
      const ul = findFirst(sec, (n) => n.tag === "ul");
      assign(h2, ul);
    }
  } else {
    const h2s = findAll(doc, (n) => n.tag === "h2");
    for (const h2 of h2s) {
      // walk siblings until we hit a ul
      const parent = h2._parent;
      if (!parent) continue;
      const idx = parent.children.indexOf(h2);
      let ul = null;
      for (let i = idx + 1; i < parent.children.length; i++) {
        if (parent.children[i].tag === "ul") { ul = parent.children[i]; break; }
      }
      assign(h2, ul);
    }
  }

  return result;
}

// ── tiny HTML walker (no external deps) ──────────────────────────

function parseHtml(html) {
  // We only need the tree structure + tag/class/href/title/text.
  // A full parser would be overkill; this regex-based walker is
  // sufficient for the well-formed Javadoc output we're targeting.
  const root = { tag: "root", children: [], attrs: {}, cls: "" };
  const stack = [root];

  const re =
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith("<!--")) continue;

    if (m[4] !== undefined) {
      // text node
      const v = m[4];
      if (v.trim())
        stack[stack.length - 1].children.push({ type: "text", value: decodeEntities(v) });
      continue;
    }

    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrsRaw = m[3];

    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].tag === tag)
        stack.pop();
      continue;
    }

    const attrs = parseAttrs(attrsRaw);
    const node = {
      tag,
      attrs,
      cls: attrs.class || "",
      children: [],
      _parent: stack[stack.length - 1],
    };
    stack[stack.length - 1].children.push(node);

    const VOID = new Set([
      "area","base","br","col","embed","hr","img","input",
      "link","meta","param","source","track","wbr",
    ]);
    if (!VOID.has(tag) && !attrsRaw.trimEnd().endsWith("/"))
      stack.push(node);
  }
  return root;
}

function parseAttrs(raw) {
  const out = {};
  const re = /([a-zA-Z_:][^\s=]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null)
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function findFirst(node, pred) {
  if (pred(node)) return node;
  for (const c of node.children || []) {
    const found = findFirst(c, pred);
    if (found) return found;
  }
  return null;
}

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children || []) findAll(c, pred, out);
  return out;
}

// ── main ─────────────────────────────────────────────────────────

async function main() {
  const url = BASE + "package-tree.html";
  console.log(`Fetching ${url} …`);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RedwoodApiExplorer/1.0)" },
    redirect: "follow",
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status} — aborting`);
    process.exit(1);
  }

  const html = await res.text();
  console.log(`Parsing …`);
  const tree = parsePackageTree(html);

  const classCount =
    tree.classHierarchy.length + tree.interfaceHierarchy.length;
  if (classCount === 0) {
    console.error("Parsed tree is empty — check selectors against the live page");
    process.exit(1);
  }

  const payload = { generatedAt: new Date().toISOString(), ...tree };
  writeFileSync(args.out, JSON.stringify(payload));
  console.log(
    `Written ${args.out}  (${tree.classHierarchy.length} class roots, ` +
    `${tree.interfaceHierarchy.length} interface roots)`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
