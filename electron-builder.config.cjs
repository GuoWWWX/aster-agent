const path = require("node:path");
const { createRequire } = require("node:module");
const desktopPackage = require("./apps/desktop/package.json");
const requireFromDesktop = createRequire(path.join(__dirname, "apps/desktop/package.json"));

module.exports = {
  appId: "com.agent.workbench",
  productName: "Aster",
  electronVersion: desktopPackage.devDependencies.electron,
  electronDist: path.dirname(requireFromDesktop("electron")),
  directories: { app: "apps/desktop", output: "release" },
  files: ["dist/**/*.cjs", "package.json", { from: "../web/dist", to: "renderer", filter: ["**/*"] }],
  asar: true,
  // The preview compiler and its browser runtimes are read by esbuild's native child process.
  asarUnpack: ["node_modules/esbuild/**", "node_modules/@esbuild/**", "node_modules/react/**", "node_modules/react-dom/**", "node_modules/scheduler/**", "node_modules/vue/**", "node_modules/@vue/**"],
  // node-pty 1.1 supplies Node-API prebuilds; package scripts verify them in Electron.
  npmRebuild: false,
  win: { target: [{ target: "nsis", arch: ["x64"] }] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: "Aster-${version}-${arch}-setup.${ext}",
  },
  publish: null,
};
