param (
    [string]$jsonPath,
    [string]$mdbPath
)

# Function to escape SQL strings
function Escape-SqlVal($val) {
    if ($val -eq $null) {
        return "NULL"
    }
    $escaped = $val.ToString().Replace("'", "''")
    return "'$escaped'"
}

# Function to format Date for Jet SQL insertion
function Format-SqlDate($val) {
    if ($val -eq $null -or $val -eq "") {
        return "NULL"
    }
    try {
        $dt = [System.DateTime]::Parse($val)
        return "#" + $dt.ToString("yyyy-MM-dd HH:mm:ss") + "#"
    } catch {
        return "NULL"
    }
}

# Function to format numeric values
function Format-SqlNum($val) {
    if ($val -eq $null -or $val -eq "") {
        return 0
    }
    return $val
}

try {
    # Remove existing file if any
    if (Test-Path $mdbPath) {
        Remove-Item $mdbPath -Force
    }

    # Create blank MDB database
    $catalog = New-Object -ComObject ADOX.Catalog
    $connString = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$mdbPath;"
    $catalog.Create($connString)
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($catalog) | Out-Null

    # Open ADODB Connection
    $conn = New-Object -ComObject ADODB.Connection
    $conn.Open($connString)

    # Create Tables
    $null = $conn.Execute("CREATE TABLE LOANEE (ANO VARCHAR(50), NAME VARCHAR(255), ADD1 VARCHAR(255), ADD2 VARCHAR(255), ADD3 VARCHAR(255), FDT DATETIME, TDT DATETIME, AMT DOUBLE, PAMT DOUBLE, BAMT DOUBLE, DA DOUBLE, DW VARCHAR(50), DS DOUBLE)")
    $null = $conn.Execute("CREATE TABLE PAMT1 (ANO VARCHAR(50), PDT DATETIME, AMT DOUBLE)")
    $null = $conn.Execute("CREATE TABLE PAMT2 (ANO VARCHAR(50), PDT DATETIME, AMT DOUBLE)")
    $null = $conn.Execute("CREATE TABLE EXAMT (AMT DOUBLE, DT DATETIME, LAMT DOUBLE)")

    # Read and parse JSON content
    $jsonRaw = [System.IO.File]::ReadAllText($jsonPath)
    $records = ConvertFrom-Json $jsonRaw

    # Insert LOANEE rows
    if ($records.LOANEE) {
        foreach ($row in $records.LOANEE) {
            $ano = Escape-SqlVal $row.ANO
            $name = Escape-SqlVal $row.NAME
            $add1 = Escape-SqlVal $row.ADD1
            $add2 = Escape-SqlVal $row.ADD2
            $add3 = Escape-SqlVal $row.ADD3
            $fdt = Format-SqlDate $row.FDT
            $tdt = Format-SqlDate $row.TDT
            $amt = Format-SqlNum $row.AMT
            $pamt = Format-SqlNum $row.PAMT
            $bamt = Format-SqlNum $row.BAMT
            $da = Format-SqlNum $row.DA
            $dw = Escape-SqlVal $row.DW
            $ds = Format-SqlNum $row.DS

            $sql = "INSERT INTO LOANEE (ANO, NAME, ADD1, ADD2, ADD3, FDT, TDT, AMT, PAMT, BAMT, DA, DW, DS) VALUES ($ano, $name, $add1, $add2, $add3, $fdt, $tdt, $amt, $pamt, $bamt, $da, $dw, $ds)"
            $null = $conn.Execute($sql)
        }
    }

    # Insert PAMT1 rows
    if ($records.PAMT1) {
        foreach ($row in $records.PAMT1) {
            $ano = Escape-SqlVal $row.ANO
            $pdt = Format-SqlDate $row.PDT
            $amt = Format-SqlNum $row.AMT

            $sql = "INSERT INTO PAMT1 (ANO, PDT, AMT) VALUES ($ano, $pdt, $amt)"
            $null = $conn.Execute($sql)
        }
    }

    # Insert PAMT2 rows
    if ($records.PAMT2) {
        foreach ($row in $records.PAMT2) {
            $ano = Escape-SqlVal $row.ANO
            $pdt = Format-SqlDate $row.PDT
            $amt = Format-SqlNum $row.AMT

            $sql = "INSERT INTO PAMT2 (ANO, PDT, AMT) VALUES ($ano, $pdt, $amt)"
            $null = $conn.Execute($sql)
        }
    }

    # Insert EXAMT rows
    if ($records.EXAMT) {
        foreach ($row in $records.EXAMT) {
            $amt = Format-SqlNum $row.AMT
            $dt = Format-SqlDate $row.DT
            $lamt = Format-SqlNum $row.LAMT

            $sql = "INSERT INTO EXAMT (AMT, DT, LAMT) VALUES ($amt, $dt, $lamt)"
            $null = $conn.Execute($sql)
        }
    }

    $conn.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($conn) | Out-Null
    Write-Host "SUCCESS"

} catch {
    Write-Host "ERROR: $_"
    if ($conn.State -eq 1) {
        $conn.Close()
    }
}
