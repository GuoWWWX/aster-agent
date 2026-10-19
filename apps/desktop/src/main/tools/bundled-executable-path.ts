/** Executables and the JS loaders that resolve them must use physical paths outside ASAR. */
export function unpackedExecutablePath(filePath: string): string {
  return filePath.replace(/([\\/])app\.asar([\\/])/u, "$1app.asar.unpacked$2");
}
