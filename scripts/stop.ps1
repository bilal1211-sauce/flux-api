$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach ($serviceName in @('web','api','executor','worker','scheduler','mysql')) {
    $pidFile = Join-Path $projectRoot ".runtime/$serviceName.pid"
    if (Test-Path -LiteralPath $pidFile) {
        $servicePid = [int](Get-Content -LiteralPath $pidFile)
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid" -ErrorAction SilentlyContinue
        if ($proc -and ($proc.CommandLine -like "*$projectRoot*" -or $proc.ExecutablePath -like "$projectRoot*")) {
            if ($serviceName -eq 'mysql') {
                $mysqlAdmin = Join-Path $projectRoot '.tools/mysql/mysql-8.4.11-winx64/bin/mysqladmin.exe'
                $mysqlConfig = Join-Path $projectRoot '.runtime/mysql-client.cnf'
                & $mysqlAdmin "--defaults-extra-file=$mysqlConfig" shutdown
            } else {
                Get-CimInstance Win32_Process -Filter "ParentProcessId = $servicePid" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like "$projectRoot*" -or $_.CommandLine -like "*$projectRoot*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
                Stop-Process -Id $servicePid -ErrorAction SilentlyContinue
            }
            Write-Output "Stopped APIForge $serviceName ($servicePid)"
        }
        Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
    }
}
# Laravel's development server can outlive its artisan parent on Windows.
Get-CimInstance Win32_Process -Filter "Name = 'php.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -like "$projectRoot*" -and $_.CommandLine -like "*$projectRoot*" -and
    ($_.CommandLine -match '-S 127\.0\.0\.1:8100 ' -or $_.CommandLine -match '-S 127\.0\.0\.1:8101 ')
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    Write-Output "Stopped orphaned APIForge development server ($($_.ProcessId))"
}
