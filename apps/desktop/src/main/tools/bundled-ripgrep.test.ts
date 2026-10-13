import { describe, expect, it } from "vitest";
import { unpackedRipgrepPath } from "./bundled-ripgrep.js";

describe("bundled ripgrep executable", () => {
  it("resolves packaged executables to their physical unpacked directory", () => {
    expect(unpackedRipgrepPath("C:\\Aster\\resources\\app.asar\\node_modules\\rg.exe"))
      .toBe("C:\\Aster\\resources\\app.asar.unpacked\\node_modules\\rg.exe");
    expect(unpackedRipgrepPath("/Aster/resources/app.asar/node_modules/rg"))
      .toBe("/Aster/resources/app.asar.unpacked/node_modules/rg");
  });
  it("preserves development paths and already unpacked paths", () => {
    for (const filePath of ["C:\\repo\\node_modules\\rg.exe", "/app.asar.unpacked/rg", "/app.asar-cache/rg"]) {
      expect(unpackedRipgrepPath(filePath)).toBe(filePath);
    }
  });
});
