import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import ts from "typescript";
import {createRule, isHtmlMediaType, isNullish, normalizedFilename, objectProperty, requireTypeServices, staticPropertyName, staticString, typeAt, typeContainsSafeBrand, unwrapExpression} from "../utils.js";

type Options = [{customServerFiles?: string[]}?];

export default createRule<Options, "unsafe" | "rawHtml" | "safeBodyAtStandardConstructor" | "uncheckedResponse">({
  name: "no-unsafe-html-response",
  meta: {type: "problem", docs: {description: "Disallow unsafe HTML-capable Fetch and Next responses"}, schema: [{type: "object", additionalProperties: false, properties: {
    customServerFiles: {type: "array", items: {type: "string"}, uniqueItems: true},
  }}], messages: {
    uncheckedResponse: "Returning an unchecked response can serve upstream active content under this origin. Use passiveResponse at the return boundary, or authenticate HTML and construct SafeResponse or SafeNextResponse.",
    unsafe: "A response body without a proven non-HTML content type can become HTML. Use SafeResponse or SafeNextResponse for SafeHtml and SafeStream, or select an explicit non-HTML content type.",
    rawHtml: "Raw HTML responses must be built with SafeResponse or SafeNextResponse from SafeHtml or SafeStream.",
    safeBodyAtStandardConstructor: "SafeHtml and SafeStream must be passed to SafeResponse or SafeNextResponse, not Response or NextResponse.",
  }},
  defaultOptions: [{}],
  create(context, [options]) {
    const services = requireTypeServices(context);
    const checker = services.program.getTypeChecker();
    const filename = normalizedFilename(context);
    const customServer = (options?.customServerFiles ?? []).some((suffix) => filename.endsWith(suffix.replaceAll("\\", "/")));
    const serverLocation = /\/(?:app\/(?:.*\/)?route|middleware|proxy)\.[cm]?[jt]sx?$/.test(filename) || customServer;
    const constants = new Map<string, TSESTree.Expression>();
    const mutated = new Set<string>();
    const responses: TSESTree.NewExpression[] = [];
    const returns: TSESTree.Expression[] = [];

    /** Finds locally declared functions exported as response entry points. */
    function exportedHandlers(program: TSESTree.Program): Set<ts.Node> {
      const source = services.esTreeNodeToTSNodeMap.get(program);
      const module = checker.getSymbolAtLocation(source);
      const handlers = new Set<ts.Node>();
      const seen = new Set<ts.Symbol>();
      function visit(node: ts.Node): void {
        if (node.getSourceFile() !== source) return;
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
          handlers.add(node);
        } else if (ts.isVariableDeclaration(node) && node.initializer) {
          visit(node.initializer);
        } else if (ts.isExportAssignment(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
          visit(node.expression);
        } else if (ts.isIdentifier(node)) {
          const symbol = checker.getSymbolAtLocation(node);
          if (symbol) visitSymbol(symbol);
        }
      }
      function visitSymbol(symbol: ts.Symbol): void {
        if (seen.has(symbol)) return;
        seen.add(symbol);
        if (symbol.flags & ts.SymbolFlags.Alias) visitSymbol(checker.getAliasedSymbol(symbol));
        else if (symbol.valueDeclaration) visit(symbol.valueDeclaration);
      }
      if (module) {
        for (const symbol of checker.getExportsOfModule(module)) {
          if (customServer || ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "middleware", "proxy", "default"].includes(symbol.name)) {
            visitSymbol(symbol);
          }
        }
      }
      return handlers;
    }

    /** Keeps returns in handler control flow while excluding nested functions. */
    function leavesHandler(node: TSESTree.Expression, handlers: Set<ts.Node>): boolean {
      let parent = services.esTreeNodeToTSNodeMap.get(node).parent;
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
      return handlers.has(parent);
    }

    function inspectReturn(node: TSESTree.Expression, seen = new Set<ts.Symbol>()): void {
      const expression = unwrapExpression(node);
      if (expression.type === AST_NODE_TYPES.AwaitExpression) {
        inspectReturn(expression.argument, seen);
        return;
      }
      if (expression.type === AST_NODE_TYPES.ConditionalExpression) {
        inspectReturn(expression.consequent, new Set(seen));
        inspectReturn(expression.alternate, new Set(seen));
        return;
      }
      if (expression.type === AST_NODE_TYPES.Identifier) {
        const symbol = checker.getSymbolAtLocation(services.esTreeNodeToTSNodeMap.get(expression));
        const declaration = symbol?.valueDeclaration;
        if (symbol && !seen.has(symbol) && declaration && ts.isVariableDeclaration(declaration) &&
            declaration.getSourceFile() === services.esTreeNodeToTSNodeMap.get(expression).getSourceFile() &&
            declaration.initializer && ts.isVariableDeclarationList(declaration.parent) &&
            (declaration.parent.flags & ts.NodeFlags.Const) !== 0) {
          seen.add(symbol);
          inspectReturn(services.tsNodeToESTreeNodeMap.get(declaration.initializer) as TSESTree.Expression, seen);
          return;
        }
      }
      // Constructors have their own body checks, including the safe constructors.
      if (expression.type === AST_NODE_TYPES.NewExpression) return;
      if (expression.type === AST_NODE_TYPES.CallExpression) {
        const call = services.esTreeNodeToTSNodeMap.get(expression);
        const declaration = checker.getResolvedSignature(call)?.declaration;
        const file = declaration?.getSourceFile().fileName.replaceAll("\\", "/") ?? "";
        // Native/Next static factories are covered by the installed response guard
        // and header rules. Do not exempt same-named methods on arbitrary objects.
        const callee = unwrapExpression(expression.callee);
        if (callee.type === AST_NODE_TYPES.MemberExpression &&
            ["json", "redirect", "error", "next", "rewrite"].includes(staticPropertyName(callee) ?? "") &&
            typeAt(context, callee.object).getConstructSignatures().some((signature) =>
              /^(?:Next)?Response(?:<.*>)?$/u.test(checker.typeToString(signature.getReturnType()))) &&
            (/\/typescript\/lib\/lib\.dom\.d\.ts$/u.test(file) || /\/undici-types\/fetch\.d\.ts$/u.test(file) || /\/next\/dist\/server\/web\/spec-extension\/response\.d\.ts$/u.test(file))) return;
      }
      const type = checker.getAwaitedType(typeAt(context, expression));
      const alternatives = type?.isUnion() ? type.types : type ? [type] : [];
      if (alternatives.some((candidate) => candidate.getProperty("headers") && candidate.getProperty("status") && candidate.getProperty("arrayBuffer") &&
          !typeContainsSafeBrand(candidate, ["SafeResponse", "SafeNextResponse", "PassiveResponse"]))) {
        context.report({node, messageId: "uncheckedResponse"});
      }
    }

    function isSafeResponseConstructor(node: TSESTree.Expression): boolean {
      return typeAt(context, node).getConstructSignatures().some((signature) =>
        /^(?:SafeNextResponse|SafeResponse)(?:<.*>)?$/u.test(checker.typeToString(signature.getReturnType())),
      );
    }

    function resolve(node: TSESTree.Expression, seen = new Set<string>()): TSESTree.Expression {
      const expression = unwrapExpression(node);
      if (expression.type !== AST_NODE_TYPES.Identifier || mutated.has(expression.name) || seen.has(expression.name)) return expression;
      const initializer = constants.get(expression.name);
      if (!initializer) return expression;
      seen.add(expression.name);
      return resolve(initializer, seen);
    }

    function contentType(node: TSESTree.Expression): string | null {
      const value = resolve(node);
      if (value.type === AST_NODE_TYPES.NewExpression) {
        const callee = unwrapExpression(value.callee);
        if (callee.type !== AST_NODE_TYPES.Identifier || callee.name !== "Headers") return null;
        const initializer = value.arguments[0];
        return initializer && initializer.type !== AST_NODE_TYPES.SpreadElement ? contentType(initializer) : null;
      }
      if (value.type === AST_NODE_TYPES.ObjectExpression) {
        const property = objectProperty(value, "content-type")?.value;
        return property ? staticString(resolve(property as TSESTree.Expression)) : null;
      }
      if (value.type === AST_NODE_TYPES.ArrayExpression) {
        for (const item of value.elements) {
          if (!item || item.type === AST_NODE_TYPES.SpreadElement) return null;
          const tuple = resolve(item);
          if (tuple.type !== AST_NODE_TYPES.ArrayExpression || tuple.elements.length < 2) return null;
          const [name, media] = tuple.elements;
          if (!name || !media || name.type === AST_NODE_TYPES.SpreadElement || media.type === AST_NODE_TYPES.SpreadElement) return null;
          if (staticString(resolve(name))?.toLowerCase() === "content-type") return staticString(resolve(media));
        }
      }
      return null;
    }

    function inspectResponse(node: TSESTree.NewExpression): void {
      const callee = unwrapExpression(node.callee);
      const directName = callee.type === AST_NODE_TYPES.Identifier ? callee.name : "";
      if (isSafeResponseConstructor(callee)) return;
      const calleeType = typeAt(context, callee);
      const rendered = checker.typeToString(calleeType);
      const constructsResponse = calleeType.getConstructSignatures().some((signature) => /^(?:Next)?Response(?:<.*>)?$/.test(checker.typeToString(signature.getReturnType())));
      if (directName !== "Response" && directName !== "NextResponse" && !constructsResponse && !/(?:ResponseConstructor|typeof (?:Next)?Response)\b/.test(rendered)) return;
      const body = node.arguments[0];
      if (!body || body.type === AST_NODE_TYPES.SpreadElement || isNullish(typeAt(context, body))) return;
      if (typeContainsSafeBrand(typeAt(context, body), ["SafeHtml", "SafeStream"])) {
        context.report({node: body, messageId: "safeBodyAtStandardConstructor"});
        return;
      }
      const init = node.arguments[1];
      let explicitHtml = false;
      let explicitNonHtml = false;
      if (init && init.type !== AST_NODE_TYPES.SpreadElement) {
        const resolvedInit = resolve(init as TSESTree.Expression);
        if (resolvedInit.type === AST_NODE_TYPES.ObjectExpression) {
          const headers = objectProperty(resolvedInit, "headers")?.value;
          const mediaType = headers ? contentType(headers as TSESTree.Expression) : null;
          explicitHtml = mediaType !== null && isHtmlMediaType(mediaType);
          explicitNonHtml = mediaType !== null && !explicitHtml;
        }
      }
      if (explicitHtml) context.report({node: body, messageId: "rawHtml"});
      else if (explicitNonHtml) return;
      else context.report({node: body, messageId: "unsafe"});
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type === AST_NODE_TYPES.Identifier && node.init && node.parent.type === AST_NODE_TYPES.VariableDeclaration && node.parent.kind === "const") {
          constants.set(node.id.name, node.init);
        }
      },
      AssignmentExpression(node) {
        if (node.left.type === AST_NODE_TYPES.Identifier) mutated.add(node.left.name);
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (callee.type === AST_NODE_TYPES.MemberExpression && callee.object.type === AST_NODE_TYPES.Identifier &&
            ["append", "delete", "set"].includes(staticPropertyName(callee) ?? "")) {
          mutated.add(callee.object.name);
        }
      },
      NewExpression(node) { if (serverLocation) responses.push(node); },
      ReturnStatement(node) { if (serverLocation && node.argument) returns.push(node.argument); },
      ArrowFunctionExpression(node) { if (serverLocation && node.body.type !== AST_NODE_TYPES.BlockStatement) returns.push(node.body); },
      "Program:exit"(program) {
        for (const response of responses) inspectResponse(response);
        const handlers = exportedHandlers(program);
        for (const returned of returns) {
          if (leavesHandler(returned, handlers)) inspectReturn(returned);
        }
      },
    };
  },
});
