import ts from "typescript";
import {AST_NODE_TYPES, type TSESLint} from "@typescript-eslint/utils";
import {calleeName, createRule, isStringLike, requireTypeServices, typeAt, typeContainsSafeBrand, unwrapExpression} from "../utils.js";

export default createRule({
  name: "no-unsafe-api-send",
  meta: {type: "problem", docs: {description: "Disallow raw and safe HTML bodies at ordinary Node and Pages response sinks"}, fixable: "code", schema: [], messages: {
    unsafe: "Do not write a raw text or byte response. Use response.safeSend or response.safeEnd for SafeHtml inside withSafeApiRoute, res.json for JSON, or an explicitly typed non-HTML helper.",
    safeBody: "Safe values cannot be passed to send, end, or write. Use response.safeSend or response.safeEnd for SafeHtml, safePipe for SafeNodeStream, or SafeResponse for SafeStream.",
  }},
  defaultOptions: [],
  create(context) {
    const services = requireTypeServices(context);
    const checker = services.program.getTypeChecker();
    return {
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        const name = calleeName(callee);
        if (name !== "send" && name !== "write" && name !== "end") return;
        if (callee.type === AST_NODE_TYPES.MemberExpression && callee.computed && callee.property.type !== AST_NODE_TYPES.Literal) return;
        const argument = node.arguments[0];
        if (!argument || argument.type === AST_NODE_TYPES.SpreadElement) return;
        const bodyType = typeAt(context, argument);
        const safeBody = typeContainsSafeBrand(bodyType, ["SafeHtml", "SafeStream", "SafeNodeStream"]);
        const byteBody = /\b(?:ArrayBuffer|ArrayBufferView|Buffer|DataView|Uint8Array)\b/u.test(checker.typeToString(bodyType));
        if (!isStringLike(bodyType) && !byteBody && !safeBody) return;
        const receiver = callee.type === AST_NODE_TYPES.MemberExpression ? callee.object : null;
        const receiverType = typeAt(context, receiver ?? callee);
        const targetType = checker.typeToString(receiverType);
        const statusCode = receiverType.getProperty("statusCode");
        const nodeResponse = statusCode?.declarations?.some((declaration) => /\/@types\/node\/(?:http|http2)\.d\.ts$/u.test(declaration.getSourceFile().fileName.replaceAll("\\", "/")));
        if (!nodeResponse && !/(?:NextApiResponse|ServerResponse|Http2ServerResponse|\bSend<)/u.test(targetType)) return;
        const htmlOnly = !(bodyType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) &&
          (bodyType.isUnion() ? bodyType.types.every((part) => typeContainsSafeBrand(part, ["SafeHtml"])) : typeContainsSafeBrand(bodyType, ["SafeHtml"]));
        const replacement = name === "send" ? "safeSend" : "safeEnd";
        const safeMethod = receiverType.getProperty(replacement);
        const callSite = services.esTreeNodeToTSNodeMap.get(callee);
        const safeMethodType = safeMethod ? checker.getTypeOfSymbolAtLocation(safeMethod, callSite) : null;
        const compatibleSignature = safeMethodType?.getCallSignatures().some((signature) =>
          node.arguments.every((value, index) => {
            if (value.type === AST_NODE_TYPES.SpreadElement) return false;
            const parameter = signature.parameters[index];
            if (!parameter) return false;
            return checker.isTypeAssignableTo(typeAt(context, value), checker.getTypeOfSymbolAtLocation(parameter, callSite));
          }));
        const canFix = htmlOnly && name !== "write" && callee.type === AST_NODE_TYPES.MemberExpression &&
          !callee.optional && !node.optional && compatibleSignature &&
          (name === "send" ? node.arguments.length === 1 : node.arguments.length <= 2);
        context.report({
          node: argument,
          messageId: safeBody ? "safeBody" : "unsafe",
          ...(canFix ? {fix(fixer: TSESLint.RuleFixer) {
            return fixer.replaceText(callee.property, callee.computed ? JSON.stringify(replacement) : replacement);
          }} : {}),
        });
      },
    };
  },
});
