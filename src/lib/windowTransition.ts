type FrameScheduler = (callback: FrameRequestCallback) => number;

let removePreviousSurface = () => {};

export function cancelSurfaceCrossfade(): void {
  removePreviousSurface();
}

/** Retain only an inert visual copy while React switches the live surface.
 * Neither copy is scaled: the native window provides the clipping container. */
export function prepareSurfaceCrossfade(): { start: () => void; cancel: () => void } {
  cancelSurfaceCrossfade();
  const noop = { start: () => {}, cancel: () => {} };
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return noop;
  // A dialog must never survive as an inert copy over a new live form.
  const source = document.querySelector<HTMLElement>("#root > .quota-card:not(.quota-card--overlay-open), #root > .quota-island");
  if (!source || typeof source.animate !== "function") return noop;
  const bounds = source.getBoundingClientRect();
  const outgoing = source.cloneNode(true) as HTMLElement;
  outgoing.removeAttribute("id");
  outgoing.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  outgoing.setAttribute("aria-hidden", "true");
  outgoing.inert = true;
  Object.assign(outgoing.style, {
    position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`,
    width: `${bounds.width}px`, height: `${bounds.height}px`, maxWidth: "none",
    margin: "0", pointerEvents: "none", zIndex: "9999",
  });
  document.body.append(outgoing);
  let exit: Animation | undefined;
  let enter: Animation | undefined;
  let cancelled = false;
  let started = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    window.clearTimeout(cleanupTimer);
    exit?.cancel();
    enter?.cancel();
    outgoing.remove();
    if (removePreviousSurface === cancel) removePreviousSurface = () => {};
  };
  // WebKit can suspend animation callbacks when the native clipping window
  // shrinks. Cleanup must not depend on onfinish or a future paint frame.
  const cleanupTimer = window.setTimeout(cancel, 400);
  removePreviousSurface = cancel;
  const start = () => {
    if (cancelled || started) return;
    started = true;
    const live = document.querySelector<HTMLElement>("#root > .quota-card:not(.quota-card--overlay-open), #root > .quota-island");
    if (!live) { cancel(); return; }
    const options = { duration: 140, easing: "ease-out", fill: "both" as const };
    try {
      exit = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], options);
      enter = live.animate([{ opacity: 0 }, { opacity: 1 }], options);
      exit.onfinish = cancel;
      exit.oncancel = cancel;
      enter.onfinish = cancel;
      enter.oncancel = cancel;
    } catch {
      cancel();
    }
  };
  return { start, cancel };
}

export function waitForSurfacePaint(scheduleFrame: FrameScheduler = window.requestAnimationFrame.bind(window)): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    // A small/occluded GTK WebView may stop producing frames. The native
    // resize is needed to make it paint again, so never wait indefinitely.
    const timeout = window.setTimeout(finish, 120);
    // The first frame commits the React surface; the second guarantees WebKit
    // has had a paint opportunity before the native Tauri frame starts growing.
    scheduleFrame(() => { if (!settled) scheduleFrame(finish); });
  });
}
