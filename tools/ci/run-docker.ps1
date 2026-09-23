param(
    [switch]$RemoveImage,
    [switch]$RebuildImage,
    [switch]$ClearCache
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$runId = [Guid]::NewGuid().ToString("N")
$imageName = "glyphmend-ci-local:latest"
$containerNames = [System.Collections.Generic.List[string]]::new()
$cacheVolumes = @(
    "glyphmend-ci-cache",
    "glyphmend-ci-npm-cache",
    "glyphmend-ci-cargo-registry",
    "glyphmend-ci-cargo-git",
    "glyphmend-ci-cargo-advisories"
)
$mountSource = $repoRoot.Replace("\", "/")
$mutex = [System.Threading.Mutex]::new($false, "Local\GlyphMendDockerCi")
$ownsMutex = $false

function Invoke-CiContainer {
    param(
        [Parameter(Mandatory)][string]$Image,
        [Parameter(Mandatory)][string]$ScriptName
    )

    $containerName = "glyphmend-ci-$runId-$ScriptName"
    $containerNames.Add($containerName)
    $dockerArgs = @(
        "run", "--rm",
        "--name", $containerName,
        "--label", "com.glyphmend.ci-managed=true",
        "--label", "com.glyphmend.ci-run=$runId",
        "--mount", "type=bind,source=$mountSource,target=/workspace,readonly",
        "--mount", "type=volume,source=$($cacheVolumes[0]),target=/root/.cache",
        "--mount", "type=volume,source=$($cacheVolumes[1]),target=/root/.npm",
        "--mount", "type=volume,source=$($cacheVolumes[2]),target=/root/.cargo/registry",
        "--mount", "type=volume,source=$($cacheVolumes[3]),target=/root/.cargo/git",
        "--mount", "type=volume,source=$($cacheVolumes[4]),target=/root/.cargo/advisory-dbs",
        "--env", "CARGO_TARGET_DIR=/root/.cache/cargo-target",
        "--workdir", "/workspace",
        $Image,
        "bash", "/workspace/tools/ci/$ScriptName"
    )
    & docker @dockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Docker CI container '$containerName' failed with exit code $LASTEXITCODE."
    }
}

try {
    try {
        $ownsMutex = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        throw "Another local CI run is already active. Wait for it to finish before starting another."
    }

    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is unavailable. Start Docker Desktop and try again."
    }

    $staleContainers = @(& docker ps --all --quiet --filter "label=com.glyphmend.ci-managed=true")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect old local CI containers."
    }
    foreach ($staleContainer in $staleContainers) {
        & docker rm --force $staleContainer *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not remove stale local CI container '$staleContainer'."
        }
    }
    foreach ($cacheVolume in $cacheVolumes) {
        & docker volume inspect $cacheVolume *> $null
        if ($LASTEXITCODE -ne 0) {
            & docker volume create --label "com.glyphmend.ci-cache=true" $cacheVolume *> $null
            if ($LASTEXITCODE -ne 0) {
                throw "Could not create local CI cache '$cacheVolume'."
            }
        }
    }
    & docker image inspect $imageName *> $null
    $imageExists = ($LASTEXITCODE -eq 0)
    if ($RebuildImage -or -not $imageExists) {
        & docker build --tag $imageName --file (Join-Path $PSScriptRoot "Dockerfile") $PSScriptRoot
        if ($LASTEXITCODE -ne 0) {
            throw "Could not build the local CI image."
        }
    }

    Invoke-CiContainer -Image $imageName -ScriptName "run-linux.sh"
}
finally {
    foreach ($containerName in $containerNames) {
        & docker rm --force $containerName *> $null
    }

    if ($ownsMutex) {
        if ($RemoveImage) {
            & docker image rm --force $imageName *> $null
        }

        if ($ClearCache) {
            foreach ($cacheVolume in $cacheVolumes) {
                & docker volume rm --force $cacheVolume *> $null
            }
        }

        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}