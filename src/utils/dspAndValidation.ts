import { MPU6050_DLPF_OPTIONS } from '../data/mpu6050Data';

export type BridgeCondition = 'secured' | 'disengaged' | 'restored';
export type DataProvenance = 'EMPIRICAL_MEASUREMENT' | 'SYNTHETIC_SIMULATION';
export type WindowFunctionType = 'hann' | 'tukey' | 'rectangular';
export type TrialEndStatus = 'CLEAN' | 'DEGRADED' | 'ABORT' | 'INCOMPLETE';

export interface ParsedSample {
  index: number;
  rawTUs: number;
  unwrappedTimeS: number;
  unwrappedS: number;
  dtUs: number;
  azMs2: number;
}

export interface FftBin {
  freqHz: number;
  amplitudeMs2: number;
}

export interface TrialAnalysis {
  id: string;
  label: string;
  condition: BridgeCondition;
  provenance: DataProvenance;
  createdAtIso: string;
  rawCsvText: string;
  samples: ParsedSample[];
  diagnosticLines: string[];
  sampleCount: number;
  durationS: number;
  effectiveFsHz: number;
  medianDtUs: number;
  p99JitterUs: number;
  maxGapUs: number;
  wrapEvents: number;
  nonMonotonicCount: number;
  overrunCount: number;
  i2cErrorCount: number;
  clipCount: number;
  lateReadCount: number;
  endStatus: TrialEndStatus;
  dlpfCfgDetected: number;
  meanAzMs2: number;
  rmsDynamicMs2: number;
  peakDynamicMs2: number;
  ringdownOnsetS: number;
  windowStartS: number;
  windowEndS: number;
  windowFunction: WindowFunctionType;
  fftBins: FftBin[];
  binSpacingHz: number;
  dominantFreqHz: number;
  dominantAmpMs2: number;
  verdict: 'PASS' | 'WARN' | 'REJECT';
  verdictReasons: string[];
}

export function getDlpfMagnitudeGain(freqHz: number, dlpfCfg: number): number {
  const opt =
    MPU6050_DLPF_OPTIONS.find((o) => o.dlpfCfg === dlpfCfg) ||
    MPU6050_DLPF_OPTIONS[4];
  const fc = opt.accelBandwidthHz;
  if (fc <= 0) return 1.0;
  return 1.0 / Math.sqrt(1.0 + Math.pow(freqHz / fc, 2));
}

export function getDlpfDb(freqHz: number, dlpfCfg: number): number {
  const gain = getDlpfMagnitudeGain(freqHz, dlpfCfg);
  return 20 * Math.log10(Math.max(gain, 1e-6));
}

/**
 * In-place radix-2 Cooley-Tukey FFT
 */
function fftRadix2(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n <= 1) return;

  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wlenR = Math.cos(angle);
    const wlenI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + halfLen] * wR - imag[i + k + halfLen] * wI;
        const vI = real[i + k + halfLen] * wI + imag[i + k + halfLen] * wR;

        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + halfLen] = uR - vR;
        imag[i + k + halfLen] = uI - vI;

        const nextWR = wR * wlenR - wI * wlenI;
        wI = wR * wlenI + wI * wlenR;
        wR = nextWR;
      }
    }
  }
}

export function detectRingdownOnsetS(
  samples: ParsedSample[],
  meanAz: number
): number {
  if (samples.length < 20) return 0;
  let peakIdx = 0;
  let maxDev = 0;
  for (let i = 0; i < samples.length; i++) {
    const dev = Math.abs(samples[i].azMs2 - meanAz);
    if (dev > maxDev) {
      maxDev = dev;
      peakIdx = i;
    }
  }
  if (maxDev < 0.05) return 0;
  // Walk backward slightly from peak to capture release onset without pre-release silence
  const onsetIdx = Math.max(0, peakIdx - 4);
  return samples[onsetIdx].unwrappedTimeS;
}

export function computeWindowWeight(
  i: number,
  n: number,
  windowType: WindowFunctionType
): number {
  if (n <= 1 || windowType === 'rectangular') return 1.0;
  if (windowType === 'hann') {
    return 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  // Tukey window (alpha = 0.25): flat 1.0 across middle 75% (preserving early decay), cosine taper on edges
  const alpha = 0.25;
  const x = i / (n - 1);
  if (x < alpha / 2) {
    return 0.5 * (1 + Math.cos(Math.PI * ((2 * x) / alpha - 1)));
  }
  if (x > 1 - alpha / 2) {
    return 0.5 * (1 + Math.cos(Math.PI * ((2 * x) / alpha - 2 / alpha + 1)));
  }
  return 1.0;
}

export function computeSpectrum(
  azValues: number[],
  effectiveFsHz: number,
  windowType: WindowFunctionType = 'hann'
): { bins: FftBin[]; binSpacingHz: number; meanAz: number } {
  const n = azValues.length;
  if (n < 8 || effectiveFsHz <= 0) {
    return { bins: [], binSpacingHz: 0, meanAz: 0 };
  }

  // 1. Empirical mean removal (removes local gravity ~9.81 + sensor offset + static tilt)
  let sum = 0;
  for (let i = 0; i < n; i++) sum += azValues[i];
  const meanAz = sum / n;

  // Next power of 2 >= max(n, 2048) so cropped ring-down windows have smooth interpolated FFT bins
  let nFft = 2048;
  while (nFft < n) nFft <<= 1;

  const real = new Float64Array(nFft);
  const imag = new Float64Array(nFft);

  let windowSum = 0;
  for (let i = 0; i < n; i++) {
    const w = computeWindowWeight(i, n, windowType);
    windowSum += w;
    real[i] = (azValues[i] - meanAz) * w;
  }

  fftRadix2(real, imag);

  const half = nFft >> 1;
  // True physical Rayleigh frequency resolution is governed by the analyzed window duration T_win = n / effectiveFsHz
  const binSpacingHz = effectiveFsHz / n;
  const fftFreqStep = effectiveFsHz / nFft;
  const scale = 2.0 / Math.max(windowSum, 1e-9);

  const bins: FftBin[] = [];
  for (let k = 0; k <= half; k++) {
    const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) * scale;
    bins.push({
      freqHz: k * fftFreqStep,
      amplitudeMs2: k === 0 ? mag * 0.5 : mag,
    });
  }

  return { bins, binSpacingHz, meanAz };
}

export function findModePeakInBand(
  bins: FftBin[],
  fMinHz: number,
  fMaxHz: number
): { peakFreqHz: number; peakAmpMs2: number; parabolicFreqHz: number } {
  if (!bins.length) return { peakFreqHz: 0, peakAmpMs2: 0, parabolicFreqHz: 0 };

  let bestIdx = -1;
  let bestAmp = -1;

  for (let i = 0; i < bins.length; i++) {
    const f = bins[i].freqHz;
    if (f >= fMinHz && f <= fMaxHz) {
      if (bins[i].amplitudeMs2 > bestAmp) {
        bestAmp = bins[i].amplitudeMs2;
        bestIdx = i;
      }
    }
  }

  if (bestIdx === -1) {
    return { peakFreqHz: 0, peakAmpMs2: 0, parabolicFreqHz: 0 };
  }

  const peakFreqHz = bins[bestIdx].freqHz;
  let parabolicFreqHz = peakFreqHz;

  // Parabolic 3-point interpolation on magnitude for sub-bin peak estimate
  if (bestIdx > 0 && bestIdx < bins.length - 1) {
    const alpha = bins[bestIdx - 1].amplitudeMs2;
    const beta = bins[bestIdx].amplitudeMs2;
    const gamma = bins[bestIdx + 1].amplitudeMs2;
    const denom = alpha - 2 * beta + gamma;
    if (Math.abs(denom) > 1e-12) {
      const p = 0.5 * ((alpha - gamma) / denom);
      const df = bins[1].freqHz - bins[0].freqHz;
      if (Math.abs(p) <= 0.5) {
        parabolicFreqHz = peakFreqHz + p * df;
      }
    }
  }

  return {
    peakFreqHz,
    peakAmpMs2: bestAmp,
    parabolicFreqHz,
  };
}

export function computeSubWindowSpectrumForTrial(
  trial: TrialAnalysis,
  startS: number,
  endS: number,
  windowType: WindowFunctionType = 'hann'
): {
  fftBins: FftBin[];
  binSpacingHz: number;
  dominantFreqHz: number;
  dominantAmpMs2: number;
  windowStartS: number;
  windowEndS: number;
  windowSampleCount: number;
} {
  const samples = trial.samples;
  if (samples.length < 8) {
    return {
      fftBins: trial.fftBins,
      binSpacingHz: trial.binSpacingHz,
      dominantFreqHz: trial.dominantFreqHz,
      dominantAmpMs2: trial.dominantAmpMs2,
      windowStartS: 0,
      windowEndS: trial.durationS,
      windowSampleCount: samples.length,
    };
  }

  const totalDurS = Math.max(
    trial.durationS,
    samples[samples.length - 1].unwrappedTimeS
  );
  const clampedStartS = Math.max(0, Math.min(startS, Math.max(0, totalDurS - 0.25)));
  const clampedEndS = Math.max(
    clampedStartS + 0.25,
    Math.min(totalDurS || 10, endS)
  );

  const slicedAz: number[] = [];
  let actualStartS = clampedStartS;
  let actualEndS = clampedEndS;
  let firstFound = false;

  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].unwrappedTimeS;
    if (t >= clampedStartS && t <= clampedEndS) {
      if (!firstFound) {
        actualStartS = t;
        firstFound = true;
      }
      actualEndS = t;
      slicedAz.push(samples[i].azMs2);
    }
  }

  const azToUse = slicedAz.length >= 16 ? slicedAz : samples.map((s) => s.azMs2);
  if (slicedAz.length < 16) {
    actualStartS = 0;
    actualEndS = totalDurS;
  }

  const spec = computeSpectrum(azToUse, trial.effectiveFsHz, windowType);
  const dom = findModePeakInBand(spec.bins, 2.0, 30.0);

  return {
    fftBins: spec.bins,
    binSpacingHz: spec.binSpacingHz,
    dominantFreqHz: dom.parabolicFreqHz,
    dominantAmpMs2: dom.peakAmpMs2,
    windowStartS: actualStartS,
    windowEndS: actualEndS,
    windowSampleCount: azToUse.length,
  };
}

export function analyzeCsvTrial(
  rawCsvText: string,
  options: {
    id: string;
    label: string;
    condition: BridgeCondition;
    forcedProvenance?: DataProvenance;
    windowType?: WindowFunctionType;
  }
): TrialAnalysis {
  const lines = rawCsvText.split(/\r?\n/);
  const diagnosticLines: string[] = [];
  const rawTimestamps: number[] = [];
  const rawAz: number[] = [];

  let detectedProvenance: DataProvenance =
    options.forcedProvenance || 'EMPIRICAL_MEASUREMENT';
  let overrunCount = 0;
  let i2cErrorCount = 0;
  let clipCount = 0;
  let lateReadCount = 0;
  let endStatus: TrialEndStatus = 'INCOMPLETE';
  let dlpfCfgDetected = 4;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      diagnosticLines.push(trimmed);
      const upper = trimmed.toUpperCase();
      if (upper.includes('SYNTHETIC')) {
        detectedProvenance = 'SYNTHETIC_SIMULATION';
      }
      const dlpfMatch = trimmed.match(/dlpf_cfg=(\d+)/i);
      if (dlpfMatch) {
        dlpfCfgDetected = parseInt(dlpfMatch[1], 10);
      }
      if (upper.startsWith('#ERR:OVERRUN')) {
        const match = trimmed.match(/missed=(\d+)/i);
        overrunCount += match ? parseInt(match[1], 10) : 1;
      } else if (upper.startsWith('#ERR:I2C')) {
        i2cErrorCount += 1;
      } else if (upper.startsWith('#WARN:LATE_READ')) {
        lateReadCount += 1;
      } else if (upper.startsWith('#WARN:CLIP')) {
        clipCount += 1;
      } else if (upper.startsWith('#END:CLEAN')) {
        endStatus = 'CLEAN';
      } else if (upper.startsWith('#END:DEGRADED')) {
        endStatus = 'DEGRADED';
        const ovMatch = trimmed.match(/overruns=(\d+)/i);
        const i2cMatch = trimmed.match(/i2c_errs=(\d+)/i);
        const clMatch = trimmed.match(/clips=(\d+)/i);
        const lrMatch = trimmed.match(/late_reads=(\d+)/i);
        if (ovMatch) overrunCount = Math.max(overrunCount, parseInt(ovMatch[1], 10));
        if (i2cMatch) i2cErrorCount = Math.max(i2cErrorCount, parseInt(i2cMatch[1], 10));
        if (clMatch) clipCount = Math.max(clipCount, parseInt(clMatch[1], 10));
        if (lrMatch) lateReadCount = Math.max(lateReadCount, parseInt(lrMatch[1], 10));
      } else if (upper.startsWith('#END:ABORT')) {
        endStatus = 'ABORT';
      }
      continue;
    }

    // Ignore accidental header row "t_us,az_m_s2"
    if (/^t_us\s*,/i.test(trimmed)) continue;

    const parts = trimmed.split(',');
    if (parts.length !== 2) continue;

    const tVal = Number(parts[0].trim());
    const azVal = Number(parts[1].trim());
    if (!Number.isFinite(tVal) || !Number.isFinite(azVal) || tVal < 0) continue;

    rawTimestamps.push(Math.floor(tVal));
    rawAz.push(azVal);
    if (Math.abs(azVal) >= 19.2) {
      clipCount += 1;
    }
  }

  if (options.forcedProvenance) {
    detectedProvenance = options.forcedProvenance;
  }

  const n = rawTimestamps.length;
  const samples: ParsedSample[] = [];
  const dtArray: number[] = [];
  let unwrappedUs = 0;
  let wrapEvents = 0;
  let nonMonotonicCount = 0;

  for (let i = 0; i < n; i++) {
    let dtUs = 0;
    if (i > 0) {
      // Wrap-safe 32-bit unsigned difference: (curr - prev) >>> 0
      const uDiff = (rawTimestamps[i] - rawTimestamps[i - 1]) >>> 0;
      if (rawTimestamps[i] < rawTimestamps[i - 1] && uDiff < 1_000_000) {
        wrapEvents += 1;
      }
      if (uDiff === 0 || uDiff > 0x80000000) {
        nonMonotonicCount += 1;
        dtUs = 0;
      } else {
        dtUs = uDiff;
      }
      unwrappedUs += dtUs;
      dtArray.push(dtUs);
    }

    const tSec = unwrappedUs * 1e-6;
    samples.push({
      index: i,
      rawTUs: rawTimestamps[i],
      unwrappedTimeS: tSec,
      unwrappedS: tSec,
      dtUs,
      azMs2: rawAz[i],
    });
  }

  const durationS = unwrappedUs * 1e-6;
  const effectiveFsHz = durationS > 0 && n > 1 ? (n - 1) / durationS : 200;

  let medianDtUs = 0;
  let p99JitterUs = 0;
  let maxGapUs = 0;

  if (dtArray.length > 0) {
    const sortedDt = [...dtArray].sort((a, b) => a - b);
    const mid = Math.floor(sortedDt.length / 2);
    medianDtUs =
      sortedDt.length % 2 !== 0
        ? sortedDt[mid]
        : 0.5 * (sortedDt[mid - 1] + sortedDt[mid]);
    maxGapUs = sortedDt[sortedDt.length - 1];

    const absDeviations = dtArray
      .map((dt) => Math.abs(dt - medianDtUs))
      .sort((a, b) => a - b);
    const p99Idx = Math.min(
      absDeviations.length - 1,
      Math.floor(absDeviations.length * 0.99)
    );
    p99JitterUs = absDeviations[p99Idx];
  }

  let totalAzSum = 0;
  for (let i = 0; i < n; i++) totalAzSum += rawAz[i];
  const overallMeanAz = n > 0 ? totalAzSum / n : 0;

  // Auto-detect ringdown onset so decaying vibration is not suppressed by a 10s Hann taper
  const ringdownOnsetS = detectRingdownOnsetS(samples, overallMeanAz);
  const windowStartS = ringdownOnsetS;
  const windowEndS = Math.min(durationS || 10, ringdownOnsetS + 3.5);
  const windowFunction: WindowFunctionType = options.windowType || 'hann';

  const ringdownAz = samples
    .filter((s) => s.unwrappedTimeS >= windowStartS && s.unwrappedTimeS <= windowEndS)
    .map((s) => s.azMs2);

  const { bins, binSpacingHz, meanAz } = computeSpectrum(
    ringdownAz.length >= 32 ? ringdownAz : rawAz,
    effectiveFsHz,
    windowFunction
  );

  const domPeak = findModePeakInBand(bins, 2.0, 30.0);

  let sumSq = 0;
  let peakDynamicMs2 = 0;
  for (let i = 0; i < n; i++) {
    const dyn = Math.abs(rawAz[i] - overallMeanAz);
    if (dyn > peakDynamicMs2) peakDynamicMs2 = dyn;
    sumSq += dyn * dyn;
  }
  const rmsDynamicMs2 = n > 0 ? Math.sqrt(sumSq / n) : 0;

  // If no explicit #END line was present (e.g. raw CSV without # comments) but 2000 clean samples exist
  if (
    endStatus === 'INCOMPLETE' &&
    diagnosticLines.length === 0 &&
    n >= 1980 &&
    overrunCount === 0 &&
    i2cErrorCount === 0 &&
    clipCount === 0
  ) {
    endStatus = 'CLEAN';
  }

  // Evaluate commissioning criteria
  const verdictReasons: string[] = [];
  let verdict: 'PASS' | 'WARN' | 'REJECT' = 'PASS';

  if (endStatus === 'ABORT') {
    verdict = 'REJECT';
    verdictReasons.push('Trial terminated with #END:ABORT (hardware or I²C fault).');
  } else if (endStatus === 'INCOMPLETE' && n < 1980) {
    verdict = n < 100 ? 'REJECT' : 'WARN';
    verdictReasons.push(
      `Incomplete recording (${n}/2,000 samples collected without #END:CLEAN footer).`
    );
  }

  if (endStatus === 'DEGRADED') {
    if (verdict !== 'REJECT') verdict = 'WARN';
    verdictReasons.push(
      'Firmware reported #END:DEGRADED (potentially invalid trial due to overruns, I²C errors, clipping, or late reads).'
    );
  }

  if (n < 100) {
    verdict = 'REJECT';
    verdictReasons.push(`Insufficient sample count (${n} < 100 minimum).`);
  } else if (n < 1980 && endStatus !== 'INCOMPLETE') {
    if (verdict !== 'REJECT') verdict = 'WARN';
    verdictReasons.push(`Sample count (${n}) is below the 1,980–2,000 target.`);
  }

  if (nonMonotonicCount > 0) {
    verdict = 'REJECT';
    verdictReasons.push(`${nonMonotonicCount} non-monotonic timestamp step(s) detected.`);
  }

  if (i2cErrorCount > 0) {
    verdict = 'REJECT';
    verdictReasons.push(`${i2cErrorCount} I²C read fault(s) reported in diagnostic stream.`);
  }

  if (maxGapUs > 15000) {
    verdict = 'REJECT';
    verdictReasons.push(
      `Maximum sample gap (${maxGapUs.toFixed(0)} µs) exceeds 15,000 µs (3 missed samples).`
    );
  } else if (maxGapUs > 7500 || overrunCount > 0) {
    if (verdict !== 'REJECT') verdict = 'WARN';
    verdictReasons.push(
      `Detected ${overrunCount} overrun(s); max interval = ${maxGapUs.toFixed(0)} µs.`
    );
  }

  if (lateReadCount > 0) {
    if (verdict !== 'REJECT') verdict = 'WARN';
    verdictReasons.push(`${lateReadCount} late-read interrupt race(s) detected.`);
  }

  if (n >= 100 && Math.abs(medianDtUs - 5000) > 60) {
    if (verdict !== 'REJECT') verdict = 'WARN';
    verdictReasons.push(
      `Median Δt (${medianDtUs.toFixed(1)} µs) deviates by >60 µs from nominal 5,000 µs.`
    );
  }

  if (clipCount > 0) {
    if (verdict !== 'REJECT') verdict = 'WARN';
    verdictReasons.push(
      `${clipCount} sample(s) approached or reached ±2g (±19.61 m/s²) saturation.`
    );
  }

  if (verdictReasons.length === 0) {
    verdictReasons.push(
      'All commissioning checks passed (#END:CLEAN, monotonic timestamps, Δt ≈ 5,000 µs, zero overruns/I²C faults/clips).'
    );
  }

  return {
    id: options.id,
    label: options.label,
    condition: options.condition,
    provenance: detectedProvenance,
    createdAtIso: new Date().toISOString(),
    rawCsvText,
    samples,
    diagnosticLines,
    sampleCount: n,
    durationS,
    effectiveFsHz,
    medianDtUs,
    p99JitterUs,
    maxGapUs,
    wrapEvents,
    nonMonotonicCount,
    overrunCount,
    i2cErrorCount,
    clipCount,
    lateReadCount,
    endStatus,
    dlpfCfgDetected,
    meanAzMs2: overallMeanAz || meanAz,
    rmsDynamicMs2,
    peakDynamicMs2,
    ringdownOnsetS,
    windowStartS,
    windowEndS,
    windowFunction,
    fftBins: bins,
    binSpacingHz,
    dominantFreqHz: domPeak.parabolicFreqHz,
    dominantAmpMs2: domPeak.peakAmpMs2,
    verdict,
    verdictReasons,
  };
}

export interface SyntheticTrialGenParams {
  condition: BridgeCondition;
  label: string;
  sampleCount: number;
  fsHz: number;
  dlpfCfg: number;
  f1Hz: number;
  amp1Ms2: number;
  zeta1: number;
  f2Hz: number;
  amp2Ms2: number;
  zeta2: number;
  noiseStdMs2: number;
  jitterStdUs: number;
  injectedOverruns: number;
  startNearWrap: boolean;
  seedOffset?: number;
}

export function generateSyntheticBridgeTrial(
  params: SyntheticTrialGenParams
): TrialAnalysis {
  const {
    condition,
    label,
    sampleCount,
    fsHz,
    dlpfCfg,
    f1Hz,
    amp1Ms2,
    zeta1,
    f2Hz,
    amp2Ms2,
    zeta2,
    noiseStdMs2,
    jitterStdUs,
    injectedOverruns,
    startNearWrap,
    seedOffset = 0,
  } = params;

  const nominalDtUs = Math.round(1_000_000 / fsHz);
  let seed = 1337 + seedOffset + Math.round(f1Hz * 100) + injectedOverruns * 19;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const nextGaussian = () => {
    const u1 = Math.max(nextRand(), 1e-7);
    const u2 = nextRand();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  };

  const g1 = getDlpfMagnitudeGain(f1Hz, dlpfCfg);
  const g2 = getDlpfMagnitudeGain(f2Hz, dlpfCfg);

  const lines: string[] = [
    `#BRIDGE-X,fw=1.1-SIM,mcu=SYNTHETIC_MODEL,fs_hz=${fsHz},dlpf_cfg=${dlpfCfg},range_g=2`,
    `#PROVENANCE:SYNTHETIC_SIMULATION,condition=${condition.toUpperCase()},f1_true_hz=${f1Hz.toFixed(3)},f2_true_hz=${f2Hz.toFixed(3)}`,
    `#COLUMNS:t_us,az_m_s2`,
    `#START:TRIAL,target_samples=${sampleCount}`,
  ];

  let currentTUs = startNearWrap ? 4291967296 : 1250000;
  let elapsedPhysicalUs = 0;
  let simClips = 0;

  const overrunIndices = new Set<number>();
  for (let k = 0; k < injectedOverruns; k++) {
    overrunIndices.add(Math.floor(((k + 1) * sampleCount) / (injectedOverruns + 2)));
  }

  for (let i = 0; i < sampleCount; i++) {
    if (i > 0) {
      let stepUs = nominalDtUs + Math.round(nextGaussian() * jitterStdUs);
      stepUs = Math.max(4, Math.round(stepUs / 4) * 4);

      if (overrunIndices.has(i)) {
        stepUs += nominalDtUs;
        const wrappedT = (currentTUs + stepUs) >>> 0;
        lines.push(`#ERR:OVERRUN,missed=1,t_us=${wrappedT}`);
      }

      elapsedPhysicalUs += stepUs;
      currentTUs = (currentTUs + stepUs) >>> 0;
    }

    const tS = elapsedPhysicalUs * 1e-6;
    let dynamicAz = 0;
    if (tS >= 0.25) {
      const tau = tS - 0.25;
      const omega1 = 2 * Math.PI * f1Hz;
      const omegaD1 = omega1 * Math.sqrt(Math.max(0.01, 1 - zeta1 * zeta1));
      const mode1 =
        amp1Ms2 * g1 * Math.exp(-zeta1 * omega1 * tau) * Math.sin(omegaD1 * tau);

      const omega2 = 2 * Math.PI * f2Hz;
      const omegaD2 = omega2 * Math.sqrt(Math.max(0.01, 1 - zeta2 * zeta2));
      const mode2 =
        amp2Ms2 * g2 * Math.exp(-zeta2 * omega2 * tau) * Math.sin(omegaD2 * tau + 0.35);

      dynamicAz = mode1 + mode2;
    }

    const azTotal = 9.80665 + 0.032 + dynamicAz + nextGaussian() * noiseStdMs2;
    if (Math.abs(azTotal) >= 19.2) {
      simClips++;
      lines.push(`#WARN:CLIP,raw=32760,t_us=${currentTUs}`);
    }
    lines.push(`${currentTUs},${azTotal.toFixed(4)}`);
  }

  if (injectedOverruns === 0 && simClips === 0) {
    lines.push(
      `#END:CLEAN,samples=${sampleCount},overruns=0,i2c_errs=0,clips=0,late_reads=0`
    );
  } else {
    lines.push(
      `#END:DEGRADED,status=POTENTIALLY_INVALID,samples=${sampleCount},overruns=${injectedOverruns},i2c_errs=0,clips=${simClips},late_reads=0`
    );
  }

  return analyzeCsvTrial(lines.join('\n'), {
    id: `syn-${condition}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    label,
    condition,
    forcedProvenance: 'SYNTHETIC_SIMULATION',
  });
}

export function triggerFileDownload(
  filename: string,
  content: string,
  mimeType = 'text/csv;charset=utf-8;'
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports an inline SVG element as either a standalone .svg vector file or a high-DPI .png raster plot
 */
export function exportSvgElementAsFile(
  svgElement: SVGSVGElement | null,
  filenameBase: string,
  format: 'svg' | 'png' = 'png'
) {
  if (!svgElement) return;
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svgElement);
  if (!svgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svgString = svgString.replace(
      '<svg',
      '<svg xmlns="http://www.w3.org/2000/svg"'
    );
  }

  if (format === 'svg') {
    triggerFileDownload(
      `${filenameBase}.svg`,
      svgString,
      'image/svg+xml;charset=utf-8;'
    );
    return;
  }

  const svgBlob = new Blob([svgString], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  const viewBox = svgElement.viewBox.baseVal;
  const width = (viewBox && viewBox.width ? viewBox.width : 760) * 2;
  const height = (viewBox && viewBox.height ? viewBox.height : 280) * 2;

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `${filenameBase}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(pngUrl);
        }
      }, 'image/png');
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

export interface SelfTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Automated verification of CSV parser, 32-bit wrap handling, missing-sample detection,
 * and FFT modal peak accuracy against known synthetic frequencies.
 */
export function runBridgeXSelfTests(): SelfTestResult[] {
  const results: SelfTestResult[] = [];

  // Test 1: Clean 2,000-sample synthetic trial & FFT frequency accuracy (14.20 Hz)
  const cleanTrial = generateSyntheticBridgeTrial({
    condition: 'secured',
    label: 'SelfTest Clean Secured',
    sampleCount: 2000,
    fsHz: 200,
    dlpfCfg: 4,
    f1Hz: 14.2,
    amp1Ms2: 1.5,
    zeta1: 0.015,
    f2Hz: 27.5,
    amp2Ms2: 0.6,
    zeta2: 0.02,
    noiseStdMs2: 0.01,
    jitterStdUs: 4,
    injectedOverruns: 0,
    startNearWrap: false,
    seedOffset: 777,
  });

  const pk1 = findModePeakInBand(cleanTrial.fftBins, 5, 20);
  const freqErrHz = Math.abs(pk1.parabolicFreqHz - 14.2);
  results.push({
    name: 'FFT Peak Accuracy (Known 14.20 Hz Fundamental)',
    passed: freqErrHz <= 0.15 && cleanTrial.verdict === 'PASS',
    detail: `Expected 14.20 Hz; resolved ${pk1.parabolicFreqHz.toFixed(3)} Hz (|error| = ${freqErrHz.toFixed(3)} Hz, verdict = ${cleanTrial.verdict}).`,
  });

  // Test 2: 32-bit micros() Rollover Wrap Handling across 4,294,967,295 -> 0
  const wrapTrial = generateSyntheticBridgeTrial({
    condition: 'disengaged',
    label: 'SelfTest Rollover',
    sampleCount: 2000,
    fsHz: 200,
    dlpfCfg: 4,
    f1Hz: 11.6,
    amp1Ms2: 1.5,
    zeta1: 0.018,
    f2Hz: 24.1,
    amp2Ms2: 0.6,
    zeta2: 0.02,
    noiseStdMs2: 0.01,
    jitterStdUs: 4,
    injectedOverruns: 0,
    startNearWrap: true,
    seedOffset: 888,
  });

  results.push({
    name: '32-Bit micros() Rollover Unwrapping (2^32 - 1 -> 0)',
    passed:
      wrapTrial.wrapEvents === 1 &&
      wrapTrial.nonMonotonicCount === 0 &&
      wrapTrial.verdict === 'PASS',
    detail: `Wrap events = ${wrapTrial.wrapEvents}, non-monotonic errors = ${wrapTrial.nonMonotonicCount}, median Δt = ${wrapTrial.medianDtUs.toFixed(1)} µs.`,
  });

  // Test 3: Overrun / Missing Sample & #END:DEGRADED Detection
  const overrunTrial = generateSyntheticBridgeTrial({
    condition: 'restored',
    label: 'SelfTest Overrun Fault',
    sampleCount: 2000,
    fsHz: 200,
    dlpfCfg: 4,
    f1Hz: 14.15,
    amp1Ms2: 1.4,
    zeta1: 0.018,
    f2Hz: 27.4,
    amp2Ms2: 0.6,
    zeta2: 0.02,
    noiseStdMs2: 0.01,
    jitterStdUs: 4,
    injectedOverruns: 2,
    startNearWrap: false,
    seedOffset: 999,
  });

  results.push({
    name: 'Missing Sample Overrun & #END:DEGRADED Flagging',
    passed:
      overrunTrial.overrunCount === 2 &&
      overrunTrial.endStatus === 'DEGRADED' &&
      overrunTrial.verdict === 'WARN',
    detail: `Injected 2 overruns -> parsed overruns = ${overrunTrial.overrunCount}, endStatus = ${overrunTrial.endStatus}, verdict = ${overrunTrial.verdict}.`,
  });

  // Test 4: Three-Condition Comparison Shift Calculation
  const pkDis = findModePeakInBand(wrapTrial.fftBins, 5, 20);
  const shiftHz = pkDis.parabolicFreqHz - pk1.parabolicFreqHz;
  results.push({
    name: 'Three-Condition Modal Shift (Secured 14.20 Hz -> Disengaged 11.60 Hz)',
    passed: Math.abs(shiftHz - -2.6) <= 0.2,
    detail: `Measured Δf = ${shiftHz.toFixed(3)} Hz (${((shiftHz / pk1.parabolicFreqHz) * 100).toFixed(2)}%) vs theoretical -2.600 Hz (-18.31%).`,
  });

  return results;
}
