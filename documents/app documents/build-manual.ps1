# Build the 369 Attendance role manuals: <role>.md -> .docx -> .pdf
#
#   powershell -File "documents\app documents\build-manual.ps1"                 # all three roles
#   powershell -File "documents\app documents\build-manual.ps1" -Role hr
#   powershell -File "documents\app documents\build-manual.ps1" -Role all -RenderOnly
#
# Two stages, and they must not share a process.
#
# Stage 1 is python-docx writing the .docx files. Stage 2 is Word, driven over
# COM, rendering each .docx to PDF. Running both in one PowerShell process makes
# the Word stage hang indefinitely without ever emitting a PDF, so the default
# run does stage 1 and then re-invokes this same script with -RenderOnly in a
# fresh process to do stage 2.

param(
  # employee, hr, admin, or all.
  [ValidateSet('employee', 'hr', 'admin', 'all')]
  [string]$Role = 'all',

  # Skip generation and only run the Word -> PDF stage. This is how the script
  # re-enters itself; it is also useful on its own after hand-editing a .docx.
  [switch]$RenderOnly
)

$ErrorActionPreference = 'Stop'

$here  = $PSScriptRoot
$roles = if ($Role -eq 'all') { @('employee', 'hr', 'admin') } else { @($Role) }

function Get-ManualBase([string]$r) { Join-Path $here "369-attendance-$r-manual" }

# --------------------------------------------------------------------------
# Stage 1 - generate the .docx files, then hand off to a clean process.
# --------------------------------------------------------------------------

if (-not $RenderOnly) {
  foreach ($r in $roles) {
    $md = "$(Get-ManualBase $r).md"
    if (-not (Test-Path $md)) { throw "No manual source at $md" }
  }

  # python-docx and Pillow live only on the 3.14 interpreter on this machine,
  # and there is no bare `python` on PATH - always go through the py launcher.
  # New captures can show the backend's product name, which must not appear in
  # the manuals. OCR every screenshot and blur any such word before building.
  Write-Host 'Blurring banned names in the screenshots...' -ForegroundColor Cyan
  & py -3.14 (Join-Path $here 'blur_words.py') --role $Role
  if ($LASTEXITCODE -ne 0) { throw "blur_words.py failed with exit code $LASTEXITCODE" }

  Write-Host 'Generating the documents...' -ForegroundColor Cyan
  & py -3.14 (Join-Path $here 'build_manual.py') --role $Role
  if ($LASTEXITCODE -ne 0) { throw "build_manual.py failed with exit code $LASTEXITCODE" }

  Write-Host "`nRendering the PDFs in a separate process..." -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Role $Role -RenderOnly
  if ($LASTEXITCODE -ne 0) { throw "Render stage failed with exit code $LASTEXITCODE" }

  Write-Host "`nDone." -ForegroundColor Cyan
  $out = foreach ($r in $roles) { "$(Get-ManualBase $r).docx"; "$(Get-ManualBase $r).pdf" }
  Get-ChildItem $out |
    Format-Table Name, @{N = 'KB'; E = { [math]::Round($_.Length / 1KB, 1) } }, LastWriteTime -AutoSize
  return
}

# --------------------------------------------------------------------------
# Stage 2 - Word renders the PDFs.
# --------------------------------------------------------------------------

foreach ($r in $roles) {
  $docx = "$(Get-ManualBase $r).docx"
  if (-not (Test-Path $docx)) { throw "No document to render at $docx" }
}

# A Word that was killed rather than quit leaves entries under Resiliency, and
# every later automated start then blocks trying to recover them - with no
# visible window to dismiss the prompt on. Clearing these first makes the build
# repeatable after a crash instead of wedged.
foreach ($key in 'DisabledItems', 'StartupItems') {
  $path = "HKCU:\Software\Microsoft\Office\16.0\Word\Resiliency\$key"
  if (Test-Path $path) {
    Write-Host "  clearing Word resiliency: $key" -ForegroundColor DarkGray
    Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$wdFormatPDF = 17

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0   # wdAlertsNone - never block on a dialog

try {
  foreach ($r in $roles) {
    $docx = "$(Get-ManualBase $r).docx"
    $pdf  = "$(Get-ManualBase $r).pdf"

    # ReadOnly, AddToRecentFiles:false - rendering must not be able to mutate
    # the generated document or clutter Word's recent-files list.
    $doc = $word.Documents.Open($docx, $false, $true, $false)
    try {
      # No Fields.Update() anywhere here. Called over the header/footer story
      # it never returns, because NUMPAGES re-triggers the pagination that is
      # being updated. ExportAsFixedFormat resolves both PAGE and NUMPAGES
      # while it renders, so the page numbers come out correct untouched.
      #
      # Arguments, positionally:
      #   1  output path
      #   2  format            17 = PDF
      #   3  open after        false
      #   4  optimise for      1 = on-screen, which keeps the file small
      #   5-8 range/from/to/item   whole document, content only
      #   9  include doc props true
      #   10 keep IRM          true
      #   11 create bookmarks  1 = wdExportCreateHeadingBookmarks
      #
      # The eleventh argument is what turns the Heading 1/2/3 styles behind
      # the part banners, section headings and step headings into the PDF's
      # Part/Step outline. It defaults to "no bookmarks".
      $doc.ExportAsFixedFormat($pdf, $wdFormatPDF, $false, 1, 0, 0, 0, 0, $true, $true, 1)
      Write-Host "  rendered $(Split-Path $pdf -Leaf)" -ForegroundColor Green
    } finally {
      $doc.Close($false)
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
    }
  }
} finally {
  # Always quit. A headless WINWORD.EXE left running silently adopts the next
  # build, and killing it is what writes the Resiliency entries cleared above.
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
