import React, { useState, useRef, useEffect } from 'react';
import {
  BridgeCondition,
  TrialAnalysis,
  analyzeCsvTrial,
  exportSvgElementAsFile,
  triggerFileDownload,
} from '../utils/dspAndValidation';
import {
  Radio,
  Square,
  RotateCcw,
  ExternalLink,
  Download,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Play,
  Save,
  Usb,
} from 'lucide-react';

interface LiveMonitorViewProps {
  selectedDlpfCfg: number;
  onSelectDlpfCfg: (cfg: number) => void;
  onSaveTrialToComparator: (trial: TrialAnalysis, navigateToComparator?: boolean) => void;
}

interface LivePoint {
  index: number;
  tUs: number;
  tSec: number;
  dtUs: number;
  azMs2: number;
}

const CONDITION_LABELS: Record<BridgeCondition, string> = {
  secured: 'Brace Secured (Baseline)',
  disengaged: 'Brace Disengaged (Altered)',
  restored: 'Brace Restored (Control)',
};

export const LiveMonitorView: React.FC<LiveMonitorViewProps> = ({
  selectedDlpfCfg,
  onSelectDlpfCfg,
  onSaveTrialToComparator,
}) => {
  // Target condition & label for incoming recording
  const [targetCondition, setTargetCondition] = useState<BridgeCondition>('secured');
  const [trialLabel, setTrialLabel] = useState<string>('Secured Run #1');
  const [autoSaveOnEnd, setAutoSaveOnEnd] = useState<boolean>(true);

  // Connection & Acquisition State
  const [connectionMode, setConnectionMode] = useState<
    'disconnected' | 'webserial_connected' | 'synthetic_stream'
  >('disconnected');
  const [isTrialRecording, setIsTrialRecording] = useState<boolean>(false);
  const [activeHardwareDlpf, setActiveHardwareDlpf] = useState<number>(selectedDlpfCfg);
  const [statusBanner, setStatusBanner] = useState<{
    tone: 'neutral' | 'success' | 'warn' | 'error';
    text: string;
  }>({
    tone: 'neutral',
    text: 'Ready to connect Arduino Nano (ATmega328P) at 115200 baud via Web Serial, or run a labelled Synthetic 200 Hz stream.',
  });

  // Live Telemetry State
  const [livePoints, setLivePoints] = useState<LivePoint[]>([]);
  const [diagnosticLog, setDiagnosticLog] = useState<string[]>([]);
  const [overrunCount, setOverrunCount] = useState<number>(0);
  const [i2cErrCount, setI2cErrCount] = useState<number>(0);
  const [clipCount, setClipCount] = useState<number>(0);
  const [lateReadCount, setLateReadCount] = useState<number>(0);
  const [lastEndStatus, setLastEndStatus] = useState<
    'NONE' | 'CLEAN' | 'DEGRADED' | 'ABORT' | 'INCOMPLETE'
  >('NONE');

  // Environment Detection (WebSerial Support & Embedded Iframe Detection)
  const [isWebSerialAvailable, setIsWebSerialAvailable] = useState<boolean>(true);
  const [isEmbeddedIframe, setIsEmbeddedIframe] = useState<boolean>(false);

  // Refs for WebSerial & Stream Buffers
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const keepReadingRef = useRef<boolean>(false);
  const rawLinesRef = useRef<string[]>([]);
  const pointsRef = useRef<LivePoint[]>([]);
  const unwrappedUsRef = useRef<number>(0);
  const simTimerRef = useRef<number | null>(null);
  const liveSvgRef = useRef<SVGSVGElement | null>(null);
  const targetConditionRef = useRef<BridgeCondition>(targetCondition);
  const trialLabelRef = useRef<string>(trialLabel);
  const autoSaveRef = useRef<boolean>(autoSaveOnEnd);

  useEffect(() => {
    targetConditionRef.current = targetCondition;
  }, [targetCondition]);

  useEffect(() => {
    trialLabelRef.current = trialLabel;
  }, [trialLabel]);

  useEffect(() => {
    autoSaveRef.current = autoSaveOnEnd;
  }, [autoSaveOnEnd]);

  useEffect(() => {
    const nav = navigator as any;
    setIsWebSerialAvailable(Boolean(nav && nav.serial));
    try {
      setIsEmbeddedIframe(window.self !== window.top);
    } catch {
      setIsEmbeddedIframe(true);
    }

    const handleUsbDisconnect = (ev: any) => {
      if (portRef.current && (ev.target === portRef.current || ev.port === portRef.current)) {
        handleUnexpectedDisconnect('USB cable disconnected during session.');
      }
    };

    if (nav && nav.serial && typeof nav.serial.addEventListener === 'function') {
      nav.serial.addEventListener('disconnect', handleUsbDisconnect);
    }

    return () => {
      if (nav && nav.serial && typeof nav.serial.removeEventListener === 'function') {
        nav.serial.removeEventListener('disconnect', handleUsbDisconnect);
      }
      stopSimulatedStream();
    };
  }, []);

  const resetTrialTelemetry = (provenanceHeader: string) => {
    rawLinesRef.current = [provenanceHeader];
    pointsRef.current = [];
    unwrappedUsRef.current = 0;
    setLivePoints([]);
    setDiagnosticLog([provenanceHeader]);
    setOverrunCount(0);
    setI2cErrCount(0);
    setClipCount(0);
    setLateReadCount(0);
    setLastEndStatus('NONE');
  };

  const processIncomingSerialLine = (
    rawLine: string,
    provenance: 'EMPIRICAL_MEASUREMENT' | 'SYNTHETIC_SIMULATION'
  ) => {
    const line = rawLine.trim();
    if (!line) return;

    rawLinesRef.current.push(line);

    if (line.startsWith('#')) {
      setDiagnosticLog((prev) => [...prev.slice(-80), line]);
      const upper = line.toUpperCase();

      if (upper.startsWith('#BRIDGE-X')) {
        const m = line.match(/dlpf_cfg=(\d+)/i);
        if (m) {
          const cfg = parseInt(m[1], 10);
          setActiveHardwareDlpf(cfg);
          onSelectDlpfCfg(cfg);
        }
      } else if (upper.startsWith('#INFO:DLPF_CFG_SET')) {
        const m = line.match(/dlpf_cfg=(\d+)/i);
        if (m) {
          const cfg = parseInt(m[1], 10);
          setActiveHardwareDlpf(cfg);
          onSelectDlpfCfg(cfg);
        }
        setStatusBanner({
          tone: 'success',
          text: `Filter configuration updated on Arduino: ${line}`,
        });
      } else if (upper.startsWith('#START:TRIAL')) {
        setIsTrialRecording(true);
        setLastEndStatus('NONE');
        setStatusBanner({
          tone: 'neutral',
          text:
            provenance === 'EMPIRICAL_MEASUREMENT'
              ? 'Recording live 200 Hz hardware trial (2,000 samples). DLPF settings are locked until completion.'
              : 'SYNTHETIC DATA: Streaming simulated 200 Hz trial (2,000 samples).',
        });
      } else if (upper.startsWith('#WARN:CMD_LOCKED')) {
        setStatusBanner({
          tone: 'warn',
          text: 'Filter change rejected by firmware (#WARN:CMD_LOCKED): DLPF cannot be changed during an active 2,000-sample trial.',
        });
      } else if (upper.startsWith('#ERR:OVERRUN')) {
        const m = line.match(/missed=(\d+)/i);
        const missed = m ? parseInt(m[1], 10) : 1;
        setOverrunCount((c) => c + missed);
      } else if (upper.startsWith('#ERR:I2C')) {
        setI2cErrCount((c) => c + 1);
      } else if (upper.startsWith('#WARN:CLIP')) {
        setClipCount((c) => c + 1);
      } else if (upper.startsWith('#WARN:LATE_READ')) {
        setLateReadCount((c) => c + 1);
      } else if (upper.startsWith('#END:CLEAN')) {
        setIsTrialRecording(false);
        setLastEndStatus('CLEAN');
        finalizeAndOptionallySaveTrial(provenance, 'CLEAN');
      } else if (upper.startsWith('#END:DEGRADED')) {
        setIsTrialRecording(false);
        setLastEndStatus('DEGRADED');
        finalizeAndOptionallySaveTrial(provenance, 'DEGRADED');
      } else if (upper.startsWith('#END:ABORT')) {
        setIsTrialRecording(false);
        setLastEndStatus('ABORT');
        setStatusBanner({
          tone: 'error',
          text: `Trial aborted by firmware: ${line}`,
        });
      }
      return;
    }

    // Parse numeric row: t_us,az_m_s2
    const parts = line.split(',');
    if (parts.length !== 2) return;
    const tVal = Number(parts[0].trim());
    const azVal = Number(parts[1].trim());
    if (!Number.isFinite(tVal) || !Number.isFinite(azVal) || tVal < 0) return;

    const pts = pointsRef.current;
    const idx = pts.length;
    let dtUs = 0;
    if (idx > 0) {
      const prevT = pts[idx - 1].tUs;
      const uDiff = (Math.floor(tVal) - prevT) >>> 0;
      dtUs = uDiff > 0 && uDiff < 0x80000000 ? uDiff : 0;
      unwrappedUsRef.current += dtUs;
    }

    const newPt: LivePoint = {
      index: idx,
      tUs: Math.floor(tVal),
      tSec: unwrappedUsRef.current * 1e-6,
      dtUs,
      azMs2: azVal,
    };
    pts.push(newPt);

    // Throttle React state updates to every 10 samples (20 fps at 200 Hz) or at sample 2000
    if (pts.length % 10 === 0 || pts.length === 1 || pts.length >= 2000) {
      setLivePoints([...pts]);
    }
  };

  const finalizeAndOptionallySaveTrial = (
    provenance: 'EMPIRICAL_MEASUREMENT' | 'SYNTHETIC_SIMULATION',
    endState: 'CLEAN' | 'DEGRADED' | 'INCOMPLETE'
  ) => {
    setLivePoints([...pointsRef.current]);
    const csvText = rawLinesRef.current.join('\n');
    const cond = targetConditionRef.current;
    const baseLabel =
      trialLabelRef.current.trim() ||
      `${provenance === 'SYNTHETIC_SIMULATION' ? 'SYNTHETIC' : 'Hardware'} ${
        CONDITION_LABELS[cond].split(' ')[1]
      }`;

    const analysis = analyzeCsvTrial(csvText, {
      id: `${provenance === 'SYNTHETIC_SIMULATION' ? 'syn-live' : 'hw-live'}-${Date.now()}`,
      label:
        provenance === 'SYNTHETIC_SIMULATION' && !baseLabel.toUpperCase().includes('SYNTHETIC')
          ? `SYNTHETIC · ${baseLabel}`
          : baseLabel,
      condition: cond,
      forcedProvenance: provenance,
    });

    if (autoSaveRef.current && analysis.sampleCount >= 20) {
      onSaveTrialToComparator(analysis, false);
      setStatusBanner({
        tone: endState === 'CLEAN' ? 'success' : 'warn',
        text: `Trial complete (#END:${endState}, ${analysis.sampleCount} samples, f₁ = ${analysis.dominantFreqHz.toFixed(
          2
        )} Hz, verdict: ${
          analysis.verdict
        }) — automatically saved to "${CONDITION_LABELS[cond]}" in FFT & Condition Comparison.`,
      });
    } else {
      setStatusBanner({
        tone: endState === 'CLEAN' ? 'success' : 'warn',
        text: `Trial finished (#END:${endState}, ${analysis.sampleCount} samples). Click "Save Current Trial to Comparator" to include it in multi-condition analysis.`,
      });
    }
  };

  const handleUnexpectedDisconnect = (reason: string) => {
    keepReadingRef.current = false;
    setConnectionMode('disconnected');
    const collected = pointsRef.current.length;
    if (isTrialRecording || (collected > 0 && collected < 2000 && lastEndStatus === 'NONE')) {
      rawLinesRef.current.push(
        `#END:ABORT,reason=USB_DISCONNECTED_INCOMPLETE,samples=${collected}`
      );
      setDiagnosticLog((prev) => [
        ...prev,
        `#END:ABORT,reason=USB_DISCONNECTED_INCOMPLETE,samples=${collected}`,
      ]);
      setIsTrialRecording(false);
      setLastEndStatus('INCOMPLETE');
      setLivePoints([...pointsRef.current]);
      setStatusBanner({
        tone: 'error',
        text: `${reason} Incomplete recording flagged (${collected}/2,000 samples captured). Partial data retained for inspection.`,
      });
    } else {
      setIsTrialRecording(false);
      setStatusBanner({
        tone: 'warn',
        text: reason,
      });
    }
  };

  // Connect to real Arduino via Web Serial (115200 baud)
  const handleConnectWebSerial = async () => {
    stopSimulatedStream();
    const nav = navigator as any;
    if (!nav || !nav.serial) {
      setStatusBanner({
        tone: 'error',
        text: 'Web Serial API is not available in this browser. Open this app in Google Chrome or Microsoft Edge on Windows/macOS/Linux.',
      });
      return;
    }

    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      keepReadingRef.current = true;
      setConnectionMode('webserial_connected');
      setIsTrialRecording(true);
      resetTrialTelemetry(
        `#PROVENANCE:EMPIRICAL_MEASUREMENT,source=WEBSERIAL_115200,condition=${targetCondition.toUpperCase()}`
      );
      setStatusBanner({
        tone: 'neutral',
        text: 'Connected to Arduino at 115200 baud. Listening for #BRIDGE-X startup header and 200.0 Hz sample stream...',
      });

      const decoder = new TextDecoderStream();
      const readableClosed = port.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let partial = '';
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          partial += value;
          const lines = partial.split(/\r?\n/);
          partial = lines.pop() || '';
          for (const ln of lines) {
            processIncomingSerialLine(ln, 'EMPIRICAL_MEASUREMENT');
          }
        }
      }

      await readableClosed;
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isPolicyErr =
        msg.toLowerCase().includes('permissions policy') ||
        msg.toLowerCase().includes('disallowed') ||
        msg.toLowerCase().includes('securityerror');

      setConnectionMode('disconnected');
      setIsTrialRecording(false);
      setStatusBanner({
        tone: isPolicyErr ? 'warn' : 'error',
        text: isPolicyErr
          ? 'Browser blocked Web Serial inside this embedded preview iframe. Click "Open App in Standalone Tab" on the right to grant USB Serial permission in a top-level tab.'
          : `Serial connection message: ${msg}`,
      });
    }
  };

  const handleDisconnectWebSerial = async () => {
    keepReadingRef.current = false;
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch {
      // Ignore close errors
    }

    const collected = pointsRef.current.length;
    const wasMidTrial = isTrialRecording && collected > 0 && collected < 2000;
    setConnectionMode('disconnected');
    setIsTrialRecording(false);

    if (wasMidTrial) {
      rawLinesRef.current.push(
        `#END:ABORT,reason=USER_DISCONNECTED_INCOMPLETE,samples=${collected}`
      );
      setLastEndStatus('INCOMPLETE');
      setLivePoints([...pointsRef.current]);
      setStatusBanner({
        tone: 'warn',
        text: `Disconnected during active trial (${collected}/2,000 samples). Flagged as INCOMPLETE.`,
      });
    } else {
      setStatusBanner({
        tone: 'neutral',
        text: 'Arduino serial port closed cleanly.',
      });
    }
  };

  // Send single-character command ('R', '3', or '4') to connected Arduino
  const sendArduinoSerialCommand = async (cmd: 'R' | '3' | '4') => {
    if ((cmd === '3' || cmd === '4') && isTrialRecording) {
      setStatusBanner({
        tone: 'warn',
        text: 'Filter settings are locked during an active trial. Wait until 2,000 samples complete before changing DLPF bandwidth.',
      });
      return;
    }

    if (connectionMode === 'webserial_connected' && portRef.current?.writable) {
      try {
        if (cmd === 'R') {
          resetTrialTelemetry(
            `#PROVENANCE:EMPIRICAL_MEASUREMENT,source=WEBSERIAL_115200,condition=${targetCondition.toUpperCase()}`
          );
          setIsTrialRecording(true);
        }
        const writer = portRef.current.writable.getWriter();
        const encoder = new TextEncoder();
        await writer.write(encoder.encode(`${cmd}\n`));
        writer.releaseLock();

        if (cmd === 'R') {
          setStatusBanner({
            tone: 'neutral',
            text: `Sent 'R' command to Arduino — starting fresh 2,000-sample trial for ${CONDITION_LABELS[targetCondition]}.`,
          });
        }
      } catch (err: any) {
        setStatusBanner({
          tone: 'error',
          text: `Failed to write command '${cmd}' to serial port: ${err?.message || String(err)}`,
        });
      }
    } else if (connectionMode !== 'webserial_connected') {
      if (cmd === '3' || cmd === '4') {
        const newCfg = cmd === '3' ? 3 : 4;
        setActiveHardwareDlpf(newCfg);
        onSelectDlpfCfg(newCfg);
        setStatusBanner({
          tone: 'neutral',
          text: `Pre-selected DLPF_CFG = ${newCfg} (${newCfg === 3 ? '44 Hz' : '21 Hz'} bandwidth) for next simulated or hardware run.`,
        });
      } else if (cmd === 'R') {
        startSimulatedLiveStream();
      }
    }
  };

  // Simulated Live 200 Hz Stream for testing without physical Arduino connected
  const stopSimulatedStream = () => {
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
  };

  const startSimulatedLiveStream = () => {
    stopSimulatedStream();
    const cond = targetCondition;
    const f1 = cond === 'secured' ? 14.2 : cond === 'disengaged' ? 11.6 : 14.15;
    const f2 = cond === 'secured' ? 27.5 : cond === 'disengaged' ? 24.1 : 27.4;
    const zeta = cond === 'disengaged' ? 0.021 : 0.018;

    setConnectionMode('synthetic_stream');
    setIsTrialRecording(true);
    resetTrialTelemetry(
      `#PROVENANCE:SYNTHETIC_SIMULATION,source=SIMULATED_LIVE_STREAM,condition=${cond.toUpperCase()}`
    );

    processIncomingSerialLine(
      `#BRIDGE-X,fw=1.1-SIM,mcu=SYNTHETIC_MODEL,fs_hz=200,dlpf_cfg=${activeHardwareDlpf},bw_hz=${
        activeHardwareDlpf === 3 ? 44 : 21
      },delay_ms=${activeHardwareDlpf === 3 ? '4.9' : '8.5'},range_g=2`,
      'SYNTHETIC_SIMULATION'
    );
    processIncomingSerialLine('#COLUMNS:t_us,az_m_s2', 'SYNTHETIC_SIMULATION');
    processIncomingSerialLine('#START:TRIAL,target_samples=2000', 'SYNTHETIC_SIMULATION');

    let sampleIdx = 0;
    let simTUs = 1000000;
    // Emit 20 samples every 50 ms (real-time 400 samples/s = 2x speed so 2,000 samples complete in 5 seconds)
    simTimerRef.current = window.setInterval(() => {
      for (let k = 0; k < 20; k++) {
        if (sampleIdx >= 2000) {
          stopSimulatedStream();
          processIncomingSerialLine(
            '#END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0',
            'SYNTHETIC_SIMULATION'
          );
          setConnectionMode('disconnected');
          return;
        }

        if (sampleIdx > 0) {
          simTUs += 5000;
        }
        const tS = sampleIdx * 0.005;
        let dyn = 0;
        if (tS >= 0.25) {
          const tau = tS - 0.25;
          const w1 = 2 * Math.PI * f1;
          const w2 = 2 * Math.PI * f2;
          dyn =
            1.45 * Math.exp(-zeta * w1 * tau) * Math.sin(w1 * tau) +
            0.55 * Math.exp(-zeta * 1.15 * w2 * tau) * Math.sin(w2 * tau + 0.3);
        }
        const noise = (Math.random() - 0.5) * 0.04;
        const az = 9.80665 + 0.025 + dyn + noise;
        processIncomingSerialLine(
          `${simTUs},${az.toFixed(4)}`,
          'SYNTHETIC_SIMULATION'
        );
        sampleIdx++;
      }
    }, 50);
  };

  const handleManualSaveCurrentBuffer = () => {
    if (pointsRef.current.length < 10) return;
    const isSyn = rawLinesRef.current.some((l) =>
      l.toUpperCase().includes('SYNTHETIC')
    );
    const provenance = isSyn ? 'SYNTHETIC_SIMULATION' : 'EMPIRICAL_MEASUREMENT';
    const analysis = analyzeCsvTrial(rawLinesRef.current.join('\n'), {
      id: `manual-${Date.now()}`,
      label:
        trialLabel.trim() ||
        `${isSyn ? 'SYNTHETIC · ' : ''}${CONDITION_LABELS[targetCondition]}`,
      condition: targetCondition,
      forcedProvenance: provenance,
    });
    onSaveTrialToComparator(analysis, true);
  };

  const handleDownloadCurrentCsv = () => {
    if (rawLinesRef.current.length < 2) return;
    const isSyn = rawLinesRef.current.some((l) =>
      l.toUpperCase().includes('SYNTHETIC')
    );
    const prefix = isSyn ? 'SYNTHETIC' : 'EMPIRICAL';
    triggerFileDownload(
      `${prefix}_${targetCondition}_${trialLabel.replace(/\s+/g, '_')}.csv`,
      rawLinesRef.current.join('\n')
    );
  };

  // Live Statistics Computation
  const sampleCount = livePoints.length;
  const latestPoint = sampleCount > 0 ? livePoints[sampleCount - 1] : null;
  const elapsedS = latestPoint ? latestPoint.tSec : 0;
  const effectiveFsHz =
    elapsedS > 0 && sampleCount > 1 ? (sampleCount - 1) / elapsedS : 0;

  let meanAz = 0;
  let peakDyn = 0;
  if (sampleCount > 0) {
    let sum = 0;
    for (let i = 0; i < sampleCount; i++) sum += livePoints[i].azMs2;
    meanAz = sum / sampleCount;
    for (let i = 0; i < sampleCount; i++) {
      const d = Math.abs(livePoints[i].azMs2 - meanAz);
      if (d > peakDyn) peakDyn = d;
    }
  }

  const isCurrentBufferSynthetic = diagnosticLog.some((l) =>
    l.toUpperCase().includes('SYNTHETIC')
  );

  return (
    <div className="space-y-6">
      {/* Embedded Preview / Browser Serial Permission Guidance */}
      {(!isWebSerialAvailable || isEmbeddedIframe) && (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="text-xs font-mono font-semibold text-slate-900">
              USB Web Serial Hardware Access Notice (115200 Baud Client-Side Connection)
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Web browsers require top-level window permission in Chrome or Edge to open a physical USB <code className="font-mono">COM</code> port via <code className="font-mono">navigator.serial</code>. If the serial port chooser is blocked inside this embedded preview frame, open the application in a standalone browser tab or test immediately using the clearly labelled <strong>Synthetic 200 Hz Stream</strong>.
            </p>
          </div>
          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <span>Open App in Standalone Tab</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Module A: Hardware Connection & Command Console */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500">
              Module A · Hardware Connection &amp; Sensor Command Controller (115200 Baud)
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              Arduino Nano (ATmega328P) &amp; MPU-6050 Live Acquisition Console
            </h1>
          </div>

          {/* Connection State Text Indicator (No Decorative Pulsing Dots) */}
          <div className="flex items-center gap-3 text-xs font-mono">
            <span
              className={`font-semibold ${
                connectionMode === 'webserial_connected'
                  ? 'text-emerald-700'
                  : connectionMode === 'synthetic_stream'
                  ? 'text-amber-700'
                  : 'text-slate-600'
              }`}
            >
              {connectionMode === 'webserial_connected'
                ? '● CONNECTED: HARDWARE WEBSERIAL (115200 BAUD)'
                : connectionMode === 'synthetic_stream'
                ? '◆ ACTIVE: SYNTHETIC DATA STREAM (200 HZ)'
                : '○ DISCONNECTED (IDLE)'}
            </span>
          </div>
        </div>

        {/* Status Feedback Bar */}
        <div
          className={`px-4 py-2.5 rounded border text-xs font-mono flex items-center justify-between gap-4 ${
            statusBanner.tone === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : statusBanner.tone === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : statusBanner.tone === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}
        >
          <span>{statusBanner.text}</span>
          {lastEndStatus !== 'NONE' && (
            <span className="font-bold shrink-0">END STATE: #{lastEndStatus}</span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Condition Assignment & USB Port Controls */}
          <div className="lg:col-span-6 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-4">
            <div className="text-xs font-semibold text-slate-900">
              1. Select Bridge Condition &amp; Trial Label Before Recording
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(['secured', 'disengaged', 'restored'] as BridgeCondition[]).map(
                (cond) => (
                  <button
                    key={cond}
                    onClick={() => {
                      setTargetCondition(cond);
                      if (cond === 'secured' && trialLabel.startsWith('Disengaged')) {
                        setTrialLabel('Secured Run #1');
                      } else if (cond === 'disengaged' && trialLabel.startsWith('Secured')) {
                        setTrialLabel('Disengaged Run #1');
                      } else if (cond === 'restored' && !trialLabel.startsWith('Restored')) {
                        setTrialLabel('Restored Run #1');
                      }
                    }}
                    className={`px-2.5 py-2 text-xs font-medium rounded border text-center transition-colors cursor-pointer whitespace-nowrap truncate ${
                      targetCondition === cond
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {cond === 'secured'
                      ? 'Brace Secured'
                      : cond === 'disengaged'
                      ? 'Brace Disengaged'
                      : 'Brace Restored'}
                  </button>
                )
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-8">
                <label className="block text-xs text-slate-600 mb-1">
                  Trial Recording Label
                </label>
                <input
                  type="text"
                  value={trialLabel}
                  onChange={(e) => setTrialLabel(e.target.value)}
                  placeholder="e.g., Secured Run #1"
                  className="w-full text-xs bg-white border border-slate-300 rounded px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <label className="sm:col-span-4 flex items-center gap-2 text-xs text-slate-700 bg-white border border-slate-300 rounded px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSaveOnEnd}
                  onChange={(e) => setAutoSaveOnEnd(e.target.checked)}
                  className="accent-blue-600"
                />
                <span className="whitespace-nowrap">Auto-Save Trial</span>
              </label>
            </div>

            <div className="pt-3 border-t border-slate-200 flex flex-wrap gap-2.5">
              {connectionMode !== 'webserial_connected' ? (
                <button
                  onClick={handleConnectWebSerial}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Usb className="w-3.5 h-3.5" />
                  <span>Connect Arduino Nano (Web Serial 115200)</span>
                </button>
              ) : (
                <button
                  onClick={handleDisconnectWebSerial}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Disconnect USB Port</span>
                </button>
              )}

              <button
                onClick={() => {
                  if (connectionMode === 'synthetic_stream') {
                    stopSimulatedStream();
                    setConnectionMode('disconnected');
                    setIsTrialRecording(false);
                  } else {
                    startSimulatedLiveStream();
                  }
                }}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded transition-colors cursor-pointer whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {connectionMode === 'synthetic_stream'
                    ? 'Stop Synthetic Stream'
                    : 'Run Simulated Stream (SYNTHETIC DATA)'}
                </span>
              </button>
            </div>
          </div>

          {/* Right Column: Serial Commands ('R', '3', '4') with Active-Trial Lockout */}
          <div className="lg:col-span-6 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                2. Hardware Commands (<code className="font-mono">R</code>,{' '}
                <code className="font-mono">4</code>, <code className="font-mono">3</code>) &amp;
                Mid-Trial Filter Lockout
              </span>
              <span className="text-[11px] font-mono text-slate-600">
                Active Filter: DLPF_CFG={activeHardwareDlpf} (
                {activeHardwareDlpf === 3 ? '44 Hz' : '21 Hz'})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                onClick={() => sendArduinoSerialCommand('R')}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Send &apos;R&apos; (Start Trial)</span>
              </button>

              <button
                onClick={() => sendArduinoSerialCommand('4')}
                disabled={isTrialRecording}
                title={
                  isTrialRecording
                    ? 'Locked during active trial so recording cannot mix two filter configurations'
                    : 'Set MPU6050 DLPF_CFG = 4 (21 Hz Bandwidth, 8.5 ms delay)'
                }
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                  isTrialRecording
                    ? 'opacity-45 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                    : activeHardwareDlpf === 4
                    ? 'bg-blue-600 text-white border-blue-600 cursor-pointer'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 cursor-pointer'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Send &apos;4&apos; (21 Hz BW)</span>
              </button>

              <button
                onClick={() => sendArduinoSerialCommand('3')}
                disabled={isTrialRecording}
                title={
                  isTrialRecording
                    ? 'Locked during active trial so recording cannot mix two filter configurations'
                    : 'Set MPU6050 DLPF_CFG = 3 (44 Hz Bandwidth, 4.9 ms delay)'
                }
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                  isTrialRecording
                    ? 'opacity-45 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                    : activeHardwareDlpf === 3
                    ? 'bg-blue-600 text-white border-blue-600 cursor-pointer'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 cursor-pointer'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Send &apos;3&apos; (44 Hz BW)</span>
              </button>
            </div>

            <div className="text-xs text-slate-600 leading-relaxed space-y-1">
              <p>
                <strong>Mid-Trial Configuration Lockout:</strong> Both this interface and <code className="font-mono">bridge_x_firmware.ino</code> reject filter commands <code className="font-mono">3</code> and <code className="font-mono">4</code> while a 2,000-sample trial is actively recording (<code className="font-mono">#WARN:CMD_LOCKED</code>), guaranteeing every trial is acquired under a single stationary filter configuration.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Module B: Live Vibration Monitor & Sampling Diagnostics */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500">
              Module B · Live Vibration Monitor &amp; Real-Time Sampling Diagnostics
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Vertical Acceleration <code className="font-mono">a_z(t)</code> vs. Time (200.0 Hz Target)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleManualSaveCurrentBuffer}
              disabled={sampleCount < 10}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Current Trial &amp; View FFT</span>
            </button>
            <button
              onClick={handleDownloadCurrentCsv}
              disabled={sampleCount < 2}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Raw CSV</span>
            </button>
            <button
              onClick={() =>
                exportSvgElementAsFile(
                  liveSvgRef.current,
                  `BRIDGE_X_Live_Waveform_${targetCondition}`,
                  'png'
                )
              }
              disabled={sampleCount < 2}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Plot (.png)</span>
            </button>
          </div>
        </div>

        {/* 6-Card Live Telemetry Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded">
            <div className="text-[11px] font-mono text-slate-500">SAMPLES RECORDED</div>
            <div className="text-xl font-mono font-bold text-slate-900 tabular-nums mt-0.5">
              {sampleCount} <span className="text-xs font-normal text-slate-500">/ 2000</span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              Elapsed: {elapsedS.toFixed(2)} s
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded">
            <div className="text-[11px] font-mono text-slate-500">LATEST TIMESTAMP</div>
            <div className="text-xl font-mono font-bold text-slate-900 tabular-nums mt-0.5">
              {latestPoint ? latestPoint.tUs : '—'}
              <span className="text-xs font-normal text-slate-500 ml-1">µs</span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              Last Δt: {latestPoint ? `${latestPoint.dtUs} µs` : '—'}
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded">
            <div className="text-[11px] font-mono text-slate-500">MEASURED RATE f_s</div>
            <div className="text-xl font-mono font-bold text-slate-900 tabular-nums mt-0.5">
              {effectiveFsHz > 0 ? effectiveFsHz.toFixed(2) : '—'}
              <span className="text-xs font-normal text-slate-500 ml-1">Hz</span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              Target: 200.00 Hz
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded">
            <div className="text-[11px] font-mono text-slate-500">MEAN GRAVITY a_z</div>
            <div className="text-xl font-mono font-bold text-slate-900 tabular-nums mt-0.5">
              {sampleCount > 0 ? meanAz.toFixed(3) : '—'}
              <span className="text-xs font-normal text-slate-500 ml-1">m/s²</span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              Nominal +Z: +9.81 m/s²
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded">
            <div className="text-[11px] font-mono text-slate-500">PEAK DYNAMIC |Δa_z|</div>
            <div className="text-xl font-mono font-bold text-slate-900 tabular-nums mt-0.5">
              {sampleCount > 0 ? peakDyn.toFixed(3) : '—'}
              <span className="text-xs font-normal text-slate-500 ml-1">m/s²</span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              Clip Rail: ±9.80 m/s² dyn
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded">
            <div className="text-[11px] font-mono text-slate-500">FAULT COUNTERS</div>
            <div
              className={`text-xl font-mono font-bold tabular-nums mt-0.5 ${
                overrunCount + i2cErrCount + clipCount + lateReadCount === 0
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }`}
            >
              {overrunCount + i2cErrCount + clipCount + lateReadCount}
              <span className="text-xs font-normal text-slate-500 ml-1">faults</span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              OV:{overrunCount} I2C:{i2cErrCount} CL:{clipCount}
            </div>
          </div>
        </div>

        {/* Live Time-Series Waveform Plot */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between text-xs font-mono">
            <span
              className={
                isCurrentBufferSynthetic
                  ? 'font-bold text-amber-700'
                  : sampleCount > 0
                  ? 'font-bold text-emerald-700'
                  : 'text-slate-500'
              }
            >
              {isCurrentBufferSynthetic
                ? '◆ SYNTHETIC DATA — SIMULATED 200.0 HZ VIBRATION WAVEFORM'
                : sampleCount > 0
                ? '● EMPIRICAL HARDWARE DATA — ARDUINO NANO (ATMEGA328P) + MPU-6050 (115200 BAUD)'
                : 'WAITING FOR SERIAL STREAM (t_us,az_m_s2)'}
            </span>
            <span className="text-slate-500">
              Condition: {CONDITION_LABELS[targetCondition]}
            </span>
          </div>

          <svg
            ref={liveSvgRef}
            viewBox="0 0 760 220"
            className="w-full h-auto bg-slate-50 border border-slate-200 rounded"
          >
            {/* Provenance Watermark Label inside SVG for Exported Plots */}
            <text
              x={60}
              y={26}
              className="text-[11px] font-mono font-bold fill-slate-700"
            >
              {isCurrentBufferSynthetic
                ? 'SYNTHETIC DATA — BRIDGE-X SIMULATED FREE VIBRATION (az_m_s2 vs Time)'
                : `BRIDGE-X VIBRATION RECORDING — ${trialLabel} (${CONDITION_LABELS[targetCondition]})`}
            </text>

            {/* Horizontal Grid Lines */}
            {[-1, -0.5, 0, 0.5, 1].map((frac, idx) => {
              const y = 115 - frac * 75;
              const maxSpan = Math.max(peakDyn * 1.15, 0.5);
              const val = (meanAz || 9.81) + frac * maxSpan;
              return (
                <g key={idx}>
                  <line
                    x1={55}
                    y1={y}
                    x2={735}
                    y2={y}
                    stroke={frac === 0 ? '#94A3B8' : '#E2E8F0'}
                    strokeDasharray={frac === 0 ? '3 3' : undefined}
                  />
                  <text
                    x={48}
                    y={y + 3}
                    textAnchor="end"
                    className="text-[10px] font-mono fill-slate-500"
                  >
                    {val.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* Time Axis Grid */}
            {[0, 2, 4, 6, 8, 10].map((sec) => {
              const x = 55 + (sec / 10) * 680;
              return (
                <g key={sec}>
                  <line x1={x} y1={35} x2={x} y2={195} stroke="#E2E8F0" />
                  <text
                    x={x}
                    y={210}
                    textAnchor="middle"
                    className="text-[10px] font-mono fill-slate-500"
                  >
                    {sec.toFixed(1)} s
                  </text>
                </g>
              );
            })}

            {/* Waveform Polyline */}
            {sampleCount > 1 &&
              (() => {
                const maxSpan = Math.max(peakDyn * 1.15, 0.5);
                const centerAz = meanAz || 9.81;
                const totalDur = Math.max(elapsedS, 10.0);
                const stride = Math.max(1, Math.floor(sampleCount / 800));
                const pts: string[] = [];

                for (let i = 0; i < sampleCount; i += stride) {
                  const p = livePoints[i];
                  const x = 55 + (p.tSec / totalDur) * 680;
                  const y = Math.max(
                    35,
                    Math.min(195, 115 - ((p.azMs2 - centerAz) / maxSpan) * 75)
                  );
                  pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                }

                return (
                  <polyline
                    fill="none"
                    stroke={isCurrentBufferSynthetic ? '#D97706' : '#2563EB'}
                    strokeWidth={1.5}
                    points={pts.join(' ')}
                  />
                );
              })()}
          </svg>
        </div>

        {/* Raw #-Prefixed Diagnostic Log */}
        <div className="bg-slate-900 text-slate-100 rounded-md p-4 space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-400 text-[11px] border-b border-slate-800 pb-1.5">
            <span>SERIAL PROTOCOL LIFECYCLE &amp; #-DIAGNOSTIC MONITOR (115200 BAUD)</span>
            <span>Format: t_us,az_m_s2</span>
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1 text-[11px]">
            {diagnosticLog.length === 0 ? (
              <div className="text-slate-500">
                No #-diagnostic messages received yet. Connect Arduino or start simulated stream.
              </div>
            ) : (
              diagnosticLog.map((ln, idx) => (
                <div
                  key={idx}
                  className={
                    ln.startsWith('#ERR') || ln.startsWith('#END:ABORT')
                      ? 'text-rose-400'
                      : ln.startsWith('#WARN') || ln.startsWith('#END:DEGRADED')
                      ? 'text-amber-300'
                      : ln.startsWith('#END:CLEAN')
                      ? 'text-emerald-400'
                      : 'text-slate-200'
                  }
                >
                  {ln}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
