import { execFile } from "node:child_process";
import os from "node:os";
import { activeTurns } from "./pendingTurns.js";

/**
 * Live vitals for the Atlas "symbiosis" view: how busy this PC is (CPU, RAM,
 * GPU when an NVIDIA card answers) and whether Aurora is thinking. Cheap:
 * CPU from os.cpus() deltas, GPU read at most every 5 s.
 */
let lastCpu = null;
function cpuLoad() {
  const totals = os.cpus().reduce((acc, cpu) => {
    const t = cpu.times;
    acc.idle += t.idle;
    acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return acc;
  }, { idle: 0, total: 0 });
  const previous = lastCpu;
  lastCpu = totals;
  if (!previous || totals.total === previous.total) return null;
  return Math.max(0, Math.min(1, 1 - (totals.idle - previous.idle) / (totals.total - previous.total)));
}

let gpuCache = { at: 0, value: null, pending: null };
function gpu() {
  if (Date.now() - gpuCache.at < 5000 || gpuCache.pending) return gpuCache.value;
  gpuCache.pending = new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total,name", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      const [util, used, total, name] = String(stdout || "").split("\n")[0].split(",").map((x) => x.trim());
      gpuCache = { at: Date.now(), value: error || !total ? null : { load: Number(util) / 100, memory: Number(used) / Number(total), name }, pending: null };
      resolve();
    });
  });
  return gpuCache.value;
}

export function systemVitals() {
  const turns = activeTurns();
  return {
    cpu: cpuLoad(),
    memory: 1 - os.freemem() / os.totalmem(),
    gpu: gpu(),
    cores: os.cpus().length,
    aurora: { thinking: turns.count > 0, stage: turns.stage, active: turns.count },
    at: Date.now(),
  };
}
