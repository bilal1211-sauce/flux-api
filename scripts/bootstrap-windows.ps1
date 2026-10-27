$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$toolRoot = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
function Download-File([string]$Url, [string]$Destination) {
    & curl.exe --fail --location --retry 2 $Url --output $Destination
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
}
function Check-Hash([string]$File, [string]$Expected, [string]$Algorithm) {
    if ((Get-FileHash -LiteralPath $File -Algorithm $Algorithm).Hash.ToLowerInvariant() -ne $Expected.ToLowerInvariant()) { throw "Checksum mismatch: $File" }
}
$phpDir = Join-Path $toolRoot 'php'
if (-not (Test-Path -LiteralPath (Join-Path $phpDir 'php.exe'))) {
    $phpZip = Join-Path $toolRoot 'php.zip'
    Download-File 'https://www.php.net/~windows/releases/php-8.3.35-nts-Win32-vs16-x64.zip' $phpZip
    Check-Hash $phpZip '25a8e2ac9ff30f1d768d1447c09a600617fa6e6082729f6e95f008b59c91fe45' 'SHA256'
    Expand-Archive -LiteralPath $phpZip -DestinationPath $phpDir
}
$composerFile = Join-Path $toolRoot 'composer.phar'
if (-not (Test-Path -LiteralPath $composerFile)) {
    Download-File 'https://getcomposer.org/composer-stable.phar' $composerFile
    $composerHash = (& curl.exe --fail --silent --location 'https://getcomposer.org/download/latest-stable/composer.phar.sha256').Trim()
    Check-Hash $composerFile $composerHash 'SHA256'
}
$certificate = Join-Path $toolRoot 'cacert.pem'
if (-not (Test-Path -LiteralPath $certificate)) { Download-File 'https://curl.se/ca/cacert.pem' $certificate }
$iniFile = Join-Path $phpDir 'php.ini'
if (-not (Test-Path -LiteralPath $iniFile)) {
    $extensionDir = (Join-Path $phpDir 'ext').Replace('\','/')
    $certificatePath = $certificate.Replace('\','/')
    @"
[PHP]
extension_dir="$extensionDir"
extension=curl
extension=fileinfo
extension=mbstring
extension=openssl
extension=pdo_mysql
extension=pdo_sqlite
extension=sqlite3
extension=zip
extension=intl
curl.cainfo="$certificatePath"
openssl.cafile="$certificatePath"
memory_limit=512M
"@ | Set-Content -LiteralPath $iniFile -Encoding ascii
}
& node.exe scripts/setup.mjs
if ($LASTEXITCODE -ne 0) { throw 'Application setup failed.' }
$mysqlDir = Join-Path $toolRoot 'mysql'
if (-not (Test-Path -LiteralPath (Join-Path $mysqlDir 'mysql-8.4.11-winx64/bin/mysqld.exe'))) {
    $mysqlZip = Join-Path $toolRoot 'mysql.zip'
    Download-File 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.11-winx64.zip' $mysqlZip
    Check-Hash $mysqlZip '2e833921898a9a030ea6bfe81bd811bc' 'MD5'
    Expand-Archive -LiteralPath $mysqlZip -DestinationPath $mysqlDir
}
& node.exe scripts/mysql-local.mjs
if ($LASTEXITCODE -ne 0) { throw 'MySQL setup failed.' }
& node.exe scripts/php.mjs artisan migrate --force
Write-Output 'Ready. Start with npm.cmd run dev and open http://127.0.0.1:3000.'
