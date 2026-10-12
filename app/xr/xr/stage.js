// The 3D stage of Aurora XR: one three.js scene for every device.
// - 3D (PC, phone, tablet, a headset's 2D browser): the miniature on a desk, orbit with mouse/touch,
//   and on a phone the view can follow the device's movement (gyroscope).
// - MR (headset, passthrough): the room is real; the miniature goes on a real table (hit-test, anchored
//   and remembered between sessions where the headset allows), the panel floats at arm's reach and
//   comes along when you walk; hands are tracked (pinch, poke, open palm to call the panel).
// - VR: the same, in a calm virtual room with a table.
// - AR (phone): the camera view; tap a surface to put the miniature there; the screen is the panel.
import * as THREE from "../vendor/three.module.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { Panel3D } from "./panel3d.js";
import { buildTwin } from "./twin3d.js";
import { Pinch, Summon, HeadMotion, palmFacesHead, twoHand, lazyFollow, ease } from "../lib/gestures.js";

const JOINTS = ["wrist", "thumb-tip", "index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip", "index-finger-metacarpal", "pinky-finger-metacarpal",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal",
  "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal"];
const ANCHOR_KEY = "aurora-xr-anchor";
const v3 = (v) => [v.x, v.y, v.z];

export class Stage {
  constructor({ canvas, profile, storage, onPick, onPanelAction, onTracking, onModeChange }) {
    Object.assign(this, { canvas, profile, storage, onPick, onPanelAction, onTracking, onModeChange });
    this.mode = "3d"; this.follow = true; this.placing = false; this.twinVisible = true;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
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
    this.twin = null;
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

    canvas.addEventListener("pointerdown", (e) => { this.down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener("pointerup", (e) => { if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 6) this.clickAt(e); this.down = null; });
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
  setTwin(layout) {
    if (this.twin) { this.holder.remove(this.twin); dispose(this.twin); }
    this.twin = buildTwin(layout); this.layout = layout;
    this.twin.visible = this.twinVisible;
    this.holder.add(this.twin);
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
  hits(origin, dir) {
    this.raycaster.set(origin, dir); this.raycaster.far = 5; this.raycaster.camera = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    const targets = [this.panel.object.visible ? this.panel.mesh : null, this.panel.object.visible ? this.panel.bar : null, this.twin && this.twinVisible ? this.twin : null].filter(Boolean);
    return this.raycaster.intersectObjects(targets, true);
  }
  rayOf(input) {
    const m = input.ctrl.matrixWorld;
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
    return { origin, dir };
  }
  startSelect(input, squeeze = false) {
    if (!input.source) return;
    const { origin, dir } = this.rayOf(input);
    const hit = this.hits(origin, dir)[0];
    input.select = { t: performance.now(), hit, origin: origin.clone(), squeeze };
    if (hit?.object === this.panel.mesh && !squeeze) { this.panel.press(this.panel.pointAt(hit.uv)); input.select = null; return; }
    if (hit?.object === this.panel.bar) { input.select.drag = "panel"; input.select.offset = new THREE.Matrix4().copy(input.ctrl.matrixWorld).invert().multiply(this.panel.object.matrixWorld); this.panelPlaced = true; return; }
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
    let hands = 0, controllers = 0;
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

function dispose(obj) {
  obj.traverse((o) => { o.geometry?.dispose?.(); if (o.material?.map) o.material.map.dispose(); if (o.isSprite) o.material.dispose(); });
}
