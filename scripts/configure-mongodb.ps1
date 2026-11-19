$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $serverRoot '.env'
$templatePath = Join-Path $serverRoot '.env.example'

Write-Host 'Configure FixMate using the existing Booknook database user on Cluster0.'
Write-Host 'Enter the database password, not your MongoDB website login password.'
$secureDatabasePassword = Read-Host 'Database password (hidden)' -AsSecureString
$databasePassword = [System.Net.NetworkCredential]::new('', $secureDatabasePassword).Password
if ([string]::IsNullOrWhiteSpace($databasePassword)) { throw 'Password cannot be empty. No file was changed.' }

try {
    $encodedPassword = [Uri]::EscapeDataString($databasePassword)
    $connectionUri = 'mongodb+srv://Booknook:' + $encodedPassword + '@cluster0.egtrsoz.mongodb.net/?retryWrites=true&w=majority&appName=FixMate'
    $content = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { [IO.File]::ReadAllText($templatePath) }
    $lines = $content -split '\r?\n'
    $updated = @($lines | Where-Object { $_ -notmatch '^\s*(MONGODB_URI|MONGODB_DB)\s*=' })
    $updated += 'MONGODB_URI=' + $connectionUri
    $updated += 'MONGODB_DB=fixmate'
    [IO.File]::WriteAllText($envPath, ($updated -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    Write-Host 'Saved the connection to the ignored server .env. Password was not displayed.'
    Write-Host 'Run npm run db:check from the server folder to verify it.'
} finally {
    $databasePassword = $null
    $encodedPassword = $null
    $connectionUri = $null
    $secureDatabasePassword.Dispose()
}
