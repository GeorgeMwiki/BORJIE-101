"use client";

/**
 * 34. code-block — syntax-highlight + copy for SQL / log / JSON / etc.
 *
 * Hand-rolled minimal tokeniser — no Shiki / Prism dependency. Highlights
 * keywords, strings, numbers, and comments with CSS classes. The brain
 * uses this for query inspections, audit-log slices, and CLI snippets.
 */

import { useMemo, useState } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { CodeBlockPartSchema } from "../schemas";

export type CodeBlockProps = AgUiUiPartByKind<"code-block">;

const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "and",
  "or",
  "not",
  "null",
  "is",
  "in",
  "as",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "on",
  "group",
  "by",
  "order",
  "having",
  "limit",
  "offset",
  "insert",
  "into",
  "update",
  "set",
  "delete",
  "create",
  "table",
  "alter",
  "drop",
  "with",
  "union",
  "values",
  "returning",
  "distinct",
  "case",
  "when",
  "then",
  "else",
  "end",
]);

const TS_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
  "export",
  "import",
  "from",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "this",
  "super",
  "extends",
  "implements",
  "async",
  "await",
  "yield",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "instanceof",
  "true",
  "false",
  "null",
  "undefined",
  "void",
  "readonly",
  "public",
  "private",
  "protected",
]);

const PY_KEYWORDS = new Set([
  "def",
  "class",
  "return",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "try",
  "except",
  "finally",
  "with",
  "as",
  "import",
  "from",
  "pass",
  "break",
  "continue",
  "lambda",
  "yield",
  "global",
  "nonlocal",
  "raise",
  "in",
  "is",
  "not",
  "and",
  "or",
  "True",
  "False",
  "None",
  "async",
  "await",
]);

interface Token {
  readonly text: string;
  readonly cls: string;
}

function tokenise(line: string, language: string): ReadonlyArray<Token> {
  const tokens: Token[] = [];
  if (language === "json") {
    const re =
      /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?)|(true|false|null)|([{}\[\],:])/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > lastIdx)
        tokens.push({ text: line.slice(lastIdx, m.index), cls: "" });
      if (m[1]) tokens.push({ text: m[1], cls: "text-emerald-700" });
      else if (m[2]) tokens.push({ text: m[2], cls: "text-amber-700" });
      else if (m[3]) tokens.push({ text: m[3], cls: "text-violet-700" });
      else tokens.push({ text: m[4]!, cls: "text-muted-foreground" });
      lastIdx = re.lastIndex;
    }
    if (lastIdx < line.length)
      tokens.push({ text: line.slice(lastIdx), cls: "" });
    return tokens;
  }

  if (language === "log") {
    if (/\b(error|fatal|panic)\b/i.test(line))
      return [{ text: line, cls: "text-destructive" }];
    if (/\b(warn|warning)\b/i.test(line))
      return [{ text: line, cls: "text-amber-700" }];
    if (/\b(info|debug)\b/i.test(line))
      return [{ text: line, cls: "text-muted-foreground" }];
    return [{ text: line, cls: "" }];
  }

  let keywordSet: Set<string> | null = null;
  if (language === "sql") keywordSet = SQL_KEYWORDS;
  else if (language === "typescript") keywordSet = TS_KEYWORDS;
  else if (language === "python") keywordSet = PY_KEYWORDS;

  if (!keywordSet) return [{ text: line, cls: "" }];

  // tokenise: comment, string, number, ident, other
  const re =
    /(--[^\n]*|\/\/[^\n]*|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > lastIdx)
      tokens.push({ text: line.slice(lastIdx, m.index), cls: "" });
    if (m[1]) tokens.push({ text: m[1], cls: "text-muted-foreground" });
    else if (m[2]) tokens.push({ text: m[2], cls: "text-emerald-700" });
    else if (m[3]) tokens.push({ text: m[3], cls: "text-amber-700" });
    else if (m[4]) {
      const lower = m[4].toLowerCase();
      const isKw = keywordSet.has(lower) || keywordSet.has(m[4]);
      tokens.push({
        text: m[4],
        cls: isKw ? "text-violet-700 font-medium" : "",
      });
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < line.length)
    tokens.push({ text: line.slice(lastIdx), cls: "" });
  return tokens;
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
  const parsed = CodeBlockPartSchema.safeParse(props);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => props.code.split("\n"), [props.code]);
  const highlight = useMemo(
    () => new Set(props.highlightLines ?? []),
    [props.highlightLines],
  );

  if (!parsed.success) {
    return (
      <GenUiError
        kind="code-block"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  async function doCopy(): Promise<void> {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(props.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <Frame kind="code-block" {...(props.title ? { title: props.title } : {})}>
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {props.filename ? <code>{props.filename}</code> : null}
          {props.filename ? " · " : ""}
          <span>{props.language}</span>
        </span>
        <button
          type="button"
          onClick={doCopy}
          className="rounded border border-border bg-surface px-2 py-0.5"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="m-0 max-h-96 overflow-auto rounded border border-border bg-surface-sunken p-2 text-[12px] leading-5">
        <code>
          {lines.map((line, i) => {
            const lineNum = i + 1;
            const isHl = highlight.has(lineNum);
            const tokens = tokenise(line, props.language);
            return (
              <div key={i} className={isHl ? "bg-amber-100/60" : ""}>
                <span className="mr-2 inline-block w-7 select-none text-right text-muted-foreground">
                  {lineNum}
                </span>
                {tokens.map((t, ti) => (
                  <span key={ti} className={t.cls}>
                    {t.text}
                  </span>
                ))}
              </div>
            );
          })}
        </code>
      </pre>
    </Frame>
  );
}
