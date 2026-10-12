# Onde está um elemento numa janela (pelo número do processo e parte do nome): o retângulo na tela,
# relativo ao canto da janela ("x y largura altura"). Só leitura; só nas janelas que o teste abriu.
param([int]$ProcessId, [string]$Name)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class WinRect { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); }
"@
$h = (Get-Process -Id $ProcessId).MainWindowHandle
$r = New-Object WinRect+RECT
[WinRect]::GetWindowRect($h, [ref]$r) | Out-Null
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
  $n = $e.Current.Name
  if ($n -and $n -like "*$Name*") {
    $b = $e.Current.BoundingRectangle
    if ($b.Width -gt 50) { "{0} {1} {2} {3} | {4}" -f [int]($b.X - $r.L), [int]($b.Y - $r.T), [int]$b.Width, [int]$b.Height, $n.Substring(0, [Math]::Min(80, $n.Length)) }
  }
}
