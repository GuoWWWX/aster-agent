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
  const command = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;try {& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))} catch {[Console]::Error.WriteLine($_.Exception.ToString());exit 1}";
  const child = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 20000 });
  child.child.stdin?.end(`${prefix}\n${script}\n`);
  try { return await child; } catch (error) {
    if (error instanceof Error && "code" in error && "stdout" in error && "stderr" in error) throw new Error(`Native test exited ${String(error.code)}: ${String(error.stdout)} ${String(error.stderr)}`, { cause: error });
    throw error;
  }
}
describe("Windows native control boundary", () => {
  it.runIf(process.platform === "win32")("renders all corners and a capture-excluded, noninteractive control hint on every screen", async () => {
    const result = await nativeSession(`
$flags=[Reflection.BindingFlags]'NonPublic,Static'
Add-Type -TypeDefinition 'public static class AsterIndicatorOrder { [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr FindWindow(string cls,string title); [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetTopWindow(System.IntPtr window); [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetWindow(System.IntPtr window,uint command); public static bool Above(System.IntPtr a,System.IntPtr b) { for(System.IntPtr w=GetTopWindow(System.IntPtr.Zero);w!=System.IntPtr.Zero;w=GetWindow(w,2)) {if(w==a)return true;if(w==b)return false;}return false;} }'
$taskbar=[AsterIndicatorOrder]::FindWindow('Shell_TrayWnd',$null)
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
$hintPoint=[AsterComputer+Point]::new();$hintPoint.X=[Windows.Forms.Screen]::PrimaryScreen.Bounds.Left+([Windows.Forms.Screen]::PrimaryScreen.Bounds.Width/2);$hintPoint.Y=[Windows.Forms.Screen]::PrimaryScreen.Bounds.Top+26
$underHint=$hitTest.Invoke($null,@($hintPoint))
$session=[AsterControlSession]::Start()
try {
  if($foregroundMethod.Invoke($null,@()) -ne $foreground){throw 'corner stole focus'}
  if($hitTest.Invoke($null,@($point)) -ne $underCorner){throw 'corner blocks pointer input'}
  if($hitTest.Invoke($null,@($hintPoint)) -ne $underHint){throw 'hint blocks pointer input'}
  $fields=[Reflection.BindingFlags]'NonPublic,Instance'
  $overlays=$session.GetType().GetField('overlays',$fields).GetValue($session)
  if($overlays.Count -ne ([Windows.Forms.Screen]::AllScreens.Count*5)){throw 'missing screen corners or control hint'}
  $hintCount=0
  foreach($overlay in $overlays){
    $styles=$overlay.GetType().GetProperty('CreateParams',$fields).GetValue($overlay,$null).ExStyle
    if(($styles -band 0x080800a0) -ne 0x080800a0 -or $overlay.ShowInTaskbar -or -not $overlay.Visible){throw 'interactive or hidden corner'}
    if($overlay.Text.Length -ne 0){throw 'overlay leaks into window listing'}
    if(-not $overlay.CaptureExcluded){throw 'overlay appears in screen capture'}
    if([AsterComputer]::PathOf($overlay.Handle) -ne ''){throw 'AI can identify control overlay'}
    $screen=[Windows.Forms.Screen]::AllScreens[[int][Math]::Floor($overlays.IndexOf($overlay)/5)].Bounds
    $actual=[AsterComputer]::Bounds($overlay.Handle)
    $position=$overlays.IndexOf($overlay)%5
    if($position -lt 4){
      $left=if($position -eq 1 -or $position -eq 2){$screen.Right-72}else{$screen.Left}
      $top=if($position -ge 2){$screen.Bottom-72}else{$screen.Top}
      if($actual.Left -ne $left -or $actual.Top -ne $top -or $actual.Right-$actual.Left -ne 72 -or $actual.Bottom-$actual.Top -ne 72){throw 'corner is outside physical screen edge'}
    }else{
      $hintCount++
      if($overlay.GetType().GetField('HintText').GetValue($null) -ne '电脑控制中 · ESC 退出'){throw 'incorrect control hint text'}
      if([Math]::Abs((($actual.Left+$actual.Right)/2)-(($screen.Left+$screen.Right)/2)) -gt 1 -or $actual.Top -ne $screen.Top+12){throw 'hint is not centered at screen top'}
    }
    $image=[Drawing.Bitmap]::new($overlay.Width,$overlay.Height)
    try {
      $overlay.DrawToBitmap($image,[Drawing.Rectangle]::new(0,0,$image.Width,$image.Height))
      $blue=0
      for($y=0;$y -lt $image.Height;$y++){for($x=0;$x -lt $image.Width;$x++){$p=$image.GetPixel($x,$y);if($p.B -gt 180 -and $p.R -lt 130){$blue++}}}
      if($position -lt 4 -and ($blue -lt 200 -or $blue -gt ($image.Width*$image.Height/3))){throw 'incorrect corner drawing'}
      if($position -eq 4 -and $blue -lt ($image.Width*$image.Height/2)){throw 'missing blue hint background'}
    } finally {$image.Dispose()}
    $overlay.TopMost=$false;$overlay.KeepOnTop()
    if(-not $overlay.TopMost){throw 'indicator did not regain topmost position'}
    if($taskbar -ne [IntPtr]::Zero -and -not [AsterIndicatorOrder]::Above($overlay.Handle,$taskbar)){throw 'indicator hidden behind taskbar'}
  }
  if($hintCount -ne [Windows.Forms.Screen]::AllScreens.Count){throw 'missing control hint'}
  if($foregroundMethod.Invoke($null,@()) -ne $foreground){throw 'topmost restoration stole focus'}
  [Console]::Out.WriteLine('native session verified')
} finally {$session.Dispose()}
if($overlays.Count -ne 0){throw 'corners retained after stop'}
`);
    expect(result.stderr).toBe(""); expect(result.stdout).toContain("native session verified");
  }, 30_000);
  it.runIf(process.platform === "win32")("keeps the target-window image unchanged while control indicators are visible", async () => {
    const result = await nativeSession(`
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition 'public sealed class AsterTestSurface : System.Windows.Forms.Form { protected override bool ShowWithoutActivation {get{return true;}} }'
$surface=[AsterTestSurface]::new();$session=$null
try {
  $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
  $surface.FormBorderStyle='None';$surface.StartPosition='Manual';$surface.ShowInTaskbar=$false;$surface.BackColor=[Drawing.Color]::Lime
  $surface.Bounds=[Drawing.Rectangle]::new($screen.Left+($screen.Width/2)-200,$screen.Top,400,100)
  $surface.Show();$surface.Refresh();[Windows.Forms.Application]::DoEvents()
  $before=[AsterComputer]::Capture($surface.Handle)
  $session=[AsterControlSession]::Start()
  $after=[AsterComputer]::Capture($surface.Handle)
  if($before.data -ne $after.data){throw 'control indicator leaked into target screenshot'}
  if(@([AsterComputer]::Windows() | Where-Object { $_.windowId -eq $surface.Handle.ToInt64().ToString() }).Count -ne 0){throw 'control-process windows exposed to AI'}
  [Console]::Out.WriteLine('capture isolated')
} finally {if($null -ne $session){$session.Dispose()};$surface.Dispose()}
`);
    expect(result.stderr).toBe(""); expect(result.stdout).toContain("capture isolated");
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
      await controller.start(); let signal = new AbortController().signal;
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
      controller.stop(); await controller.start(); signal = new AbortController().signal; prompt.mockResolvedValue("deny");
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: false, code: "APPLICATION_ACCESS_DENIED" });
      expect(prompt).toHaveBeenCalledTimes(2);
      controller.stop(); await controller.start(); signal = new AbortController().signal; prompt.mockResolvedValue("permanent");
      expect(await controller.execute({ action: "screenshot", windowId }, signal)).toMatchObject({ ok: true });
      expect(configuration.applications).toHaveLength(1);
      controller.stop(); await controller.start(); signal = new AbortController().signal;
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
