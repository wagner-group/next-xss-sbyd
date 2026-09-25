import ts from "typescript";
import {AST_NODE_TYPES} from "@typescript-eslint/utils";
import {createRule, requireTypeServices, staticString, unwrapExpression} from "../utils.js";

export default createRule({
  name: "no-object-url",
  meta: {type: "problem", docs: {description: "Require checked passive object URL creation"}, schema: [], messages: {
    nativeObjectUrl: "Use createPassiveObjectUrl from next-xss-sbyd/object-url instead of native URL.createObjectURL. MediaSource requires a separately reviewed exception.",
  }},
  defaultOptions: [],
  create(context) {
    const services = requireTypeServices(context);
    const checker = services.program.getTypeChecker();
    return {
      CallExpression(node) {
        let target = unwrapExpression(node.callee);
        if (target.type === AST_NODE_TYPES.MemberExpression) {
          const member = !target.computed && target.property.type === AST_NODE_TYPES.Identifier ?
            target.property.name : staticString(target.property);
          if (member === "call" || member === "apply") target = target.object;
        }
        const callee = services.esTreeNodeToTSNodeMap.get(target);
        // Looking at the function's declarations preserves identity through
        // aliases and destructuring, without treating user methods as native.
        const signatures = checker.getTypeAtLocation(callee).getCallSignatures();
        const native = signatures.some((signature) => {
          const declaration = signature.getDeclaration();
          if (!declaration || !ts.isMethodSignature(declaration) ||
              !ts.isIdentifier(declaration.name) || declaration.name.text !== "createObjectURL") return false;
          return services.program.isSourceFileDefaultLibrary(declaration.getSourceFile());
        });
        if (native) context.report({node, messageId: "nativeObjectUrl"});
      },
    };
  },
});
