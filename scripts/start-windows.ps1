$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 24 or newer is required.'
}
if ([int](& node -p 'process.versions.node.split(".")[0]') -lt 24) { throw 'Node.js 24 or newer is required for the writing algorithms.' }
# Only the current Windows user can open a previously saved DPAPI credential.
$credentialName = '{0}{1}\tencent-soe.clixml' -f [char]0x58F0, [char]0x573A
$credentialPath = Join-Path $env:LOCALAPPDATA $credentialName
if (-not (Test-Path -LiteralPath $credentialPath)) {
    $credentialPath = Join-Path (Join-Path $env:USERPROFILE 'AppData\Local') $credentialName
}
$names = @('TENCENT_APP_ID', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY')
$missing = @($names | Where-Object { -not [Environment]::GetEnvironmentVariable($_) })
if ($missing.Count -eq $names.Count -and (Test-Path -LiteralPath $credentialPath)) {
    $stored = Import-Clixml -LiteralPath $credentialPath
    foreach ($name in $names) {
        $secure = $stored[$name]
        if ($secure -isnot [Security.SecureString]) { throw 'Invalid local Tencent credential.' }
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            [Environment]::SetEnvironmentVariable($name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
            $secure.Dispose()
        }
    }
}
$portNumber = if ($env:PORT) { $env:PORT } else { '4192' }
# A prior demo may already be using the default port. Keep that process intact.
if (-not $env:PORT) {
    foreach ($candidate in @(4192,4194,4197)) {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try {
            $probe.Start()
            $portNumber = $candidate
            break
        } catch [Net.Sockets.SocketException] {
            if ($candidate -eq 4197) { throw 'Set PORT to a free port and try again.' }
        } finally { $probe.Stop() }
    }
    $env:PORT = [string]$portNumber
}
Write-Host "Open http://127.0.0.1:$portNumber/?demo=1 in your browser."
& node scripts/start.mjs
exit $LASTEXITCODE
