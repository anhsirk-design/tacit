import { createRequire } from "node:module";
import path from "node:path";
import { Parser, Language, type TreeCursor as TsCursor, type Node as TsNode } from "web-tree-sitter";

const require = createRequire(import.meta.url);

export interface ParsedSymbol {
  name: string;
  kind: "function" | "method" | "class" | "struct" | "interface" | "type" | "component" | "variable" | "field" | "enum" | "route" | "namespace";
  lineStart: number; // 1-based, inclusive
  lineEnd: number;   // 1-based, inclusive
  parent: string | null;
  signature?: string;
}

export interface ParsedRef {
  kind: "imports" | "calls" | "extends" | "implements" | "references" | "route";
  targetName: string;
  /** position of the reference, 1-based */
  line: number;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  refs: ParsedRef[];
  routes: ParsedRef[]; // framework routes detected (e.g. app.get("/x"))
}

type Lang = "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "rust" | "java";

const EXT_LANG: Record<string, Lang> = {
  ".ts": "ts", ".mts": "ts", ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js", ".mjs": "js", ".cjs": "js",
  ".jsx": "jsx",
  ".py": "py",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
};

export function langForPath(p: string): Lang | null {
  return EXT_LANG[path.extname(p).toLowerCase()] ?? null;
}

let parser: Parser | null = null;
const langCache = new Map<Lang, Language>();

async function ensureParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  parser = new Parser();
  return parser;
}

async function lang(l: Lang): Promise<Language | null> {
  const hit = langCache.get(l);
  if (hit) return hit;
  const wasmName =
    l === "py" ? "python" :
    l === "rust" ? "rust" :
    l === "ts" || l === "tsx" ? "typescript" :
    l === "js" || l === "jsx" ? "javascript" :
    l; // go, java map directly
  // fallback: some tree-sitter-wasms versions ship a short alias name
  const wasmCandidates = [wasmName, wasmName === "javascript" ? "js" : wasmName];
  try {
    for (const candidate of wasmCandidates) {
      try {
        const wasmPath = require.resolve(`tree-sitter-wasms/out/tree-sitter-${candidate}.wasm`);
        const loaded = await Language.load(wasmPath);
        langCache.set(l, loaded);
        return loaded;
      } catch {
        // try next candidate name
      }
    }
    return null; // graceful degradation: skip unparseable language
  } catch {
    return null;
  }
}

/** Parse one file into symbols and references. Returns null when the language is unsupported. */
export async function parseFile(
  filePath: string,
  source: string
): Promise<ParseResult | null> {
  const l = langForPath(filePath);
  if (!l) return null;
  const p = await ensureParser();
  const g = await lang(l);
  if (!g) return null;
  p.setLanguage(g);
  const tree = p.parse(source);
  if (!tree) return null;

  const symbols: ParsedSymbol[] = [];
  const refs: ParsedRef[] = [];
  const routes: ParsedRef[] = [];
  const stack: { name: string; kind: ParsedSymbol["kind"] }[] = [];

  const cursor = tree.walk();
  if (!cursor) return null;
  walk(cursor, 0);

  function walk(c: TsCursor, depth: number): void {
    const node = c.currentNode;
    const type = node.type;
    const named = node.isNamed;

    if (type === "function_declaration" || type === "arrow_function" || type === "function_definition" || type === "function_item") {
      const name = declaratorName(node, l);
      if (named && name) {
        symbols.push(mk(name, "function", node, stack));
        stack.push({ name, kind: "function" });
        descend(c, depth);
        stack.pop();
        return;
      }
    }

    if (type === "method_definition" || type === "method_declaration" || type === "function_signature_item") {
      const name = declaratorName(node, l);
      if (name) {
        symbols.push(mk(name, "method", node, stack));
        stack.push({ name, kind: "method" });
        descend(c, depth);
        stack.pop();
        return;
      }
    }

    if (
      type === "class_declaration" || type === "class_definition" || type === "struct_item" ||
      type === "trait_item" || type === "impl_item" || type === "type_alias_declaration" ||
      type === "type_declaration" || type === "interface_declaration" || type === "enum_declaration" ||
      type === "protocol_declaration" || type === "impl_declaration"
    ) {
      const name = declaratorName(node, l);
      if (name) {
        const kind: ParsedSymbol["kind"] =
          type.includes("interface") ? "interface" :
          type.includes("struct") ? "struct" :
          type.includes("enum") ? "enum" :
          type.includes("type_alias") || type.includes("type_declaration") ? "type" : "class";
        symbols.push(mk(name, kind, node, stack));
        stack.push({ name, kind });
        descend(c, depth);
        stack.pop();
        return;
      }
    }

    if (type === "variable_declarator" || type === "assignment" || type === "const_item") {
      // const X = () => ... or const X = something (keep only function-ish top-level decls)
      const name = node.childForFieldName("name")?.text ?? declaratorName(node, l);
      const value = node.childForFieldName("value");
      const isFn = value && /^(arrow_function|function|function_expression|lambda|closure_expression)/.test(value.type);
      if (name && !stack.length) {
        const text = node.text ?? "";
        const looksComponent = /^[A-Z]/.test(name) && (l === "tsx" || l === "jsx");
        const jsx = text.includes("<") && text.includes(">");
        symbols.push(mk(name, isFn && jsx ? "component" : isFn ? "function" : "variable", node, stack));
        if (isFn && !jsx) {
          stack.push({ name, kind: "function" });
          descend(c, depth);
          stack.pop();
          return;
        }
      }
    }

    if (type === "import_statement" || type === "import_declaration" || type === "use_declaration" || type === "class_identifier" && named === false) {
      const src = node.text?.match(/['"]([^'"]+)['"]/)?.[1];
      if (src) {
        refs.push({ kind: "imports", targetName: src, line: node.startPosition.row + 1 });
        return c.gotoNextSibling() ? walk(c, depth) : undefined;
      }
      // Rust `use` or single import leaf: capture the import path text
      if (type === "use_declaration") {
        refs.push({ kind: "imports", targetName: node.text.replace(/^use\s+|;$/g, ""), line: node.startPosition.row + 1 });
        return;
      }
    }

    if (type === "call_expression" || type === "call") {
      const fn = node.childForFieldName("function") ?? node.namedChildren[0];
      if (fn) {
        const t = fn.text;
        if (t && !/^(if|for|while|switch|catch|return|new)$/.test(t)) {
          if (/^(get|post|put|patch|delete|use|head|options)\s*\(\s*['"]/.test(node.text)) {
            const m = node.text.match(/['"]([^'"]+)['"]/);
            if (m) routes.push({ kind: "route", targetName: m[1], line: node.startPosition.row + 1 });
          }
          refs.push({ kind: "calls", targetName: t.split("(")[0], line: node.startPosition.row + 1 });
        }
      }
    }

    if (type === "extends_clause" || type === "class_heritage") {
      for (const ch of node.namedChildren) {
        if (!ch) continue;
        if (ch.type === "identifier" || ch.type === "type_identifier") {
          refs.push({ kind: "extends", targetName: ch.text, line: ch.startPosition.row + 1 });
        }
      }
    }

    if (type === "implements_clause" || type === "type_heritage") {
      for (const ch of node.namedChildren) {
        if (!ch) continue;
        refs.push({ kind: "implements", targetName: ch.text, line: ch.startPosition.row + 1 });
      }
    }

    descend(c, depth);
  }

  function descend(c: TsCursor, depth: number): void {
    if (c.gotoFirstChild()) {
      walk(c, depth + 1);
      while (c.gotoNextSibling()) walk(c, depth + 1);
      c.gotoParent();
    }
  }

  function mk(
    name: string,
    kind: ParsedSymbol["kind"],
    node: TsNode,
    stack: { name: string }[]
  ): ParsedSymbol {
    return {
      name,
      kind,
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      parent: stack.length ? stack[stack.length - 1].name : null,
      signature: firstLine(node.text ?? "").slice(0, 120),
    };
  }

  // filter self-calls noise: a symbol's name should not be its own call target within itself
  return { symbols, refs: dedupeRefs(refs), routes: dedupeRefs(routes) };
}

function declaratorName(node: TsNode, l: Lang | null): string | null {
  void l;
  let f = node.childForFieldName("name") ??
    node.childForFieldName("declarator") ??
    node.childForFieldName("item") ??
    node.childForFieldName("abstract");
  if (!f) {
    for (const c of node.namedChildren) {
      if (c && c.type.includes("identifier")) { f = c; break; }
    }
  }
  if (!f) return null;
  return f.text?.split("(")[0] ?? null;
}

function firstLine(s: string): string {
  const i = s.indexOf("\n");
  return i === -1 ? s : s.slice(0, i);
}

function dedupeRefs(refs: ParsedRef[]): ParsedRef[] {
  const seen = new Set<string>();
  const out: ParsedRef[] = [];
  for (const r of refs) {
    const key = `${r.kind}|${r.targetName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
