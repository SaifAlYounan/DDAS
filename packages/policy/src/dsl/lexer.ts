import { RuleError } from "./ast.js";

export type TokenKind =
  | "ident"
  | "number"
  | "string"
  | "lparen"
  | "rparen"
  | "op" // == != < <= > >=
  | "and"
  | "or"
  | "not"
  | "in"
  | "else"
  | "true"
  | "false"
  | "not_found"
  | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  pos: number;
}

const KEYWORDS: Record<string, TokenKind> = {
  and: "and",
  or: "or",
  not: "not",
  in: "in",
  else: "else",
  true: "true",
  false: "false",
  NOT_FOUND: "not_found",
};

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen", text: "(", pos: i++ });
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen", text: ")", pos: i++ });
      continue;
    }
    if (c === "=" || c === "!" || c === "<" || c === ">") {
      const two = source.slice(i, i + 2);
      if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
        tokens.push({ kind: "op", text: two, pos: i });
        i += 2;
        continue;
      }
      if (c === "<" || c === ">") {
        tokens.push({ kind: "op", text: c, pos: i++ });
        continue;
      }
      throw new RuleError("parse_error", `unexpected '${c}' at ${i}`, i);
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = "";
      while (j < n && source[j] !== quote) {
        if (source[j] === "\\" && j + 1 < n) {
          out += source[j + 1];
          j += 2;
        } else {
          out += source[j];
          j++;
        }
      }
      if (j >= n) throw new RuleError("parse_error", `unterminated string at ${i}`, i);
      tokens.push({ kind: "string", text: out, pos: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(source[i + 1] ?? ""))) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(source.slice(i))!;
      tokens.push({ kind: "number", text: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      const word = m[0];
      tokens.push({ kind: KEYWORDS[word] ?? "ident", text: word, pos: i });
      i += word.length;
      continue;
    }
    throw new RuleError("parse_error", `unexpected '${c}' at ${i}`, i);
  }
  tokens.push({ kind: "eof", text: "", pos: n });
  return tokens;
}
