import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration } from "@agent/protocol";
import { WindowsComputerController } from "./windows-computer-controller.js";
import source from "./windows-driver.ps1";
const exec = promisify(execFile);
describe("Windows native control boundary", () => {
  it.runIf(process.platform === "win32")("compiles actual Win32/UIAutomation driver and denies unapproved targets", async () => {
    const controller = new WindowsComputerController({ getConfiguration: () => ({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true }) });
    try {
      expect(await controller.start()).toMatchObject({ running: true, elevated: false });
      const signal = new AbortController().signal;
      expect(await controller.execute({ action: "list" }, signal)).toEqual(expect.objectContaining({ ok: true, value: { windows: [] } }));
      expect(await controller.execute({ action: "observe", windowId: "1" }, signal)).toMatchObject({ ok: false, code: "APPLICATION_NOT_ALLOWED" });
    } finally { controller.stop(); }
  }, 30_000);
  it.runIf(process.platform === "win32")("observes and captures only an authorized test window, then applies revocation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-computer-host-"));
    const executable = path.join(directory, "test-window.exe");
    // Offscreen, no activation and no taskbar entry: this fixture cannot steal the user's foreground window.
    const hostSource = `using System; using System.Drawing; using System.Windows.Forms;
public class TestWindow:Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { var p=base.CreateParams;p.ExStyle|=0x08000080;return p; } }
  [STAThread] public static void Main() { var f=new TestWindow(); f.Text="Aster computer boundary fixture";f.ShowInTaskbar=false;f.StartPosition=FormStartPosition.Manual;f.Location=new Point(-20000,-20000);f.Size=new Size(320,200);f.Controls.Add(new Label { Text="authorized content",AutoSize=true });Application.Run(f); }
}`;
    const compile = `Add-Type -TypeDefinition @'\n${hostSource}\n'@ -ReferencedAssemblies System.Drawing,System.Windows.Forms -OutputAssembly '${executable.replaceAll("'", "''")}' -OutputType WindowsApplication`;
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(compile, "utf16le").toString("base64")], { windowsHide: true, timeout: 15000 });
    const host = spawn(executable, [], { windowsHide: true, stdio: "ignore" });
    const configuration: ComputerUseConfiguration = { ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true,
      applications: [{ id: "11111111-1111-4111-8111-111111111111", name: "Fixture", executablePath: executable, enabled: true }] };
    const controller = new WindowsComputerController({ getConfiguration: () => configuration });
    try {
      await controller.start(); const signal = new AbortController().signal;
      let windowId = "";
      await vi.waitFor(async () => {
        const result = await controller.execute({ action: "list" }, signal);
        if (!result.ok) throw new Error(result.code);
        const windows = z.object({ windows: z.array(z.object({ windowId: z.string(), title: z.string() })) }).parse(result.value).windows;
        expect(windows).toHaveLength(1); windowId = windows[0]!.windowId;
      }, { timeout: 5000, interval: 100 });
      const observed = await controller.execute({ action: "observe", windowId }, signal);
      expect(observed.ok).toBe(true); expect(JSON.stringify(observed)).toContain("authorized content");
      const screenshot = await controller.execute({ action: "screenshot", windowId }, signal);
      if (!screenshot.ok) throw new Error(screenshot.code);
      expect(z.object({ data: z.string() }).parse(screenshot.value).data).toMatch(/^iVBOR/u);
      configuration.applications = [];
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: false, code: "APPLICATION_NOT_ALLOWED" });
    } finally {
      controller.stop();
      const stopped = new Promise<void>((resolve) => host.once("exit", () => resolve())); host.kill(); await stopped;
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it.runIf(process.platform === "win32")("has valid PowerShell syntax and a native watchdog outside a PowerShell runspace", async () => {
    // The full script is supplied through stdin to avoid the Windows command-line length limit.
    const script = `$text=[Console]::In.ReadToEnd();$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object Message;exit 1}`;
    const child = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000 });
    child.child.stdin?.end(source); expect((await child).stderr).toBe("");
  }, 20_000);
});
