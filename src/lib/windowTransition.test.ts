// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelSurfaceCrossfade, prepareSurfaceCrossfade, waitForSurfacePaint } from "./windowTransition";

afterEach(() => {
  cancelSurfaceCrossfade();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("waitForSurfacePaint", () => {
  it("waits for two animation frames before releasing the native resize", async () => {
    const frames: FrameRequestCallback[] = [];
    const schedule = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const ready = vi.fn();

    void waitForSurfacePaint(schedule).then(ready);
    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()?.(16);
    await Promise.resolve();
    expect(ready).toHaveBeenCalledOnce();
  });

  it("releases the resize when an occluded webview never produces a frame", async () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    const schedule = vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const ready = vi.fn();
    void waitForSurfacePaint(schedule).then(ready);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ready).toHaveBeenCalledOnce();
    // A late frame cannot start another paint wait after the fallback fired.
    frames.shift()?.(1000);
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("also releases the resize when only the first paint frame arrives", async () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    const schedule = (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; };
    const ready = vi.fn();
    void waitForSurfacePaint(schedule).then(ready);
    frames.shift()?.(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ready).toHaveBeenCalledOnce();
    frames.shift()?.(1000);
    await Promise.resolve();
    expect(ready).toHaveBeenCalledOnce();
  });
});

describe("surface crossfade", () => {
  function createSurface(className = "quota-card") {
    document.body.innerHTML = `<div id="root"><main class="${className}"><input aria-label="Server URL" /></main></div>`;
    const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null }));
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    return animate;
  }

  it("keeps an inert unscaled outgoing surface and removes it on completion", () => {
    document.body.innerHTML = '<div id="root"><main class="quota-card"><button id="action">Open</button></main></div>';
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }> = [];
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn(() => {
      const animation = { cancel: vi.fn(), onfinish: null };
      animations.push(animation);
      return animation;
    }) });
    const source = document.querySelector<HTMLElement>("main")!;
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue({ left: 4, top: 4, width: 520, height: 600 } as DOMRect);
    const reveal = prepareSurfaceCrossfade();
    const outgoing = document.body.lastElementChild as HTMLElement;
    expect(outgoing.inert).toBe(true);
    expect(outgoing.getAttribute("aria-hidden")).toBe("true");
    expect(outgoing.querySelector("[id]")).toBeNull();
    expect(outgoing.style.width).toBe("520px");
    expect(outgoing.style.pointerEvents).toBe("none");
    reveal.start();
    expect(animations).toHaveLength(2);
    animations[0].onfinish?.();
    expect(outgoing.isConnected).toBe(false);
    animations[1].onfinish?.();
    expect(animations[1].cancel).toHaveBeenCalledOnce();
    const superseded = prepareSurfaceCrossfade();
    const cancelledCopy = document.body.lastElementChild;
    superseded.cancel();
    superseded.start();
    expect(cancelledCopy?.isConnected).toBe(false);
    expect(animations).toHaveLength(2);
  });

  it("removes a prepared copy even when paint frames never start the crossfade", async () => {
    vi.useFakeTimers();
    const animate = createSurface();
    const reveal = prepareSurfaceCrossfade();
    const outgoing = document.body.lastElementChild!;
    expect(outgoing.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(outgoing.isConnected).toBe(false);
    reveal.start();
    expect(animate).not.toHaveBeenCalled();
  });

  it("restores the live surface if WebKit never finishes either animation", async () => {
    vi.useFakeTimers();
    const animate = createSurface();
    const reveal = prepareSurfaceCrossfade();
    const outgoing = document.body.lastElementChild!;
    reveal.start();
    expect(animate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(outgoing.isConnected).toBe(false);
    for (const result of animate.mock.results) expect(result.value.cancel).toHaveBeenCalledOnce();
  });

  it("removes a stale copy immediately when control center takes the window", () => {
    const animate = createSurface();
    prepareSurfaceCrossfade().start();
    const outgoing = document.body.lastElementChild!;
    cancelSurfaceCrossfade();
    expect(outgoing.isConnected).toBe(false);
    for (const result of animate.mock.results) expect(result.value.cancel).toHaveBeenCalledOnce();
    expect(document.querySelector("#root input")).not.toBeNull();
  });

  it("does not clone dialogs containing editable forms", () => {
    const animate = createSurface("quota-card quota-card--overlay-open");
    prepareSurfaceCrossfade().start();
    expect(document.querySelectorAll("input")).toHaveLength(1);
    expect(animate).not.toHaveBeenCalled();
  });

  it("discards a queued copy when a dialog replaces the live surface before start", () => {
    const animate = createSurface();
    const reveal = prepareSurfaceCrossfade();
    const outgoing = document.body.lastElementChild!;
    document.querySelector("#root > main")!.classList.add("quota-card--overlay-open");
    reveal.start();
    expect(outgoing.isConnected).toBe(false);
    expect(animate).not.toHaveBeenCalled();
  });
});
