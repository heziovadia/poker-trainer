# Creates the app icon (public/icon.ico) and a "Poker Trainer" shortcut on the Desktop and in the Start menu.
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$icoPath = Join-Path $root 'public\icon.ico'
New-Item -ItemType Directory -Force (Join-Path $root 'public') | Out-Null

# Draw a brass rounded square with a dark spade.
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)
$rect = New-Object System.Drawing.Rectangle 8, 8, 240, 240
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56
$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
$path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
$path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
$path.CloseFigure()
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(236, 210, 154)), ([System.Drawing.Color]::FromArgb(169, 132, 63)), 45
$g.FillPath($brush, $path)
$font = New-Object System.Drawing.Font 'Segoe UI Symbol', 150, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString([string][char]0x2660, $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(10, 16, 28))), (New-Object System.Drawing.RectangleF 0, 4, $size, $size), $fmt)
$g.Dispose()

# Save as a PNG-compressed .ico (supported since Windows Vista).
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$fs = [System.IO.File]::Create($icoPath)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
$w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0)
$w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
$w.Write($png)
$w.Close()
$bmp.Save((Join-Path $root 'public\icon-256.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Poker Trainer.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Poker Trainer.lnk')
)
foreach ($lnk in $targets) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $root 'launch.ps1')`""
  $s.WorkingDirectory = $root
  $s.IconLocation = $icoPath
  $s.Description = 'Poker Trainer - Texas Hold''em coach'
  $s.Save()
  "created: $lnk"
}
