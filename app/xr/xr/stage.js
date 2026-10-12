// The 3D stage of Aurora XR: one three.js scene for every device.
// - 3D (PC, phone, tablet, a headset's 2D browser): the miniature on a desk, orbit with mouse/touch,
//   and on a phone the view can follow the device's movement (gyroscope).
// - MR (headset, passthrough): the room is real; the miniature goes on a real table (hit-test, anchored
//   and remembered between sessions where the headset allows), the panel floats at arm's reach and
//   comes along when you walk; hands are tracked (pinch, poke, open palm to call the panel).
// - VR: the same, in a calm virtual room with a table.
// - AR (phone): the camera view; tap a surface to put the miniature there; the screen is the panel.
// In every mode the miniature is alive (lib/dynamics.js): things move as they do (people, vehicles,
// animals of a scene), a finger or a held thing pushes them, and anything picked up (pinch or grip
// near it, or pulled with the ray; the mouse or a finger on a screen) grows in the hand to be seen up
// close and, let go, flies back to its place.
import * as THREE from "../vendor/three.module.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { Panel3D } from "./panel3d.js";
import { buildTwin, label } from "./twin3d.js";
import { buildScene } from "./scene3d.js";
import { Assets, play } from "./assets.js";
import { Pinch, Summon, HeadMotion, palmFacesHead, twoHand, lazyFollow, ease } from "../lib/gestures.js";
import { makeBody, stepBodies, behave, returnArc } from "../lib/dynamics.js";

const JOINTS = ["wrist", "thumb-tip", "index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip", "index-finger-metacarpal", "pinky-finger-metacarpal",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal",
  "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal"];
const ANCHOR_KEY = "aurora-xr-anchor";
const v3 = (v) => [v.x, v.y, v.z];
const INSPECT = 0.14;          // metres: the largest side of a thing held to be seen up close
const NEAR = 0.035;            // metres from a thing's edge where a pinch or a grip takes it directly
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Stage {
  constructor({ canvas, profile, storage, onPick, onPanelAction, onTracking, onModeChange }) {
    Object.assign(this, { canvas, profile, storage, onPick, onPanelAction, onTracking, onModeChange });
    this.mode = "3d"; this.follow = true; this.placing = false; this.twinVisible = true;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    // A headset draws the edges of the view at lower resolution, where the eye does not look.
    this.renderer.xr.setFoveation?.(1);
    this.assets = new Assets();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 60);
    this.camera.position.set(0, 0.42, 0.62);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.02, 0); this.controls.enableDamping = true; this.controls.minDistance = 0.18; this.controls.maxDistance = 3;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.scene.add(new THREE.HemisphereLight(0xe6ecff, 0x1a2040, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.6, 1.4, 0.8); this.scene.add(sun);

    // The desk (3D) and the room (VR).
    this.desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.5, 0.03, 64), new THREE.MeshStandardMaterial({ color: 0x151c3a, roughness: 0.9 }));
    top.position.y = -0.024; this.desk.add(top);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.0025, 6, 96), new THREE.MeshBasicMaterial({ color: 0x4bd9c4 }));
    glow.rotation.x = Math.PI / 2; glow.position.y = -0.009; this.desk.add(glow);
    this.scene.add(this.desk);
    this.room = this.makeRoom(); this.room.visible = false; this.scene.add(this.room);

    // The miniature: a holder that is moved, turned and scaled; its content rebuilt with the data.
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.twin = null; this.bodies = []; this.holds = new Map(); this.returning = []; this.mouse = null;
    // Where a hand or a ray would take something: a ring under it.
    this.hoverRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), new THREE.MeshBasicMaterial({ color: 0x4bd9c4, transparent: true, opacity: 0.9 }));
    this.hoverRing.rotation.x = Math.PI / 2; this.hoverRing.visible = false; this.hoverRing.raycast = () => {}; this.scene.add(this.hoverRing);
    // The panel (only in a headset's immersive modes).
    this.panel = new Panel3D({ width: profile.panel.width, onAction: (a, arg) => this.onPanelAction?.(a, arg) });
    this.panel.object.visible = false; this.scene.add(this.panel.object);
    // Where the miniature would go (MR/AR placing).
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.062, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4bd9c4 }));
    this.reticle.matrixAutoUpdate = false; this.reticle.visible = false; this.scene.add(this.reticle);

    this.inputs = [0, 1].map((i) => this.makeInput(i));
    this.raycaster = new THREE.Raycaster();
    // Lines (the plate's rim, the rays) are not targets: the default 1 m line tolerance would catch them first.
    this.raycaster.params.Line.threshold = 0.001;
    this.summon = [new Summon(), new Summon()];
    this.motion = new HeadMotion();
    this.tracking = { hands: 0, controllers: 0, planes: null, anchor: false, walking: false };
    this.renderer.xr.addEventListener("sessionstart", () => this.started());
    this.renderer.xr.addEventListener("sessionend", () => this.ended());

    // Mouse and touch: a thing under the pointer is dragged over the plate (before the orbit sees it).
    canvas.addEventListener("pointerdown", (e) => { this.down = { x: e.clientX, y: e.clientY }; if (this.pointerGrab(e)) { e.stopImmediatePropagation(); canvas.setPointerCapture?.(e.pointerId); } }, { capture: true });
    canvas.addEventListener("pointermove", (e) => this.pointerDrag(e));
    canvas.addEventListener("pointerup", (e) => { const click = this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 6; this.down = null; if (this.pointerDrop(e, click)) return; if (click) this.clickAt(e); });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.renderer.setAnimationLoop((t, frame) => this.frame(t, frame));
  }

  makeRoom() {
    const g = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0e1430, roughness: 1 }));
    g.add(floor);
    const grid = new THREE.PolarGridHelper(6, 12, 12, 64, 0x2a3561, 0x1c2550); grid.position.y = 0.002; g.add(grid);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.76, 48), new THREE.MeshStandardMaterial({ color: 0x1a2244, roughness: 0.8 }));
    table.position.set(0, 0.38, -0.7); g.add(table);
    // The room is drawn first, whatever the distance sorting says: it is always behind what sits on it
    // (and stays right where a framebuffer has no depth, as in the browser emulator).
    floor.renderOrder = -3; grid.renderOrder = -2; table.renderOrder = -1;
    return g;
  }

  makeInput(i) {
    const ctrl = this.renderer.xr.getController(i);
    const grip = this.renderer.xr.getControllerGrip(i);
    const hand = this.renderer.xr.getHand(i);
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x4bd9c4, transparent: true, opacity: 0.85 }));
    ray.scale.z = 0.4; ray.visible = false; ctrl.add(ray);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0x4bd9c4 })); dot.visible = false; this.scene.add(dot);
    // A controller: a small body to see where it is.
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.07, 4, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa5cf, roughness: 0.5 })); body.visible = false; grip.add(body);
    const input = { i, ctrl, grip, hand, ray, dot, body, source: null, pinch: new Pinch(), select: null, poked: false, jointMeshes: new Map() };
    ctrl.addEventListener("connected", (e) => { input.source = e.data; body.visible = !e.data.hand && e.data.targetRayMode === "tracked-pointer"; });
    ctrl.addEventListener("disconnected", () => { input.source = null; body.visible = false; ray.visible = false; dot.visible = false; this.endSelect(input); });
    ctrl.addEventListener("selectstart", () => this.startSelect(input));
    ctrl.addEventListener("selectend", () => this.endSelect(input));
    ctrl.addEventListener("squeezestart", () => this.startSelect(input, true));
    ctrl.addEventListener("squeezeend", () => this.endSelect(input));
    this.scene.add(ctrl, grip, hand);
    return input;
  }

  // ----- Data -----
  setTwin(layout) { this.setContent(buildTwin(layout), layout); }
  /**
   * A scene composed by lib/compose.js, built with the object library; onProgress(done, total) while
   * its models load. A newer call wins over one still loading.
   */
  async setScene(layout, onProgress) {
    const ticket = (this.sceneTicket = (this.sceneTicket || 0) + 1);
    const group = await buildScene(layout, this.assets, onProgress, { animBudget: this.profile.kind === "headset" ? 12 : 30 });
    if (ticket !== this.sceneTicket) { dispose(group); return false; }
    this.loose = layout.things.filter((t) => !t.crop).length;      // things with a body (crops are drawn in rows)
    this.setContent(group, { width: layout.width, depth: layout.depth }); return true;
  }
  setContent(group, dims) {
    // Whatever was held or flying home belongs to the old miniature.
    for (const h of [...this.holds.values(), ...this.returning]) { this.scene.remove(h.obj); if (h.tag) this.scene.remove(h.tag); dispose(h.obj); }
    this.holds.clear(); this.returning = []; this.mouse = null; this.hover = null;
    if (this.twin) { this.holder.remove(this.twin); dispose(this.twin); }
    this.twin = group; this.layout = dims;
    this.twin.visible = this.twinVisible;
    this.holder.add(this.twin);
    const bounds = { w: dims.width || 0.5, d: dims.depth || 0.5 };
    this.bodies = group.children.filter((o) => o.userData.dyn).map((obj) => {
      const d = obj.userData.dyn;
      const body = makeBody({ x: obj.position.x, y: obj.position.y, z: obj.position.z, rot: obj.rotation.y, radius: d.radius, height: d.height, behavior: d.behavior, seed: d.seed, fixed: d.fixed, bounds, path: d.path, area: d.area, roam: d.roam });
      body.obj = obj; body.s0 = obj.scale.x; obj.userData.body = body;
      return body;
    });
    // Drawn in a batch while still (xr/scene3d.js); the living ones' animations are spread over frames.
    this.batched = this.bodies.filter((b) => b.obj.userData.batched?.length);
    this.animated = this.bodies.filter((b) => b.obj.userData.anim).length;
    if (this.mode === "3d") this.frameTwin();
  }
  setPanel(state) { this.panelState = state; if (this.panel.object.visible) this.panel.draw(state); }
  showTwin(on) { this.twinVisible = on; if (this.twin) this.twin.visible = on; }

  // ----- Modes -----
  async enter(mode, init) {
    const session = await navigator.xr.requestSession(mode === "vr" ? "immersive-vr" : "immersive-ar", init);
    this.mode = mode; this.session = session;
    this.renderer.xr.setReferenceSpaceType(init.requiredFeatures.includes("local-floor") || (init.optionalFeatures || []).includes("local-floor") ? "local-floor" : "local");
    await this.renderer.xr.setSession(session);
    return session;
  }
  exit() { this.session?.end(); }
  started() {
    const s = this.session;
    this.camera.position.set(0, 0, 0);
    const passthrough = this.mode !== "vr";
    // MR/AR: nothing behind (the real room shows through); VR: a calm night colour.
    this.scene.background = passthrough ? null : new THREE.Color(0x0b0f1e); this.renderer.setClearAlpha(passthrough ? 0 : 1);
    this.room.visible = this.mode === "vr"; this.desk.visible = false;
    this.headsetPanel = this.profile.kind === "headset" || this.profile.kind === "desktop";
    this.panel.object.visible = this.headsetPanel; this.panelPlaced = false;
    if (this.panelState) this.panel.draw(this.panelState);
    this.holder.scale.setScalar(this.mode === "vr" ? 1.4 : 1); this.twinPlaced = false;
    if (this.mode === "vr") { this.holder.position.set(0, 0.77, -0.7); this.holder.rotation.set(0, 0, 0); this.twinPlaced = true; }
    this.hitSource = null; this.anchor = null; this.tracking.anchor = false;
    if (passthrough && s.requestReferenceSpace) {
      s.requestReferenceSpace("viewer").then((viewer) => s.requestHitTestSource?.({ space: viewer })).then((src) => { this.hitSource = src || null; }).catch(() => {});
      this.restoreAnchor(s);
      this.placing = !this.twinPlaced;
    }
    this.onModeChange?.(this.mode);
  }
  ended() {
    this.mode = "3d"; this.session = null; this.hitSource = null; this.anchor = null; this.placing = false;
    this.room.visible = false; this.desk.visible = true; this.panel.object.visible = false; this.reticle.visible = false;
    this.renderer.setClearAlpha(0); this.scene.background = null;
    this.holder.position.set(0, 0, 0); this.holder.rotation.set(0, 0, 0); this.holder.scale.setScalar(1);
    this.camera.position.set(0, 0.42, 0.62); this.frameTwin();
    for (const input of this.inputs) for (const m of input.jointMeshes.values()) m.visible = false;
    this.onModeChange?.("3d");
  }

  /** Where the miniature goes: MR/AR: the next tap/pinch on a surface; VR: back on the table. */
  place() {
    if (this.mode === "vr") { this.holder.position.set(0, 0.77, -0.7); this.holder.rotation.set(0, 0, 0); return; }
    if (this.mode === "3d") { this.frameTwin(); return; }
    this.placing = true; this.twinPlaced = false; this.dropAnchor();
  }
  recenter() { if (this.mode === "3d") this.frameTwin(); else this.panelPlaced = false; }

  /** The 3D view fits the miniature (its width on a wide screen, also its depth on a narrow one). */
  frameTwin() {
    const w = (this.layout?.width || 0.5) * 1.08; const depth = (this.layout?.depth || 0.5) * 1.3;
    this.desk.scale.setScalar(Math.max(1, w / 0.92));
    this.controls.target.set(0, 0, 0.02);
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const d = Math.max(w / 2 / (tan * this.camera.aspect), depth / 2 / tan) * 1.05;
    this.camera.position.set(0, d * 0.72, d * 0.7);
    this.controls.update();
  }

  // ----- Phone movement (gyroscope) in 3D -----
  async motionView(on) {
    if (!on) { removeEventListener("deviceorientation", this.onOrient); this.onOrient = null; this.controls.enabled = true; return false; }
    if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
      if ((await DeviceOrientationEvent.requestPermission().catch(() => "denied")) !== "granted") return false;
    }
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    let base = null;
    this.onOrient = (e) => {
      if (e.alpha == null) return;
      if (!base) base = { a: e.alpha, theta: sph.theta };
      const theta = base.theta + THREE.MathUtils.degToRad(e.alpha - base.a);
      const phi = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(90 - (e.beta || 45)) + 0.35, 0.15, Math.PI * 0.48);
      this.camera.position.setFromSpherical(new THREE.Spherical(sph.radius, phi, theta)).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
    };
    this.controls.enabled = false;
    addEventListener("deviceorientation", this.onOrient);
    return true;
  }

  // ----- Anchors (the miniature stays on your real table) -----
  async dropAnchor() { try { const h = this.storage?.get(ANCHOR_KEY); if (h && this.session?.deletePersistentAnchor) await this.session.deletePersistentAnchor(h); } catch { /* none */ } this.storage?.remove(ANCHOR_KEY); this.anchor?.delete?.(); this.anchor = null; this.tracking.anchor = false; }
  async restoreAnchor(s) {
    const h = this.storage?.get(ANCHOR_KEY);
    if (!h || !s.restorePersistentAnchor) return;
    try { this.anchor = await s.restorePersistentAnchor(h); this.twinPlaced = true; this.placing = false; this.tracking.anchor = true; } catch { this.storage?.remove(ANCHOR_KEY); }
  }
  async placeAtReticle() {
    if (!this.reticle.visible) return false;
    const m = new THREE.Matrix4().copy(this.reticle.matrix);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    this.holder.position.copy(p);
    this.faceViewer(this.holder);
    this.twinPlaced = true; this.placing = false; this.reticle.visible = false;
    // An anchor keeps it where it is on the table as tracking refines; a persistent one brings it back next time.
    const hit = this.lastHit;
    if (hit?.createAnchor) {
      try {
        this.anchor = await hit.createAnchor(); this.tracking.anchor = true; this.anchorYaw = this.holder.rotation.y;
        if (this.anchor.requestPersistentHandle) this.storage?.set(ANCHOR_KEY, await this.anchor.requestPersistentHandle());
      } catch { /* placed without anchor */ }
    }
    return true;
  }
  faceViewer(obj) {
    const head = new THREE.Vector3(); this.renderer.xr.getCamera().getWorldPosition(head);
    obj.rotation.set(0, Math.atan2(head.x - obj.position.x, head.z - obj.position.z), 0);
  }

  // ----- Input -----
  /** The thing (with a body) a mesh belongs to, or null. */
  thingOf(o) { while (o && !o.userData.body) o = o.parent; return o && o.parent === this.twin && !o.userData.body.fixed ? o : null; }
  /** The nearest thing to a point in the room within reach (its edge closer than NEAR). */
  nearest(point) {
    if (!point || !this.twin?.visible) return null;
    const W = this.twin.getWorldScale(new THREE.Vector3()).x; let best = null;
    for (const b of this.bodies) {
      if (b.held || b.fixed) continue;
      const c = this.twin.localToWorld(new THREE.Vector3(b.pose.x, b.pose.y + b.height / 2, b.pose.z));
      const d = c.distanceTo(point) - b.radius * W;
      if (d < NEAR && (!best || d < best.d)) best = { d, obj: b.obj };
    }
    return best?.obj || null;
  }
  /** Where a hand holds (between thumb and index) or a controller's grip; and how it is turned. */
  handPoint(input) {
    const j = input.hand?.joints; const a = j?.["thumb-tip"], b = j?.["index-finger-tip"];
    if (input.source?.hand && a?.visible && b?.visible) return a.getWorldPosition(new THREE.Vector3()).add(b.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const g = input.grip.visible ? input.grip : input.ctrl;
    return new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
  }
  handQuat(input) { const g = input.grip.visible ? input.grip : input.ctrl; return g.getWorldQuaternion(new THREE.Quaternion()); }

  /** Take a thing: it leaves the plate for the hand and grows to be seen up close. */
  grab(input, obj, direct) {
    const body = obj.userData.body; body.held = true;
    this.returning = this.returning.filter((r) => r.obj !== obj);
    this.scene.attach(obj);
    const box = new THREE.Box3().setFromObject(obj); const size = box.getSize(new THREE.Vector3());
    const centre = obj.worldToLocal(box.getCenter(new THREE.Vector3()));
    const k = THREE.MathUtils.clamp(INSPECT / Math.max(size.x, size.y, size.z, 1e-3), 1, 12);
    const q = this.handQuat(input);
    const tag = label(obj.userData.dyn.label || "", { height: 0.018 }); this.scene.add(tag);
    this.holds.set(input, { obj, body, t0: performance.now(), direct, from: obj.position.clone(), fromQ: obj.quaternion.clone(), s0: obj.scale.x, s1: obj.scale.x * k,
      rel: q.clone().invert().multiply(obj.quaternion), centre, top: size.y / obj.scale.x, tag });
    const e = obj.userData.entity; if (e) this.onPick?.(e);
  }
  /** Let go: it flies back to where it belongs (moving with its behaviour) and shrinks back. */
  release(input) {
    const h = this.holds.get(input); if (!h) return; this.holds.delete(input);
    this.scene.remove(h.tag);
    this.goHome(h.obj);
  }
  goHome(obj) {
    if (obj.parent !== this.scene) this.scene.attach(obj);
    const body = obj.userData.body; body.held = true; body.ox = body.oz = body.vx = body.vz = 0;
    this.returning.push({ obj, body, t0: performance.now(), from: obj.position.clone(), fromQ: obj.quaternion.clone(), fromS: obj.scale.x });
  }
  holdFrame(t) {
    for (const [input, h] of this.holds) {
      if (!input.source) { this.release(input); continue; }
      const u = ease01((performance.now() - h.t0) / (h.direct ? 220 : 380));
      const s = THREE.MathUtils.lerp(h.s0, h.s1, u);
      const q = h.fromQ.clone().slerp(this.handQuat(input).multiply(h.rel), u);
      const at = this.handPoint(input).sub(h.centre.clone().multiplyScalar(s).applyQuaternion(q));
      h.obj.position.lerpVectors(h.from, at, u); h.obj.quaternion.copy(q); h.obj.scale.setScalar(s);
      h.tag.position.copy(at).add(new THREE.Vector3(0, h.top * s + 0.03, 0));
    }
    if (!this.returning.length) return;
    const m = new THREE.Matrix4(); const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const sc = new THREE.Vector3();
    this.twin.updateMatrixWorld();
    this.returning = this.returning.filter((r) => {
      const pose = behave(r.body, t);
      m.compose(new THREE.Vector3(pose.x, pose.y, pose.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pose.rot, 0)), new THREE.Vector3().setScalar(r.body.s0));
      m.premultiply(this.twin.matrixWorld).decompose(p, q, sc);
      const a = returnArc((performance.now() - r.t0) / 650);
      if (a.mix >= 1) {
        this.twin.add(r.obj); r.obj.position.set(pose.x, pose.y, pose.z); r.obj.rotation.set(0, pose.rot, 0); r.obj.scale.setScalar(r.body.s0);
        r.body.held = false; return false;
      }
      r.obj.position.lerpVectors(r.from, p, a.mix).y += a.lift * 0.05 * this.holder.scale.x;
      r.obj.quaternion.copy(r.fromQ).slerp(q, a.mix); r.obj.scale.setScalar(THREE.MathUtils.lerp(r.fromS, sc.x, a.mix));
      return true;
    });
  }
  /** The life of the miniature: behaviours, pushes (fingers, controllers, held things), the springs. */
  liveFrame(t, dt) {
    if (!this.twin || !this.bodies.length) return;
    this.twin.updateMatrixWorld();
    const W = this.twin.getWorldScale(new THREE.Vector3()).x;
    const local = (v) => this.twin.worldToLocal(v.clone());
    const pushers = [];
    if (this.renderer.xr.isPresenting) for (const input of this.inputs) {
      if (!input.source) continue;
      if (input.source.hand) for (const n of ["index-finger-tip", "thumb-tip", "middle-finger-tip", "wrist"]) {
        const j = input.hand.joints?.[n]; if (!j?.visible) continue;
        const p = local(j.getWorldPosition(new THREE.Vector3())); pushers.push({ x: p.x, y: p.y, z: p.z, r: (n === "wrist" ? 0.03 : 0.01) / W });
      } else if (input.grip.visible) { const p = local(new THREE.Vector3().setFromMatrixPosition(input.grip.matrixWorld)); pushers.push({ x: p.x, y: p.y, z: p.z, r: 0.025 / W }); }
    }
    for (const h of this.holds.values()) { const p = local(h.obj.position); pushers.push({ x: p.x, y: p.y, z: p.z, r: h.body.radius * (h.obj.scale.x / (h.body.s0 * W)) }); }
    if (this.mouse?.moved) { const o = this.mouse.obj.position; pushers.push({ x: o.x, y: o.y, z: o.z, r: this.mouse.body.radius }); }
    stepBodies(this.bodies, { t, dt, pushers });
    this.frameNo = (this.frameNo || 0) + 1; const every = this.animated > 16 ? 3 : 2;
    for (const b of this.bodies) {
      if (!b.held) { b.obj.position.set(b.pose.x, b.pose.y, b.pose.z); b.obj.rotation.y = b.pose.rot; }
      b.obj.userData.tick?.(t);
      // People and animals: walking while they move, at rest (or grazing) when they stop.
      const A = b.obj.userData.anim;
      if (A) {
        const last = b.last || b.pose; const v = Math.hypot(b.pose.x - last.x, b.pose.z - last.z) / Math.max(dt, 1e-3); b.last = { ...b.pose };
        b.speed = (b.speed || 0) * 0.85 + v * 0.15;
        const swims = b.path && b.path.speed < 0.02;              // a swim loop (lib/compose.js lakes)
        play(b.obj, b.held ? "idle" : b.speed > 0.03 ? "run" : b.speed > 0.002 ? (swims ? "swim" : "walk") : b.seed % 3 === 0 ? "eat" : "idle");
        // Each animal or person every second (or third, in a crowd) frame, with the time it missed.
        A.wait = (A.wait || 0) + dt;
        if (b.held || (this.frameNo + b.seed) % every === 0) { A.mixer.update(A.wait); A.wait = 0; }
      }
    }
    this.syncBatches();
  }
  /** A still thing that is held, pushed or flying home shows its own model; at home, its batch draws it. */
  syncBatches() {
    for (const b of this.batched) {
      const loose = b.held || Math.abs(b.ox) > 2e-4 || Math.abs(b.oz) > 2e-4 || b.hop >= 0;
      if (loose === !!b.loose) continue;
      b.loose = loose; b.obj.children.forEach((c) => (c.visible = loose));
      for (const sl of b.obj.userData.batched) { sl.im.setMatrixAt(sl.i, loose ? HIDDEN : sl.home); sl.im.instanceMatrix.needsUpdate = true; }
    }
  }
  showHover(obj) {
    this.hover = obj; const r = this.hoverRing;
    if (!obj || obj.userData.body?.held) { r.visible = false; return; }
    const W = this.twin.getWorldScale(new THREE.Vector3()).x;
    obj.getWorldPosition(r.position); r.position.y += 0.002; r.scale.setScalar(obj.userData.body.radius * W * 1.25); r.visible = true;
  }

  // ----- Mouse and touch (3D on the PC, the phone, the tablet) -----
  pointerRay(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    return this.raycaster;
  }
  pointerGrab(e) {
    if (this.mode !== "3d" || !this.twin?.visible) return false;
    const hit = this.pointerRay(e).intersectObject(this.twin, true).find((h) => this.thingOf(h.object));
    const obj = hit && this.thingOf(hit.object); if (!obj) return false;
    obj.userData.body.held = true;
    this.mouse = { obj, body: obj.userData.body, moved: false, x: e.clientX, y: e.clientY };
    this.controls.enabled = false; return true;
  }
  pointerDrag(e) {
    const m = this.mouse; if (!m) return;
    if (!m.moved && Math.hypot(e.clientX - m.x, e.clientY - m.y) < 6) return;
    m.moved = true;
    // Over the plate, lifted a little: the ray meets the plane of the plate in its own coordinates.
    const ray = this.pointerRay(e).ray.clone().applyMatrix4(this.twin.matrixWorld.clone().invert());
    const p = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.015), new THREE.Vector3()); if (!p) return;
    const w = (this.layout?.width || 0.5) / 2 - m.body.radius, d = (this.layout?.depth || 0.5) / 2 - m.body.radius;
    m.obj.position.set(THREE.MathUtils.clamp(p.x, -w, w), m.body.home.y + 0.015, THREE.MathUtils.clamp(p.z, -d, d));
  }
  pointerDrop(e, click) {
    const m = this.mouse; if (!m) return false; this.mouse = null;
    this.controls.enabled = !this.onOrient;
    if (!m.moved || click) { m.body.held = false; m.body.hop = performance.now() / 1000; this.onPick?.(m.obj.userData.entity || null); return true; }
    this.goHome(m.obj); return true;
  }

  hits(origin, dir) {
    this.raycaster.set(origin, dir); this.raycaster.far = 5; this.raycaster.camera = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    const shown = this.twin && this.twinVisible; const plate = shown && this.twin.userData.plate;
    const targets = [this.panel.object.visible ? this.panel.mesh : null, this.panel.object.visible ? this.panel.bar : null, shown && !plate ? this.twin : null].filter(Boolean);
    const out = this.raycaster.intersectObjects(targets, true);
    // A composed scene: its plate and the things' bodies (a ray against hundreds of meshes, animated
    // ones skinned on the CPU to be tested, costs a headset its frame rate).
    if (plate) { out.push(...this.raycaster.intersectObject(plate, false)); const t = this.rayThing(origin, dir); if (t) out.push(t); out.sort((a, b) => a.distance - b.distance); }
    return out;
  }
  /** The nearest thing a ray passes through (each thing a sphere around its body). */
  rayThing(origin, dir) {
    const W = this.twin.getWorldScale(new THREE.Vector3()).x; let best = null; const c = new THREE.Vector3();
    for (const b of this.bodies) {
      if (b.held || b.fixed) continue;
      this.twin.localToWorld(c.set(b.pose.x, b.pose.y + b.height / 2, b.pose.z)).sub(origin);
      const r = Math.max(b.radius, b.height / 2) * W; const along = c.dot(dir); if (along < 0) continue;
      const off = c.lengthSq() - along * along; if (off > r * r) continue;
      const d = along - Math.sqrt(r * r - off);
      if (!best || d < best.distance) best = { object: b.obj, distance: d, point: origin.clone().addScaledVector(dir, d) };
    }
    return best;
  }
  rayOf(input) {
    const m = input.ctrl.matrixWorld;
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
    return { origin, dir };
  }
  startSelect(input, squeeze = false) {
    if (!input.source) return;
    if (this.holds.has(input)) return;
    const { origin, dir } = this.rayOf(input);
    const hit = this.hits(origin, dir)[0];
    input.select = { t: performance.now(), hit, origin: origin.clone(), squeeze };
    // A pinch or a grip right at a thing takes it.
    const near = this.mode !== "3d" && this.nearest(this.handPoint(input));
    if (near) { input.select.drag = "item"; this.grab(input, near, true); return; }
    if (hit?.object === this.panel.mesh && !squeeze) { this.panel.press(this.panel.pointAt(hit.uv)); input.select = null; return; }
    if (hit?.object === this.panel.bar) { input.select.drag = "panel"; input.select.offset = new THREE.Matrix4().copy(input.ctrl.matrixWorld).invert().multiply(this.panel.object.matrixWorld); this.panelPlaced = true; return; }
    // Pointed at from afar: it comes to the hand.
    const thing = hit && this.thingOf(hit.object);
    if (thing) { input.select.drag = "item"; this.grab(input, thing, false); return; }
    if (hit && this.twin) {
      input.select.drag = "twin"; input.select.offset = new THREE.Matrix4().copy(input.ctrl.matrixWorld).invert().multiply(this.holder.matrixWorld);
      const other = this.inputs.find((x) => x !== input && x.select?.drag === "twin");
      if (other) this.two = { a: other, b: input, a0: v3(this.rayPoint(other)), b0: v3(this.rayPoint(input)), pos: this.holder.position.clone(), rot: this.holder.rotation.y, scale: this.holder.scale.x };
      return;
    }
    if (this.placing) this.placeAtReticle();
  }
  rayPoint(input) { return new THREE.Vector3().setFromMatrixPosition(input.ctrl.matrixWorld); }
  endSelect(input) {
    const s = input.select; input.select = null; if (!s) return;
    if (this.two && (this.two.a === input || this.two.b === input)) this.two = null;
    if (s.drag === "twin") { this.anchor = null; this.tracking.anchor = false; }
    if (s.drag === "item") { this.release(input); return; }
    // A short press on an entity is a pick; a hold was a move.
    const quick = performance.now() - s.t < 350;
    const e = s.hit?.object?.userData?.entity;
    if (quick && e) this.onPick?.(e);
  }
  clickAt(ev) {
    if (this.mode !== "3d" || !this.twin) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.twin, true).find((h) => h.object.userData.entity);
    this.onPick?.(hit ? hit.object.userData.entity : null);
  }

  // ----- Frame -----
  frame(t, frame) {
    const now = performance.now(); const dt = Math.min(0.05, ((now - (this.last || now)) / 1000)); this.last = now;
    if (frame) this.xrFrame(frame, dt);
    else this.controls.update();
    this.holdFrame(now / 1000);
    this.liveFrame(now / 1000, dt);
    this.renderer.render(this.scene, this.camera);
  }

  xrFrame(frame, dt) {
    const ref = this.renderer.xr.getReferenceSpace();
    const xrCam = this.renderer.xr.getCamera();
    const head = new THREE.Vector3(); xrCam.getWorldPosition(head);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.getWorldQuaternion(new THREE.Quaternion()));
    this.tracking.walking = this.motion.update(v3(head), frame.predictedDisplayTime / 1000, dt);
    // First frame: the miniature in front of the person until it is put on a surface.
    if (!this.twinPlaced && !this.anchor && this.mode !== "vr" && !this.placedOnce) {
      // Below the panel's line of sight, a little further: the panel reads above it, nothing overlaps.
      this.holder.position.set(head.x + fwd.x * 0.95, head.y - 0.62, head.z + fwd.z * 0.95); this.faceViewer(this.holder); this.placedOnce = true;
    }
    // Placing: the reticle on the surface seen at the centre of view.
    if (this.placing && this.hitSource) {
      const results = frame.getHitTestResults(this.hitSource);
      const pose = results[0]?.getPose(ref);
      this.reticle.visible = !!pose; this.lastHit = results[0] || null;
      if (pose) this.reticle.matrix.fromArray(pose.transform.matrix);
    } else this.reticle.visible = false;
    // Anchored: follow the anchor (the room's tracking may refine where the table is).
    if (this.anchor && frame.trackedAnchors?.has(this.anchor)) {
      const p = frame.getPose(this.anchor.anchorSpace, ref);
      if (p) this.holder.position.set(p.transform.position.x, p.transform.position.y, p.transform.position.z);
    }
    if (frame.detectedPlanes) this.tracking.planes = frame.detectedPlanes.size;

    // Hands and controllers.
    let hands = 0, controllers = 0; let hover = null;
    for (const input of this.inputs) {
      const src = input.source;
      if (!src) continue;
      if (src.hand) { hands++; this.handFrame(input, head, dt); } else if (src.targetRayMode === "tracked-pointer") controllers++;
      if (src.targetRayMode === "screen") continue;
      const { origin, dir } = this.rayOf(input);
      const hit = this.hits(origin, dir)[0];
      input.ray.visible = !src.hand || !!hit;
      input.ray.scale.z = hit ? hit.distance : 0.4;
      input.dot.visible = !!hit; if (hit) input.dot.position.copy(hit.point);
      if (!this.holds.has(input)) hover = hover || this.nearest(this.handPoint(input)) || (hit && this.thingOf(hit.object));
      if (hit?.object === this.panel.mesh) this.panel.setHover(this.panel.pointAt(hit.uv));
      // Dragging what was grabbed.
      const s = input.select;
      if (s?.drag === "panel") { const m = new THREE.Matrix4().multiplyMatrices(input.ctrl.matrixWorld, s.offset); this.panel.object.position.setFromMatrixPosition(m); this.lookAtHead(this.panel.object, head); }
      if (s?.drag === "twin" && !this.two) {
        const m = new THREE.Matrix4().multiplyMatrices(input.ctrl.matrixWorld, s.offset);
        const q = new THREE.Quaternion(); const p = new THREE.Vector3(); m.decompose(p, q, new THREE.Vector3());
        this.holder.position.copy(p); this.holder.rotation.set(0, new THREE.Euler().setFromQuaternion(q, "YXZ").y, 0);
        this.twinPlaced = true; this.placing = false;
      }
    }
    if (this.two) {
      const T = twoHand(this.two.a0, this.two.b0, v3(this.rayPoint(this.two.a)), v3(this.rayPoint(this.two.b)));
      this.holder.scale.setScalar(THREE.MathUtils.clamp(this.two.scale * T.scale, 0.3, 6));
      this.holder.rotation.y = this.two.rot + T.yaw;
      this.holder.position.set(this.two.pos.x + T.move[0], this.two.pos.y + T.move[1], this.two.pos.z + T.move[2]);
    }
    this.tracking.hands = hands; this.tracking.controllers = controllers;
    this.showHover(hover);

    // The panel: in front at first, then stays while you look around; comes along when you walk or turn away.
    if (this.panel.object.visible) {
      const P = this.panel.object.position;
      const f = lazyFollow({ panel: this.panelPlaced ? v3(P) : null, head: v3(head), forward: v3(fwd), distance: this.profile.panel.distance, height: -0.12, walking: this.tracking.walking });
      const dragging = this.inputs.some((x) => x.select?.drag === "panel");
      if (!dragging && (!this.panelPlaced || (this.follow && f.move))) {
        this.panelTarget = f.target; this.panelPlaced = true;
      }
      if (this.panelTarget && !dragging) {
        const next = this.panelPlacedOnce ? ease(v3(P), this.panelTarget, dt, 0.3) : this.panelTarget;
        P.set(...next); this.panelPlacedOnce = true;
        if (Math.hypot(next[0] - this.panelTarget[0], next[1] - this.panelTarget[1], next[2] - this.panelTarget[2]) < 0.005) this.panelTarget = null;
        this.lookAtHead(this.panel.object, head);
      }
    }
    this.reportTracking(dt);
  }

  handFrame(input, head, dt) {
    const hand = input.hand; const joints = {};
    for (const name of JOINTS) {
      const j = hand.joints?.[name]; if (!j || !j.visible) continue;
      const w = new THREE.Vector3(); j.getWorldPosition(w); joints[name] = v3(w);
      // Motion tracking you can see: a small dot on each joint.
      let m = input.jointMeshes.get(name);
      if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(name.endsWith("tip") ? 0.0055 : 0.0045, 8, 6), new THREE.MeshBasicMaterial({ color: name.endsWith("tip") ? 0x4bd9c4 : 0xb04bff, transparent: true, opacity: 0.85 })); this.scene.add(m); input.jointMeshes.set(name, m); }
      m.position.copy(w); m.visible = true;
    }
    const tracked = !!joints.wrist;
    // Open palm turned to the face for 0.8 s: the panel comes in front of you.
    if (this.summon[input.i].update(tracked, tracked && palmFacesHead(joints, input.source.handedness, v3(head)), dt)) { this.panelPlaced = false; this.panel.object.visible = this.headsetPanel; }
    // Poke: the index tip touching the panel presses it (re-armed after moving 3 cm away).
    if (tracked && this.panel.object.visible && joints["index-finger-tip"]) {
      const tip = new THREE.Vector3(...joints["index-finger-tip"]);
      const local = this.panel.mesh.worldToLocal(tip.clone());
      const p = this.panel.mesh.geometry.parameters;
      const inside = Math.abs(local.x) < p.width / 2 && Math.abs(local.y) < p.height / 2;
      if (inside && Math.abs(local.z) < 0.012 && !input.poked) { input.poked = true; this.panel.press(this.panel.pointAt({ x: local.x / p.width + 0.5, y: local.y / p.height + 0.5 })); }
      if (!inside || Math.abs(local.z) > 0.03) input.poked = false;
    }
  }

  lookAtHead(obj, head) { obj.lookAt(head.x, obj.position.y, head.z); }
  reportTracking(dt) { this.trackAge = (this.trackAge || 0) + dt; if (this.trackAge > 0.5) { this.trackAge = 0; this.onTracking?.({ ...this.tracking }); } }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const el = this.canvas.parentElement; const w = el.clientWidth || 1; const h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.mode === "3d" && !this.onOrient) this.frameTwin();
  }
}

const ease01 = (u) => { const x = Math.max(0, Math.min(1, u)); return 1 - (1 - x) ** 3; };

function dispose(obj) {
  obj.traverse((o) => { o.geometry?.dispose?.(); if (o.material?.map) o.material.map.dispose(); if (o.isSprite) o.material.dispose(); });
}
