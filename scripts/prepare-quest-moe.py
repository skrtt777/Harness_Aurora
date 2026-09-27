"""Build the repository's pinned SSD/MoE experiment for Android, without deploying.

Weights remain outside the APK. Existing desktop benchmarks are not modified.
Run with --download to fetch the exact original 30B blob (18.6 GB).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / 'unreal/AuroraXR/Saved/MoePort'
LLAMA = 'f5e85d43a048f3d5adefb4c5e29867d8077fba62'
SWAP = '50459bb422a01c0ba2e1da08b4d932f652f3e413'
SHA = '1194192cf2a187eb02722edcc3f77b11d21f537048ce04b67ccf8ba78863006a'
SIZE = 18556688736

def run(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=REPO)

def checkout(name, url, commit):
    path = ROOT / name
    if not (path / '.git').exists():
        run('git', 'clone', '--no-checkout', '--filter=blob:none', url, path)
        run('git', '-C', path, 'checkout', '--detach', commit)
    actual = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != commit:
        raise RuntimeError(f'{path}: unexpected commit; checkout preserved')
    return path

def replace_once(path, old, new):
    content = path.read_text(encoding='utf-8')
    if new in content:
        return
    if content.count(old) != 1:
        raise RuntimeError(f'Unexpected source in {path}; refusing to patch')
    path.write_text(content.replace(old, new), encoding='utf-8', newline='\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--ndk', type=Path, default=Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/ndk/27.2.12479018')
    parser.add_argument('--cmake', default='C:/Program Files/CMake/bin/cmake.exe')
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    swap = checkout('swap-moe', 'https://github.com/ek15072809/Swap-MoE.git', SWAP)
    source = checkout('llama.cpp', 'https://github.com/ggml-org/llama.cpp.git', LLAMA)
    if not (source/'src/llama-expert-stream.cpp').exists():
        run('git', '-C', source, 'apply', swap/'llama.cpp-expert-streaming.patch')
    # Bionic deliberately makes POSIX_MADV_DONTNEED a no-op. These regions
    # refer only to immutable, read-only file mappings, so MADV_DONTNEED can
    # safely discard resident pages; later accesses fault weights back in.
    replace_once(source/'src/llama-expert-stream.cpp',
        '    int rc = posix_madvise((void *) a0, a1 - a0, POSIX_MADV_DONTNEED);',
        '''#if defined(__ANDROID__)
    int rc = madvise((void *) a0, a1 - a0, MADV_DONTNEED) == 0 ? 0 : errno;
#else
    int rc = posix_madvise((void *) a0, a1 - a0, POSIX_MADV_DONTNEED);
#endif''')
    replace_once(source/'src/llama-expert-stream.cpp', '#include <cstring>', '#include <cstring>\n#include <cerrno>')
    # Expert tensors are aligned to GGUF blocks, not necessarily OS pages.
    # Bionic WILLNEED requires an aligned base; include the preceding partial
    # page from the same read-only mmap, keeping the full expert range.
    replace_once(source/'src/llama-expert-stream.cpp',
        '    int rc = posix_madvise(base, len, POSIX_MADV_WILLNEED);',
        '''#if defined(__ANDROID__)
    long ps = sysconf(_SC_PAGESIZE);
    if (ps <= 0) ps = 4096;
    uintptr_t address = (uintptr_t) base;
    uintptr_t aligned = address & ~((uintptr_t) ps - 1);
    int rc = posix_madvise((void *) aligned, len + (address - aligned), POSIX_MADV_WILLNEED);
#else
    int rc = posix_madvise(base, len, POSIX_MADV_WILLNEED);
#endif''')
    # The UI asset generator runs on the build host, not on Android. Build
    # it with MSVC instead of accidentally using the NDK's host GNU target.
    replace_once(source/'tools/ui/CMakeLists.txt',
        'if(CMAKE_CROSSCOMPILING)\n',
        '''if(CMAKE_CROSSCOMPILING AND DEFINED LLAMA_UI_EMBED_HOST)
    set(LLAMA_UI_EMBED_EXE "${LLAMA_UI_EMBED_HOST}")
    add_custom_target(llama-ui-embed DEPENDS "${LLAMA_UI_EMBED_EXE}")
elseif(CMAKE_CROSSCOMPILING)
''')
    host = ROOT/'build-host'
    run(args.cmake, '-S', source, '-B', host, '-G', 'Visual Studio 17 2022', '-A', 'x64',
        '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_CURL=OFF',
        '-DLLAMA_BUILD_UI=OFF', '-DLLAMA_USE_PREBUILT_UI=OFF')
    run(args.cmake, '--build', host, '--config', 'Release', '--target', 'llama-ui-embed', '-j', '8')
    embed = host/'tools/ui/Release/llama-ui-embed.exe'
    if not embed.is_file():
        raise RuntimeError('Host UI generator missing')
    ninja = args.ndk.parent.parent/'cmake/3.22.1/bin/ninja.exe'
    build = ROOT/'build-android'
    run(args.cmake, '-S', source, '-B', build, '-G', 'Ninja',
        f'-DCMAKE_MAKE_PROGRAM={ninja.as_posix()}',
        f'-DCMAKE_TOOLCHAIN_FILE={(args.ndk/"build/cmake/android.toolchain.cmake").as_posix()}',
        '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-29', '-DANDROID_STL=c++_static',
        '-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON',
        '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_OPENMP=OFF',
        '-DGGML_NATIVE=OFF', '-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod', '-DLLAMA_CURL=OFF',
        '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_SERVER=ON',
        '-DLLAMA_BUILD_UI=OFF', '-DLLAMA_USE_PREBUILT_UI=OFF', f'-DLLAMA_UI_EMBED_HOST={embed.as_posix()}')
    run(args.cmake, '--build', build, '--target', 'llama-server', '-j', '8')
    binary = build/'bin/llama-server'
    manifest = {'model':'qwen3-coder:30b', 'modelSha256':SHA, 'modelBytes':SIZE,
        'llamaCommit':LLAMA, 'swapCommit':SWAP, 'abi':'arm64-v8a', 'androidApi':29,'elfPageAlignment':16384,
        'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
        'contextProfile':'original-harness', 'deviceValidated':False,
        'adaptations':['Android MADV_DONTNEED for read-only expert mappings', 'Android page-aligned expert prefetch', 'Windows host UI generator'],
        'candidateArgs':['-ngl','0','--expert-streaming','--expert-prefetch','--no-warmup',
            '-c','8192','-b','512','-ub','512','-t','3','-tb','3','-np','1',
            '-ctk','q8_0','-ctv','q8_0','-fa','on','--no-webui'],
        'memoryNote':'No hard RSS cap. Windows working-set limit is not an Android memory limit.'}
    (ROOT/'moe-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    if args.download:
        model = ROOT/'qwen3-coder-30b.gguf'
        part = model.with_suffix('.gguf.part')
        if not model.exists():
            run('curl.exe', '--fail', '--location', '--retry', '3', '--continue-at', '-', '--output', part,
                f'https://registry.ollama.ai/v2/library/qwen3-coder/blobs/sha256:{SHA}')
        candidate = model if model.exists() else part
        digest = hashlib.sha256()
        with candidate.open('rb') as stream:
            for block in iter(lambda: stream.read(8*1024*1024), b''):
                digest.update(block)
        if candidate.stat().st_size != SIZE or digest.hexdigest() != SHA:
            raise RuntimeError('Weight size/hash mismatch; file preserved, not deployed')
        if candidate == part:
            part.rename(model)
    print('Android MoE build ready; device inference and memory limits still need validation.')

if __name__ == '__main__':
    main()
