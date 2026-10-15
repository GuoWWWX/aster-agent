import { NATIVE_OVERLAY_FRAME_NAME, type NativeOverlayRegionsInput } from "@agent/protocol";
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";

import { NATIVE_OVERLAY_READY } from "../../lib/native-overlay.js";
import { LIVE_PANEL_RESIZE_EVENT, type LivePanelResizeDetail } from "../layout/live-panel-resize.js";

const NativeOverlayContext = createContext<HTMLElement | undefined>(undefined);

export function useNativeOverlayContainer(): HTMLElement | undefined {
  return useContext(NativeOverlayContext);
}

/** React keeps ownership of the portals; the native child supplies their compositing layer. */
export function NativeOverlayProvider({ children }: { children: ReactNode }): ReactElement {
  const [container, setContainer] = useState<HTMLElement>();

  useEffect(() => {
    if (window.agentDesktop === undefined) return undefined;
    let child: Window | null = null;
    let detach: (() => void) | undefined;
    let disposed = false;
    const open = (): void => {
      child = window.open(new URL("native-overlay.html", window.location.href).href, NATIVE_OVERLAY_FRAME_NAME);
    };
    // StrictMode's setup/cleanup probe must not open a second native window.
    const timer = window.setTimeout(open, 0);
    const closed = window.setInterval(() => {
      if (disposed || child === null || !child.closed) return;
      detach?.();
      detach = undefined;
      setContainer(undefined);
      open();
    }, 500);
    const ready = (event: MessageEvent): void => {
      if (child === null || event.source !== child || event.origin !== location.origin
        || event.data !== NATIVE_OVERLAY_READY || detach !== undefined) return;
      const root = child.document.getElementById("overlay-root");
      if (root === null || child.nativeOverlay === undefined) return;
      detach = connectOverlayHost(child, root);
      setContainer(root);
    };
    window.addEventListener("message", ready);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearInterval(closed);
      window.removeEventListener("message", ready);
      detach?.();
      child?.close();
    };
  }, []);

  return <NativeOverlayContext.Provider value={container}>{children}</NativeOverlayContext.Provider>;
}

function connectOverlayHost(child: Window, root: HTMLElement): () => void {
  const bridge = child.nativeOverlay!;
  let updateTimer: number | undefined;
  let lastInput = "";
  let overlays: HTMLElement[] = [];
  let resizing = false;
  let browserDrag = false;
  let interactive = false;
  const observedOverlays = new Set<HTMLElement>();
  const resizeObserver = new ResizeObserver(() => schedule());

  const synchronize = (): void => {
    updateTimer = undefined;
    overlays = [...root.querySelectorAll<HTMLElement>("[data-native-view-overlay], [role=menu]")]
      .filter((element) => element.dataset.state !== "closed");
    for (const element of observedOverlays) {
      if (!overlays.includes(element)) { resizeObserver.unobserve(element); observedOverlays.delete(element); }
    }
    for (const element of overlays) {
      if (!observedOverlays.has(element)) { resizeObserver.observe(element); observedOverlays.add(element); }
    }
    if (document.body.dataset.resizingPanel !== "true") browserDrag = false;
    else if (!browserDrag) browserDrag = [...document.querySelectorAll<HTMLElement>("[data-managed-browser-surface]")]
      .some((surface) => surface.getBoundingClientRect().width > 0);
    const draggingBrowser = browserDrag;
    resizing = draggingBrowser;
    const regions = overlays.flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || child.getComputedStyle(element).visibility === "hidden") return [];
      const x = Math.max(0, Math.floor(bounds.left) - 12);
      const y = Math.max(0, Math.floor(bounds.top) - 12);
      const right = Math.min(window.innerWidth, Math.ceil(bounds.right) + 12);
      const bottom = Math.min(window.innerHeight, Math.ceil(bounds.bottom) + 12);
      return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
    });
    const input: NativeOverlayRegionsInput = {
      regions,
      interactive: regions.length > 0 && overlays.some((element) => element.dataset.nativeOverlayInteractive !== "false"),
      resizing: draggingBrowser,
    };
    interactive = input.interactive;
    const key = JSON.stringify(input);
    if (key !== lastInput) {
      lastInput = key;
      bridge.update(input);
    }
  };
  const schedule = (): void => {
    updateTimer ??= window.setTimeout(synchronize, 0);
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(root, { subtree: true, childList: true, attributes: true });

  const synchronizeTheme = (): void => {
    for (const name of ["class", "data-theme", "style", "lang", "dir"]) {
      const value = document.documentElement.getAttribute(name);
      if (value === null) child.document.documentElement.removeAttribute(name);
      else child.document.documentElement.setAttribute(name, value);
    }
    child.document.documentElement.style.setProperty("background", "transparent", "important");
    child.document.documentElement.style.setProperty("overflow", "hidden", "important");
  };
  const themeObserver = new MutationObserver(synchronizeTheme);
  themeObserver.observe(document.documentElement, { attributes: true });
  synchronizeTheme();
  // Component CSS and development HMR styles also apply to portals in the child document.
  let clonedStyles: Node[] = [];
  const synchronizeStyles = (): void => {
    for (const node of clonedStyles) node.parentNode?.removeChild(node);
    clonedStyles = [...document.head.querySelectorAll('style, link[rel="stylesheet"]')].map((style) => style.cloneNode(true));
    child.document.head.append(...clonedStyles);
  };
  const stylesObserver = new MutationObserver(synchronizeStyles);
  stylesObserver.observe(document.head, { childList: true, subtree: true, attributes: true, characterData: true });
  synchronizeStyles();

  // Radix listens in the portal's ownerDocument. Preserve the original parent Node
  // target so its trigger/outside checks keep working across the two documents.
  const forwardOutside = (event: Event): void => {
    if (resizing || overlays.length === 0 || !(event instanceof MouseEvent)) return;
    const forwarded = new PointerEvent(event.type, {
      bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY,
      button: event.button, buttons: event.buttons,
      pointerType: event instanceof PointerEvent ? event.pointerType : "mouse",
    });
    Object.defineProperty(forwarded, "target", { value: event.target });
    child.document.dispatchEvent(forwarded);
  };
  const outsideEvents = ["pointerdown", "pointerup", "mousedown", "mouseup", "click"];
  for (const type of outsideEvents) window.addEventListener(type, forwardOutside);
  const stopResizePointer = bridge.onResizePointer((pointer) => {
    if (!resizing) return;
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, clientX: pointer.x, clientY: pointer.y,
      button: 0, buttons: 1, pointerType: "mouse", isPrimary: true,
    }));
    if (pointer.phase === "move") return;
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, clientX: pointer.x, clientY: pointer.y,
      button: 0, buttons: 0,
      pointerType: "mouse", isPrimary: true,
    }));
  });
  const returnFocus = bridge.onParentFocus(() => {
    child.document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  });
  const forwardKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !event.defaultPrevented) window.dispatchEvent(new KeyboardEvent(event.type, {
      key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
      altKey: event.altKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true,
    }));
  };
  child.addEventListener("keydown", forwardKey);
  // Moving focus into the native portal is still focus inside the application.
  // Radix Select's parent-window blur listener would otherwise close it immediately.
  const parentBlur = (event: FocusEvent): void => {
    if (interactive) event.stopImmediatePropagation();
  };
  window.addEventListener("blur", parentBlur, true);
  const focusContent = (event: FocusEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target === null || !target.matches("[data-native-view-overlay], [role=dialog]")) return;
    queueMicrotask(() => {
      if (child.document.activeElement === target) {
        const candidates = tabbableElements(target);
        (candidates.find((element) => element.dataset.state === "checked") ?? candidates[0])?.focus();
      }
    });
  };
  const trapTab = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const focused = child.document.activeElement as HTMLElement | null;
    const scope = focused?.closest<HTMLElement>('[role="dialog"]');
    if (scope === undefined || scope === null) return;
    const candidates = tabbableElements(scope);
    const first = candidates[0];
    const last = candidates.at(-1);
    if (first === undefined || (!event.shiftKey && focused === last) || (event.shiftKey && focused === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  child.document.addEventListener("focusin", focusContent);
  child.document.addEventListener("keydown", trapTab, true);
  const liveResize = (event: Event): void => {
    if ((event as CustomEvent<LivePanelResizeDetail>).detail.phase !== "move") synchronize();
  };
  window.addEventListener(LIVE_PANEL_RESIZE_EVENT, liveResize);
  window.addEventListener("resize", schedule);
  const dragObserver = new MutationObserver(synchronize);
  dragObserver.observe(document.body, { attributes: true, attributeFilter: ["data-resizing-panel"] });
  schedule();
  return () => {
    if (updateTimer !== undefined) window.clearTimeout(updateTimer);
    resizeObserver.disconnect();
    mutations.disconnect();
    themeObserver.disconnect();
    stylesObserver.disconnect();
    dragObserver.disconnect();
    if (!child.closed) returnFocus();
    for (const type of outsideEvents) window.removeEventListener(type, forwardOutside);
    if (!child.closed) {
      stopResizePointer();
      child.removeEventListener("keydown", forwardKey);
      child.document.removeEventListener("focusin", focusContent);
      child.document.removeEventListener("keydown", trapTab, true);
    }
    window.removeEventListener("blur", parentBlur, true);
    window.removeEventListener(LIVE_PANEL_RESIZE_EVENT, liveResize);
    window.removeEventListener("resize", schedule);
    if (!child.closed) bridge.update({ regions: [], interactive: false });
  };
}

function tabbableElements(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]')]
    .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled, [inert], [inert] *") && element.getClientRects().length > 0);
}
