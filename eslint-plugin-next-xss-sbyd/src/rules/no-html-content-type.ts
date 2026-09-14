import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import {isPassiveMediaType, parsedMediaType} from "next-xss-sbyd/passive-content";
import {calleeName, createRule, isAnyType, isHtmlMediaType, literalStrings, objectProperty, requireTypeServices, staticString, typeAt, unwrapExpression} from "../utils.js";

function inspectHeaderValue(context: Context, header: string | null, value: TSESTree.Node): void {
  const name = header?.toLowerCase();
  if (name !== "content-type" && name !== "x-content-type-options") return;
  const media = staticString(value);
  if (name === "x-content-type-options") {
    if (media?.trim().toLowerCase() !== "nosniff") context.report({node: value, messageId: "nosniff"});
  } else if (media === null) {
    context.report({node: value, messageId: "dynamic"});
  } else if (parsedMediaType(media) === null) {
    context.report({node: value, messageId: "invalidMedia"});
  } else if (isHtmlMediaType(parsedMediaType(media)!)) {
    context.report({node: value, messageId: "html"});
  } else if (!isPassiveMediaType(media)) {
    context.report({node: value, messageId: "active"});
  }
}
type Message = "html" | "active" | "dynamic" | "remove" | "dynamicRemoval" | "invalidMedia" | "nosniff";
type Context = import("../utils.js").RuleContext<Message>;

function methodNames(context: Context, callee: TSESTree.Expression, name: string | null): string[] | null {
  if (callee.type !== AST_NODE_TYPES.MemberExpression || !callee.computed) return name === null ? null : [name];
  const property = unwrapExpression(callee.property);
  const literal = staticString(property);
  return literal === null ? literalStrings(typeAt(context, property)) : [literal];
}

function isHeaders(type: ReturnType<typeof typeAt>): boolean {
  if (type.isUnion()) return type.types.some(isHeaders);
  return isAnyType(type) || type.getProperty("getSetCookie") !== undefined;
}

function mayDeleteHeader(context: Context, callee: TSESTree.Expression): boolean {
  if (callee.type !== AST_NODE_TYPES.MemberExpression) return false;
  return isHeaders(typeAt(context, callee.object).getNonNullableType());
}

function deletionHeaderNames(context: Context, key: TSESTree.CallExpressionArgument): string[] | null {
  const argument = key.type === AST_NODE_TYPES.SpreadElement ? key : unwrapExpression(key);
  const literal = staticString(argument);
  const names = literal === null ? literalStrings(typeAt(context, argument)) : [literal];
  return names?.map(name => name.toLowerCase()) ?? null;
}

function create(context: Context) {
  requireTypeServices(context);
  return {
    CallExpression(node: TSESTree.CallExpression) {
      const name = calleeName(node.callee);
      const callee = unwrapExpression(node.callee);
      const deletionNames = methodNames(context, callee, name);
      if ((deletionNames?.includes("removeHeader") ||
          ((deletionNames === null || deletionNames.includes("delete")) && mayDeleteHeader(context, callee))) &&
          node.arguments.length >= 1) {
        const key = node.arguments[0]!;
        const headers = deletionHeaderNames(context, key);
        if (headers === null || headers.includes("content-type") || headers.includes("x-content-type-options")) {
          context.report({node: key, messageId: headers === null ? "dynamicRemoval" : "remove"});
        }
      }
      if ((name === "setHeader" || name === "set" || name === "append") && node.arguments.length >= 2) {
        inspectHeaderValue(context, staticString(node.arguments[0]!), node.arguments[1]!);
      }
      if (name === "writeHead") {
        const headers = node.arguments.length >= 3 ? node.arguments[2] : node.arguments[1];
        if (!headers || (node.arguments.length === 2 && staticString(headers) !== null)) return;
        if (headers.type === AST_NODE_TYPES.ObjectExpression) inspectObject(context, headers);
        else context.report({node: headers, messageId: "dynamic"});
      }
    },
    NewExpression(node: TSESTree.NewExpression) {
      const init = node.arguments[1];
      if (init?.type !== AST_NODE_TYPES.ObjectExpression) return;
      const headers = objectProperty(init, "headers")?.value;
      if (headers?.type === AST_NODE_TYPES.ObjectExpression) inspectObject(context, headers);
    },
  };
}
function inspectObject(context: Context, object: TSESTree.ObjectExpression): void {
  for (const property of object.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    const key = property.key;
    const name = key.type === AST_NODE_TYPES.Identifier ? key.name : key.type === AST_NODE_TYPES.Literal ? String(key.value) : null;
    inspectHeaderValue(context, name, property.value);
  }
}

export default createRule({
  name: "no-html-content-type",
  meta: {type: "problem", docs: {description: "Disallow unsafe content types and removal of response security headers"}, schema: [], messages: {
    html: "Do not manually set an HTML Content-Type. The response wrapper sets it for authenticated HTML.",
    active: "Content-Type not known to be passive (unable to execute JavaScript during browser navigation). Use a reviewed passive type or an explicit security-reviewed exception.",
    dynamic: "Do not compute Content-Type dynamically; use the response wrapper or an explicit non-HTML response.",
    invalidMedia: "Use a valid Content-Type with a type, subtype, and well-formed parameters; empty or invalid values permit HTML sniffing.",
    nosniff: "Set X-Content-Type-Options to the literal nosniff to prevent HTML sniffing.",
    remove: "Do not remove Content-Type or X-Content-Type-Options; these headers prevent response bodies from being sniffed as HTML.",
    dynamicRemoval: "Do not remove a dynamically named response header; it may remove Content-Type or X-Content-Type-Options.",
  }},
  defaultOptions: [],
  create,
});
