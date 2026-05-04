/* eslint-env node */
"use strict";

const BANNED_MATH_MEMBERS = new Set([
  "PI",
  "E",
  "LN2",
  "LN10",
  "LOG2E",
  "LOG10E",
  "SQRT2",
  "SQRT1_2",
  "floor",
  "ceil",
  "round",
  "sqrt",
  "cbrt",
  "pow",
  "exp",
  "log",
  "log2",
  "log10",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "hypot",
  "sign",
  "trunc",
  "fround",
  "random",
]);

const BANNED_NUMBER_MEMBERS = new Set([
  "EPSILON",
  "MAX_VALUE",
  "MIN_VALUE",
  "parseFloat",
]);

const BANNED_GLOBALS = new Set(["parseFloat"]);

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban floating-point arithmetic in deterministic sim/mapgen code.",
    },
    messages: {
      decimalLiteral: "Decimal literal '{{raw}}' produces a float — use integers.",
      exponentLiteral:
        "Exponent literal '{{raw}}' may produce a float — use integers.",
      divOperator:
        "'/' produces a float — use idiv(a,b) from sim/math for integer division.",
      mathMember:
        "Math.{{name}} is banned in sim/mapgen — it is float-producing.",
      numberMember:
        "Number.{{name}} is banned in sim/mapgen — it is float-related.",
      globalParseFloat:
        "parseFloat() is banned in sim/mapgen — it produces a float.",
      jsonParse:
        "JSON.parse() is banned in sim/mapgen — data ingestion happens at boundaries, not inside the deterministic core.",
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "number") return;
        const raw = node.raw;
        if (raw === undefined) return;
        // Hex/binary/octal literals (0x..., 0b..., 0o...) are integer
        // by JS spec — skip the decimal/exponent checks. Hex digits
        // include `e` / `E` (e.g. `0x9e3779b1`), which would otherwise
        // false-positive the exponent test.
        const lower = raw.toLowerCase();
        if (
          lower.startsWith("0x") ||
          lower.startsWith("0b") ||
          lower.startsWith("0o") ||
          lower.startsWith("-0x") ||
          lower.startsWith("-0b") ||
          lower.startsWith("-0o")
        ) {
          return;
        }
        if (raw.includes(".")) {
          context.report({
            node,
            messageId: "decimalLiteral",
            data: { raw },
          });
        } else if (raw.includes("e") || raw.includes("E")) {
          context.report({
            node,
            messageId: "exponentLiteral",
            data: { raw },
          });
        }
      },
      BinaryExpression(node) {
        if (node.operator === "/") {
          context.report({ node, messageId: "divOperator" });
        }
      },
      AssignmentExpression(node) {
        if (node.operator === "/=") {
          context.report({ node, messageId: "divOperator" });
        }
      },
      MemberExpression(node) {
        if (
          node.object &&
          node.object.type === "Identifier" &&
          node.property &&
          node.property.type === "Identifier"
        ) {
          if (
            node.object.name === "Math" &&
            BANNED_MATH_MEMBERS.has(node.property.name)
          ) {
            context.report({
              node,
              messageId: "mathMember",
              data: { name: node.property.name },
            });
          } else if (
            node.object.name === "Number" &&
            BANNED_NUMBER_MEMBERS.has(node.property.name)
          ) {
            context.report({
              node,
              messageId: "numberMember",
              data: { name: node.property.name },
            });
          } else if (
            node.object.name === "JSON" &&
            node.property.name === "parse"
          ) {
            context.report({ node, messageId: "jsonParse" });
          }
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          BANNED_GLOBALS.has(node.callee.name)
        ) {
          context.report({ node, messageId: "globalParseFloat" });
        }
      },
    };
  },
};
