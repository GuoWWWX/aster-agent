// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fillBrowserLogin, readBrowserLogin } from "./browser-password-form.js";
const login = { origin: "https://example.com", username: "tester", password: "test-secret" };
afterEach(() => document.body.replaceChildren());
describe("browser login forms", () => {
  it("never treats a password field named user_password as the username", () => {
    document.body.innerHTML = '<form><input type="password" name="user_password" value="test-secret"></form>';
    expect(readBrowserLogin(document.forms[0]!, login.origin)?.username).toBe("");
  });
  it("fills an empty login form, emits input events and reads a submitted credential", () => {
    document.body.innerHTML = '<form><input autocomplete="username"><input type="password"></form>';
    let inputs = 0;
    document.addEventListener("input", () => inputs++, { once: true });
    fillBrowserLogin(document, login);
    expect(readBrowserLogin(document.forms[0]!, login.origin)).toEqual(login);
    expect(inputs).toBe(1);
  });
  it("preserves user-entered values and never fills a different account", () => {
    document.body.innerHTML = '<form><input autocomplete="username" value="another"><input type="password"></form>';
    fillBrowserLogin(document, login);
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    document.body.innerHTML = '<form><input type="password" value="entered"></form>';
    fillBrowserLogin(document, login);
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("entered");
  });
  it.each([
    '<form><input type="password" autocomplete="new-password"></form>',
    '<form><input type="password"><input type="password"></form>',
  ])("skips registration and password-change forms", (html) => {
    document.body.innerHTML = html;
    fillBrowserLogin(document, login);
    expect(readBrowserLogin(document.forms[0]!, login.origin)).toBeNull();
    expect([...document.querySelectorAll<HTMLInputElement>('input')].every((input) => input.value === "")).toBe(true);
  });
});
