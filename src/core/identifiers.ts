/**
 * Pull exact identifiers out of a free-text coding query:
 * class/function/file names, camelCase, snake_case, kebab paths, package names.
 * Deterministic — no model calls.
 */
export function extractIdentifiers(text: string): string[] {
  const out: string[] = [];
  // files with extensions: auth/service.ts
  const fileRe = /[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md)\b/g;
  for (const m of text.matchAll(fileRe)) out.push(m[0].replaceAll("\\", "/"));

  // identifiers: camelCase, snake_case, kebab-case, PascalCase, dotted
  const idRe = /\b[A-Za-z_][A-Za-z0-9_$]*(?:[._][A-Za-z0-9_$]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9_$]*\b|\b[A-Z][a-z]+[A-Z][A-Za-z0-9_$]*\b/g;
  for (const m of text.matchAll(idRe)) out.push(m[0]);

  // generated-style tokens containing digits (v1, f0, handler2) — only treated
  // as exact identifiers when they carry a digit, so prose stays prose
  const digitRe = /\b[A-Za-z_][A-Za-z0-9_$]*[0-9][A-Za-z0-9_$]*\b/g;
  for (const m of text.matchAll(digitRe)) out.push(m[0]);

  // quoted usages
  const qRe = /['"`]([^'"`\n]{2,80})['"`]/g;
  for (const m of text.matchAll(qRe)) out.push(m[1]);

  return [...new Set(out)].slice(0, 12);
}
