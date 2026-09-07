param (
    [string]$mdbPath,
    [string]$outputPath
)

$conn = New-Object -ComObject ADODB.Connection
$records = @{
    LOANEE = @()
    PAMT1 = @()
    PAMT2 = @()
    EXAMT = @()
}

function Format-MDBDate($val) {
    if ($val -eq $null -or $val -eq [DBNull]::Value) {
        return $null
    }
    if ($val -is [System.DateTime]) {
        return $val.ToString("yyyy-MM-dd")
    }
    # Fallback try parsing
    try {
        $dt = [System.DateTime]::Parse($val.ToString())
        return $dt.ToString("yyyy-MM-dd")
    } catch {
        return $val.ToString()
    }
}

try {
    $conn.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$mdbPath;")
    
    # 1. Read LOANEE
    $rs = New-Object -ComObject ADODB.Recordset
    $rs.Open("SELECT * FROM LOANEE", $conn, 1, 3)
    while (-not $rs.EOF) {
        $row = @{
            ANO = $rs.Fields.Item('ANO').Value
            NAME = $rs.Fields.Item('NAME').Value
            ADD1 = $rs.Fields.Item('ADD1').Value
            ADD2 = $rs.Fields.Item('ADD2').Value
            ADD3 = $rs.Fields.Item('ADD3').Value
            FDT = Format-MDBDate $rs.Fields.Item('FDT').Value
            TDT = Format-MDBDate $rs.Fields.Item('TDT').Value
            AMT = $rs.Fields.Item('AMT').Value
            PAMT = $rs.Fields.Item('PAMT').Value
            BAMT = $rs.Fields.Item('BAMT').Value
            DA = $rs.Fields.Item('DA').Value
            DW = $rs.Fields.Item('DW').Value
            DS = $rs.Fields.Item('DS').Value
        }
        $records.LOANEE += $row
        $rs.MoveNext()
    }
    $rs.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($rs) | Out-Null

    # 2. Read PAMT1
    $rs = New-Object -ComObject ADODB.Recordset
    $rs.Open("SELECT * FROM PAMT1", $conn, 1, 3)
    while (-not $rs.EOF) {
        $row = @{
            ANO = $rs.Fields.Item('ANO').Value
            PDT = Format-MDBDate $rs.Fields.Item('PDT').Value
            AMT = $rs.Fields.Item('AMT').Value
        }
        $records.PAMT1 += $row
        $rs.MoveNext()
    }
    $rs.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($rs) | Out-Null

    # 3. Read PAMT2
    $rs = New-Object -ComObject ADODB.Recordset
    $rs.Open("SELECT * FROM PAMT2", $conn, 1, 3)
    while (-not $rs.EOF) {
        $row = @{
            ANO = $rs.Fields.Item('ANO').Value
            PDT = Format-MDBDate $rs.Fields.Item('PDT').Value
            AMT = $rs.Fields.Item('AMT').Value
        }
        $records.PAMT2 += $row
        $rs.MoveNext()
    }
    $rs.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($rs) | Out-Null

    # 4. Read EXAMT
    $rs = New-Object -ComObject ADODB.Recordset
    try {
        $rs.Open("SELECT * FROM EXAMT", $conn, 1, 3)
        while (-not $rs.EOF) {
            $row = @{
                AMT = $rs.Fields.Item('AMT').Value
                DT = Format-MDBDate $rs.Fields.Item('DT').Value
                LAMT = $rs.Fields.Item('LAMT').Value
            }
            $records.EXAMT += $row
            $rs.MoveNext()
        }
        $rs.Close()
    } catch {
        # Table might not exist or be empty with errors
    }
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($rs) | Out-Null

    $conn.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($conn) | Out-Null

    # Serialize to JSON file
    $jsonContent = ConvertTo-Json $records -Depth 5
    [System.IO.File]::WriteAllText($outputPath, $jsonContent)
    Write-Host "SUCCESS"

} catch {
    Write-Host "ERROR: $_"
    if ($conn.State -eq 1) {
        $conn.Close()
    }
}
