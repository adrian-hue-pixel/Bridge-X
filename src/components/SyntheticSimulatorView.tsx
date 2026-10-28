import React, { useState, useMemo } from 'react';
import { MPU6050_DLPF_OPTIONS } from '../data/mpu6050Data';
import {
  generateSyntheticBridgeTrial,
  findModePeakInBand,
  triggerFileDownload,
  TrialAnalysis,
} from '../utils/dspAndValidation';
import { Download, Play, FlaskConical } from 'lucide-react';

interface SyntheticSimulatorViewProps {
  selectedDlpfCfg: number;
  onSelectDlpfCfg: (cfg: number) => void;
  onLoadSyntheticSetIntoComparator: (trials: TrialAnalysis[]) => void;
}

export const SyntheticSimulatorView: React.FC<SyntheticSimulatorViewProps> = ({
  selectedDlpfCfg,
  onSelectDlpfCfg,
  onLoadSyntheticSetIntoComparator,
}) => {
  // Synthetic Modal Parameters for the 3 Bridge States
  const [f1SecuredHz, setF1SecuredHz] = useState<number>(14.2);
  const [f1DisengagedHz, setF1DisengagedHz] = useState<number>(11.6);
  const [f1RestoredHz, setF1RestoredHz] = useState<number>(14.15);

  const [f2SecuredHz, setF2SecuredHz] = useState<number>(27.5);
  const [f2DisengagedHz, setF2DisengagedHz] = useState<number>(24.1);
  const [f2RestoredHz, setF2RestoredHz] = useState<number>(27.4);

  const [dampingZeta, setDampingZeta] = useState<number>(0.018);
  const [noiseStdMs2, setNoiseStdMs2] = useState<number>(0.025);
  const [jitterStdUs, setJitterStdUs] = useState<number>(8);
  const [injectedOverruns, setInjectedOverruns] = useState<number>(0);
  const [windowType, setWindowType] = useState<'hann' | 'rectangular'>('hann');
  const [hoverFreqHz, setHoverFreqHz] = useState<number | null>(null);

  const activeDlpf =
    MPU6050_DLPF_OPTIONS.find((d) => d.dlpfCfg === selectedDlpfCfg) ||
    MPU6050_DLPF_OPTIONS[4];

  const syntheticTriplet = useMemo(() => {
    const secured = generateSyntheticBridgeTrial({
      condition: 'secured',
      label: 'SYNTHETIC · Brace Secured (Intact Model)',
      sampleCount: 2000,
      fsHz: 200,
      dlpfCfg: selectedDlpfCfg,
      f1Hz: f1SecuredHz,
      amp1Ms2: 1.45,
      zeta1: dampingZeta,
      f2Hz: f2SecuredHz,
      amp2Ms2: 0.65,
      zeta2: dampingZeta * 1.15,
      noiseStdMs2,
      jitterStdUs,
      injectedOverruns,
      startNearWrap: false,
      seedOffset: 10,
    });

    const disengaged = generateSyntheticBridgeTrial({
      condition: 'disengaged',
      label: 'SYNTHETIC · Brace Disengaged (Altered Model)',
      sampleCount: 2000,
      fsHz: 200,
      dlpfCfg: selectedDlpfCfg,
      f1Hz: f1DisengagedHz,
      amp1Ms2: 1.65,
      zeta1: dampingZeta * 1.2,
      f2Hz: f2DisengagedHz,
      amp2Ms2: 0.72,
      zeta2: dampingZeta * 1.25,
      noiseStdMs2,
      jitterStdUs,
      injectedOverruns,
      startNearWrap: false,
      seedOffset: 20,
    });

    const restored = generateSyntheticBridgeTrial({
      condition: 'restored',
      label: 'SYNTHETIC · Brace Restored (Control Model)',
      sampleCount: 2000,
      fsHz: 200,
      dlpfCfg: selectedDlpfCfg,
      f1Hz: f1RestoredHz,
      amp1Ms2: 1.42,
      zeta1: dampingZeta,
      f2Hz: f2RestoredHz,
      amp2Ms2: 0.64,
      zeta2: dampingZeta * 1.15,
      noiseStdMs2,
      jitterStdUs,
      injectedOverruns,
      startNearWrap: false,
      seedOffset: 30,
    });

    return { secured, disengaged, restored };
  }, [
    selectedDlpfCfg,
    f1SecuredHz,
    f1DisengagedHz,
    f1RestoredHz,
    f2SecuredHz,
    f2DisengagedHz,
    f2RestoredHz,
    dampingZeta,
    noiseStdMs2,
    jitterStdUs,
    injectedOverruns,
    windowType,
  ]);

  const peakSecuredM1 = findModePeakInBand(syntheticTriplet.secured.fftBins, 2, 20);
  const peakDisengagedM1 = findModePeakInBand(syntheticTriplet.disengaged.fftBins, 2, 20);
  const peakRestoredM1 = findModePeakInBand(syntheticTriplet.restored.fftBins, 2, 20);

  const peakSecuredM2 = findModePeakInBand(syntheticTriplet.secured.fftBins, 20.1, 35);
  const peakDisengagedM2 = findModePeakInBand(syntheticTriplet.disengaged.fftBins, 20.1, 35);

  const deltaF1Hz = peakDisengagedM1.parabolicFreqHz - peakSecuredM1.parabolicFreqHz;
  const deltaF1Pct =
    peakSecuredM1.parabolicFreqHz > 0
      ? (deltaF1Hz / peakSecuredM1.parabolicFreqHz) * 100
      : 0;

  return (
    <div className="space-y-6">
      {/* Explicit Provenance Banner */}
      <div className="bg-amber-50 border border-amber-300 rounded-lg px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-amber-700 shrink-0" />
          <div>
            <div className="text-xs font-mono font-bold uppercase text-amber-900">
              SYNTHETIC NUMERICAL SIMULATION — PIPELINE & DSP VERIFICATION SANDBOX
            </div>
            <p className="text-xs text-amber-800 mt-0.5">
              All waveforms and spectra in this tab are mathematically generated from a damped 2-DOF Euler-Bernoulli modal model (<code className="font-mono">#PROVENANCE:SYNTHETIC_SIMULATION</code>). Never report these synthetic curves as physical bridge measurements.
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            onLoadSyntheticSetIntoComparator([
              syntheticTriplet.secured,
              syntheticTriplet.disengaged,
              syntheticTriplet.restored,
            ])
          }
          className="px-3.5 py-2 text-xs font-semibold text-amber-950 bg-amber-200 hover:bg-amber-300 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          Send Synthetic Triplet to Comparator (Tagged Synthetic)
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Parameter Column */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div>
            <div className="text-xs font-mono text-slate-500 uppercase">
              Synthetic Model Parameters
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-0.5">
              Modal Frequencies, DLPF & Timing Faults
            </h2>
          </div>

          <div className="space-y-3 border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-800">
              Mode 1 Fundamental Bending (2–20 Hz Band)
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Brace Secured f₁</span>
                <span className="font-mono font-semibold text-blue-700">{f1SecuredHz.toFixed(2)} Hz</span>
              </div>
              <input
                type="range"
                min={5}
                max={19}
                step={0.1}
                value={f1SecuredHz}
                onChange={(e) => setF1SecuredHz(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Brace Disengaged f₁</span>
                <span className="font-mono font-semibold text-amber-700">{f1DisengagedHz.toFixed(2)} Hz</span>
              </div>
              <input
                type="range"
                min={5}
                max={19}
                step={0.1}
                value={f1DisengagedHz}
                onChange={(e) => setF1DisengagedHz(Number(e.target.value))}
                className="w-full accent-amber-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Brace Restored f₁</span>
                <span className="font-mono font-semibold text-emerald-700">{f1RestoredHz.toFixed(2)} Hz</span>
              </div>
              <input
                type="range"
                min={5}
                max={19}
                step={0.1}
                value={f1RestoredHz}
                onChange={(e) => setF1RestoredHz(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-800">
              Mode 2 Higher Harmonic (20–35 Hz Band — Tests DLPF Roll-off)
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Secured f₂ / Disengaged f₂</span>
                <span className="font-mono text-slate-900">
                  {f2SecuredHz.toFixed(1)} Hz / {f2DisengagedHz.toFixed(1)} Hz
                </span>
              </div>
              <input
                type="range"
                min={20.5}
                max={34}
                step={0.5}
                value={f2SecuredHz}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setF2SecuredHz(val);
                  setF2RestoredHz(val - 0.1);
                }}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-800">
              MPU6050 Filter, Damping & Acquisition Impairments
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Selectable MPU6050 Filter (<code className="font-mono">CONFIG 0x1A</code>)
              </label>
              <select
                value={selectedDlpfCfg}
                onChange={(e) => onSelectDlpfCfg(Number(e.target.value))}
                className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900"
              >
                <option value={4}>DLPF_CFG=4 · 21 Hz BW (-4.8 dB @ 30 Hz)</option>
                <option value={3}>DLPF_CFG=3 · 44 Hz BW (-1.7 dB @ 30 Hz)</option>
                <option value={2}>DLPF_CFG=2 · 94 Hz BW (-0.4 dB @ 30 Hz)</option>
                <option value={5}>DLPF_CFG=5 · 10 Hz BW (-10.0 dB @ 30 Hz)</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Modal Damping Ratio (ζ)</span>
                <span className="font-mono text-slate-900">{(dampingZeta * 100).toFixed(2)}%</span>
              </div>
              <input
                type="range"
                min={0.005}
                max={0.06}
                step={0.002}
                value={dampingZeta}
                onChange={(e) => setDampingZeta(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Timing Jitter σ_t (µs)</span>
                <span className="font-mono text-slate-900">±{jitterStdUs} µs</span>
              </div>
              <input
                type="range"
                min={0}
                max={120}
                step={4}
                value={jitterStdUs}
                onChange={(e) => setJitterStdUs(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Injected Missed Interrupt Overruns</span>
                <span className="font-mono text-slate-900">{injectedOverruns} missed samples</span>
              </div>
              <input
                type="range"
                min={0}
                max={6}
                step={1}
                value={injectedOverruns}
                onChange={(e) => setInjectedOverruns(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 flex gap-2">
            <button
              onClick={() => {
                setF1DisengagedHz(f1SecuredHz);
                setF2DisengagedHz(f2SecuredHz);
              }}
              className="flex-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
            >
              Test Null Shift (Δf = 0)
            </button>
            <button
              onClick={() => {
                setF1SecuredHz(14.2);
                setF1DisengagedHz(11.6);
                setF1RestoredHz(14.15);
                setF2SecuredHz(27.5);
                setF2DisengagedHz(24.1);
              }}
              className="flex-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
            >
              Reset Default Shift
            </button>
          </div>
        </div>

        {/* Right Visualization Stage */}
        <div className="lg:col-span-8 space-y-6">
          {/* Synthetic FFT Spectrum Comparison */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[11px] font-mono font-semibold text-amber-700 uppercase">
                  [SYNTHETIC DATA] · HANN-WINDOWED SINGLE-SIDED AMPLITUDE SPECTRUM (2–35 HZ)
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  Simulated Modal Frequency Shift: Secured vs. Disengaged vs. Restored
                </h3>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-blue-600">■ Secured</span>
                <span className="text-amber-600">■ Disengaged</span>
                <span className="text-emerald-600">-- Restored</span>
              </div>
            </div>

            <svg
              viewBox="0 0 720 260"
              className="w-full h-auto bg-slate-50 border border-slate-200 rounded cursor-crosshair"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = ((e.clientX - rect.left) / rect.width) * 720;
                const f = ((relX - 55) / 635) * 35;
                if (f >= 0 && f <= 35) setHoverFreqHz(f);
              }}
              onMouseLeave={() => setHoverFreqHz(null)}
            >
              {/* DLPF -3 dB Cutoff Marker if within 0-35 Hz */}
              {activeDlpf.accelBandwidthHz <= 35 && (
                <g>
                  <line
                    x1={55 + (activeDlpf.accelBandwidthHz / 35) * 635}
                    y1={20}
                    x2={55 + (activeDlpf.accelBandwidthHz / 35) * 635}
                    y2={220}
                    stroke="#E11D48"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={55 + (activeDlpf.accelBandwidthHz / 35) * 635 + 4}
                    y={32}
                    className="text-[10px] font-mono fill-rose-600"
                  >
                    DLPF -3dB ({activeDlpf.accelBandwidthHz} Hz)
                  </text>
                </g>
              )}

              {/* Frequency Grid */}
              {[0, 5, 10, 15, 20, 25, 30, 35].map((f) => {
                const x = 55 + (f / 35) * 635;
                return (
                  <g key={f}>
                    <line x1={x} y1={20} x2={x} y2={220} stroke="#E2E8F0" />
                    <text
                      x={x}
                      y={238}
                      textAnchor="middle"
                      className="text-[10px] font-mono fill-slate-500"
                    >
                      {f} Hz
                    </text>
                  </g>
                );
              })}

              {/* Amplitude Grid */}
              {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((a) => {
                const y = 220 - (a / 0.55) * 200;
                return (
                  <g key={a}>
                    <line x1={55} y1={y} x2={690} y2={y} stroke="#E2E8F0" />
                    <text
                      x={48}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[10px] font-mono fill-slate-500"
                    >
                      {a.toFixed(2)}
                    </text>
                  </g>
                );
              })}

              {/* Plot Secured, Disengaged, Restored FFT Curves */}
              {[
                { trial: syntheticTriplet.secured, color: '#2563EB', dash: undefined },
                { trial: syntheticTriplet.disengaged, color: '#D97706', dash: undefined },
                { trial: syntheticTriplet.restored, color: '#059669', dash: '4 2' },
              ].map((item, idx) => {
                const pts = item.trial.fftBins
                  .filter((b) => b.freqHz <= 35)
                  .map((b) => {
                    const x = 55 + (b.freqHz / 35) * 635;
                    const y = Math.max(20, 220 - (b.amplitudeMs2 / 0.55) * 200);
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  });
                return (
                  <polyline
                    key={idx}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={2}
                    strokeDasharray={item.dash}
                    points={pts.join(' ')}
                  />
                );
              })}

              {/* Hover Crosshair */}
              {hoverFreqHz !== null && (
                <g>
                  <line
                    x1={55 + (hoverFreqHz / 35) * 635}
                    y1={20}
                    x2={55 + (hoverFreqHz / 35) * 635}
                    y2={220}
                    stroke="#0F172A"
                    strokeWidth={1}
                  />
                  <text
                    x={685}
                    y={34}
                    textAnchor="end"
                    className="text-[11px] font-mono font-semibold fill-slate-900"
                  >
                    Cursor: {hoverFreqHz.toFixed(2)} Hz
                  </text>
                </g>
              )}
            </svg>

            {/*Recovered Synthetic Peak Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-500">SECURED MODE 1</div>
                <div className="text-base font-bold text-blue-700 mt-0.5">
                  {peakSecuredM1.parabolicFreqHz.toFixed(2)} Hz
                </div>
                <div className="text-[11px] text-slate-500">
                  True: {f1SecuredHz.toFixed(2)} Hz
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-500">DISENGAGED MODE 1</div>
                <div className="text-base font-bold text-amber-700 mt-0.5">
                  {peakDisengagedM1.parabolicFreqHz.toFixed(2)} Hz
                </div>
                <div className="text-[11px] text-slate-500">
                  True: {f1DisengagedHz.toFixed(2)} Hz
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-500">RESTORED MODE 1</div>
                <div className="text-base font-bold text-emerald-700 mt-0.5">
                  {peakRestoredM1.parabolicFreqHz.toFixed(2)} Hz
                </div>
                <div className="text-[11px] text-slate-500">
                  True: {f1RestoredHz.toFixed(2)} Hz
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-500">MEASURED SHIFT Δf₁</div>
                <div className="text-base font-bold text-slate-900 mt-0.5">
                  {deltaF1Hz >= 0 ? '+' : ''}
                  {deltaF1Hz.toFixed(2)} Hz ({deltaF1Pct.toFixed(1)}%)
                </div>
                <div className="text-[11px] text-slate-500">
                  Mode 2 Amp: {peakSecuredM2.peakAmpMs2.toFixed(3)} m/s²
                </div>
              </div>
            </div>
          </div>

          {/* Time-Domain Ring-Down Preview (First 3.0 Seconds) */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[11px] font-mono font-semibold text-amber-700 uppercase">
                  [SYNTHETIC DATA] · TIME-DOMAIN RING-DOWN WAVEFORM (0.0 – 3.0 S ZOOM)
                </span>
                <h3 className="text-sm font-bold text-slate-900">
                  Midspan Vertical Specific Force <code className="font-mono">az_m_s2</code> (Including +9.81 m/s² Gravity Baseline)
                </h3>
              </div>
              <button
                onClick={() =>
                  triggerFileDownload(
                    `SYNTHETIC_BRIDGE_X_${selectedDlpfCfg}_Secured.csv`,
                    syntheticTriplet.secured.rawCsvText
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Synthetic CSV (Tagged)</span>
              </button>
            </div>

            <svg
              viewBox="0 0 720 180"
              className="w-full h-auto bg-slate-50 border border-slate-200 rounded"
            >
              {/* Gravity +9.81 baseline */}
              <line x1={55} y1={90} x2={690} y2={90} stroke="#CBD5E1" strokeDasharray="3 3" />
              <text x={48} y={93} textAnchor="end" className="text-[10px] font-mono fill-slate-500">
                9.81
              </text>
              <text x={48} y={30} textAnchor="end" className="text-[10px] font-mono fill-slate-500">
                12.0
              </text>
              <text x={48} y={155} textAnchor="end" className="text-[10px] font-mono fill-slate-500">
                7.6
              </text>

              {/* Plot first 600 samples (3.0 s) for Secured and Disengaged */}
              {[
                { trial: syntheticTriplet.secured, color: '#2563EB' },
                { trial: syntheticTriplet.disengaged, color: '#D97706' },
              ].map((item, idx) => {
                const pts = item.trial.samples
                  .slice(0, 600)
                  .map((s) => {
                    const x = 55 + (s.unwrappedTimeS / 3.0) * 635;
                    const y = 90 - ((s.azMs2 - 9.838) / 2.4) * 65;
                    return `${x.toFixed(1)},${Math.max(15, Math.min(165, y)).toFixed(1)}`;
                  });
                return (
                  <polyline
                    key={idx}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={1.5}
                    points={pts.join(' ')}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
