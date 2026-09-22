$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    Add-Type -AssemblyName System.Security
    # Only base64 bytes and a fixed purpose arrive through stdin, never command arguments.
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.purpose -notin @('credentials-v1', 'session-v1', 'auth-v1')) { throw 'Invalid purpose' }
    [byte[]]$data = [Convert]::FromBase64String($request.data)
    [byte[]]$entropy = [Text.Encoding]::UTF8.GetBytes('bars-helper:bars.mpei.ru:' + $request.purpose)
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($request.operation -eq 'protect') {
        [byte[]]$result = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope)
    } elseif ($request.operation -eq 'unprotect') {
        [byte[]]$result = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope)
    } else { throw 'Invalid operation' }
    $response = @{ version = 1; data = [Convert]::ToBase64String($result) } | ConvertTo-Json -Compress
    [Console]::Out.Write($response)
    exit 0
} catch {
    # Do not print exceptions, input, decrypted data, or script diagnostics.
    exit 1
}
