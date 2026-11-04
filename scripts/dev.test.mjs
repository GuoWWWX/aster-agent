import assert from "node:assert/strict";
import { test } from "node:test";
import { devCommands } from "./dev.mjs";

test("root development uses the same explicit port for Vite and its readiness gate", () => {
  for (const port of [5173, 5177]) {
    const commands = devCommands(`http://127.0.0.1:${port}`);
    assert.ok(commands[0].command.includes(`--port ${port} --strictPort`));
    assert.ok(commands[1].command.includes(`tcp:127.0.0.1:${port}`));
  }
  assert.deepEqual(devCommands(), devCommands("http://127.0.0.1:5173"));
});
test("root development rejects remote URLs and shell-bearing origins", () => {
  for (const url of ["https://remote.test", "http://user:password@127.0.0.1:5177", "http://127.0.0.1:5177/;echo", "http://127.0.0.1:5177/?args=extra"]) {
    assert.throws(() => devCommands(url));
  }
});
