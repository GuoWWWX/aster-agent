---
name: ui-verification
description: Inspect rendered interfaces, animation phases, requested interactions and observed defects.
---

# Build the intended result

For complex work, plan around the user's goal and important details. Preserve the requested format and constraints.

# Verify actual pixels and behavior

- Render important visual work before declaring it complete. Use present_html action=inspect for self-contained HTML/React/Vue or an existing HTML path; use browser-use for a running project or interactive checks. Source code and a successful build are not visual evidence.
- Inspect composition, legibility, recognizable features, alignment, overflow and required states. Use the current client's viewport by default. Add phone/tablet or other sizes only when requested or needed to investigate an observed defect. Check relevant interactions and runtime errors within the requested scope.
- Snippet inspection closes its page after capture; it returns no reusable URL or browserId. For interaction, pass a bounded actions array to inspect: for example Tab then Enter activates the first native button. Click coordinates require a prior screenshot of the same source and viewport. Each inspection starts fresh; compare the observed state instead of assuming the actions succeeded. Use browser-use for an existing running project, not an expired snippet page.
- For animation, use frames/intervalMs in one inspection to sample distinct phases of the SAME source. Check contacts, joints, rotations, timing and continuity. Extra inspections need a new verification question, changed source or an observed defect.
- Fix observed defects, then rerender the changed state. Reuse evidence for unchanged aspects. Do not inspect/list/search repeatedly without a new question or changed state.
- Output snippet source once as a complete html/react/jsx/tsx/vue fence in assistant text, alongside the inspection tool call. Use present_html(action=inspect, sourceRef=latest) to read that fence. Never put snippet source in tool arguments. Reuse the exact returned sourceRef for further checks; output a new fence only for a real source change.
- Final delivery references the returned displayRef as a standalone Markdown link between complete paragraphs. The UI displays the original code block there; do not resend its source or call present again. Existing HTML files still use action=present with path. If rendering is unavailable, state what was and was not checked.

# Component preview format

React: a default-exported component, or one JSX expression; JSX/TSX and imports from react or react-dom/client are bundled locally. Vue: one SFC using template, optional script/script setup (TypeScript supported) and CSS style. Imports from vue are available. Arbitrary packages, relative imports, remote modules and preprocessors need a real project environment; do not install them just for a snippet. Compilation errors must be fixed, not hidden by switching to a static imitation.
