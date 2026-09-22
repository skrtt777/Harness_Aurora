param([string]$CMake = 'C:\Program Files\CMake\bin\cmake.exe')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function GitChecked([string[]]$GitArgs) {
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "git failed: $GitArgs" }
}
$swapCommit = '50459bb422a01c0ba2e1da08b4d932f652f3e413'
$llamaCommit = 'f5e85d43a048f3d5adefb4c5e29867d8077fba62'
if (!(Test-Path tmp/swap-moe/.git)) {
    GitChecked @('clone','--depth','1','https://github.com/ek15072809/Swap-MoE.git','tmp/swap-moe')
}
GitChecked @('-C','tmp/swap-moe','fetch','--depth','1','origin',$swapCommit)
GitChecked @('-C','tmp/swap-moe','checkout','--detach',$swapCommit)
if (!(Test-Path tmp/llama-ssd/.git)) {
    New-Item -ItemType Directory -Force tmp/llama-ssd | Out-Null
    GitChecked @('-C','tmp/llama-ssd','init')
    GitChecked @('-C','tmp/llama-ssd','remote','add','origin','https://github.com/ggml-org/llama.cpp.git')
    GitChecked @('-C','tmp/llama-ssd','fetch','--depth','1','origin',$llamaCommit)
    GitChecked @('-C','tmp/llama-ssd','checkout','--detach',$llamaCommit)
    GitChecked @('-C','tmp/llama-ssd','apply','../swap-moe/llama.cpp-expert-streaming.patch')
} else {
    $actualCommit = & git -C tmp/llama-ssd rev-parse HEAD
    if ($actualCommit -ne $llamaCommit) { throw 'Existing experimental checkout has a different commit; preserve it and inspect manually.' }
    & git -C tmp/llama-ssd apply --reverse --check ../swap-moe/llama.cpp-expert-streaming.patch 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Existing checkout does not match the expected applied patch.' }
}
& $CMake -S tmp/llama-ssd -B tmp/llama-ssd/build -G 'Visual Studio 17 2022' -A x64 -DGGML_CUDA=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_UI=OFF
if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed' }
& $CMake --build tmp/llama-ssd/build --config Release --target llama-server -j 12
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
New-Item -ItemType Directory -Force tmp/ssd-models | Out-Null
$models = @(
    @{Tag='qwen3-coder:30b'; Name='qwen3-coder-30b'; Sha='1194192cf2a187eb02722edcc3f77b11d21f537048ce04b67ccf8ba78863006a'},
    @{Tag='qwen2.5-coder:1.5b'; Name='qwen25-coder-15b'; Sha='29d8c98fa6b098e200069bfb88b9508dc3e85586d20cba59f8dda9a808165104'}
)
foreach ($model in $models) {
    $destination = Join-Path 'tmp/ssd-models' ($model.Name+'.gguf')
    if (!(Test-Path -LiteralPath $destination)) {
        $modelfile = & ollama show $model.Tag --modelfile
        if ($LASTEXITCODE -ne 0) { throw "Model $($model.Tag) must already be installed; no implicit download." }
        $fromLine = $modelfile | Where-Object { $_ -match '^FROM ' } | Select-Object -First 1
        $sourceModel = $fromLine.Substring(5).Trim('"')
        if (!(Test-Path -LiteralPath $sourceModel)) { throw "Cannot resolve model file: $($model.Tag)" }
        Copy-Item -LiteralPath $sourceModel -Destination $destination
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $model.Sha) {
        throw "Weight hash mismatch: $destination. Existing file preserved."
    }
}
Write-Output 'Prepared CPU-only experimental engine. Read docs/QWEN3_MOE_BENCHMARK.md before running. Confirm that this checkout is on SSD.'
