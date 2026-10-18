import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration } from "@agent/protocol";
import { WindowsComputerController } from "./windows-computer-controller.js";
import { ComputerApplicationPermissions, type ComputerAccessDecision } from "./computer-application-permissions.js";
import source from "./windows-driver.ps1";
const exec = promisify(execFile);
async function nativeSession(script: string) {
  const prefix = source.slice(0, source.indexOf("[AsterComputer]::Init()"));
  const command = "$ErrorActionPreference='Stop';try {& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))} catch {[Console]::Error.WriteLine($_.Exception.ToString());exit 1}";
  const child = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 20000 });
  child.child.stdin?.end(`${prefix}\n${script}\n`);
  try { return await child; } catch (error) {
    if (error instanceof Error && "code" in error && "stdout" in error && "stderr" in error) throw new Error(`Native test exited ${String(error.code)}: ${String(error.stdout)} ${String(error.stderr)}`, { cause: error });
    throw error;
  }
}
describe("Windows native control boundary", () => {
  it.runIf(process.platform === "win32")("distinguishes physical Escape and renders four nonactivating, click-through corners", async () => {
    const result = await nativeSession(`
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$isEscape=[AsterControlSession].GetMethod('IsEmergencyEscape',$flags)
if(-not $isEscape.Invoke($null,@(0,256,[uint32]27,[uint32]0))){throw 'physical Escape ignored'}
foreach($event in @(@(0,256,27,16),@(0,256,27,18),@(0,257,27,0),@(-1,256,27,0),@(0,256,13,0),@(0,256,16,0),@(0,256,65,0))){
  if($isEscape.Invoke($null,@([int]$event[0],[int]$event[1],[uint32]$event[2],[uint32]$event[3]))){throw 'not a physical Escape press'}
}
$foregroundMethod=[AsterComputer].GetMethod('GetForegroundWindow',$flags)
$foreground=$foregroundMethod.Invoke($null,@())
$point=[AsterComputer+Point]::new();$point.X=[Windows.Forms.Screen]::PrimaryScreen.Bounds.Left+6;$point.Y=[Windows.Forms.Screen]::PrimaryScreen.Bounds.Top+30
$hitTest=[AsterComputer].GetMethod('WindowFromPoint',$flags)
$underCorner=$hitTest.Invoke($null,@($point))
$session=[AsterControlSession]::Start()
try {
  if($foregroundMethod.Invoke($null,@()) -ne $foreground){throw 'corner stole focus'}
  if($hitTest.Invoke($null,@($point)) -ne $underCorner){throw 'corner blocks pointer input'}
  $fields=[Reflection.BindingFlags]'NonPublic,Instance'
  $overlays=$session.GetType().GetField('overlays',$fields).GetValue($session)
  if($overlays.Count -ne ([Windows.Forms.Screen]::AllScreens.Count*4)){throw 'missing screen corners'}
  foreach($overlay in $overlays){
    $styles=$overlay.GetType().GetProperty('CreateParams',$fields).GetValue($overlay,$null).ExStyle
    if(($styles -band 0x080800a0) -ne 0x080800a0 -or $overlay.ShowInTaskbar -or -not $overlay.Visible){throw 'interactive or hidden corner'}
    if($overlay.Text.Length -ne 0){throw 'overlay leaks into window listing'}
    $image=[Drawing.Bitmap]::new($overlay.Width,$overlay.Height)
    try {
      $overlay.DrawToBitmap($image,[Drawing.Rectangle]::new(0,0,$image.Width,$image.Height))
      $blue=0
      for($y=0;$y -lt $image.Height;$y++){for($x=0;$x -lt $image.Width;$x++){$p=$image.GetPixel($x,$y);if($p.B -gt 180 -and $p.R -lt 130){$blue++}}}
      if($blue -lt 200 -or $blue -gt ($image.Width*$image.Height/3)){throw 'incorrect corner drawing'}
    } finally {$image.Dispose()}
  }
  [Console]::Out.WriteLine('native session verified')
} finally {$session.Dispose()}
if($overlays.Count -ne 0){throw 'corners retained after stop'}
`);
    expect(result.stderr).toBe(""); expect(result.stdout).toContain("native session verified");
  }, 30_000);
  it.runIf(process.platform === "win32")("exits the native helper on a physical Escape without sending keys to the user's desktop", async () => {
    const result = await nativeSession(`
$session=[AsterControlSession]::Start()
$event=[Runtime.InteropServices.Marshal]::AllocHGlobal(32)
try {
  [Runtime.InteropServices.Marshal]::WriteInt32($event,0,27)
  [Runtime.InteropServices.Marshal]::WriteInt32($event,8,0)
  [Console]::Out.WriteLine('session ready')
  $callback=$session.GetType().GetMethod('OnKeyboard',[Reflection.BindingFlags]'NonPublic,Instance')
  $callback.Invoke($session,@(0,[IntPtr]256,$event))|Out-Null
  Start-Sleep -Seconds 5
  throw 'Escape failed to stop the helper'
} finally {[Runtime.InteropServices.Marshal]::FreeHGlobal($event);$session.Dispose()}
`);
    expect(result.stderr).toBe(""); expect(result.stdout).toContain("session ready");
  }, 30_000);
  it.runIf(process.platform === "win32")("compiles actual Win32/UIAutomation driver and denies unapproved targets", async () => {
    const controller = new WindowsComputerController({ getConfiguration: () => ({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true }) });
    try {
      expect(await controller.start()).toMatchObject({ running: true, elevated: false });
      const signal = new AbortController().signal;
      const listed = await controller.execute({ action: "list" }, signal);
      if (!listed.ok) throw new Error(listed.code);
      const windows = z.object({ windows: z.array(z.object({ title: z.string(), authorized: z.boolean() })) }).parse(listed.value).windows;
      expect(windows.every((value) => value.title === "" && !value.authorized)).toBe(true);
      expect(await controller.execute({ action: "observe", windowId: "1" }, signal)).toMatchObject({ ok: false, code: "WINDOW_UNAVAILABLE" });
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
    const prompt = vi.fn<() => Promise<ComputerAccessDecision>>().mockResolvedValue("session");
    const store = { getConfiguration: () => configuration, saveConfiguration: (value: ComputerUseConfiguration) => Object.assign(configuration, value) };
    const controller = new WindowsComputerController(store, new ComputerApplicationPermissions(store, prompt));
    try {
      await controller.start(); const signal = new AbortController().signal;
      let windowId = "";
      await vi.waitFor(async () => {
        const result = await controller.execute({ action: "list" }, signal);
        if (!result.ok) throw new Error(result.code);
        const windows = z.object({ windows: z.array(z.object({ windowId: z.string(), title: z.string(), authorized: z.boolean() })) }).parse(result.value).windows;
        const authorized = windows.filter((value) => value.authorized);
        expect(authorized).toHaveLength(1); windowId = authorized[0]!.windowId;
      }, { timeout: 5000, interval: 100 });
      const observed = await controller.execute({ action: "observe", windowId }, signal);
      expect(observed.ok).toBe(true); expect(JSON.stringify(observed)).toContain("authorized content");
      const screenshot = await controller.execute({ action: "screenshot", windowId }, signal);
      if (!screenshot.ok) throw new Error(screenshot.code);
      expect(z.object({ data: z.string() }).parse(screenshot.value).data).toMatch(/^iVBOR/u);
      configuration.accessMode = "all"; configuration.blockedApplications = [...configuration.applications];
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: false, code: "APPLICATION_BLOCKED" });
      configuration.accessMode = "ask"; configuration.blockedApplications = []; configuration.applications = [];
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: true });
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: true });
      expect(prompt).toHaveBeenCalledOnce(); expect(configuration.applications).toEqual([]);
      controller.stop(); await controller.start(); prompt.mockResolvedValue("deny");
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: false, code: "APPLICATION_ACCESS_DENIED" });
      expect(prompt).toHaveBeenCalledTimes(2);
      controller.stop(); await controller.start(); prompt.mockResolvedValue("permanent");
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: true });
      expect(configuration.applications).toHaveLength(1);
      controller.stop(); await controller.start();
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: true });
      expect(prompt).toHaveBeenCalledTimes(3);
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
