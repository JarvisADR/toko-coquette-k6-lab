[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[1-9][0-9]*$')]
    [string]$RunId,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z_][a-z0-9_-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$')]
    [string]$Vm,

    [string]$GitHubCli = 'gh'
)

$ErrorActionPreference = 'Stop'
$repo = 'JarvisADR/toko-coquette-k6-lab'
$json = & $GitHubCli api "repos/$repo/actions/runs/$RunId"
if ($LASTEXITCODE -ne 0) { throw 'Could not read the GitHub release run.' }
$run = $json | ConvertFrom-Json
if ($run.conclusion -ne 'success' -or $run.head_branch -ne 'main' -or
    $run.path -ne '.github/workflows/deploy.yml' -or $run.repository.full_name -ne $repo) {
    throw 'Choose a successful Prepare K3s release run from main.'
}

$name = 'coquette-upload-' + [Guid]::NewGuid().ToString('N')
$upload = Join-Path ([IO.Path]::GetTempPath()) $name
$null = New-Item -ItemType Directory -Path $upload
try {
    & $GitHubCli run download $RunId --repo $repo --name coquette-k3s-images --dir $upload
    if ($LASTEXITCODE -ne 0) { throw 'Could not download the release artifact.' }

    $manifest = (Get-Content -LiteralPath (Join-Path $upload 'release.txt') -Raw).Trim()
    if ($manifest -cnotmatch '^([0-9a-f]{40}) ([0-9a-f]{64})$') { throw 'Invalid release manifest.' }
    $commit = $Matches[1]
    $digest = $Matches[2]
    $archive = Join-Path $upload 'images.tar.gz'
    if ($commit -cne $run.head_sha -or (Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant() -cne $digest) {
        throw 'Release commit or archive checksum does not match.'
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'k3s-deploy.sh') -Destination $upload

    & scp -o StrictHostKeyChecking=yes -r $upload "${Vm}:./"
    if ($LASTEXITCODE -ne 0) { throw 'Could not transfer the release to the VM.' }
    $command = 'cd -- "$HOME/{0}" || exit 1; sudo bash ./k3s-deploy.sh ./images.tar.gz {1} {2}; result=$?; rm -f -- ./k3s-deploy.sh ./images.tar.gz ./release.txt; cd -- "$HOME" && rmdir -- "{0}"; exit "$result"' -f $name, $commit, $digest
    & ssh -t -o StrictHostKeyChecking=yes $Vm $command
    if ($LASTEXITCODE -ne 0) { throw 'VM deployment failed. Review the deployment output.' }
} finally {
    foreach ($file in 'images.tar.gz', 'release.txt', 'k3s-deploy.sh') {
        $path = Join-Path $upload $file
        if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path }
    }
    if (-not (Get-ChildItem -LiteralPath $upload -Force)) { Remove-Item -LiteralPath $upload }
}
