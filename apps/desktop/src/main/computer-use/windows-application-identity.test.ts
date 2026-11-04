import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import source from "./windows-driver.ps1";

describe("Windows application identity", () => {
  it.runIf(process.platform === "win32")("does not authorize a shared frame host in place of its actual application", async () => {
    // Compile the production resolver without starting a control session or showing overlays.
    const prefix = source.slice(0, source.indexOf("[AsterComputer]::Init()"));
    const command = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;try {& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))} catch {[Console]::Error.WriteLine($_.Exception.ToString());exit 1}";
    const child = promisify(execFile)(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 20000 });
    child.child.stdin?.end(`${prefix}
$nativeTokens=$null;$nativeParseErrors=$null
$nativeSource=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString("base64")}'))
[Management.Automation.Language.Parser]::ParseInput($nativeSource,[ref]$nativeTokens,[ref]$nativeParseErrors)|Out-Null
if($nativeParseErrors.Count -gt 0){throw 'Invalid driver syntax'}
$hostPath=[IO.Path]::Combine([Environment]::SystemDirectory,'ApplicationFrameHost.exe')
$appPath='C:\\Apps\\CalculatorApp.exe'
$results=@(
  [AsterComputer]::SelectApplicationPath('C:\\Tools\\Editor.exe',[string[]]@($appPath)),
  [AsterComputer]::SelectApplicationPath($hostPath,[string[]]@($hostPath,$appPath,$appPath.ToUpperInvariant())),
  [AsterComputer]::SelectApplicationPath($hostPath,[string[]]@()),
  [AsterComputer]::SelectApplicationPath($hostPath,[string[]]@($appPath,'C:\\Apps\\Other.exe')),
  [AsterComputer]::SelectApplicationPath('C:\\Tools\\ApplicationFrameHost.exe',[string[]]@($appPath))
)
ConvertTo-Json -InputObject $results -Compress
`);
    const result = await child;
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual([
      "C:\\Tools\\Editor.exe", "C:\\Apps\\CalculatorApp.exe", "", "", "C:\\Tools\\ApplicationFrameHost.exe",
    ]);
  }, 25_000);
});
describe("Windows accessible control coordinates", () => {
  it.runIf(process.platform === "win32")("returns window-relative physical bounds and rejects invisible or out-of-window targets", async () => {
    const prefix = source.slice(0, source.indexOf("[AsterComputer]::Init()"));
    const child = promisify(execFile)(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"], { windowsHide: true, timeout: 20000 });
    child.child.stdin?.end(`${prefix}
$window=[AsterComputer+Rect]::new();$window.Left=100;$window.Top=200;$window.Right=900;$window.Bottom=1400
$values=@(
  [AsterComputer]::ElementBounds($window,[Windows.Rect]::new(200.5,900.5,100,80)),
  [AsterComputer]::ElementBounds($window,[Windows.Rect]::Empty),
  [AsterComputer]::ElementBounds($window,[Windows.Rect]::new(50,200,100,80)),
  [AsterComputer]::ElementBounds($window,[Windows.Rect]::new(850,1300,100,80))
)
ConvertTo-Json -InputObject $values -Compress
`);
    const result = await child;
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual([{ x: 100, y: 700, width: 101, height: 81 }, null, null, null]);
  }, 25_000);
});
