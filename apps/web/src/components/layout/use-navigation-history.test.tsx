// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useNavigationHistory } from "./use-navigation-history.js";

it("preserves forward history and drops it after a new visit", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  function Fixture() {
    const [page, setPage] = useState("A");
    const history = useNavigationHistory(page, (entry) => entry, setPage, (entry) => entry !== "deleted");
    return <><output>{page}</output>
      <button id="back" disabled={!history.canGoBack} onClick={history.goBack} />
      <button id="forward" disabled={!history.canGoForward} onClick={history.goForward} />
      {["B", "C", "deleted"].map((entry) => <button id={entry} key={entry} onClick={() => setPage(entry)} />)}</>;
  }
  act(() => root.render(<Fixture />));
  const click = (id: string) => act(() => container.querySelector<HTMLButtonElement>(`#${id}`)!.click());
  click("B"); click("deleted"); click("C"); click("back");
  expect(container.querySelector("output")!.textContent).toBe("B");
  click("forward");
  expect(container.querySelector("output")!.textContent).toBe("C");
  click("back"); click("back"); click("C");
  expect(container.querySelector<HTMLButtonElement>("#forward")!.disabled).toBe(true);
  act(() => root.unmount());
});
