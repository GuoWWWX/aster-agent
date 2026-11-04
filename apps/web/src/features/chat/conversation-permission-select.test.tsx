// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
import { ConversationPermissionSelect } from "./conversation-permission-select.js";

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); useApplicationSettingsStore.setState({ approvalReviewer: "user" }); });

it("offers the three distinct modes and returns the selected behavior", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  const changed = vi.fn();
  act(() => root!.render(<TooltipProvider><ConversationPermissionSelect value="request_approval" disabled={false} deferred={false} onChange={changed} /></TooltipProvider>));
  const trigger = node.querySelector<HTMLButtonElement>('[aria-label="权限模式"]')!;
  expect(trigger.textContent).toBe("");
  act(() => trigger.click());
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options).toHaveLength(3);
  expect(options.map(option => option.textContent)).toEqual([
    expect.stringContaining("请求批准"), expect.stringContaining("帮我批准"), expect.stringContaining("完全访问"),
  ]);
  act(() => options[1]!.click());
  expect(changed).toHaveBeenCalledWith("auto_review");
});

it("maps the legacy default to its actual reviewer without changing saved history", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useApplicationSettingsStore.setState({ approvalReviewer: "auto_review" });
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  const changed = vi.fn();
  act(() => root!.render(<TooltipProvider><ConversationPermissionSelect value="ask_before_changes" disabled={false} deferred={false} onChange={changed} /></TooltipProvider>));
  expect(node.querySelector('[aria-label="权限模式"]')?.getAttribute("data-permission-mode")).toBe("auto_review");
  expect(changed).not.toHaveBeenCalled();
});
