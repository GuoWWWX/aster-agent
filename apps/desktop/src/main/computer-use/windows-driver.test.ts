import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { computerUseArgumentsSchema, DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration } from "@agent/protocol";
import { WindowsComputerController } from "./windows-computer-controller.js";
import { ComputerApplicationPermissions, type ComputerAccessDecision } from "./computer-application-permissions.js";
import source from "./windows-driver.ps1";
const exec = promisify(execFile);
async function nativeSession(script: string, driver = source) {
  const prefix = driver.slice(0, driver.indexOf("[AsterComputer]::Init()"));
  const command = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;try {& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))} catch {[Console]::Error.WriteLine($_.Exception.ToString());exit 1}";
  const child = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 20000 });
  child.child.stdin?.end(`${prefix}\n${script}\n`);
  try { return await child; } catch (error) {
    if (error instanceof Error && "code" in error && "stdout" in error && "stderr" in error) throw new Error(`Native test exited ${String(error.code)}: ${String(error.stdout)} ${String(error.stderr)}`, { cause: error });
    throw error;
  }
}
describe("Windows native control boundary", () => {
  it.runIf(process.platform === "win32")("does not reposition stable indicators on polling ticks and restores them only when needed", async () => {
    const counted = source.replace('[DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);',
      '[DllImport("user32.dll",EntryPoint="SetWindowPos",SetLastError=true)] static extern bool NativeSetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);public static int PositionChanges;static bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags){PositionChanges++;return NativeSetWindowPos(window,after,x,y,width,height,flags);}');
    const result = await nativeSession(`
$assembly=[AsterComputer].Assembly
$hint=[Activator]::CreateInstance($assembly.GetType('AsterControlHint'),[object[]]@([Drawing.Rectangle]::new(-20000,-20000,1200,800)))
$counter=$assembly.GetType('AsterControlOverlay').GetField('PositionChanges')
try {
  $hint.Show();[Windows.Forms.Application]::DoEvents()
  $before=$counter.GetValue($null)
  for($i=0;$i -lt 10;$i++){$hint.KeepOnTop()}
  if($counter.GetValue($null) -ne $before){throw 'idle indicator keeps changing z-order'}
  $hint.TopMost=$false;$hint.KeepOnTop()
  if(-not $hint.TopMost -or $counter.GetValue($null) -ne $before+1){throw 'lost topmost indicator not restored'}
  $hint.KeepOnTop()
  if($counter.GetValue($null) -ne $before+1){throw 'restored indicator keeps changing z-order'}
  [Console]::Out.WriteLine('stable indicator verified')
} finally {$hint.Dispose()}
`, counted);
    expect(result.stdout).toContain("stable indicator verified");
  }, 20_000);
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
  $surface.Bounds=[Drawing.Rectangle]::new(-20000,-20000,400,100)
  $surface.Show();$surface.Refresh();[Windows.Forms.Application]::DoEvents()
  $painted=$false;$paintTimer=[Diagnostics.Stopwatch]::StartNew()
  do {
    $surface.Refresh();[Windows.Forms.Application]::DoEvents()
    $before=[AsterComputer]::Capture($surface.Handle)
    $stream=[IO.MemoryStream]::new([Convert]::FromBase64String($before.data));$bitmap=[Drawing.Bitmap]::new($stream)
    try {$pixel=$bitmap.GetPixel(50,50);$painted=$pixel.G -eq 255 -and $pixel.R -eq 0 -and $pixel.B -eq 0} finally {$bitmap.Dispose();$stream.Dispose()}
    if(-not $painted){Start-Sleep -Milliseconds 25}
  } while(-not $painted -and $paintTimer.ElapsedMilliseconds -lt 2000)
  if(-not $painted){throw 'offscreen fixture did not finish its first paint'}
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

function assertFixtureDirectory(directory: string): void {
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("aster-input-fixture-")) throw new Error("Unexpected fixture cleanup path");
}
const pasteText = "粘贴中文\nText";
const fixtureSource = `using System;using System.IO;using System.Text;using System.Drawing;using System.Runtime.InteropServices;using System.Windows.Forms;
public sealed class InputFixture:Form {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  static string log;IntPtr previous;Point cursor;DataObject clipboard;RichTextBox editor;
  static void Record(string text){File.AppendAllText(log,text+"\\n",Encoding.UTF8);}
  sealed class Area:Panel {
    string label;public Area(string name){label=name;BackColor=Color.LightBlue;}
    protected override void WndProc(ref Message m){
      if(m.Msg==0x20a||m.Msg==0x20e) Record(label+":"+(m.Msg==0x20a?"vertical":"horizontal")+":"+((short)((m.WParam.ToInt64()>>16)&65535)));
      base.WndProc(ref m);
    }
    protected override void OnMouseDown(MouseEventArgs e){Record("down:"+e.Button);base.OnMouseDown(e);}
    protected override void OnMouseMove(MouseEventArgs e){if(e.Button!=MouseButtons.None)Record("held:"+e.X+":"+e.Y);base.OnMouseMove(e);}
    protected override void OnMouseUp(MouseEventArgs e){Record("up:"+e.Button);base.OnMouseUp(e);}
  }
  protected override void OnShown(EventArgs e){base.OnShown(e);Activate();Record("ready");}
  protected override void OnFormClosing(FormClosingEventArgs e){
    if(GetForegroundWindow()==Handle){SetForegroundWindow(previous);Point current;if(GetCursorPos(out current)&&Bounds.Contains(current))SetCursorPos(cursor.X,cursor.Y);}
    try{if(Clipboard.ContainsText()&&Clipboard.GetText()=="${pasteText.replaceAll("\r", "\\r").replaceAll("\n", "\\n")}"&&clipboard!=null)Clipboard.SetDataObject(clipboard,true);}catch(ExternalException){}
    base.OnFormClosing(e);
  }
  [STAThread]public static void Main(string[] args){
    SetProcessDPIAware();log=args[0];var form=new InputFixture();form.previous=GetForegroundWindow();Point originalCursor;GetCursorPos(out originalCursor);form.cursor=originalCursor;
    try{var current=Clipboard.GetDataObject();form.clipboard=new DataObject();if(current!=null)foreach(string format in current.GetFormats(false)){object value=current.GetData(format,false);if(value!=null)form.clipboard.SetData(format,value);}}catch(ExternalException){}
    form.Text="Aster input-only acceptance fixture";form.FormBorderStyle=FormBorderStyle.None;form.StartPosition=FormStartPosition.CenterScreen;form.Size=new Size(600,360);form.ShowInTaskbar=false;form.KeyPreview=true;
    form.Controls.Add(new Area("left"){Bounds=new Rectangle(0,0,280,210)});form.Controls.Add(new Area("right"){Bounds=new Rectangle(300,0,280,210)});
    form.editor=new RichTextBox{Bounds=new Rectangle(10,230,570,100),Multiline=true};form.editor.TextChanged+=delegate{Record("text:"+Convert.ToBase64String(Encoding.UTF8.GetBytes(form.editor.Text)));};form.Controls.Add(form.editor);
    form.KeyDown+=delegate(object sender,KeyEventArgs e){Record("key:"+e.KeyCode+":"+e.Control+":"+e.Shift+":"+e.Alt);};
    var timer=new Timer{Interval=25};bool wasHeld=false;timer.Tick+=delegate{if(File.Exists(log+".stop")){form.Close();return;}bool held=GetAsyncKeyState(1)<0;if(wasHeld&&!held)Record("released");wasHeld=held;};timer.Start();
    Application.Run(form);timer.Dispose();
  }
}`;

describe.runIf(process.platform === "win32")("Windows actual input", () => {
  it("scrolls under the pointer on both axes, types/pastes and shortcuts in order, drags, and releases on cancellation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-input-fixture-"));
    const executable = path.join(directory, "input-fixture.exe"), log = path.join(directory, "events.txt");
    const compile = `$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;try{Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -ReferencedAssemblies System.Drawing,System.Windows.Forms -OutputAssembly '${executable.replaceAll("'", "''")}' -OutputType WindowsApplication}catch{[Console]::Error.WriteLine($_.Exception.ToString());exit 1}`;
    const compiled = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", compile], { windowsHide: true, timeout: 15000 });
    compiled.child.stdin?.end(fixtureSource); await compiled;
    const host = spawn(executable, [log], { windowsHide: true, stdio: "ignore" });
    const controller = new WindowsComputerController({ getConfiguration: () => ({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true,
      applications: [{ id: "11111111-1111-4111-8111-111111111111", name: "Input fixture", executablePath: executable, enabled: true }] }) });
    const events = async (): Promise<string> => readFile(log, "utf8");
    try {
      await vi.waitFor(async () => expect(await events()).toContain("ready"), { timeout: 5000 });
      await controller.start();
      const signal = new AbortController().signal;
      const listed = await controller.execute({ action: "list" }, signal);
      if (!listed.ok) throw new Error(listed.code);
      const windows = z.object({ windows: z.array(z.object({ windowId: z.string(), authorized: z.boolean() })) }).parse(listed.value).windows;
      const target = windows.find((window) => window.authorized);
      if (target === undefined) throw new Error("Input fixture was not listed");
      const act = (input: Record<string, unknown>) => controller.execute(computerUseArgumentsSchema.parse({ ...input, windowId: target.windowId }), signal);
      const focused = await act({ action: "focus" });
      if (!focused.ok) throw new Error(`Fixture focus failed: ${focused.code}`);
      expect(await act({ action: "move", x: 90, y: 80 })).toMatchObject({ ok: true });
      expect(await act({ action: "scroll", delta: -2 })).toMatchObject({ ok: true });
      await vi.waitFor(async () => expect(await events()).toContain("left:vertical:-240"));
      expect(await act({ action: "scroll", x: 390, y: 80, delta: 3, axis: "horizontal" })).toMatchObject({ ok: true });
      await vi.waitFor(async () => expect(await events()).toContain("right:horizontal:360"));
      expect(await act({ action: "scroll", delta: -1, axis: "horizontal" })).toMatchObject({ ok: true });
      await vi.waitFor(async () => expect(await events()).toContain("right:horizontal:-120"));
      expect(await act({ action: "sequence", steps: [
        { action: "click", x: 30, y: 260 }, { action: "key", key: "A", modifiers: ["control"] }, { action: "key", key: "Backspace" }, { action: "type", text: "输入😀" },
        { action: "key", key: "A", modifiers: ["control"] }, { action: "paste", text: pasteText },
        { action: "key", key: "F12", modifiers: ["control", "shift"] },
      ] })).toMatchObject({ ok: true, value: { completedSteps: 7 } });
      await vi.waitFor(async () => {
        const history = await events();
        expect(history).toContain(`text:${Buffer.from("输入😀").toString("base64")}`);
        expect(history).toContain(`text:${Buffer.from(pasteText).toString("base64")}`);
        expect(history).toContain("key:F12:True:True:False");
      });
      expect(await act({ action: "drag", path: [{ x: 40, y: 80 }, { x: 140, y: 120 }, { x: 240, y: 80 }], durationMs: 450 })).toMatchObject({ ok: true });
      await vi.waitFor(async () => { const history = await events(); expect(history).toContain("held:"); expect(history).toContain("up:Left"); });
      const before = await events();
      expect(await act({ action: "sequence", steps: [{ action: "move", x: 50, y: 50 }, { action: "move", x: 30000, y: 0 }, { action: "click", x: 50, y: 50 }] }))
        .toMatchObject({ ok: false, code: "POINT_OUTSIDE_WINDOW", completedSteps: 1, failedStep: 2 });
      expect((await events()).slice(before.length)).not.toContain("down:");
      const abort = new AbortController();
      const dragStart = (await events()).length;
      const dragging = controller.execute(computerUseArgumentsSchema.parse({ action: "drag", windowId: target.windowId, path: [{ x: 40, y: 80 }, { x: 240, y: 80 }], durationMs: 5000 }), abort.signal);
      const cancelled = expect(dragging).rejects.toMatchObject({ code: "PROCESS_CANCELLED" });
      await vi.waitFor(async () => expect((await events()).slice(dragStart)).toContain("down:Left"));
      abort.abort(); await cancelled;
      await vi.waitFor(async () => expect((await events()).slice(dragStart)).toContain("released"), { timeout: 1500, interval: 30 });
      expect(controller.getStatus().running).toBe(false);
    } finally {
      controller.stop();
      // Close only this fixture, allowing it to restore focus/pointer and an unchanged test clipboard.
      await writeFile(`${log}.stop`, "stop");
      if (host.exitCode === null) { const exited = new Promise<void>((resolve) => host.once("exit", () => resolve())); await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1500))]); }
      if (host.exitCode === null) { const exited = new Promise<void>((resolve) => host.once("exit", () => resolve())); host.kill(); await exited; }
      assertFixtureDirectory(directory);
      await rm(directory, { recursive: true, force: true });
    }
  }, 45_000);

  it("releases only tool-owned inputs, including partial batches, without sending real shortcuts to the desktop", async () => {
    // Replace only the OS input boundary: run the real ownership/cleanup logic with recorded packets.
    const prefix = source.slice(0, source.indexOf("[AsterComputer]::Init()"))
      .replace('[DllImport("user32.dll")] static extern uint SendInput(uint n, Input[] inputs, int size);',
        'public static readonly List<Input> Packets=new List<Input>();public static bool FailNext;static uint SendInput(uint n,Input[] inputs,int size){Packets.AddRange(inputs);if(FailNext){FailNext=false;return n-1;}return n;}');
    const command = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;try {& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))}catch{[Console]::Error.WriteLine($_.Exception.ToString());exit 1}";
    const child = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 15000 });
    child.child.stdin?.end(`${prefix}\n
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$held=[AsterComputer].GetField('heldInputs',$flags).GetValue($null)
$virtual=[AsterComputer].GetMethod('VirtualKey',$flags)
$release=$virtual.Invoke($null,@([uint16]91,$true));$held.Add($release)
$mouse=[AsterComputer].GetMethod('MouseEvent',$flags).Invoke($null,@([uint32]4));$held.Add($mouse)
[AsterComputer]::ReleaseInputs();[AsterComputer]::ReleaseInputs()
if([AsterComputer]::Packets.Count -ne 2 -or $held.Count -ne 0){throw 'held inputs retained or duplicate release'}
if([AsterComputer]::Packets[0].Data.Key.Flags -ne 3 -or [AsterComputer]::Packets[1].Data.Mouse.Flags -ne 4){throw 'incorrect key/button release'}
$session=[AsterControlSession]::Start();[AsterComputer]::Session=$session
try {
  $window=[AsterComputer].GetMethod('GetForegroundWindow',$flags).Invoke($null,@())
  [AsterComputer]::Packets.Clear()
  [AsterComputer]::Press($window,80,[uint16[]]@(17,16,18,91))
  $actual=@([AsterComputer]::Packets|ForEach-Object {$_.Data.Key.Vk})
  if(($actual -join ',') -ne '17,16,18,91,80,80,91,18,16,17'){throw 'shortcut press/release order is wrong'}
  if($held.Count -ne 0){throw 'shortcut retained input state'}
  [AsterComputer]::Packets.Clear();[AsterComputer]::FailNext=$true
  try {[AsterComputer]::Press($window,80,[uint16[]]@(17));throw 'partial input was accepted'}
  catch {if(-not $_.Exception.ToString().Contains('INPUT_BLOCKED')){throw}}
  if($held.Count -ne 0 -or [AsterComputer]::Packets.Count -ne 6){throw 'partial input was not released'}
  if([AsterComputer]::Packets[4].Data.Key.Vk -ne 80 -or [AsterComputer]::Packets[5].Data.Key.Vk -ne 17){throw 'wrong partial-input release'}
} finally {$session.Dispose()}
[Console]::Out.WriteLine('owned inputs released')
`);
    expect((await child).stdout).toContain("owned inputs released");
  }, 20_000);
});
