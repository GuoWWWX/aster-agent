// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ProjectImageViewer } from "./project-image-viewer.js";

describe("ProjectImageViewer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the image and exposes sibling navigation", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();

    act(() => {
      root.render(
        <TooltipProvider>
          <ProjectImageViewer
            currentIndex={1}
            dataUrl="data:image/png;base64,AQID"
            fileName="second.png"
            hasNext
            hasPrevious
            total={3}
            onNext={onNext}
            onPrevious={onPrevious}
          />
        </TooltipProvider>,
      );
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AQID",
    );
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("second.png");
    expect(container.textContent).toContain("2 / 3");

    const previousOverlay = container.querySelector(
      'button[data-image-navigation="previous"]',
    ) as HTMLButtonElement;
    const nextOverlay = container.querySelector(
      'button[data-image-navigation="next"]',
    ) as HTMLButtonElement;
    expect(previousOverlay).not.toBeNull();
    expect(nextOverlay).not.toBeNull();
    expect(previousOverlay.className).toContain("rounded-full");
    expect(previousOverlay.className).toContain("opacity-0");
    expect(previousOverlay.querySelector("svg")?.getAttribute("width")).toBe("20");

    const navigationZone = container.querySelector('[data-image-navigation-zone="true"]') as HTMLDivElement;
    navigationZone.getBoundingClientRect = vi.fn(() => ({
      bottom: 400,
      height: 400,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    act(() => {
      navigationZone.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 20 }));
    });
    expect(previousOverlay.className).toContain("opacity-100");
    expect(nextOverlay.className).toContain("opacity-0");

    act(() => {
      previousOverlay.click();
      navigationZone.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 580 }));
    });
    expect(previousOverlay.className).toContain("opacity-0");
    expect(nextOverlay.className).toContain("opacity-100");
    act(() => {
      nextOverlay.click();
    });

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("hides side navigation where there is no sibling image", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <ProjectImageViewer
            currentIndex={0}
            dataUrl="data:image/png;base64,AQID"
            fileName="only.png"
            hasNext={false}
            hasPrevious={false}
            total={1}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
          />
        </TooltipProvider>,
      );
    });

    expect(container.querySelector('[data-image-navigation="previous"]')).toBeNull();
    expect(container.querySelector('[data-image-navigation="next"]')).toBeNull();
  });

  it("zooms from fit mode and can return to actual size or fit", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <ProjectImageViewer
            currentIndex={0}
            dataUrl="data:image/webp;base64,AQID"
            fileName="asset.webp"
            hasNext={false}
            hasPrevious={false}
            total={1}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
          />
        </TooltipProvider>,
      );
    });

    const image = container.querySelector("img") as HTMLImageElement;
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 600 },
      naturalWidth: { configurable: true, value: 800 },
    });
    image.getBoundingClientRect = vi.fn(() => ({
      bottom: 350,
      height: 300,
      left: 50,
      right: 450,
      top: 50,
      width: 400,
      x: 50,
      y: 50,
      toJSON: () => ({}),
    }));
    act(() => {
      image.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(container.textContent).toContain("适应");
    act(() => {
      (container.querySelector('button[aria-label="放大图片"]') as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("60%");

    act(() => {
      (container.querySelector('button[aria-label="显示图片实际大小"]') as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("100%");

    act(() => {
      (container.querySelector('button[aria-label="使图片适应窗口"]') as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("适应");
  });

  it("only zooms around the pointer when Ctrl is held", () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <ProjectImageViewer
            currentIndex={0}
            dataUrl="data:image/png;base64,AQID"
            fileName="large.png"
            hasNext={false}
            hasPrevious={false}
            total={1}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
          />
        </TooltipProvider>,
      );
    });

    const image = container.querySelector("img") as HTMLImageElement;
    const viewport = container.querySelector('[role="group"]') as HTMLDivElement;
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 600 },
      naturalWidth: { configurable: true, value: 800 },
    });
    image.getBoundingClientRect = vi.fn(() => {
      const width = Number.parseFloat(image.style.width) || 400;
      const height = Number.parseFloat(image.style.height) || 300;
      return {
        bottom: 50 + height,
        height,
        left: 50,
        right: 50 + width,
        top: 50,
        width,
        x: 50,
        y: 50,
        toJSON: () => ({}),
      };
    });
    viewport.getBoundingClientRect = vi.fn(() => ({
      bottom: 500,
      height: 500,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    act(() => {
      image.dispatchEvent(new Event("load", { bubbles: true }));
    });

    const plainWheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 250,
      clientY: 200,
      deltaY: -100,
    });
    act(() => {
      image.dispatchEvent(plainWheelEvent);
    });
    expect(plainWheelEvent.defaultPrevented).toBe(false);
    expect(container.textContent).toContain("适应");

    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 250,
      clientY: 200,
      ctrlKey: true,
      deltaY: -100,
    });
    act(() => {
      image.dispatchEvent(wheelEvent);
    });
    act(() => animationFrames.splice(0).forEach((callback) => callback(0)));

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(container.textContent).toContain("55%");
    expect(viewport.scrollLeft).toBeGreaterThan(0);
  });

  it("pans an enlarged image by dragging it with the primary pointer", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <ProjectImageViewer
            currentIndex={0}
            dataUrl="data:image/png;base64,AQID"
            fileName="large.png"
            hasNext={false}
            hasPrevious={false}
            total={1}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
          />
        </TooltipProvider>,
      );
    });

    const image = container.querySelector("img") as HTMLImageElement;
    const viewport = container.querySelector('[role="group"]') as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 900 },
      scrollLeft: { configurable: true, value: 240, writable: true },
      scrollTop: { configurable: true, value: 180, writable: true },
      scrollWidth: { configurable: true, value: 1200 },
    });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(image, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
      setPointerCapture,
    });
    const pointerEvent = (
      type: "pointerdown" | "pointermove" | "pointerup",
      clientX: number,
      clientY: number,
    ): MouseEvent => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX,
        clientY,
      });
      Object.defineProperty(event, "pointerId", { value: 7 });
      return event;
    };

    act(() => {
      image.dispatchEvent(pointerEvent("pointerdown", 220, 180));
      image.dispatchEvent(pointerEvent("pointermove", 160, 120));
    });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(viewport.scrollLeft).toBe(300);
    expect(viewport.scrollTop).toBe(240);
    expect(image.className).toContain("cursor-grabbing");

    act(() => {
      image.dispatchEvent(pointerEvent("pointerup", 160, 120));
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(image.className).not.toContain("cursor-grabbing");
  });
});
