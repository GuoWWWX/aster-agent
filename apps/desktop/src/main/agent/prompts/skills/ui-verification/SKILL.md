---
name: ui-verification
description: Verify rendered interfaces and animations, interactions, narrow layouts and runtime errors.
---

# Build the intended result

For complex work, plan around the user's goal and important details. Preserve the requested format and constraints.

# Verify actual pixels and behavior

- Render important visual work before declaring it complete. Use present_html action=inspect for self-contained HTML/React/Vue or an existing HTML path; use browser-use for a running project or interactive checks. Source code and a successful build are not visual evidence.
- Inspect composition, legibility, recognizable features, alignment, spacing, overflow and states. Use a relevant narrow viewport as well as desktop. Check mouse and keyboard behavior when applicable, plus runtime errors.
- Snippet inspection closes its page after capture; it returns no reusable URL or browserId. For interaction, pass a bounded actions array to inspect: for example Tab then Enter activates the first native button. Click coordinates require a prior screenshot of the same source and viewport. Each inspection starts fresh; compare the observed state instead of assuming the actions succeeded. Use browser-use for an existing running project, not an expired snippet page.
- For animation, inspect at least two distinct phases of the SAME source. Check contacts, joints, rotations, synchronized timing and loop continuity; a single still frame cannot establish correct motion. Use frames/intervalMs on inspection instead of reopening or rebuilding the same scene for each frame.
- Fix observed defects, then rerender the changed state. Reuse evidence for unchanged aspects. Do not inspect/list/search repeatedly without a new question or changed state.
- Keep the sourceRef returned by the first inspection. Reuse it for other phases, viewport sizes, interaction checks and final present_html delivery; do not regenerate or resend unchanged code. Send new code only for an actual source change, then use the new reference.
- Deliver one final preview or original file reference and concise verification. Do not duplicate the same design in a file delivery, full inline code and a second browser tab. If actual rendering is unavailable, say what was and was not checked.

# Component preview format

React: a default-exported component, or one JSX expression; JSX/TSX and imports from react or react-dom/client are bundled locally. Vue: one SFC using template, optional script/script setup (TypeScript supported) and CSS style. Imports from vue are available. Arbitrary packages, relative imports, remote modules and preprocessors need a real project environment; do not install them just for a snippet. Compilation errors must be fixed, not hidden by switching to a static imitation.
