"""Isolated, monitored on-device MoE test. Stops the MR app; preserves its data.

Weights must already be provisioned and verified. This is not an MR benchmark
and the sampled watchdog is not a hard memory limit.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import time
import threading
import urllib.request

ROOT = Path(__file__).resolve().parents[1]/'unreal/AuroraXR/Saved/MoePort'
ADB = Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
REMOTE = '/data/local/tmp/aurora-moe'
WEIGHTS = '/sdcard/Android/data/com.aurora.xr/files/models/qwen3-coder-30b.gguf'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--max-rss-mib', type=int, default=4096)
    parser.add_argument('--min-available-mib', type=int, default=768)
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--expert-cache-mib', type=int, default=0)
    parser.add_argument('--no-prefetch', action='store_true')
    parser.add_argument('--prompt', default='Quanto e 3 + 5? Responda somente o numero.')
    parser.add_argument('--max-output-tokens',type=int,default=16)
    args = parser.parse_args()
    if args.max_rss_mib<1024 or args.min_available_mib<512 or args.timeout<10 or args.expert_cache_mib<0:
        parser.error('Invalid probe limits')
    def adb(*command):
        return subprocess.check_output([str(ADB),'-s',args.serial,*command],text=True,timeout=30).strip()
    if adb('get-state') != 'device':
        raise RuntimeError('Quest unavailable')
    if adb('shell','pidof llama-server || true'):
        raise RuntimeError('Another isolated llama-server is already running; preserved')
    manifest=json.loads((ROOT/'moe-build.json').read_text())
    if int(adb('shell','stat','-c','%s',WEIGHTS)) != manifest['modelBytes']:
        raise RuntimeError('Model size mismatch')
    print('Verifying device weights; this reads the file and warms caches.',flush=True)
    weight_hash=subprocess.check_output([str(ADB),'-s',args.serial,'shell','sha256sum',WEIGHTS],text=True,timeout=600).split()[0]
    if weight_hash!=manifest['modelSha256']:
        raise RuntimeError('Device weights failed SHA256 verification')
    remote_hash=adb('shell','sha256sum',REMOTE+'/llama-server').split()[0]
    if remote_hash != manifest['binarySha256']:
        raise RuntimeError('Executor differs from build manifest')
    adb('shell','chmod','700',REMOTE+'/llama-server')
    # This test deliberately excludes MR and the dense model from its RAM usage.
    adb('shell','am','force-stop','com.aurora.xr')
    port=int(adb('forward','tcp:0','tcp:18081'))
    key=secrets.token_hex(32)
    run_id=time.strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(3)
    pid_file=REMOTE+'/probe-'+run_id+'.pid'
    tuning=[item for item in manifest['candidateArgs'] if not (args.no_prefetch and item=='--expert-prefetch')]
    command=[REMOTE+'/llama-server','-m',WEIGHTS,'--host','127.0.0.1','--port','18081','--api-key',key,*tuning]
    command+=['--expert-cache-size',str(args.expert_cache_mib)]
    report={'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'serial':args.serial,
        'mode':'isolated-no-MR','model':manifest['model'],'binarySha256':remote_hash,'modelSha256Verified':weight_hash,
        'sampledWatchdog':{'maxRssMiB':args.max_rss_mib,'minAvailableMiB':args.min_available_mib},
        'expertCacheMiB':args.expert_cache_mib,'samples':[],'responses':[],
        'prefetch':not args.no_prefetch,'engineArgs':tuning,
        'arithmeticExactMatch':False,'integrationValidated':False,
        'cacheState':'warm/unknown: recent transfer and SHA256 verification',
        'baseline':adb('shell','cat /proc/meminfo; cat /proc/pressure/memory 2>/dev/null; dumpsys battery')}
    output=ROOT/f'probe-{run_id}.json'
    started=time.monotonic();pid=None;process=None
    def save():output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    def http(path,body=None,timeout=None):
        request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,
            data=json.dumps(body).encode() if body else None,
            headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=timeout or args.timeout) as response:
            return json.load(response)
    def stop_model():
        if not pid:return
        for signal in ['-TERM','-KILL']:
            identity=adb('shell',f'cat /proc/{pid}/cmdline 2>/dev/null || true')
            if REMOTE+'/llama-server' not in identity or key not in identity:return
            adb('shell','kill',signal,pid)
            time.sleep(1)
    def sample():
        raw=adb('shell',f'cat /proc/{pid}/status; cat /proc/meminfo; cat /proc/{pid}/io 2>/dev/null; cat /proc/pressure/memory 2>/dev/null || true')
        fields={k:int(v) for k,v in re.findall(r'^(VmRSS|VmHWM|VmSwap|RssAnon|RssFile|MemAvailable|read_bytes|rchar):\s+(\d+)',raw,re.M)}
        if 'VmRSS' not in fields:
            raise RuntimeError('Executor exited')
        record={'seconds':round(time.monotonic()-started,2),**fields,
            'pressure':[line for line in raw.splitlines() if line.startswith(('some avg','full avg'))]}
        report['samples'].append(record);save()
        if fields['VmRSS']>args.max_rss_mib*1024:
            raise RuntimeError('Stopped by sampled RSS watchdog')
        if fields.get('MemAvailable',0)<args.min_available_mib*1024:
            raise RuntimeError('Stopped by available-memory watchdog')
        if record['seconds']>args.timeout:
            raise RuntimeError('Stopped by test timeout')
    try:
        with (ROOT/f'probe-{run_id}.log').open('w',encoding='utf-8') as log:
            launch=f'echo $$ > {pid_file}; exec '+shlex.join(command)
            process=subprocess.Popen([str(ADB),'-s',args.serial,'shell',launch],stdout=log,stderr=subprocess.STDOUT)
            time.sleep(1)
            pid=adb('shell','cat',pid_file)
            if not pid.isdecimal():raise RuntimeError('Invalid executor PID')
            while True:
                sample()
                try:
                    if http('/health',timeout=2).get('status')=='ok':break
                except Exception:pass
                time.sleep(2)
            report['loadSeconds']=round(time.monotonic()-started,2)
            print('Model ready:',report['loadSeconds'],'seconds',flush=True)
            # Direct inference first. Harness integration and the user's poisoned
            # conversation are separate follow-up checks, not claimed by this probe.
            turn=time.monotonic()
            body={
                'model':manifest['model'],'messages':[{'role':'user','content':args.prompt}],
                'max_tokens':args.max_output_tokens,'temperature':0,'stream':False,'cache_prompt':True}
            future=concurrent.futures.Future()
            def request_turn():
                try:future.set_result(http('/v1/chat/completions',body))
                except Exception as error:future.set_exception(error)
            threading.Thread(target=request_turn,daemon=True).start()
            try:
                while not future.done():
                    sample();time.sleep(2)
                result=future.result()
                sample()
                report['responses'].append({'seconds':time.monotonic()-turn,'result':result})
                text=result.get('choices',[{}])[0].get('message',{}).get('content','')
                report['arithmeticExactMatch']=text.strip()=='8'
                print('Response:',repr(text),'seconds:',round(time.monotonic()-turn,2),flush=True)
            finally:
                if not future.done():
                    stop_model()
    except Exception as error:
        report['error']=str(error);print('Probe:',error,flush=True)
    finally:
        if pid and process:
            try:
                stop_model()
            except Exception as error:report['cleanupError']=str(error)
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.terminate()
        try:adb('forward','--remove',f'tcp:{port}')
        except Exception as error:report['forwardCleanupError']=str(error)
        try:report['batteryAfter']=adb('shell','dumpsys battery')
        except Exception:pass
        report['totalSeconds']=round(time.monotonic()-started,2);save()
        print('Report:',output,flush=True)

if __name__=='__main__':main()
