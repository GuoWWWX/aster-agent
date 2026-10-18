param([string]$PipeName, [string]$Token)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms, WindowsBase -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
public static class AsterComputer {
  public static IDisposable Deadline() { return new System.Threading.Timer(delegate(object _) { Environment.Exit(3); },null,20000,System.Threading.Timeout.Infinite); }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort Vk,Scan; public uint Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Mouse Mouse; [FieldOffset(0)] public Keyboard Key; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public Union Data; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr p, int flags, StringBuilder path, ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern uint SendInput(uint n, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  public static void Init() { SetProcessDPIAware(); }
  public static string PathOf(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    IntPtr p=OpenProcess(0x1000,false,pid); if(p==IntPtr.Zero) return "";
    try { int size=4096; StringBuilder s=new StringBuilder(size); return QueryFullProcessImageName(p,0,s,ref size) ? s.ToString() : ""; }
    finally { CloseHandle(p); }
  }
  public static object[] Windows() {
    List<object> values=new List<object>();
    EnumWindows(delegate(IntPtr h, IntPtr _) {
      if(IsWindowVisible(h)) {
        StringBuilder title=new StringBuilder(512); GetWindowText(h,title,512);
        if(title.Length>0) values.Add(new { windowId=h.ToInt64().ToString(), title=title.ToString(), executablePath=PathOf(h) });
      }
      return true;
    },IntPtr.Zero); return values.ToArray();
  }
  public static Rect Bounds(IntPtr h) {
    Rect r; if(!GetWindowRect(h,out r) || r.Right<=r.Left || r.Bottom<=r.Top) throw new Exception("WINDOW_UNAVAILABLE");
    return r;
  }
  public static void Focus(IntPtr h) {
    if(GetForegroundWindow()!=h) SetForegroundWindow(h);
    if(GetForegroundWindow()!=h) throw new Exception("FOCUS_REQUIRED");
    foreach(int vk in new int[]{0x10,0x11,0x12,0x5b,0x5c}) if(GetAsyncKeyState(vk)<0) throw new Exception("USER_INPUT_ACTIVE");
  }
  static Input Key(ushort key, bool up, bool unicode) {
    return new Input { Type=1, Data=new Union { Key=new Keyboard { Vk=unicode ? (ushort)0 : key, Scan=unicode ? key : (ushort)0, Flags=(uint)((unicode?4:0)|(up?2:0)) } } };
  }
  static void Send(IntPtr h, Input[] values) {
    if(GetForegroundWindow()!=h) throw new Exception("FOCUS_CHANGED");
    if(SendInput((uint)values.Length,values,Marshal.SizeOf(typeof(Input)))!=values.Length) throw new Exception("INPUT_BLOCKED");
  }
  static Input At(IntPtr h, int x, int y) {
    Focus(h); Rect r=Bounds(h);
    if(x<0||y<0||x>=r.Right-r.Left||y>=r.Bottom-r.Top) throw new Exception("POINT_OUTSIDE_WINDOW");
    Point p=new Point { X=r.Left+x,Y=r.Top+y };
    if(GetAncestor(WindowFromPoint(p),2)!=h) throw new Exception("WINDOW_OCCLUDED");
    // Absolute movement shares the same SendInput batch as the click; the hit test is checked immediately before it.
    int left=System.Windows.Forms.SystemInformation.VirtualScreen.Left;
    int top=System.Windows.Forms.SystemInformation.VirtualScreen.Top;
    int width=System.Windows.Forms.SystemInformation.VirtualScreen.Width;
    int height=System.Windows.Forms.SystemInformation.VirtualScreen.Height;
    return new Input { Type=0,Data=new Union { Mouse=new Mouse { X=(int)((long)(p.X-left)*65535/Math.Max(1,width-1)),Y=(int)((long)(p.Y-top)*65535/Math.Max(1,height-1)),Flags=0xC001 } } };
  }
  public static void Click(IntPtr h, int x, int y, bool right) {
    Input move=At(h,x,y);
    Input down=new Input { Type=0,Data=new Union { Mouse=new Mouse { Flags=right?8u:2u } } };
    Input up=new Input { Type=0,Data=new Union { Mouse=new Mouse { Flags=right?16u:4u } } };
    Send(h,new Input[]{move,down,up});
  }
  public static void Type(IntPtr h,string text) {
    Focus(h);
    foreach(char c in text) Send(h,new Input[]{Key(c,false,true),Key(c,true,true)});
  }
  public static void Press(IntPtr h,ushort key,bool control,bool shift) {
    Focus(h); List<Input> keys=new List<Input>();
    if(control) keys.Add(Key(0x11,false,false)); if(shift) keys.Add(Key(0x10,false,false));
    keys.Add(Key(key,false,false)); keys.Add(Key(key,true,false));
    if(shift) keys.Add(Key(0x10,true,false)); if(control) keys.Add(Key(0x11,true,false));
    Send(h,keys.ToArray());
  }
  public static void Scroll(IntPtr h,int delta) {
    Rect r=Bounds(h); Input move=At(h,(r.Right-r.Left)/2,(r.Bottom-r.Top)/2);
    Send(h,new Input[]{move,new Input { Type=0,Data=new Union { Mouse=new Mouse { Data=unchecked((uint)(delta*120)),Flags=0x0800 } } }});
  }
  public static object Observe(IntPtr h) {
    List<object> elements=new List<object>();
    AutomationElement root=AutomationElement.FromHandle(h);
    Queue<AutomationElement> pending=new Queue<AutomationElement>(); pending.Enqueue(root);
    TreeWalker walker=TreeWalker.ControlViewWalker;
    int chars=0;
    while(pending.Count>0 && elements.Count<150 && chars<16000) {
      AutomationElement current=pending.Dequeue();
      if(!current.Current.IsPassword) {
        string name=current.Current.Name ?? ""; if(name.Length>300) name=name.Substring(0,300); chars+=name.Length;
        elements.Add(new { name=name, type=current.Current.ControlType.ProgrammaticName, enabled=current.Current.IsEnabled });
        AutomationElement child=walker.GetFirstChild(current);
        while(child!=null && pending.Count<200) { pending.Enqueue(child); child=walker.GetNextSibling(child); }
      }
    }
    Rect r=Bounds(h); return new { windowId=h.ToInt64().ToString(),width=r.Right-r.Left,height=r.Bottom-r.Top,elements=elements, truncated=pending.Count>0, coordinateSpace="window_physical_pixels" };
  }
  public static object Capture(IntPtr h) {
    Rect r=Bounds(h); int w=r.Right-r.Left, height=r.Bottom-r.Top;
    if(w>4096||height>4096) throw new Exception("WINDOW_TOO_LARGE");
    using(Bitmap image=new Bitmap(w,height)) using(Graphics graphics=Graphics.FromImage(image)) {
      IntPtr dc=graphics.GetHdc(); bool captured; try { captured=PrintWindow(h,dc,2); } finally { graphics.ReleaseHdc(dc); }
      if(!captured) throw new Exception("CAPTURE_UNAVAILABLE");
      using(MemoryStream stream=new MemoryStream()) { image.Save(stream,ImageFormat.Png); return new { width=w,height=height,data=Convert.ToBase64String(stream.ToArray()) }; }
    }
  }
}
'@
[AsterComputer]::Init()
$pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [IO.Pipes.PipeDirection]::InOut)
try {
  $pipe.Connect(15000)
  $reader = [IO.StreamReader]::new($pipe, [Text.UTF8Encoding]::new($false))
  $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false)); $writer.AutoFlush = $true
  $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $writer.WriteLine((@{ token=$Token; elevated=$elevated } | ConvertTo-Json -Compress))
  while ($null -ne ($line = $reader.ReadLine())) {
    $timer = [AsterComputer]::Deadline()
    try {
      $request = $line | ConvertFrom-Json
      $command = $request.command
      $allowed = @($request.applications | Where-Object { $_.enabled })
      if ($command.action -eq 'list') {
        $windows = @([AsterComputer]::Windows() | Where-Object { $candidate=$_; $allowed | Where-Object { [String]::Equals($_.executablePath,$candidate.executablePath,[StringComparison]::OrdinalIgnoreCase) } } | ForEach-Object {
          $window=$_; $application=$allowed | Where-Object { [String]::Equals($_.executablePath,$window.executablePath,[StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
          @{ windowId=$window.windowId; title=$window.title; applicationId=$application.id; name=$application.name }
        })
        $value = @{ windows=$windows }
      } elseif ($command.action -eq 'launch') {
        $application = $allowed | Where-Object { $_.id -eq $command.applicationId } | Select-Object -First 1
        if ($null -eq $application) { throw 'APPLICATION_NOT_ALLOWED' }
        $start = [Diagnostics.ProcessStartInfo]::new($application.executablePath); $start.UseShellExecute=$false
        $process = [Diagnostics.Process]::Start($start)
        $value = @{ launched=$true; processId=$process.Id }
      } else {
        $window = [IntPtr]::new([long]$command.windowId)
        $path = [AsterComputer]::PathOf($window)
        if (-not ($allowed | Where-Object { [String]::Equals($_.executablePath,$path,[StringComparison]::OrdinalIgnoreCase) })) { throw 'APPLICATION_NOT_ALLOWED' }
        switch ($command.action) {
          'observe' { $value = [AsterComputer]::Observe($window) }
          'screenshot' { $value = [AsterComputer]::Capture($window) }
          'click' { [AsterComputer]::Click($window,$command.x,$command.y,($command.button -eq 'right')); $value=@{ performed=$true } }
          'type' { [AsterComputer]::Type($window,$command.text); $value=@{ performed=$true } }
          'key' {
            $codes=@{ Enter=13;Tab=9;Escape=27;Backspace=8;Delete=46;Home=36;End=35;PageUp=33;PageDown=34;Left=37;Right=39;Up=38;Down=40;Space=32 }
            $code=$codes[$command.key]; if ($null -eq $code -and $command.key -cmatch '^[A-Z]$') { $code=[int][char]$command.key }
            if ($null -eq $code) { throw 'INVALID_KEY' }
            [AsterComputer]::Press($window,$code,($command.modifiers -contains 'control'),($command.modifiers -contains 'shift')); $value=@{ performed=$true }
          }
          'scroll' { [AsterComputer]::Scroll($window,$command.delta); $value=@{ performed=$true } }
          default { throw 'INVALID_ACTION' }
        }
      }
      $response=@{ id=$request.id; ok=$true; value=$value }
    } catch {
      $codes=@('APPLICATION_NOT_ALLOWED','WINDOW_UNAVAILABLE','FOCUS_REQUIRED','USER_INPUT_ACTIVE','FOCUS_CHANGED','INPUT_BLOCKED','POINT_OUTSIDE_WINDOW','WINDOW_OCCLUDED','WINDOW_TOO_LARGE','CAPTURE_UNAVAILABLE','INVALID_KEY','INVALID_ACTION')
      $code='COMPUTER_OPERATION_FAILED'
      foreach ($candidate in $codes) { if ($_.Exception.ToString().Contains($candidate)) { $code=$candidate; break } }
      $response=@{ id=$request.id; ok=$false; code=$code }
    } finally { $timer.Dispose() }
    $writer.WriteLine(($response | ConvertTo-Json -Compress -Depth 12))
  }
} finally { $pipe.Dispose() }
