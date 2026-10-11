# Um clique num ponto de uma janela (pelo número do processo; x, y a partir do canto da janela). Só nas
# janelas que o teste abriu.
param([int]$ProcessId, [int]$X, [int]$Y)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class WinClick {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
$h = (Get-Process -Id $ProcessId).MainWindowHandle
[WinClick]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400
$r = New-Object WinClick+RECT
[WinClick]::GetWindowRect($h, [ref]$r) | Out-Null
# The page is a web view: it takes a click after the mouse has moved over the point.
foreach ($d in @(-12, -6, -2, 0)) { [WinClick]::SetCursorPos($r.L + $X + $d, $r.T + $Y + $d) | Out-Null; Start-Sleep -Milliseconds 120 }
Start-Sleep -Milliseconds 300
[WinClick]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
[WinClick]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
