import ts from "typescript";
import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import {createRule, literalStrings, requireTypeServices, staticString, unwrapExpression} from "../utils.js";

export default createRule({
  name: "no-object-url",
  meta: {type: "problem", docs: {description: "Require checked passive object URL creation"}, schema: [], messages: {
    nativeObjectUrl: "Use createPassiveObjectUrl from next-xss-sbyd/object-url instead of native URL.createObjectURL. MediaSource requires a separately reviewed exception.",
    unverifiedObjectUrl: "Cannot verify that this createObjectURL is not the native API. Use createPassiveObjectUrl from next-xss-sbyd/object-url or add a justified disable.",
  }},
  defaultOptions: [],
  create(context) {
    const services = requireTypeServices(context);
    const checker = services.program.getTypeChecker();

    const reportedReferences = new Set<TSESTree.Node>();

    function isNative(type: ts.Type): boolean {
      return type.getCallSignatures().some((signature) => {
        const declaration = signature.getDeclaration();
        return declaration !== undefined && ts.isMethodSignature(declaration) &&
          ts.isIdentifier(declaration.name) && declaration.name.text === "createObjectURL" &&
          services.program.isSourceFileDefaultLibrary(declaration.getSourceFile());
      });
    }

    function checkReference(node: TSESTree.MemberExpression | TSESTree.Property, receiver: TSESTree.Node, key: TSESTree.Node) {
      const name = !node.computed && key.type === AST_NODE_TYPES.Identifier ? key.name : staticString(key);
      if (name !== "createObjectURL" && (name !== null ||
          !literalStrings(services.getTypeAtLocation(key))?.includes("createObjectURL"))) return;
      const receiverType = services.getTypeAtLocation(receiver);
      // TypeScript also represents unresolved/error receivers as Any.
      if ((receiverType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
        context.report({node, messageId: "unverifiedObjectUrl"});
        return;
      }
      const property = receiverType.getProperty("createObjectURL");
      if (!property) return;
      const type = checker.getTypeOfSymbolAtLocation(property, services.esTreeNodeToTSNodeMap.get(node));
      if (isNative(type)) {
        context.report({node, messageId: "nativeObjectUrl"});
        reportedReferences.add(node);
      }
    }

    return {
      "CallExpression:exit"(node) {
        let target = unwrapExpression(node.callee);
        if (target.type === AST_NODE_TYPES.MemberExpression) {
          const member = !target.computed && target.property.type === AST_NODE_TYPES.Identifier ?
            target.property.name : staticString(target.property);
          if (member === "call" || member === "apply" || member === "bind") target = unwrapExpression(target.object);
        }
        // Keep checking native-typed functions supplied by other modules or callers.
        // A direct member call already reports its reference; an alias invocation
        // may report in addition to the place where the alias was acquired.
        if (!reportedReferences.has(target) && isNative(services.getTypeAtLocation(target))) {
          context.report({node, messageId: "nativeObjectUrl"});
        }
      },
      MemberExpression(node) {
        checkReference(node, node.object, node.property);
      },
      Property(node) {
        if (node.parent.type !== AST_NODE_TYPES.ObjectPattern) return;
        const pattern = node.parent;
        const receiver = pattern.parent.type === AST_NODE_TYPES.AssignmentExpression && pattern.parent.left === pattern ?
          pattern.parent.right : pattern;
        checkReference(node, receiver, node.key);
      },
    };
  },
});
