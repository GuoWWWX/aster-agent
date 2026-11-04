# Native overlay document compatibility

Aster renders React portals in a separate native window. Its controls belong to that
window's document, while their JavaScript modules run in the opener. Reading the
global `document.activeElement` therefore reports the wrong focus state.

- `@radix-ui/react-focus-scope@1.1.16`: use the container/candidate's owner document
  for focus listeners, autofocus, Tab wrapping, mutation recovery and input selection.
- `@radix-ui/react-select@2.3.7`: use the content/item's owner document for selecting
  the first candidate, typeahead, pointer leave and scroll indicators.

Both CommonJS and ESM builds are patched. Versions and patch hashes are registered
in `pnpm-workspace.yaml` and `pnpm-lock.yaml`; installation applies the fixes without
manual edits to `node_modules`.

Regression: `pnpm --filter @agent/web exec vitest run src/components/ui/native-overlay-focus.test.tsx`.
The fixture keeps the opener unfocused while a different document owns the dialog.
It checks initial focus, focus during asynchronous preview updates and Select arrow navigation.

When upgrading either package, review the upstream document handling, regenerate
only the patches still needed, and run these regressions plus the normal web suite.
