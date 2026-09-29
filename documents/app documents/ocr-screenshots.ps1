# Read the words in every screenshot with the Windows built-in OCR engine.
#
#   powershell -File "documents\app documents\ocr-screenshots.ps1" -Folder <dir>
#
# Prints one line per recognised word:  file<TAB>word<TAB>x<TAB>y<TAB>w<TAB>h
# (pixel box in the source image). verify_manual.py uses this to sweep the
# screenshots for names that must not appear, and blur_words.py uses the boxes
# to blur them. Windows.Media.Ocr ships with Windows 10 and later, so nothing
# needs installing.

param(
  [Parameter(Mandatory = $true)][string]$Folder
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]

# WinRT async operations have to be bridged to .NET tasks by hand in
# Windows PowerShell 5.1.
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'No OCR language is installed for this user profile.' }

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Get-ChildItem -Path $Folder -Filter *.png | Sort-Object Name | ForEach-Object {
  $file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
  $stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result  = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    foreach ($line in $result.Lines) {
      foreach ($word in $line.Words) {
        $r = $word.BoundingRect
        "{0}`t{1}`t{2}`t{3}`t{4}`t{5}" -f $_.Name, $word.Text, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height
      }
    }
  } finally {
    $stream.Dispose()
  }
}
