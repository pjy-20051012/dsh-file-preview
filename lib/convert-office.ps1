# convert-office.ps1 — Convert an Office document to PDF via COM automation.
# Used by dsh-file-preview for VISUAL preview (see the file as it looks).
# Params: -Kind word|excel|powerpoint  -Src <abs path>  -Out <abs pdf path>
param([string]$Kind, [string]$Src, [string]$Out)
$ErrorActionPreference = 'Stop'

# Disable Protected View so COM opens files directly instead of hanging on an
# invisible modal dialog (downloaded/emailed files carry Mark-of-the-Web).
$pvRoots = @(
    'HKCU:\Software\Microsoft\Office\16.0\Word\Security\ProtectedView',
    'HKCU:\Software\Microsoft\Office\16.0\Excel\Security\ProtectedView',
    'HKCU:\Software\Microsoft\Office\16.0\PowerPoint\Security\ProtectedView'
)
foreach ($root in $pvRoots) {
    try {
        New-Item -Path $root -Force | Out-Null
        Set-ItemProperty -Path $root -Name DisableInternetFilesInPV -Value 1 -ErrorAction SilentlyContinue
        Set-ItemProperty -Path $root -Name DisableUnsafeLocationsInPV -Value 1 -ErrorAction SilentlyContinue
        Set-ItemProperty -Path $root -Name DisableAttachmentsInPV -Value 1 -ErrorAction SilentlyContinue
    } catch { }
}

$part = "$Out.part.pdf"
try {
    switch ($Kind) {
        'word' {
            $app = New-Object -ComObject Word.Application
            $app.Visible = $false
            $app.DisplayAlerts = 0
            $doc = $app.Documents.Open($Src, $false, $true)  # ConfirmConversions=false, ReadOnly=true
            $doc.ExportAsFixedFormat($part, 17)             # wdExportFormatPDF
            $doc.Close($false)
            $app.Quit()
        }
        'excel' {
            $app = New-Object -ComObject Excel.Application
            $app.Visible = $false
            $app.DisplayAlerts = $false
            $wb = $app.Workbooks.Open($Src, 0, $true)        # UpdateLinks=0, ReadOnly=true
            $wb.ExportAsFixedFormat(0, $part)               # xlTypePDF
            $wb.Close($false)
            $app.Quit()
        }
        'powerpoint' {
            $app = New-Object -ComObject PowerPoint.Application
            $pres = $app.Presentations.Open($Src, $true, $false, $false)  # ReadOnly, Untitled, WithWindow=false
            $pres.SaveAs($part, 32)                          # ppSaveAsPDF
            $pres.Close()
            $app.Quit()
        }
        default {
            [Console]::Error.WriteLine("unknown kind: $Kind")
            exit 2
        }
    }
    # Best-effort COM release to avoid orphaned Office processes.
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) | Out-Null
    [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
    if (Test-Path -LiteralPath $part) {
        Move-Item -LiteralPath $part -Destination $Out -Force
        exit 0
    }
    exit 3
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
