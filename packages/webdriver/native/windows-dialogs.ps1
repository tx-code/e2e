$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$dispatched = $false
try {
  $targetId = if ($request.action -eq 'identity') { [int]$request.processId } else { [int]$request.owner.processId }
  $targetProcess = Get-Process -Id $targetId -ErrorAction SilentlyContinue
  if($null -eq $targetProcess) {
    if($request.action -eq 'observe') {
      @{ok=$true;value=@{processExited=$true;windows=@()}} | ConvertTo-Json -Compress
      exit 0
    }
    throw 'The owned process has exited'
  }
  $startTicks = $targetProcess.StartTime.ToUniversalTime().Ticks.ToString()
  if ($request.action -eq 'identity') {
    @{ok=$true;value=@{processId=$targetId;startedAtTicks=$startTicks}} | ConvertTo-Json -Compress
    exit 0
  }
  if ($startTicks -ne $request.owner.startedAtTicks) { throw 'The process identity changed' }
  Add-Type -AssemblyName Accessibility
  Add-Type -ReferencedAssemblies Accessibility @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Accessibility;
public static class NativeDialogs {
 public delegate bool Callback(IntPtr hwnd, IntPtr state);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback fn, IntPtr state);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, Callback fn, IntPtr state);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam, string text, uint flags, uint timeout, out IntPtr result);
 [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr ReadMessage(IntPtr hwnd, uint msg, IntPtr wparam, StringBuilder text, uint flags, uint timeout, out IntPtr result);
 [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object result);
 public static string Text(IntPtr hwnd) { var s=new StringBuilder(2048); GetWindowText(hwnd,s,s.Capacity); return s.ToString(); }
 public static string Class(IntPtr hwnd) { var s=new StringBuilder(128); GetClassName(hwnd,s,s.Capacity); return s.ToString(); }
 public static bool Owned(IntPtr hwnd,int pid) { uint found; GetWindowThreadProcessId(hwnd,out found); return found==pid && IsWindow(hwnd); }
 public static IntPtr[] Windows(int pid) { var found=new List<IntPtr>(); EnumWindows((h,s)=>{if(Owned(h,pid)&&IsWindowVisible(h))found.Add(h);return true;},IntPtr.Zero);return found.ToArray(); }
 public static IntPtr[] Children(IntPtr hwnd) { var found=new List<IntPtr>();EnumChildWindows(hwnd,(h,s)=>{found.Add(h);return found.Count<250;},IntPtr.Zero);return found.ToArray(); }
 public static IntPtr FileEdit(IntPtr hwnd) {
   IntPtr modern=IntPtr.Zero; int modernCount=0;
   foreach(var h in Children(hwnd)) {
     int id=GetDlgCtrlID(h);
     if(id==1148) { if(Class(h)=="Edit")return h;foreach(var inner in Children(h))if(Class(inner)=="Edit")return inner; }
     if(id==1152 && Class(h)=="Edit")return h;
     if(id==1001 && Class(h)=="Edit") { modern=h; modernCount++; }
   }
   return modernCount==1?modern:IntPtr.Zero;
 }
 public static IntPtr OpenButton(IntPtr hwnd) {
   foreach(var h in Children(hwnd)) if(GetDlgCtrlID(h)==1 && Class(h)=="Button") {
     string t=Text(h).Replace("&","").Trim();
     if(t.StartsWith("Open",StringComparison.OrdinalIgnoreCase)||t.StartsWith("\u6253\u5f00")||t.StartsWith("\u958b\u555f")||t.StartsWith("\u00d6ffnen")||t.StartsWith("Ouvrir")||t.StartsWith("Abrir"))return h;
   }
   return IntPtr.Zero;
 }
 public static IntPtr SaveButton(IntPtr hwnd) {
   foreach(var h in Children(hwnd)) if(GetDlgCtrlID(h)==1 && Class(h)=="Button") {
     string t=Text(h).Replace("&","").Trim();
     if(t.StartsWith("Save",StringComparison.OrdinalIgnoreCase)||t.StartsWith("\u4fdd\u5b58")||t.StartsWith("\u5132\u5b58")||t.StartsWith("Speichern")||t.StartsWith("Enregistrer")||t.StartsWith("Guardar"))return h;
   }
   return IntPtr.Zero;
 }
 public static void SetFile(IntPtr edit,string path) {
   IntPtr result;
   if(SendMessageTimeout(edit,12,IntPtr.Zero,path,2,2000,out result)==IntPtr.Zero)throw new Exception("File-name input did not acknowledge the value");
   var current=new StringBuilder(32768);
   if(ReadMessage(edit,13,new IntPtr(current.Capacity),current,2,2000,out result)==IntPtr.Zero || current.ToString()!=path)throw new Exception("File-name input did not retain the configured path");
 }
 public static string[] AccessibleText(IntPtr hwnd) {
   var result=new List<string>(); object raw;
   var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
   try { if(AccessibleObjectFromWindow(hwnd,0xFFFFFFFC,ref iid,out raw)==0)ReadAccessible(raw as IAccessible,0,result); } catch {}
   return result.ToArray();
 }
 static void ReadAccessible(IAccessible a,int depth,List<string> output) {
   if(a==null||depth>8||output.Count>=100)return;
   try {
     int count=Math.Min(a.accChildCount,150);
     for(int i=0;i<=count && output.Count<100;i++) {
       object role=a.get_accRole(i); int r=role is int?(int)role:0;
       int state=Convert.ToInt32(a.get_accState(i));
       if((state&0x20000000)==0&&(r==41||r==43||r==18)) { string name=a.get_accName(i);if(!String.IsNullOrEmpty(name)&&!output.Contains(name))output.Add(name.Length>2048?name.Substring(0,2048):name); }
       if(i>0) { var child=a.get_accChild(i) as IAccessible;if(child!=null)ReadAccessible(child,depth+1,output); }
     }
   } catch {}
 }
}
'@
  if ($request.action -eq 'observe') {
    $windows = @()
    foreach ($handle in [NativeDialogs]::Windows($targetId)) {
      $isDialog = [NativeDialogs]::Class($handle) -eq '#32770'
      $edit = if($isDialog){[NativeDialogs]::FileEdit($handle)}else{[IntPtr]::Zero}
      $open = if($isDialog){[NativeDialogs]::OpenButton($handle)}else{[IntPtr]::Zero}
      $save = if($isDialog){[NativeDialogs]::SaveButton($handle)}else{[IntPtr]::Zero}
      $controls = @()
      if($isDialog){ foreach($control in [NativeDialogs]::Children($handle)) {
        $className=[NativeDialogs]::Class($control)
        $controls += @{id=[NativeDialogs]::GetDlgCtrlID($control);className=$className;enabled=[NativeDialogs]::IsWindowEnabled($control);name=if($className -match 'Edit|Combo'){''}else{[NativeDialogs]::Text($control)}}
      }}
      $windows += @{id=$handle.ToInt64().ToString();title=[NativeDialogs]::Text($handle);className=[NativeDialogs]::Class($handle);enabled=[NativeDialogs]::IsWindowEnabled($handle);dialog=$isDialog;filePicker=($edit -ne [IntPtr]::Zero -and $open -ne [IntPtr]::Zero);savePicker=($edit -ne [IntPtr]::Zero -and $save -ne [IntPtr]::Zero);controls=$controls;text=@(if($isDialog){[NativeDialogs]::AccessibleText($handle)})}
    }
    @{ok=$true;value=@{processExited=$false;windows=$windows}} | ConvertTo-Json -Depth 6 -Compress
    exit 0
  }
  if ($null -eq $request.windowId -and ($request.action -eq 'choose' -or $request.action -eq 'save')) {
    $candidates = @([NativeDialogs]::Windows($targetId) | Where-Object {
      $candidate = $_
      if ([NativeDialogs]::Class($candidate) -ne '#32770' -or -not [NativeDialogs]::IsWindowEnabled($candidate)) { return $false }
      $candidateEdit = [NativeDialogs]::FileEdit($candidate)
      $candidateButton = if ($request.action -eq 'save') { [NativeDialogs]::SaveButton($candidate) } else { [NativeDialogs]::OpenButton($candidate) }
      return $candidateEdit -ne [IntPtr]::Zero -and $candidateButton -ne [IntPtr]::Zero -and [NativeDialogs]::IsWindowEnabled($candidateEdit) -and [NativeDialogs]::IsWindowEnabled($candidateButton)
    })
    if ($candidates.Count -ne 1) { throw "Expected exactly one enabled native dialog for $($request.action); found $($candidates.Count). Inspect native_windows and provide windowId when appropriate." }
    $dialog = $candidates[0]
  } else {
    $dialog = [IntPtr]([long]$request.windowId)
  }
  if (-not [NativeDialogs]::Owned($dialog,$targetId) -or [NativeDialogs]::Class($dialog) -ne '#32770' -or -not [NativeDialogs]::IsWindowVisible($dialog)) { throw 'The target is not a visible dialog owned by this attempt' }
  if (-not [NativeDialogs]::IsWindowEnabled($dialog)) { throw 'The target dialog is disabled' }
  if ($request.action -eq 'cancel') {
    $dispatched = $true
    if(-not [NativeDialogs]::PostMessage($dialog,16,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Dialog close request failed'}
  } elseif ($request.action -eq 'choose' -or $request.action -eq 'save') {
    $edit = [NativeDialogs]::FileEdit($dialog)
    $open = if($request.action -eq 'save'){[NativeDialogs]::SaveButton($dialog)}else{[NativeDialogs]::OpenButton($dialog)}
    if($edit -eq [IntPtr]::Zero -or $open -eq [IntPtr]::Zero){throw 'This window is not a supported dialog for the requested file operation'}
    if(-not [NativeDialogs]::Owned($edit,$targetId) -or -not [NativeDialogs]::Owned($open,$targetId)){throw 'File controls are not owned by this attempt'}
    if(-not [NativeDialogs]::IsWindowEnabled($edit) -or -not [NativeDialogs]::IsWindowEnabled($open)){throw 'File selection is currently disabled'}
    if($request.action -eq 'save') {
      if(Test-Path -LiteralPath $request.filePath){throw 'Refusing to overwrite an existing destination'}
      if(-not (Test-Path -LiteralPath (Split-Path -Parent $request.filePath) -PathType Container)){throw 'The destination directory does not exist'}
    } elseif(-not (Test-Path -LiteralPath $request.filePath -PathType Leaf)){throw 'The configured file is unavailable'}
    $dispatched = $true
    [NativeDialogs]::SetFile($edit,[string]$request.filePath)
    if(-not [NativeDialogs]::Owned($dialog,$targetId) -or -not [NativeDialogs]::Owned($open,$targetId)){throw 'Dialog identity changed after file-name input'}
    if(-not [NativeDialogs]::PostMessage($open,245,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Open request failed'}
  } else { throw 'Unknown native dialog operation' }
  @{ok=$true;value=@{submitted=$true}} | ConvertTo-Json -Compress
} catch {
  @{ok=$false;error=$_.Exception.Message;dispatched=$dispatched} | ConvertTo-Json -Compress
}
