[CmdletBinding()]
param(
  [string]$DesktopBuild = "release\win-unpacked",
  [string]$OutputDirectory = "distribution"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$buildRoot = [IO.Path]::GetFullPath((Join-Path $workspace $DesktopBuild))
$outputRoot = [IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
$package = Get-Content -Raw -LiteralPath (Join-Path $workspace "package.json") | ConvertFrom-Json
$version = [string]$package.version

if (-not (Test-Path -LiteralPath (Join-Path $buildRoot "Vocabulary Trainer.exe") -PathType Leaf)) {
  throw "The packaged desktop build was not found at $buildRoot"
}

[IO.Directory]::CreateDirectory($outputRoot) | Out-Null

$windowsArchive = Join-Path $outputRoot "Vocabulary-Trainer-Windows-x64-$version.zip"
$sourceArchive = Join-Path $outputRoot "Vocabulary-Trainer-Source-$version.zip"
$checksumsFile = Join-Path $outputRoot "SHA256SUMS.txt"

function Get-ArchivePath([string]$root, [string]$path, [string]$prefix) {
  $absoluteRoot = [IO.Path]::GetFullPath($root).TrimEnd("\") + "\"
  $absolutePath = [IO.Path]::GetFullPath($path)
  if (-not $absolutePath.StartsWith($absoluteRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Archive source is outside its expected root: $absolutePath"
  }
  $relative = $absolutePath.Substring($absoluteRoot.Length).Replace("\", "/")
  return "$prefix/$relative"
}

function Write-ZipArchive([string]$destination, [object[]]$files) {
  if ([IO.File]::Exists($destination)) {
    [IO.File]::Delete($destination)
  }

  $stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
  try {
    $archive = [IO.Compression.ZipArchive]::new(
      $stream,
      [IO.Compression.ZipArchiveMode]::Create,
      $false
    )
    try {
      foreach ($file in $files) {
        $entry = $archive.CreateEntry(
          $file.Entry,
          [IO.Compression.CompressionLevel]::Optimal
        )
        $source = [IO.File]::OpenRead($file.Source)
        try {
          $target = $entry.Open()
          try {
            $source.CopyTo($target)
          } finally {
            $target.Dispose()
          }
        } finally {
          $source.Dispose()
        }
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

$userDataRoot = [IO.Path]::GetFullPath(
  (Join-Path $buildRoot "Vocabulary Trainer Data")
)
$windowsFiles = @(
  Get-ChildItem -LiteralPath $buildRoot -Recurse -File |
    Where-Object {
      -not $_.FullName.StartsWith(
        $userDataRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
      )
    } |
    ForEach-Object {
      [PSCustomObject]@{
        Source = $_.FullName
        Entry = Get-ArchivePath $buildRoot $_.FullName "Vocabulary Trainer"
      }
    }
)

$sourcePrefix = "Vocabulary-Trainer-Source-$version"
$sourceDirectories = @("desktop", "docs", "public-app", "scripts", "src", "tests")
$sourceRootFiles = @(
  ".gitignore",
  "AGENTS.md",
  "build.bat",
  "eslint.config.js",
  "index.html",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "README.md",
  "start.bat",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts"
)
$sourceFiles = @(
  foreach ($directory in $sourceDirectories) {
    $directoryPath = Join-Path $workspace $directory
    if (-not (Test-Path -LiteralPath $directoryPath -PathType Container)) {
      continue
    }
    Get-ChildItem -LiteralPath $directoryPath -Recurse -File | ForEach-Object {
      [PSCustomObject]@{
        Source = $_.FullName
        Entry = Get-ArchivePath $workspace $_.FullName $sourcePrefix
      }
    }
  }
  foreach ($file in $sourceRootFiles) {
    $filePath = Join-Path $workspace $file
    if (Test-Path -LiteralPath $filePath -PathType Leaf) {
      [PSCustomObject]@{
        Source = $filePath
        Entry = "$sourcePrefix/$file"
      }
    }
  }
)

Write-Host "Creating clean Windows distribution archive..."
Write-ZipArchive $windowsArchive $windowsFiles
Write-Host "Creating source project archive..."
Write-ZipArchive $sourceArchive $sourceFiles

function Get-Sha256([string]$path) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($path)
    try {
      return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $algorithm.Dispose()
  }
}

$checksumLines = @(
  "$(Get-Sha256 $windowsArchive)  $([IO.Path]::GetFileName($windowsArchive))"
  "$(Get-Sha256 $sourceArchive)  $([IO.Path]::GetFileName($sourceArchive))"
)
[IO.File]::WriteAllLines($checksumsFile, $checksumLines, [Text.UTF8Encoding]::new($false))

Write-Host "Created:"
Get-Item -LiteralPath $windowsArchive, $sourceArchive, $checksumsFile |
  Select-Object FullName, Length, LastWriteTime |
  Format-Table -AutoSize
