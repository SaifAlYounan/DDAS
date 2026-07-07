/**
 * Recursive-descent parser for the band-rule DSL.
 * Precedence: or < and < not < primary. Direct transcription of the EBNF in
 * the plan; produces the surface AST (identifiers unresolved).
 */
import { RuleError, type CmpOp, type SExpr, type SOperand } from "./ast.js";
import { tokenize, type Token, type TokenKind } from "./lexer.js";

const OPS: Record<string, CmpOp> = {
  "==": "eq",
  "!=": "ne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
};

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i]!;
  }
  private next(): Token {
    return this.tokens[this.i++]!;
  }
  private expect(kind: TokenKind): Token {
    const t = this.next();
    if (t.kind !== kind)
      throw new RuleError("parse_error", `expected ${kind}, got '${t.text || t.kind}' at ${t.pos}`, t.pos);
    return t;
  }

  parseRule(): SExpr {
    if (this.peek().kind === "else") {
      this.next();
      this.expect("eof");
      return { kind: "else" };
    }
    const expr = this.parseOr();
    this.expect("eof");
    return expr;
  }

  private parseOr(): SExpr {
    const children = [this.parseAnd()];
    while (this.peek().kind === "or") {
      this.next();
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0]! : { kind: "or", children };
  }

  private parseAnd(): SExpr {
    const children = [this.parseUnary()];
    while (this.peek().kind === "and") {
      this.next();
      children.push(this.parseUnary());
    }
    return children.length === 1 ? children[0]! : { kind: "and", children };
  }

  private parseUnary(): SExpr {
    if (this.peek().kind === "not") {
      this.next();
      return { kind: "not", child: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): SExpr {
    if (this.peek().kind === "lparen") {
      this.next();
      const inner = this.parseOr();
      this.expect("rparen");
      return inner;
    }
    return this.parsePredicate();
  }

  private parsePredicate(): SExpr {
    const left = this.parseOperand();
    const t = this.peek();
    if (t.kind === "op") {
      this.next();
      const right = this.parseOperand();
      return { kind: "cmp", left, op: OPS[t.text]!, right };
    }
    if (t.kind === "in") {
      this.next();
      const listTok = this.expect("ident");
      return { kind: "in", left, listName: listTok.text };
    }
    throw new RuleError(
      "parse_error",
      `expected a comparison or 'in' after operand, got '${t.text || t.kind}' at ${t.pos}`,
      t.pos
    );
  }

  private parseOperand(): SOperand {
    const t = this.next();
    switch (t.kind) {
      case "ident":
        return { t: "ident", name: t.text };
      case "number":
        return { t: "num", v: Number(t.text) };
      case "string":
        return { t: "str", v: t.text };
      case "true":
        return { t: "bool", v: true };
      case "false":
        return { t: "bool", v: false };
      case "not_found":
        return { t: "not_found" };
      default:
        throw new RuleError("parse_error", `expected operand, got '${t.text || t.kind}' at ${t.pos}`, t.pos);
    }
  }
}

export function parseRule(source: string): SExpr {
  return new Parser(tokenize(source)).parseRule();
}
