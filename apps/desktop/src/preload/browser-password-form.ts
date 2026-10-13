import type { BrowserCredential } from "@agent/protocol";

function passwordInput(root: ParentNode): HTMLInputElement | null {
  const fields = [...root.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  if (fields.length !== 1 || fields[0]?.autocomplete === "new-password") return null;
  return fields[0] ?? null;
}

function usernameInput(root: ParentNode): HTMLInputElement | null {
  const fields = [...root.querySelectorAll<HTMLInputElement>('input:not([type="password"]):not([type="hidden"])')];
  return fields.find((input) => input.autocomplete === "username" || input.type === "email" || /user|login/iu.test(input.name))
    ?? fields.find((input) => input.type === "text") ?? null;
}

export function readBrowserLogin(form: HTMLFormElement, origin: string): BrowserCredential | null {
  const password = passwordInput(form);
  if (password === null || password.value === "" || password.disabled) return null;
  return { origin, username: usernameInput(form)?.value ?? "", password: password.value };
}

export function fillBrowserLogin(document: Document, credential: BrowserCredential): void {
  for (const form of document.forms) {
    const password = passwordInput(form);
    if (password === null || password.value !== "" || password.disabled || password.readOnly) continue;
    const username = usernameInput(form);
    if (username !== null && username.value !== "" && username.value !== credential.username) continue;
    const setValue = (input: HTMLInputElement, value: string): void => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.bind(input);
      setter?.(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (username !== null && !username.disabled && !username.readOnly) setValue(username, credential.username);
    setValue(password, credential.password);
  }
}
