// Which device is this and how the Aurora should present itself on it: the same app on a phone, a
// tablet, a computer and a headset. Pure: the browser gathers the facts, this decides.

/**
 * facts: { width, height, touch, coarse, ar, vr, standalone, ua }
 * -> { kind: "phone"|"tablet"|"desktop"|"headset", modes: ["mr","vr","ar"...], primary, panel, layout }
 */
export function deviceProfile(f) {
  const ua = String(f.ua || "");
  const headset = /OculusBrowser|Quest|Pico|Wolvic|VisionOS|Vision Pro/i.test(ua) || (f.vr && f.ar && !f.touch);
  const short = Math.min(f.width || 0, f.height || 0);
  const kind = headset ? "headset" : f.touch && f.coarse ? (short < 600 ? "phone" : "tablet") : "desktop";
  const modes = [];
  // In a headset, AR is mixed reality (passthrough); on a phone it is the camera view.
  if (f.ar) modes.push(kind === "headset" ? "mr" : "ar");
  if (f.vr) modes.push("vr");
  const primary = modes[0] || "3d";
  const narrow = (f.width || 0) < 720;
  return {
    kind, modes, primary,
    // Desktop/tablet: the panel beside the 3D view; phone: one column, the 3D view on top and the
    // panel below, tabs at the thumb.
    layout: narrow || kind === "phone" ? "stack" : "split",
    // In XR: the panel at arm's reach in a headset; on a phone, AR draws the miniature only (the screen is the panel).
    panel: kind === "headset" ? { distance: 0.75, width: 0.62, height: 0.46, follow: true } : { distance: 0.6, width: 0.4, height: 0.3, follow: false },
    // Mixed reality wants to place the miniature on a real table (hit-test); VR gives a virtual one.
    xrFeatures: {
      mr: { required: ["local-floor"], optional: ["hand-tracking", "hit-test", "anchors", "plane-detection", "mesh-detection", "light-estimation", "dom-overlay"] },
      ar: { required: [], optional: ["local-floor", "hit-test", "anchors", "dom-overlay", "light-estimation"] },
      vr: { required: ["local-floor"], optional: ["hand-tracking", "bounded-floor"] },
    },
  };
}

/** The XR session's options for a mode (the DOM overlay only where it exists: phones). */
export function sessionInit(profile, mode, overlay) {
  const spec = profile.xrFeatures[mode];
  const init = { requiredFeatures: [...spec.required], optionalFeatures: [...spec.optional] };
  if (overlay && spec.optional.includes("dom-overlay")) init.domOverlay = { root: overlay };
  return init;
}

export const MODE_LABEL = { mr: "Realidade mista", ar: "Ver na mesa (AR)", vr: "Entrar em VR", "3d": "3D" };
