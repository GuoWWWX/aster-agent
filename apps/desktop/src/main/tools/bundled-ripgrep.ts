import { rgPath as resolvedRipgrepPath } from "@vscode/ripgrep";

export function unpackedRipgrepPath(filePath: string): string {
  return filePath.replace(/([\\/])app\.asar([\\/])/u, "$1app.asar.unpacked$2");
}

// Executables cannot be spawned through an ASAR virtual path.
export const rgPath = unpackedRipgrepPath(resolvedRipgrepPath);
