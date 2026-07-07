/**
 * RFC 8785 pinning: targeted vectors from the RFC's Appendix B sample and its
 * number/string serialization tables, restricted to I-JSON data (which is all
 * this repo ever canonicalizes — schema-enforced).
 */
import { describe, expect, it } from "vitest";
import { canonicalize, contentHash } from "./jcs.js";

describe("RFC 8785 canonicalization", () => {
  it("serializes the Appendix B string with RFC escaping", () => {
    // RFC 8785 Appendix B "string" member: euro sign, dollar, U+000F,
    // newline, A, apostrophe, B, quote, backslash, backslash, quote, slash.
    // Built from code points so this source file holds no raw control chars.
    const input = [0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f]
      .map((c) => String.fromCharCode(c))
      .join("");
    const expected = String.raw`"€$\u000f\nA'B\"\\\\\"/"`;
    expect(canonicalize(input)).toBe(expected);
  });

  it("serializes numbers per ECMAScript Number::toString (RFC Appendix B forms)", () => {
    expect(canonicalize([333333333.33333329, 1e30, 4.5, 0.002, 1e-27])).toBe(
      "[333333333.3333333,1e+30,4.5,0.002,1e-27]"
    );
    expect(canonicalize({ a: 1000000, b: 1.5, c: 0.0001, d: -0 })).toBe(
      '{"a":1000000,"b":1.5,"c":0.0001,"d":0}'
    );
  });

  it("sorts keys by UTF-16 code units", () => {
    expect(canonicalize({ b: 1, a: 2, A: 3, "é": 4 })).toBe('{"A":3,"a":2,"b":1,"é":4}');
  });

  it("nests and sorts recursively", () => {
    expect(canonicalize({ x: [1, { z: "s", y: true }], w: null })).toBe(
      '{"w":null,"x":[1,{"y":true,"z":"s"}]}'
    );
  });

  it("is whitespace- and key-order-insensitive (same hash)", () => {
    const a = { x: [1, 2, { z: "s", y: true }], w: null };
    const b = { w: null, x: [1, 2, { y: true, z: "s" }] };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ a: Infinity })).toThrow();
    expect(() => canonicalize({ a: NaN })).toThrow();
  });

  it("hash format is sha256-prefixed hex", () => {
    expect(contentHash({})).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
