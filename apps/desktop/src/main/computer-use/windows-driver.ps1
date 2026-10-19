param([string]$PipeName, [string]$Token)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms, WindowsBase -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
// Only this thread owns the hook and overlays; pipe reads and slow UIAutomation calls cannot block Escape.
public sealed class AsterControlSession : IDisposable {
  delegate IntPtr KeyboardHook(int code, IntPtr message, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct KeyEvent { public uint Key,Scan,Flags,Time; public UIntPtr Extra; }
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type,KeyboardHook callback,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string module);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  internal static void Terminate(uint code) { TerminateProcess(GetCurrentProcess(),code); }
  readonly ManualResetEventSlim ready=new ManualResetEventSlim(false);
  readonly List<AsterControlOverlay> overlays=new List<AsterControlOverlay>();
  readonly Thread thread;
  Control dispatcher;
  KeyboardHook callback;
  IntPtr hook;
  Exception failure;
  int active;
  AsterControlSession() { thread=new Thread(Run);thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start(); }
  public static AsterControlSession Start() {
    AsterControlSession session=new AsterControlSession();
    if(!session.ready.Wait(5000) || session.failure!=null || Volatile.Read(ref session.active)==0) {
      session.Dispose(); throw new InvalidOperationException("CONTROL_GUARD_UNAVAILABLE",session.failure);
    }
    return session;
  }
  static bool IsEmergencyEscape(int code,int message,uint key,uint flags) {
    // LLKHF_INJECTED: a model's Escape must still work inside the target app without ending the session.
    return code>=0 && (message==0x100 || message==0x104) && key==27 && (flags&0x12)==0;
  }
  IntPtr OnKeyboard(int code,IntPtr message,IntPtr data) {
    if(code>=0) {
      KeyEvent input=(KeyEvent)Marshal.PtrToStructure(data,typeof(KeyEvent));
      if(IsEmergencyEscape(code,message.ToInt32(),input.Key,input.Flags)) {
        Interlocked.Exchange(ref active,0);
        // Return from the low-level hook promptly. Process exit removes overlays and closes even an elevated pipe.
        // Terminate this disposable helper directly: CLR shutdown inside a WinForms callback can deadlock/crash.
        dispatcher.BeginInvoke(new Action(delegate { Terminate(0); }));
        return new IntPtr(1);
      }
    }
    return CallNextHookEx(hook,code,message,data);
  }
  void RebuildOverlays() {
    foreach(AsterControlOverlay overlay in overlays) overlay.Dispose(); overlays.Clear();
    foreach(Screen screen in Screen.AllScreens) {
      for(int corner=0;corner<4;corner++) {
        AsterControlOverlay overlay=new AsterControlCorner(screen.Bounds,corner); overlays.Add(overlay);overlay.Show();
      }
      AsterControlOverlay hint=new AsterControlHint(screen.Bounds);overlays.Add(hint);hint.Show();
    }
  }
  void DisplayChanged(object sender,EventArgs args) {
    if(Volatile.Read(ref active)!=0) dispatcher.BeginInvoke(new Action(delegate {
      try { RebuildOverlays(); } catch { Terminate(3); }
    }));
  }
  void Run() {
    try {
      using(dispatcher=new Control()) using(System.Windows.Forms.Timer visibility=new System.Windows.Forms.Timer()) {
        dispatcher.CreateControl();callback=OnKeyboard;
        hook=SetWindowsHookEx(13,callback,GetModuleHandle(null),0);
        if(hook==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        RebuildOverlays();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged+=DisplayChanged;
        // Reassert Z-order after taskbar/fullscreen activation without redrawing or taking focus.
        visibility.Interval=1000;
        visibility.Tick+=delegate {
          if(Volatile.Read(ref active)==0) return;
          try { foreach(AsterControlOverlay overlay in overlays) overlay.KeepOnTop(); } catch { Terminate(3); }
        };
        visibility.Start();
        dispatcher.BeginInvoke(new Action(delegate { Volatile.Write(ref active,1);ready.Set(); }));
        Application.Run();
      }
    } catch(Exception error) { failure=error;ready.Set(); }
    finally {
      bool unexpected=Interlocked.Exchange(ref active,0)!=0;Microsoft.Win32.SystemEvents.DisplaySettingsChanged-=DisplayChanged;
      if(hook!=IntPtr.Zero) UnhookWindowsHookEx(hook);
      foreach(AsterControlOverlay overlay in overlays) overlay.Dispose();overlays.Clear();
      if(unexpected) Terminate(3);
    }
  }
  public void CheckActive() { if(Volatile.Read(ref active)==0) throw new OperationCanceledException("CONTROL_STOPPED"); }
  public void Dispose() {
    Interlocked.Exchange(ref active,0);
    if(dispatcher!=null && dispatcher.IsHandleCreated && !dispatcher.IsDisposed) dispatcher.BeginInvoke(new Action(Application.ExitThread));
    if(thread!=Thread.CurrentThread) thread.Join(2000);
  }
}
abstract class AsterControlOverlay : Form {
  [StructLayout(LayoutKind.Sequential)] struct WindowRect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowDisplayAffinity(IntPtr window,uint affinity);
  [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr window,out uint affinity);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out WindowRect bounds);
  readonly Rectangle placement;
  protected AsterControlOverlay(Rectangle bounds) {
    placement=bounds;FormBorderStyle=FormBorderStyle.None;StartPosition=FormStartPosition.Manual;
    ShowInTaskbar=false;TopMost=true;AutoScaleMode=AutoScaleMode.None;DoubleBuffered=true;
    BackColor=Color.Black;TransparencyKey=Color.Black;Bounds=bounds;
  }
  public bool CaptureExcluded { get { uint affinity;return IsHandleCreated && GetWindowDisplayAffinity(Handle,out affinity) && affinity==0x11; } }
  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    if(!SetWindowDisplayAffinity(Handle,0x11) || !CaptureExcluded) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  protected override void OnShown(EventArgs e) { base.OnShown(e);KeepOnTop(); }
  public void KeepOnTop() {
    if(IsDisposed) return;
    if(!TopMost) TopMost=true;
    WindowRect actual;uint flags=0x10|0x400;
    if(GetWindowRect(Handle,out actual) && actual.Left==placement.Left && actual.Top==placement.Top && actual.Right==placement.Right && actual.Bottom==placement.Bottom) flags|=3;
    if(!SetWindowPos(Handle,new IntPtr(-1),placement.X,placement.Y,placement.Width,placement.Height,flags)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { CreateParams p=base.CreateParams;p.ExStyle|=0x080800a0;return p; } }
  protected override void WndProc(ref Message message) {
    if(message.Msg==0x84) { message.Result=new IntPtr(-1);return; } // HTTRANSPARENT
    if(message.Msg==0x21) { message.Result=new IntPtr(3);return; } // MA_NOACTIVATE
    base.WndProc(ref message);
  }
}
sealed class AsterControlCorner : AsterControlOverlay {
  readonly int corner;
  public AsterControlCorner(Rectangle screen,int corner) : base(new Rectangle(corner==1||corner==2 ? screen.Right-72 : screen.Left,corner>=2 ? screen.Bottom-72 : screen.Top,72,72)) { this.corner=corner; }
  protected override void OnPaint(PaintEventArgs e) {
    e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
    e.Graphics.TranslateTransform(36,36);e.Graphics.RotateTransform(corner*90);e.Graphics.TranslateTransform(-36,-36);
    using(Pen pen=new Pen(Color.FromArgb(91,141,239),6)) using(GraphicsPath path=new GraphicsPath()) {
      pen.StartCap=LineCap.Round;pen.EndCap=LineCap.Round;
      path.AddLine(6,64,6,18);path.AddArc(6,6,24,24,180,90);path.AddLine(18,6,64,6);e.Graphics.DrawPath(pen,path);
    }
  }
}
sealed class AsterControlHint : AsterControlOverlay {
  public const string HintText="电脑控制中 · ESC 退出";
  static Rectangle Placement(Rectangle screen) {
    Size text=TextRenderer.MeasureText(HintText,SystemFonts.MessageBoxFont,Size.Empty,TextFormatFlags.NoPadding|TextFormatFlags.SingleLine);
    int width=Math.Min(screen.Width-16,text.Width+32),height=text.Height+16;
    return new Rectangle(screen.Left+(screen.Width-width)/2,screen.Top+12,width,height);
  }
  public AsterControlHint(Rectangle screen) : base(Placement(screen)) {}
  protected override void OnPaint(PaintEventArgs e) {
    e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
    using(GraphicsPath path=new GraphicsPath()) using(Brush background=new SolidBrush(Color.FromArgb(45,105,218))) {
      int right=ClientSize.Width-1,bottom=ClientSize.Height-1,radius=9;
      path.AddArc(0,0,radius*2,radius*2,180,90);path.AddArc(right-radius*2,0,radius*2,radius*2,270,90);
      path.AddArc(right-radius*2,bottom-radius*2,radius*2,radius*2,0,90);path.AddArc(0,bottom-radius*2,radius*2,radius*2,90,90);path.CloseFigure();
      e.Graphics.FillPath(background,path);
    }
    TextRenderer.DrawText(e.Graphics,HintText,SystemFonts.MessageBoxFont,ClientRectangle,Color.White,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.SingleLine|TextFormatFlags.NoPrefix);
  }
}
public static class AsterComputer {
  public static AsterControlSession Session;
  public static IDisposable Deadline() { return new System.Threading.Timer(delegate(object _) { AsterControlSession.Terminate(3); },null,20000,System.Threading.Timeout.Infinite); }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort Vk,Scan; public uint Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Mouse Mouse; [FieldOffset(0)] public Keyboard Key; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public Union Data; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr p, int flags, StringBuilder path, ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
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
  public static string OwnerPathOf(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    IntPtr p=OpenProcess(0x1000,false,pid); if(p==IntPtr.Zero) return "";
    try { int size=4096; StringBuilder s=new StringBuilder(size); return QueryFullProcessImageName(p,0,s,ref size) ? s.ToString() : ""; }
    finally { CloseHandle(p); }
  }
  static bool IsFrameHost(string path) {
    return String.Equals(path,Path.Combine(Environment.SystemDirectory,"ApplicationFrameHost.exe"),StringComparison.OrdinalIgnoreCase);
  }
  public static string SelectApplicationPath(string owner,string[] children) {
    if(!IsFrameHost(owner)) return owner;
    HashSet<string> applications=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach(string child in children) if(!String.IsNullOrWhiteSpace(child) && !IsFrameHost(child)) applications.Add(child);
    if(applications.Count==1) foreach(string application in applications) return application;
    return ""; // Missing or ambiguous application identity must not grant access to the shared host.
  }
  static string ApplicationPathOf(IntPtr h,string owner) {
    if(!IsFrameHost(owner)) return owner;
    uint ownerPid; GetWindowThreadProcessId(h,out ownerPid);
    HashSet<uint> processes=new HashSet<uint>();processes.Add(ownerPid);
    List<string> children=new List<string>();
    EnumChildWindows(h,delegate(IntPtr child,IntPtr _) {
      uint pid; GetWindowThreadProcessId(child,out pid);
      if(pid!=0 && processes.Add(pid)) children.Add(OwnerPathOf(child));
      return true;
    },IntPtr.Zero);
    return SelectApplicationPath(owner,children.ToArray());
  }
  public static bool IsControlWindow(IntPtr h) { uint pid;GetWindowThreadProcessId(h,out pid);return pid!=0 && pid==GetCurrentProcessId(); }
  public static string PathOf(IntPtr h) { return IsControlWindow(h) ? "" : ApplicationPathOf(h,OwnerPathOf(h)); }
  public static object[] Windows() {
    List<object> values=new List<object>();
    EnumWindows(delegate(IntPtr h, IntPtr _) {
      if(IsWindowVisible(h) && !IsControlWindow(h)) {
        StringBuilder title=new StringBuilder(512); GetWindowText(h,title,512);
        if(title.Length>0) {
          string owner=OwnerPathOf(h);
          values.Add(new { windowId=h.ToInt64().ToString(), title=title.ToString(), executablePath=ApplicationPathOf(h,owner), ownerExecutablePath=owner });
        }
      }
      return true;
    },IntPtr.Zero); return values.ToArray();
  }
  public static Rect Bounds(IntPtr h) {
    Rect r; if(!GetWindowRect(h,out r) || r.Right<=r.Left || r.Bottom<=r.Top) throw new Exception("WINDOW_UNAVAILABLE");
    return r;
  }
  public static void Focus(IntPtr h) {
    Session.CheckActive();
    if(GetForegroundWindow()!=h) SetForegroundWindow(h);
    if(GetForegroundWindow()!=h) throw new Exception("FOCUS_REQUIRED");
    foreach(int vk in new int[]{0x10,0x11,0x12,0x5b,0x5c}) if(GetAsyncKeyState(vk)<0) throw new Exception("USER_INPUT_ACTIVE");
  }
  static Input Key(ushort key, bool up, bool unicode) {
    return new Input { Type=1, Data=new Union { Key=new Keyboard { Vk=unicode ? (ushort)0 : key, Scan=unicode ? key : (ushort)0, Flags=(uint)((unicode?4:0)|(up?2:0)) } } };
  }
  static void Send(IntPtr h, Input[] values) {
    Session.CheckActive();
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
  public static object ElementBounds(Rect window,System.Windows.Rect element) {
    if(element.IsEmpty || element.Width<=0 || element.Height<=0) return null;
    double left=element.Left-window.Left,top=element.Top-window.Top,right=element.Right-window.Left,bottom=element.Bottom-window.Top;
    if(left<0 || top<0 || right>window.Right-window.Left || bottom>window.Bottom-window.Top) return null;
    int x=(int)Math.Floor(left),y=(int)Math.Floor(top);
    return new { x=x,y=y,width=(int)Math.Ceiling(right)-x,height=(int)Math.Ceiling(bottom)-y };
  }
  public static object Observe(IntPtr h) {
    Rect r=Bounds(h);
    List<object> elements=new List<object>();
    AutomationElement root=AutomationElement.FromHandle(h);
    Queue<AutomationElement> pending=new Queue<AutomationElement>(); pending.Enqueue(root);
    TreeWalker walker=TreeWalker.ControlViewWalker;
    int chars=0;
    while(pending.Count>0 && elements.Count<150 && chars<16000) {
      AutomationElement current=pending.Dequeue();
      if(!current.Current.IsPassword) {
        string name=current.Current.Name ?? ""; if(name.Length>300) name=name.Substring(0,300); chars+=name.Length;
        string automationId=current.Current.AutomationId ?? ""; if(automationId.Length>120) automationId=automationId.Substring(0,120);
        elements.Add(new { name=name, type=current.Current.ControlType.ProgrammaticName, enabled=current.Current.IsEnabled,automationId=automationId,
          bounds=current.Current.IsOffscreen ? null : ElementBounds(r,current.Current.BoundingRectangle) });
        AutomationElement child=walker.GetFirstChild(current);
        while(child!=null && pending.Count<200) { pending.Enqueue(child); child=walker.GetNextSibling(child); }
      }
    }
    return new { windowId=h.ToInt64().ToString(),width=r.Right-r.Left,height=r.Bottom-r.Top,elements=elements, truncated=pending.Count>0, coordinateSpace="window_physical_pixels" };
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
$session = $null
try {
  $pipe.Connect(15000)
  $session = [AsterControlSession]::Start()
  [AsterComputer]::Session = $session
  $reader = [IO.StreamReader]::new($pipe, [Text.UTF8Encoding]::new($false))
  $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false)); $writer.AutoFlush = $true
  $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $writer.WriteLine((@{ token=$Token; elevated=$elevated } | ConvertTo-Json -Compress))
  while ($null -ne ($line = $reader.ReadLine())) {
    $timer = [AsterComputer]::Deadline()
    try {
      $session.CheckActive()
      $request = $line | ConvertFrom-Json
      $command = $request.command
      $allowed = @($request.applications | Where-Object { $_.enabled })
      $blocked = @($request.blockedApplications | Where-Object { $_.enabled })
      if ($command.action -eq 'list') {
        $windows = @([AsterComputer]::Windows() | Where-Object { $_.executablePath -match '^[a-z]:\\.*\.exe$' } | Select-Object -First 1000 | ForEach-Object {
          $window=$_
          if (-not ($blocked | Where-Object { [String]::Equals($_.executablePath,$window.executablePath,[StringComparison]::OrdinalIgnoreCase) -or [String]::Equals($_.executablePath,$window.ownerExecutablePath,[StringComparison]::OrdinalIgnoreCase) })) {
            $readable = $request.accessMode -eq 'all' -or ($allowed | Where-Object { [String]::Equals($_.executablePath,$window.executablePath,[StringComparison]::OrdinalIgnoreCase) })
            @{ windowId=$window.windowId; title=$(if($readable){$window.title}else{''}); executablePath=$window.executablePath }
          }
        })
        $value = @{ windows=$windows }
      } elseif ($command.action -eq 'identify') {
        $path = [AsterComputer]::PathOf([IntPtr]::new([long]$command.windowId))
        $ownerPath = [AsterComputer]::OwnerPathOf([IntPtr]::new([long]$command.windowId))
        if ([String]::IsNullOrEmpty($path)) { throw 'WINDOW_UNAVAILABLE' }
        if ($blocked | Where-Object { [String]::Equals($_.executablePath,$path,[StringComparison]::OrdinalIgnoreCase) -or [String]::Equals($_.executablePath,$ownerPath,[StringComparison]::OrdinalIgnoreCase) }) { throw 'APPLICATION_BLOCKED' }
        $value = @{ executablePath=$path }
      } elseif ($command.action -eq 'launch') {
        $application = $allowed | Where-Object { $_.id -eq $command.applicationId } | Select-Object -First 1
        if ($null -eq $application) { throw 'APPLICATION_NOT_ALLOWED' }
        if ($blocked | Where-Object { [String]::Equals($_.executablePath,$application.executablePath,[StringComparison]::OrdinalIgnoreCase) }) { throw 'APPLICATION_BLOCKED' }
        $start = [Diagnostics.ProcessStartInfo]::new($application.executablePath); $start.UseShellExecute=$false
        $process = [Diagnostics.Process]::Start($start)
        $value = @{ launched=$true; processId=$process.Id }
      } else {
        $window = [IntPtr]::new([long]$command.windowId)
        $path = [AsterComputer]::PathOf($window)
        $ownerPath = [AsterComputer]::OwnerPathOf($window)
        if (-not [String]::Equals($path,$request.expectedExecutablePath,[StringComparison]::OrdinalIgnoreCase)) { throw 'WINDOW_CHANGED' }
        if ($blocked | Where-Object { [String]::Equals($_.executablePath,$path,[StringComparison]::OrdinalIgnoreCase) -or [String]::Equals($_.executablePath,$ownerPath,[StringComparison]::OrdinalIgnoreCase) }) { throw 'APPLICATION_BLOCKED' }
        if ($request.accessMode -ne 'all' -and -not ($allowed | Where-Object { [String]::Equals($_.executablePath,$path,[StringComparison]::OrdinalIgnoreCase) })) { throw 'APPLICATION_NOT_ALLOWED' }
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
      $codes=@('APPLICATION_BLOCKED','APPLICATION_NOT_ALLOWED','WINDOW_CHANGED','WINDOW_UNAVAILABLE','FOCUS_REQUIRED','USER_INPUT_ACTIVE','FOCUS_CHANGED','INPUT_BLOCKED','POINT_OUTSIDE_WINDOW','WINDOW_OCCLUDED','WINDOW_TOO_LARGE','CAPTURE_UNAVAILABLE','INVALID_KEY','INVALID_ACTION')
      $code='COMPUTER_OPERATION_FAILED'
      foreach ($candidate in $codes) { if ($_.Exception.ToString().Contains($candidate)) { $code=$candidate; break } }
      $response=@{ id=$request.id; ok=$false; code=$code }
    } finally { $timer.Dispose() }
    $writer.WriteLine(($response | ConvertTo-Json -Compress -Depth 12))
  }
} finally { if ($null -ne $session) { $session.Dispose() }; $pipe.Dispose() }
