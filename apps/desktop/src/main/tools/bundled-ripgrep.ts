import { rgPath as resolvedRipgrepPath } from "@vscode/ripgrep";
import { unpackedExecutablePath } from "./bundled-executable-path.js";
export { unpackedExecutablePath as unpackedRipgrepPath } from "./bundled-executable-path.js";

// Executables cannot be spawned through an ASAR virtual path.
export const rgPath = unpackedExecutablePath(resolvedRipgrepPath);
