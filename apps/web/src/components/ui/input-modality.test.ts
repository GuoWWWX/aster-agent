// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { trackInputModality } from "./input-modality.js";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
  delete document.documentElement.dataset.inputModality;
});

it("distinguishes navigation keys from mouse input and synthetic Escape dismissal", () => {
  stop = trackInputModality([document]);
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(document.documentElement.dataset.inputModality).toBe("keyboard");
  document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
  expect(document.documentElement.dataset.inputModality).toBe("keyboard");
});

it("shares the last input method between the main document and a native portal", () => {
  document.documentElement.dataset.inputModality = "keyboard";
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const portal = iframe.contentDocument!;
  stop = trackInputModality([document, portal]);
  expect(portal.documentElement.dataset.inputModality).toBe("keyboard");
  portal.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(portal.documentElement.dataset.inputModality).toBe("keyboard");
  stop();
  portal.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(document.documentElement.dataset.inputModality).toBe("keyboard");
});

it("restores native focus visibility when the root provider unmounts", () => {
  stop = trackInputModality([document]);
  stop();
  expect(document.documentElement.dataset.inputModality).toBeUndefined();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(document.documentElement.dataset.inputModality).toBeUndefined();
});
