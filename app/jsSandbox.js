import { parse } from "acorn";
import { simple } from "acorn-walk";
import { analyze } from "eslint-scope";
import globals from "globals";

// Generated code is UNTRUSTED. Never evaluate it in Node (node:vm is not a
// security boundary). The legacy function name is retained for compatibility.
export function parseJavaScript(js) {
  return parse(js, { ecmaVersion: "latest", sourceType: "module", ranges: true, locations: true });
}

function scopes(js) {
  return analyze(parseJavaScript(js), { ecmaVersion: 2024, sourceType: "module" });
}

export function constReassignments(js) {
  try {
    return [...new Set(scopes(js).scopes.flatMap(scope => scope.variables)
      .filter(v => v.defs.some(d => d.kind === "const") && v.references.some(r => r.isWrite() && !r.init))
      .map(v => v.name))];
  } catch { return []; }
}

export function runCodeInSandbox(js, sourceText = js) {
  if (!js?.trim()) return { checked: false, crashed: false, error: null };
  try {
    const manager = scopes(js);
    const ast = parseJavaScript(js);
    const constants = constReassignments(js);
    if (constants.length) throw new TypeError(`Assignment to constant variable: ${constants.join(", ")}`);
    // External scripts can introduce globals which cannot be resolved statically.
    const externalScripts = /<script\b[^>]*\bsrc\s*=/i.test(sourceText);
    const allowed = new Set([...Object.keys(globals.browser), ...Object.keys(globals.es2025), "THREE"]);
    const missing = manager.globalScope.through.find(r => !allowed.has(r.identifier.name));
    if (missing && !externalScripts) throw new ReferenceError(`${missing.identifier.name} is not defined`);
    for (const scope of manager.scopes) {
      for (const variable of scope.variables) {
        const declaration = variable.defs.find(d => d.kind === "let" || d.kind === "const");
        if (!declaration) continue;
        // Do not guess when closures execute: only check reads in the same scope.
        if (variable.references.some(r => r.isRead() && r.from.variableScope === scope.variableScope && r.identifier.start < declaration.name.start)) {
          throw new ReferenceError(`Cannot access '${variable.name}' before initialization`);
        }
        for (const reference of variable.references.filter(r => r.isRead())) {
          const fn = reference.from.variableScope.block;
          if (fn.type !== "FunctionDeclaration" || !fn.id) continue;
          const functionBinding = scope.variables.find(v => v.defs.some(d => d.node === fn));
          if (functionBinding?.references.some(r => r.from.variableScope === scope.variableScope && r.identifier.start > fn.end && r.identifier.start < declaration.name.start)) {
            throw new ReferenceError(`Cannot access '${variable.name}' before initialization`);
          }
        }
      }
    }
    const addons = new Set(["OrbitControls", "GLTFLoader", "FBXLoader", "OBJLoader", "EffectComposer", "RenderPass", "UnrealBloomPass", "PointerLockControls"]);
    simple(ast, { NewExpression(node) {
      const callee = node.callee;
      if (callee.type !== "MemberExpression" || callee.computed || callee.object.name !== "THREE" || !addons.has(callee.property.name)) return;
      const localThree = manager.scopes.flatMap(s => s.variables).find(v => v.name === "THREE" && v.defs.some(d => d.type !== "ImportBinding"));
      if (localThree) return;
      const name = callee.property.name;
      const legacyAddon = [...String(sourceText).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].some(m => m[1].includes(name) && !m[1].includes("/jsm/"));
      if (!legacyAddon) throw new ReferenceError(`${name} é um addon: importe e use o binding ${name}, não THREE.${name}.`);
    } });
    return { checked: true, crashed: false, error: null };
  } catch (error) {
    return { checked: true, crashed: true, error: `${error.name}: ${error.message}`.slice(0, 500) };
  }
}
