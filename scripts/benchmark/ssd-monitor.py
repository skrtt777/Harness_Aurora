"""Own one experimental llama-server; cap its Windows working set and sample it.

The cap is NOT a system-wide RAM limit: mapped pages can remain in standby cache.
No global cache flush, registry changes, privileges or unrelated process control.
Requires psutil (already present in Aurora's isolated training environment).
"""
import ctypes as C
from ctypes import wintypes as W
import json, os, subprocess, sys, threading, time
import psutil

config = json.load(open(sys.argv[1], encoding='utf-8'))
os.makedirs(config['directory'], exist_ok=True)
k = C.WinDLL('kernel32', use_last_error=True)
k.SetProcessWorkingSetSizeEx.argtypes = [W.HANDLE, C.c_size_t, C.c_size_t, W.DWORD]
k.SetProcessWorkingSetSizeEx.restype = W.BOOL
k.GetProcessWorkingSetSizeEx.argtypes = [W.HANDLE, C.POINTER(C.c_size_t), C.POINTER(C.c_size_t), C.POINTER(W.DWORD)]
k.GetProcessWorkingSetSizeEx.restype = W.BOOL

class PerformanceInfo(C.Structure):
    _fields_ = [('cb', W.DWORD)] + [(n, C.c_size_t) for n in
        ['CommitTotal','CommitLimit','CommitPeak','PhysicalTotal','PhysicalAvailable','SystemCache','KernelTotal','KernelPaged','KernelNonpaged','PageSize']] + [(n,W.DWORD) for n in ['HandleCount','ProcessCount','ThreadCount']]
psapi = C.WinDLL('psapi', use_last_error=True)
psapi.GetPerformanceInfo.argtypes = [C.POINTER(PerformanceInfo), W.DWORD]

log = open(os.path.join(config['directory'], 'server.log'), 'w', encoding='utf-8')
child = subprocess.Popen(config['command'], stdout=log, stderr=log, stdin=subprocess.DEVNULL,
                         creationflags=subprocess.CREATE_NO_WINDOW)
try:
    handle = W.HANDLE(int(child._handle))
    cap = int(config['capBytes'])
    if not k.SetProcessWorkingSetSizeEx(handle, 1024*1024, cap, 0x4 | 0x2):
        raise C.WinError(C.get_last_error())
    low, high, flags = C.c_size_t(), C.c_size_t(), W.DWORD()
    if not k.GetProcessWorkingSetSizeEx(handle, C.byref(low), C.byref(high), C.byref(flags)):
        raise C.WinError(C.get_last_error())
    if high.value != cap or not flags.value & 4:
        raise RuntimeError('Working-set hard maximum was not applied')
    identity = dict(pid=child.pid, startedAt=time.time()*1000, requestedCapBytes=cap,
                    actualMaximumBytes=high.value, flags=flags.value,
                    scope='process working set only; OS standby cache is outside this cap')
    json.dump(identity, open(os.path.join(config['directory'], 'process.json'),'w'), indent=2)
    print(json.dumps(identity), flush=True)
    stop = threading.Event()
    def wait_stop():
        sys.stdin.readline()
        stop.set()
    threading.Thread(target=wait_stop, daemon=True).start()
    proc = psutil.Process(child.pid)
    with open(os.path.join(config['directory'], 'samples.jsonl'), 'a', buffering=1) as samples:
        while not stop.is_set() and child.poll() is None:
            try:
                mem, io = proc.memory_info(), proc.io_counters()
                perf = PerformanceInfo(); perf.cb=C.sizeof(perf)
                got = psapi.GetPerformanceInfo(C.byref(perf), perf.cb)
                disk = psutil.disk_io_counters(perdisk=True).get(config['physicalDisk'])
                sample = dict(at=time.time()*1000, rss=mem.rss, private=mem.private,
                    peakWset=mem.peak_wset, pageFaults=mem.num_page_faults,
                    processReadBytes=io.read_bytes, cpuSeconds=sum(proc.cpu_times()[:2]),
                    physicalTotal=psutil.virtual_memory().total,
                    systemAvailable=perf.PhysicalAvailable*perf.PageSize if got else None,
                    systemCache=perf.SystemCache*perf.PageSize if got else None,
                    systemCommit=perf.CommitTotal*perf.PageSize if got else None,
                    diskReadBytes=disk.read_bytes if disk else None,
                    diskReadCount=disk.read_count if disk else None)
                samples.write(json.dumps(sample)+'\n')
            except psutil.NoSuchProcess:
                break
            stop.wait(0.25)
finally:
    if child.poll() is None:
        child.terminate()
        try: child.wait(timeout=15)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
    log.close()
