# Foto de uma janela (pelo número do processo), para conferir o visual nos testes. Só janelas do teste.
param([int]$ProcessId, [string]$Path)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
}
"@
$h = (Get-Process -Id $ProcessId).MainWindowHandle
[Win]::ShowWindow($h, 3) | Out-Null
Start-Sleep -Milliseconds 1500
$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc(); [Win]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
$bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
