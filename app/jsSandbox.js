import vm from "node:vm";

/**
 * An object/function that accepts any property access or call and returns
 * more of itself, so a fake THREE/DOM API never throws "X is not a
 * function" just because our stub doesn't happen to model that specific
 * method. This matters because we want the sandbox to only ever surface
 * real JS-language errors (ReferenceError, const reassignment, TDZ) —
 * never a false positive caused by our own stub being incomplete.
 */
function permissive() {
  const fn = function permissiveCallable() {
    return permissive();
  };
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "then" || prop === "constructor") return undefined;
      if (typeof prop === "symbol") return undefined;
      if (!(prop in target)) target[prop] = permissive();
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    construct() {
      return permissive();
    },
    apply() {
      return permissive();
    },
  });
}

/**
 * Three.js classes that live in separate addon/example files, not the core
 * build — the single most common mistake seen across this project's local-
 * model testing (referencing THREE.OrbitControls, THREE.GLTFLoader, etc.
 * without ever importing/loading the addon that defines it, which throws
 * the moment it's constructed). A blanket-permissive THREE stub can't catch
 * this — it would happily pretend OrbitControls exists too. So these
 * specific names are left undefined on the stub unless the answer's own
 * source actually references a matching import/script URL for them.
 */
const KNOWN_ADDON_CLASSES = [
  "OrbitControls",
  "TrackballControls",
  "FirstPersonControls",
  "PointerLockControls",
  "FlyControls",
  "MapControls",
  "ArcballControls",
  "GLTFLoader",
  "FBXLoader",
  "OBJLoader",
  "MTLLoader",
  "DRACOLoader",
  "KTX2Loader",
  "RGBELoader",
  "EffectComposer",
  "RenderPass",
  "UnrealBloomPass",
  "ShaderPass",
  "OutlinePass",
  "TransformControls",
  "DragControls",
  "CSS2DRenderer",
  "CSS3DRenderer",
  "BufferGeometryUtils",
  "SkeletonUtils",
];

function detectAvailableAddons(sourceText) {
  const urls = [
    ...[...String(sourceText || "").matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...String(sourceText || "").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
  ];
  const available = new Set();
  for (const name of KNOWN_ADDON_CLASSES) {
    if (urls.some((url) => url.includes(name))) available.add(name);
  }
  return available;
}

function buildThreeStub(availableAddons) {
  const base = permissive();
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === "string" && KNOWN_ADDON_CLASSES.includes(prop) && !availableAddons.has(prop)) {
        return undefined;
      }
      return target[prop];
    },
  });
}

function buildSandboxGlobals(availableAddons) {
  const document = {
    createElement: () => permissive(),
    getElementById: () => permissive(),
    body: permissive(),
    documentElement: permissive(),
    addEventListener: () => {},
  };
  const globals = {
    THREE: buildThreeStub(availableAddons),
    document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    alert: () => {},
    Math,
    JSON,
    Date,
  };
  // Real browsers expose window as the global object itself (window.window
  // === window); generated code inconsistently uses bare globals or
  // window.-prefixed ones, so both must resolve the same way.
  globals.window = globals;
  return globals;
}

function stripImportsAndExports(js) {
  return js
    .replace(/^\s*import\s[^\n]*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+/gm, "");
}

/**
 * Actually runs the local model's generated JS in a sandboxed context with
 * a permissive fake THREE/DOM, instead of guessing at bug patterns. A
 * permissive stub never throws on its own, so any exception that surfaces
 * is a genuine language-level bug (ReferenceError from an undeclared
 * variable, TDZ, const reassignment, a real syntax error, ...) — the kind
 * of runtime-only mistake `node --check` structurally cannot see, caught
 * with much higher confidence than a regex heuristic.
 */
export function runCodeInSandbox(js, sourceText = js) {
  if (!js || !js.trim()) return { checked: false, crashed: false, error: null };

  const context = vm.createContext(buildSandboxGlobals(detectAvailableAddons(sourceText)));
  const stripped = stripImportsAndExports(js);
  try {
    vm.runInContext(stripped, context, { timeout: 2000, displayErrors: false });
    return { checked: true, crashed: false, error: null };
  } catch (error) {
    const detail = `${error.name || "Error"}: ${error.message || String(error)}`.slice(0, 500);
    return { checked: true, crashed: true, error: detail };
  }
}
