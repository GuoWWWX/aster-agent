// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useComposerHistory } from "./use-composer-history.js";
import { useUndoStore } from "../../stores/undo-store.js";

it("restores draft text and mention metadata without consuming application undo", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const [snapshot, setSnapshot] = useState({ text: "", mentions: [] as string[] });
    const ref = useRef<HTMLTextAreaElement>(null);
    const history = useComposerHistory(snapshot, setSnapshot, ref);
    return <><textarea ref={ref} value={snapshot.text} onChange={() => undefined}
      onFocus={history.onFocus} onKeyDown={history.onKeyDown} />
      <button onClick={() => setSnapshot({ text: "@会话", mentions: ["conversation-id"] })}>引用</button>
      <output>{snapshot.mentions.join(",")}</output></>;
  }
  act(() => root.render(<Fixture />));
  act(() => container.querySelector("button")!.click());
  const input = container.querySelector("textarea")!;
  act(() => input.focus());
  act(() => useUndoStore.getState().editor!.undo());
  expect(input.value).toBe("");
  expect(container.querySelector("output")!.textContent).toBe("");
  act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
  expect(input.value).toBe("@会话");
  expect(container.querySelector("output")!.textContent).toBe("conversation-id");
  act(() => root.unmount());
  expect(useUndoStore.getState().editor).toBeNull();
  container.remove();
});
