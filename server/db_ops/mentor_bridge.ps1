param (
    [string]$action = "scan",
    [string]$tdataDir = "",
    [string]$folder = "New",
    [int]$lineNo = 1,
    [string]$mdbPath = "",
    [string]$inputJson = "",
    [string]$outputJson = ""
)

$ErrorActionPreference = "Stop"

if (-not $tdataDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $candidate1 = Join-Path $scriptDir "..\..\TDATA"
    $candidate2 = "D:\Mentor\TDATA"
    if (Test-Path $candidate1) {
        $tdataDir = (Resolve-Path $candidate1).Path
    } elseif (Test-Path $candidate2) {
        $tdataDir = $candidate2
    } else {
        $tdataDir = "D:\Version 1\TDATA"
    }
}

function Format-MDBDate($val) {
    if ($val -eq $null -or $val -eq [DBNull]::Value) { return $null }
    if ($val -is [System.DateTime]) { return $val.ToString("yyyy-MM-dd") }
    try {
        $dt = [System.DateTime]::Parse($val.ToString())
        return $dt.ToString("yyyy-MM-dd")
    } catch {
        return $val.ToString()
    }
}

function Escape-SqlVal($val) {
    if ($val -eq $null) { return "NULL" }
    $escaped = $val.ToString().Replace("'", "''")
    return "'$escaped'"
}

function Format-SqlDate($val) {
    if ($val -eq $null -or $val -eq "") { return "NULL" }
    try {
        $dt = [System.DateTime]::Parse($val)
        return "#" + $dt.ToString("yyyy-MM-dd HH:mm:ss") + "#"
    } catch {
        return "NULL"
    }
}

function Format-SqlNum($val) {
    if ($val -eq $null -or $val -eq "") { return 0 }
    return $val
}

# ----------------------------------------------------
# 1. ACTION: SCAN
# ----------------------------------------------------
if ($action -eq "scan") {
    $result = @{
        tdataDir = $tdataDir
        newLines = @()
        oldLines = @()
        villages = @()
    }

    # Helper to scan a folder (New / OLD)
    function Scan-LineFolder($subfolderName) {
        $lines = @()
        $folderPath = Join-Path $tdataDir $subfolderName
        if (-not (Test-Path $folderPath)) { return $lines }

        $files = Get-ChildItem -Path $folderPath -Filter "*.MDB" | Sort-Object {
            $num = 0
            if ([int]::TryParse($_.BaseName, [ref]$num)) { $num } else { 9999 }
        }

        foreach ($f in $files) {
            $lineId = $f.BaseName
            $num = 0
            $isNum = [int]::TryParse($lineId, [ref]$num)
            
            $item = @{
                lineNo = if ($isNum) { $num } else { $lineId }
                fileName = $f.Name
                filePath = $f.FullName
                folder = $subfolderName
                sizeBytes = $f.Length
                lastModified = $f.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                loaneeCount = 0
                collectionCount = 0
                disbursedAmount = 0
                paidAmount = 0
                balanceAmount = 0
            }

            # Quick read stats via ADODB
            try {
                $conn = New-Object -ComObject ADODB.Connection
                $conn.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$($f.FullName);")
                
                # Loanee stats
                try {
                    $rs = New-Object -ComObject ADODB.Recordset
                    $rs.Open("SELECT COUNT(*) AS CNT, SUM(AMT) AS SAMT, SUM(PAMT) AS SPAMT, SUM(BAMT) AS SBAMT FROM LOANEE", $conn, 1, 3)
                    if (-not $rs.EOF) {
                        $item.loaneeCount = if ($rs.Fields.Item('CNT').Value) { [int]$rs.Fields.Item('CNT').Value } else { 0 }
                        $item.disbursedAmount = if ($rs.Fields.Item('SAMT').Value) { [double]$rs.Fields.Item('SAMT').Value } else { 0 }
                        $item.paidAmount = if ($rs.Fields.Item('SPAMT').Value) { [double]$rs.Fields.Item('SPAMT').Value } else { 0 }
                        $item.balanceAmount = if ($rs.Fields.Item('SBAMT').Value) { [double]$rs.Fields.Item('SBAMT').Value } else { 0 }
                    }
                    $rs.Close()
                } catch {}

                # Collection count
                try {
                    $rs = New-Object -ComObject ADODB.Recordset
                    $rs.Open("SELECT COUNT(*) AS CNT FROM PAMT1", $conn, 1, 3)
                    if (-not $rs.EOF) {
                        $item.collectionCount = if ($rs.Fields.Item('CNT').Value) { [int]$rs.Fields.Item('CNT').Value } else { 0 }
                    }
                    $rs.Close()
                } catch {}

                $conn.Close()
            } catch {}

            $lines += $item
        }
        return $lines
    }

    $result.newLines = Scan-LineFolder "New"
    $result.oldLines = Scan-LineFolder "OLD"

    # Also load Village Names from PWD\Examt.mdb if present
    $examtPath = Join-Path $tdataDir "PWD\Examt.mdb"
    if (Test-Path $examtPath) {
        try {
            $conn = New-Object -ComObject ADODB.Connection
            $conn.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$examtPath;")
            $rs = New-Object -ComObject ADODB.Recordset
            $rs.Open("SELECT LNO, SNO, VNAME FROM VILNAME ORDER BY LNO, SNO", $conn, 1, 3)
            while (-not $rs.EOF) {
                $result.villages += @{
                    lineNo = $rs.Fields.Item('LNO').Value
                    serialNo = $rs.Fields.Item('SNO').Value
                    villageName = [string]$rs.Fields.Item('VNAME').Value
                }
                $rs.MoveNext()
            }
            $rs.Close()
            $conn.Close()
        } catch {}
    }

    $jsonOut = ConvertTo-Json $result -Depth 6
    if ($outputJson) {
        [System.IO.File]::WriteAllText($outputJson, $jsonOut)
    } else {
        Write-Output $jsonOut
    }
}

# ----------------------------------------------------
# 2. ACTION: IMPORT-LINE
# ----------------------------------------------------
elseif ($action -eq "import-line") {
    $targetMdb = $mdbPath
    if (-not $targetMdb) {
        $targetMdb = Join-Path (Join-Path $tdataDir $folder) "$lineNo.MDB"
    }

    if (-not (Test-Path $targetMdb)) {
        throw "Target MDB file not found: $targetMdb"
    }

    $conn = New-Object -ComObject ADODB.Connection
    $conn.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$targetMdb;")

    $data = @{
        lineNo = $lineNo
        folder = $folder
        mdbPath = $targetMdb
        LOANEE = @()
        PAMT1 = @()
        PAMT2 = @()
        EXAMT = @()
        villages = @()
    }

    # Read LOANEE
    try {
        $rs = New-Object -ComObject ADODB.Recordset
        $rs.Open("SELECT * FROM LOANEE", $conn, 1, 3)
        while (-not $rs.EOF) {
            $row = @{
                ANO = [string]$rs.Fields.Item('ANO').Value
                NAME = [string]$rs.Fields.Item('NAME').Value
                ADD1 = [string]$rs.Fields.Item('ADD1').Value
                ADD2 = [string]$rs.Fields.Item('ADD2').Value
                ADD3 = [string]$rs.Fields.Item('ADD3').Value
                FDT = Format-MDBDate $rs.Fields.Item('FDT').Value
                TDT = Format-MDBDate $rs.Fields.Item('TDT').Value
                AMT = if ($rs.Fields.Item('AMT').Value) { [double]$rs.Fields.Item('AMT').Value } else { 0 }
                PAMT = if ($rs.Fields.Item('PAMT').Value) { [double]$rs.Fields.Item('PAMT').Value } else { 0 }
                BAMT = if ($rs.Fields.Item('BAMT').Value) { [double]$rs.Fields.Item('BAMT').Value } else { 0 }
                DA = if ($rs.Fields.Item('DA').Value) { [double]$rs.Fields.Item('DA').Value } else { 0 }
                DW = [string]$rs.Fields.Item('DW').Value
                DS = if ($rs.Fields.Item('DS').Value) { [double]$rs.Fields.Item('DS').Value } else { 0 }
            }
            $data.LOANEE += $row
            $rs.MoveNext()
        }
        $rs.Close()
    } catch {}

    # Read PAMT1
    try {
        $rs = New-Object -ComObject ADODB.Recordset
        $rs.Open("SELECT * FROM PAMT1", $conn, 1, 3)
        while (-not $rs.EOF) {
            $data.PAMT1 += @{
                ANO = [string]$rs.Fields.Item('ANO').Value
                PDT = Format-MDBDate $rs.Fields.Item('PDT').Value
                AMT = if ($rs.Fields.Item('AMT').Value) { [double]$rs.Fields.Item('AMT').Value } else { 0 }
            }
            $rs.MoveNext()
        }
        $rs.Close()
    } catch {}

    # Read PAMT2
    try {
        $rs = New-Object -ComObject ADODB.Recordset
        $rs.Open("SELECT * FROM PAMT2", $conn, 1, 3)
        while (-not $rs.EOF) {
            $data.PAMT2 += @{
                ANO = [string]$rs.Fields.Item('ANO').Value
                PDT = Format-MDBDate $rs.Fields.Item('PDT').Value
                AMT = if ($rs.Fields.Item('AMT').Value) { [double]$rs.Fields.Item('AMT').Value } else { 0 }
            }
            $rs.MoveNext()
        }
        $rs.Close()
    } catch {}

    # Read EXAMT
    try {
        $rs = New-Object -ComObject ADODB.Recordset
        $rs.Open("SELECT * FROM EXAMT", $conn, 1, 3)
        while (-not $rs.EOF) {
            $data.EXAMT += @{
                AMT = if ($rs.Fields.Item('AMT').Value) { [double]$rs.Fields.Item('AMT').Value } else { 0 }
                DT = Format-MDBDate $rs.Fields.Item('DT').Value
                LAMT = if ($rs.Fields.Item('LAMT').Value) { [double]$rs.Fields.Item('LAMT').Value } else { 0 }
            }
            $rs.MoveNext()
        }
        $rs.Close()
    } catch {}

    $conn.Close()

    # Read Villages for this line from PWD\Examt.mdb
    $examtPath = Join-Path $tdataDir "PWD\Examt.mdb"
    if (Test-Path $examtPath) {
        try {
            $conn2 = New-Object -ComObject ADODB.Connection
            $conn2.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$examtPath;")
            $rs = New-Object -ComObject ADODB.Recordset
            $rs.Open("SELECT SNO, VNAME FROM VILNAME WHERE LNO=$lineNo ORDER BY SNO", $conn2, 1, 3)
            while (-not $rs.EOF) {
                $data.villages += @{
                    serialNo = $rs.Fields.Item('SNO').Value
                    villageName = [string]$rs.Fields.Item('VNAME').Value
                }
                $rs.MoveNext()
            }
            $rs.Close()
            $conn2.Close()
        } catch {}
    }

    $jsonOut = ConvertTo-Json $data -Depth 6
    if ($outputJson) {
        [System.IO.File]::WriteAllText($outputJson, $jsonOut)
    } else {
        Write-Output $jsonOut
    }
}

# ----------------------------------------------------
# 3. ACTION: EXPORT-LINE
# ----------------------------------------------------
elseif ($action -eq "export-line") {
    if (-not $inputJson -or -not (Test-Path $inputJson)) {
        throw "Input JSON file not provided or does not exist: $inputJson"
    }

    $targetMdb = $mdbPath
    if (-not $targetMdb) {
        $targetMdb = Join-Path (Join-Path $tdataDir $folder) "$lineNo.MDB"
    }

    # Ensure parent directory exists
    $parentDir = Split-Path -Parent $targetMdb
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    # Remove existing MDB file
    if (Test-Path $targetMdb) {
        Remove-Item $targetMdb -Force
    }

    # Create fresh Access Jet 4.0 database
    $catalog = New-Object -ComObject ADOX.Catalog
    $connString = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$targetMdb;"
    $catalog.Create($connString)
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($catalog) | Out-Null

    $conn = New-Object -ComObject ADODB.Connection
    $conn.Open($connString)

    # Create tables exactly as MAL.EXE expects
    $null = $conn.Execute("CREATE TABLE LOANEE (ANO VARCHAR(50), NAME VARCHAR(255), ADD1 VARCHAR(255), ADD2 VARCHAR(255), ADD3 VARCHAR(255), FDT DATETIME, TDT DATETIME, AMT DOUBLE, PAMT DOUBLE, BAMT DOUBLE, DA DOUBLE, DW VARCHAR(50), DS DOUBLE)")
    $null = $conn.Execute("CREATE TABLE PAMT1 (ANO VARCHAR(50), PDT DATETIME, AMT DOUBLE)")
    $null = $conn.Execute("CREATE TABLE PAMT2 (ANO VARCHAR(50), PDT DATETIME, AMT DOUBLE)")
    $null = $conn.Execute("CREATE TABLE EXAMT (AMT DOUBLE, DT DATETIME, LAMT DOUBLE)")

    $raw = [System.IO.File]::ReadAllText($inputJson)
    $obj = ConvertFrom-Json $raw

    # Insert LOANEE
    if ($obj.LOANEE) {
        foreach ($r in $obj.LOANEE) {
            $ano = Escape-SqlVal $r.ANO
            $name = Escape-SqlVal $r.NAME
            $add1 = Escape-SqlVal $r.ADD1
            $add2 = Escape-SqlVal $r.ADD2
            $add3 = Escape-SqlVal $r.ADD3
            $fdt = Format-SqlDate $r.FDT
            $tdt = Format-SqlDate $r.TDT
            $amt = Format-SqlNum $r.AMT
            $pamt = Format-SqlNum $r.PAMT
            $bamt = Format-SqlNum $r.BAMT
            $da = Format-SqlNum $r.DA
            $dw = Escape-SqlVal $r.DW
            $ds = Format-SqlNum $r.DS
            $null = $conn.Execute("INSERT INTO LOANEE (ANO, NAME, ADD1, ADD2, ADD3, FDT, TDT, AMT, PAMT, BAMT, DA, DW, DS) VALUES ($ano, $name, $add1, $add2, $add3, $fdt, $tdt, $amt, $pamt, $bamt, $da, $dw, $ds)")
        }
    }

    # Insert PAMT1
    if ($obj.PAMT1) {
        foreach ($r in $obj.PAMT1) {
            $ano = Escape-SqlVal $r.ANO
            $pdt = Format-SqlDate $r.PDT
            $amt = Format-SqlNum $r.AMT
            $null = $conn.Execute("INSERT INTO PAMT1 (ANO, PDT, AMT) VALUES ($ano, $pdt, $amt)")
        }
    }

    # Insert PAMT2
    if ($obj.PAMT2) {
        foreach ($r in $obj.PAMT2) {
            $ano = Escape-SqlVal $r.ANO
            $pdt = Format-SqlDate $r.PDT
            $amt = Format-SqlNum $r.AMT
            $null = $conn.Execute("INSERT INTO PAMT2 (ANO, PDT, AMT) VALUES ($ano, $pdt, $amt)")
        }
    }

    # Insert EXAMT
    if ($obj.EXAMT) {
        foreach ($r in $obj.EXAMT) {
            $amt = Format-SqlNum $r.AMT
            $dt = Format-SqlDate $r.DT
            $lamt = Format-SqlNum $r.LAMT
            $null = $conn.Execute("INSERT INTO EXAMT (AMT, DT, LAMT) VALUES ($amt, $dt, $lamt)")
        }
    }

    $conn.Close()
    Write-Output "SUCCESS: Exported to $targetMdb"
}
