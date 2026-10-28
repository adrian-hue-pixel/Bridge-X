import React, { useState, useRef, useMemo } from 'react';
import {
  BridgeCondition,
  TrialAnalysis,
  WindowFunctionType,
  analyzeCsvTrial,
  computeSubWindowSpectrumForTrial,
  findModePeakInBand,
  triggerFileDownload,
  exportSvgElementAsFile,
  getDlpfDb,
} from '../utils/dspAndValidation';
import {
  Upload,
  Download,
  Trash2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';

interface TrialComparatorViewProps {
  trials: TrialAnalysis[];
  onAddTrial: (trial: TrialAnalysis) => void;
  onRemoveTrial: (id: string) => void;
  onClearSyntheticTrials: () => void;
}

const CONDITION_META: Record<
  BridgeCondition,
  { title: string; short: string; role: string; stroke: string }
> = {
  secured: {
    title: 'Condition 1: Brace Secured (Baseline)',
    short: 'Brace Secured',
    role: 'Baseline',
    stroke: '#2563EB',
  },
  disengaged: {
    title: 'Condition 2: Brace Disengaged (Altered)',
    short: 'Brace Disengaged',
    role: 'Altered Condition',
    stroke: '#D97706',
  },
  restored: {
    title: 'Condition 3: Brace Restored (Control)',
    short: 'Brace Restored',
    role: 'Control Measurement',
    stroke: '#059669',
  },
};

export const TrialComparatorView: React.FC<TrialComparatorViewProps> = ({
  trials,
  onAddTrial,
  onRemoveTrial,
  onClearSyntheticTrials,
}) => {
  // Upload / Paste Target Condition & Label
  const [targetCondition, setTargetCondition] = useState<BridgeCondition>('secured');
  const [customTrialLabel, setCustomTrialLabel] = useState<string>('Empirical Run #1');
  const [pastedCsvText, setPastedCsvText] = useState<string>('');
  const [excludeSynthetic, setExcludeSynthetic] = useState<boolean>(false);

  // Configurable Analysis Band [fMin, fMax] Hz (default 2-30 Hz per specification, adjustable to focus on fundamental mode)
  const [modeBandMinHz, setModeBandMinHz] = useState<number>(2.0);
  const [modeBandMaxHz, setModeBandMaxHz] = useState<number>(30.0);

  // Decaying Free-Vibration Sub-Window & Window Function Controls
  const [subWindowMode, setSubWindowMode] = useState<'auto_ringdown' | 'custom' | 'full_10s'>(
    'auto_ringdown'
  );
  const [autoRingdownDurationS, setAutoRingdownDurationS] = useState<number>(3.5);
  const [customWinStartS, setCustomWinStartS] = useState<number>(0.25);
  const [customWinEndS, setCustomWinEndS] = useState<number>(3.75);
  const [windowFunction, setWindowFunction] = useState<WindowFunctionType>('hann');

  const [selectedTrialIdForDetail, setSelectedTrialIdForDetail] = useState<string | null>(
    trials[0]?.id || null
  );
  const [hoverFreqHz, setHoverFreqHz] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fftSvgRef = useRef<SVGSVGElement | null>(null);
  const waveformSvgRef = useRef<SVGSVGElement | null>(null);

  // Recompute FFT spectra for all visible trials according to the selected sub-window & taper
  const visibleTrials = useMemo(() => {
    const filtered = excludeSynthetic
      ? trials.filter((t) => t.provenance === 'EMPIRICAL_MEASUREMENT')
      : trials;

    return filtered.map((t) => {
      const startS =
        subWindowMode === 'full_10s'
          ? 0
          : subWindowMode === 'custom'
          ? customWinStartS
          : t.ringdownOnsetS;
      const endS =
        subWindowMode === 'full_10s'
          ? Math.max(t.durationS, 10)
          : subWindowMode === 'custom'
          ? customWinEndS
          : Math.min(Math.max(t.durationS, 1.0), t.ringdownOnsetS + autoRingdownDurationS);

      const subSpec = computeSubWindowSpectrumForTrial(
        t,
        startS,
        endS,
        windowFunction
      );
      return {
        ...t,
        fftBins: subSpec.fftBins,
        binSpacingHz: subSpec.binSpacingHz,
        dominantFreqHz: subSpec.dominantFreqHz,
        dominantAmpMs2: subSpec.dominantAmpMs2,
        windowStartS: subSpec.windowStartS,
        windowEndS: subSpec.windowEndS,
        windowFunction,
      };
    });
  }, [
    trials,
    excludeSynthetic,
    subWindowMode,
    autoRingdownDurationS,
    customWinStartS,
    customWinEndS,
    windowFunction,
  ]);

  const selectedDetailTrial = useMemo(() => {
    return (
      visibleTrials.find((t) => t.id === selectedTrialIdForDetail) ||
      visibleTrials[0] ||
      null
    );
  }, [visibleTrials, selectedTrialIdForDetail]);

  // Compute per-condition modal statistics within [modeBandMinHz, modeBandMaxHz]
  const conditionStats = useMemo(() => {
    const computeFor = (cond: BridgeCondition) => {
      const condTrials = visibleTrials.filter(
        (t) => t.condition === cond && t.verdict !== 'REJECT'
      );
      const peaks = condTrials.map((t) => {
        const pk = findModePeakInBand(t.fftBins, modeBandMinHz, modeBandMaxHz);
        return {
          trial: t,
          freqHz: pk.parabolicFreqHz,
          binFreqHz: pk.peakFreqHz,
          ampMs2: pk.peakAmpMs2,
        };
      });

      const n = peaks.length;
      if (n === 0) {
        return {
          count: 0,
          meanFreqHz: 0,
          stdFreqHz: 0,
          minFreqHz: 0,
          maxFreqHz: 0,
          meanAmpMs2: 0,
          meanBinSpacingHz: 0.1,
          hasSynthetic: false,
          hasEmpirical: false,
          peaks: [],
        };
      }

      const freqs = peaks.map((p) => p.freqHz);
      const meanFreqHz = freqs.reduce((acc, v) => acc + v, 0) / n;
      const minFreqHz = Math.min(...freqs);
      const maxFreqHz = Math.max(...freqs);
      const meanAmpMs2 = peaks.reduce((acc, p) => acc + p.ampMs2, 0) / n;
      const meanBinSpacingHz =
        peaks.reduce((acc, p) => acc + p.trial.binSpacingHz, 0) / n;
      const variance =
        n > 1
          ? freqs.reduce((acc, f) => acc + Math.pow(f - meanFreqHz, 2), 0) / (n - 1)
          : 0;
      const stdFreqHz = Math.sqrt(variance);

      return {
        count: n,
        meanFreqHz,
        stdFreqHz,
        minFreqHz,
        maxFreqHz,
        meanAmpMs2,
        meanBinSpacingHz,
        hasSynthetic: condTrials.some((t) => t.provenance === 'SYNTHETIC_SIMULATION'),
        hasEmpirical: condTrials.some((t) => t.provenance === 'EMPIRICAL_MEASUREMENT'),
        peaks,
      };
    };

    const secured = computeFor('secured');
    const disengaged = computeFor('disengaged');
    const restored = computeFor('restored');

    // Frequency shifts relative to Secured baseline
    const deltaDisengagedHz =
      secured.count > 0 && disengaged.count > 0
        ? disengaged.meanFreqHz - secured.meanFreqHz
        : null;
    const deltaDisengagedPct =
      deltaDisengagedHz !== null && secured.meanFreqHz > 0
        ? (deltaDisengagedHz / secured.meanFreqHz) * 100
        : null;

    const deltaRestoredHz =
      secured.count > 0 && restored.count > 0
        ? restored.meanFreqHz - secured.meanFreqHz
        : null;
    const deltaRestoredPct =
      deltaRestoredHz !== null && secured.meanFreqHz > 0
        ? (deltaRestoredHz / secured.meanFreqHz) * 100
        : null;

    const combinedStdHz = Math.sqrt(
      secured.stdFreqHz * secured.stdFreqHz +
        disengaged.stdFreqHz * disengaged.stdFreqHz
    );
    const minDetectableShiftHz = Math.max(
      secured.meanBinSpacingHz || 0.1,
      2 * combinedStdHz
    );
    const isShiftRepeatable =
      deltaDisengagedHz !== null &&
      Math.abs(deltaDisengagedHz) > minDetectableShiftHz;

    return {
      secured,
      disengaged,
      restored,
      deltaDisengagedHz,
      deltaDisengagedPct,
      deltaRestoredHz,
      deltaRestoredPct,
      combinedStdHz,
      minDetectableShiftHz,
      isShiftRepeatable,
    };
  }, [visibleTrials, modeBandMinHz, modeBandMaxHz]);

  // Handle File Upload (.csv / .txt)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = String(ev.target?.result || '');
        const isSyntheticFile =
          content.toUpperCase().includes('SYNTHETIC_SIMULATION') ||
          file.name.toUpperCase().includes('SYNTHETIC');
        const analysis = analyzeCsvTrial(content, {
          id: `emp-${Date.now()}-${idx}`,
          label: file.name.replace(/\.[^/.]+$/, ''),
          condition: targetCondition,
          forcedProvenance: isSyntheticFile
            ? 'SYNTHETIC_SIMULATION'
            : 'EMPIRICAL_MEASUREMENT',
        });
        onAddTrial(analysis);
        setSelectedTrialIdForDetail(analysis.id);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  // Handle Pasted Raw Serial / CSV Stream
  const handleImportPastedCsv = () => {
    if (!pastedCsvText.trim()) return;
    const isSyntheticPaste = pastedCsvText
      .toUpperCase()
      .includes('SYNTHETIC_SIMULATION');
    const analysis = analyzeCsvTrial(pastedCsvText, {
      id: `paste-${Date.now()}`,
      label: customTrialLabel.trim() || `${CONDITION_META[targetCondition].short} Trial`,
      condition: targetCondition,
      forcedProvenance: isSyntheticPaste
        ? 'SYNTHETIC_SIMULATION'
        : 'EMPIRICAL_MEASUREMENT',
    });
    onAddTrial(analysis);
    setSelectedTrialIdForDetail(analysis.id);
    setPastedCsvText('');
  };

  // Export Single Trial CSV
  const handleExportSingleTrialCsv = (trial: TrialAnalysis) => {
    const header = [
      `#BRIDGE-X_EXPORT,trial_id=${trial.id},label=${trial.label}`,
      `#PROVENANCE:${trial.provenance}`,
      `#CONDITION:${trial.condition.toUpperCase()}`,
      `#VERDICT:${trial.verdict},end_status=${trial.endStatus},samples=${trial.sampleCount},fs_hz=${trial.effectiveFsHz.toFixed(3)},median_dt_us=${trial.medianDtUs.toFixed(1)}`,
      ...trial.diagnosticLines.filter(
        (l) => !l.startsWith('#PROVENANCE') && !l.startsWith('#CONDITION')
      ),
    ];
    const rows = trial.samples.map((s) => `${s.rawTUs},${s.azMs2.toFixed(4)}`);
    const prefix =
      trial.provenance === 'EMPIRICAL_MEASUREMENT' ? 'REAL_EMPIRICAL' : 'SYNTHETIC_DATA';
    triggerFileDownload(
      `${prefix}_${trial.condition}_${trial.label.replace(/\s+/g, '_')}.csv`,
      [...header, ...rows].join('\n')
    );
  };

  // Export Multi-Condition Summary CSV
  const handleExportComparisonSummaryCsv = () => {
    const lines: string[] = [
      '#BRIDGE-X MULTI-CONDITION MODAL COMPARISON & COMMISSIONING SUMMARY',
      `#GENERATED_AT:${new Date().toISOString()}`,
      `#ANALYSIS_BAND_HZ:${modeBandMinHz.toFixed(2)}_to_${modeBandMaxHz.toFixed(2)}`,
      `#SECURED_MEAN_F_HZ:${conditionStats.secured.meanFreqHz.toFixed(4)},STD_HZ:${conditionStats.secured.stdFreqHz.toFixed(4)},N:${conditionStats.secured.count}`,
      `#DISENGAGED_MEAN_F_HZ:${conditionStats.disengaged.meanFreqHz.toFixed(4)},STD_HZ:${conditionStats.disengaged.stdFreqHz.toFixed(4)},N:${conditionStats.disengaged.count}`,
      `#RESTORED_MEAN_F_HZ:${conditionStats.restored.meanFreqHz.toFixed(4)},STD_HZ:${conditionStats.restored.stdFreqHz.toFixed(4)},N:${conditionStats.restored.count}`,
      `#DELTA_F_DISENGAGED_MINUS_SECURED_HZ:${
        conditionStats.deltaDisengagedHz !== null
          ? conditionStats.deltaDisengagedHz.toFixed(4)
          : 'NA'
      },PCT:${
        conditionStats.deltaDisengagedPct !== null
          ? conditionStats.deltaDisengagedPct.toFixed(2)
          : 'NA'
      }`,
      `#DELTA_F_RESTORED_MINUS_SECURED_HZ:${
        conditionStats.deltaRestoredHz !== null
          ? conditionStats.deltaRestoredHz.toFixed(4)
          : 'NA'
      },PCT:${
        conditionStats.deltaRestoredPct !== null
          ? conditionStats.deltaRestoredPct.toFixed(2)
          : 'NA'
      }`,
      'trial_id,provenance,condition,label,verdict,end_status,sample_count,duration_s,effective_fs_hz,median_dt_us,p99_jitter_us,max_gap_us,overruns,i2c_errors,clips,mean_az_m_s2,rms_dyn_m_s2,window_start_s,window_end_s,window_fn,mode_peak_freq_hz,mode_peak_amp_m_s2,rayleigh_bin_spacing_hz',
    ];

    for (const t of visibleTrials) {
      const pk = findModePeakInBand(t.fftBins, modeBandMinHz, modeBandMaxHz);
      lines.push(
        [
          t.id,
          t.provenance,
          t.condition,
          `"${t.label.replace(/"/g, '""')}"`,
          t.verdict,
          t.endStatus,
          t.sampleCount,
          t.durationS.toFixed(4),
          t.effectiveFsHz.toFixed(3),
          t.medianDtUs.toFixed(1),
          t.p99JitterUs.toFixed(1),
          t.maxGapUs.toFixed(0),
          t.overrunCount,
          t.i2cErrorCount,
          t.clipCount,
          t.meanAzMs2.toFixed(4),
          t.rmsDynamicMs2.toFixed(4),
          t.windowStartS.toFixed(3),
          t.windowEndS.toFixed(3),
          t.windowFunction,
          pk.parabolicFreqHz.toFixed(4),
          pk.peakAmpMs2.toFixed(5),
          t.binSpacingHz.toFixed(4),
        ].join(',')
      );
    }

    triggerFileDownload('BRIDGE_X_Trial_Comparison_Summary.csv', lines.join('\n'));
  };

  // Generate & Download IB Physics Experimental Summary Report (.md)
  const handleDownloadIbPhysicsReport = () => {
    const anySynthetic = visibleTrials.some(
      (t) => t.provenance === 'SYNTHETIC_SIMULATION'
    );
    const anyEmpirical = visibleTrials.some(
      (t) => t.provenance === 'EMPIRICAL_MEASUREMENT'
    );

    const trialRowsMd = visibleTrials
      .map((t) => {
        const pk = findModePeakInBand(t.fftBins, modeBandMinHz, modeBandMaxHz);
        return `| ${
          t.provenance === 'EMPIRICAL_MEASUREMENT' ? 'EMPIRICAL' : 'SYNTHETIC DATA'
        } | ${CONDITION_META[t.condition].short} | ${t.label} | ${t.createdAtIso} | ${
          t.sampleCount
        } (${t.effectiveFsHz.toFixed(2)} Hz) | ${t.medianDtUs.toFixed(1)} µs (±${t.p99JitterUs.toFixed(
          0
        )} µs) | [${t.windowStartS.toFixed(2)}s, ${t.windowEndS.toFixed(
          2
        )}s] (${t.windowFunction}) | **${pk.parabolicFreqHz.toFixed(
          2
        )} Hz** (±${t.binSpacingHz.toFixed(2)} Hz) | ${pk.peakAmpMs2.toFixed(
          3
        )} m/s² | ${t.verdict} (#END:${t.endStatus}) |`;
      })
      .join('\n');

    const reportMd = `# BRIDGE-X — IB Physics Collaborative Sciences Experimental Summary Report

- **Generated Timestamp (ISO-8601):** \`${new Date().toISOString()}\`
- **Dataset Provenance Audit:** ${
      anyEmpirical && anySynthetic
        ? '**MIXED DATASET (Contains Both Empirical Hardware Trials and Synthetic Simulation Trials — Filter Out Synthetic Before Final Submission)**'
        : anyEmpirical
        ? '**EMPIRICAL HARDWARE MEASUREMENTS ONLY**'
        : '**SYNTHETIC SIMULATION DATA ONLY (For Software Testing — Do Not Submit as Real Bridge Data)**'
    }
- **Physical Specimen:** Wooden Model Truss Bridge (\`60 × 12 × 12 cm\`), MPU-6050 Accelerometer Mounted Rigidly at Midspan (\`+Z\` Vertical)
- **Acquisition Hardware & Protocol:** Arduino Uno R3 (\`ATmega328P\`), Hardware \`DATA_RDY_INT\` on Pin \`D2\` at \`200.0 Hz\` (\`SMPLRT_DIV = 4\`), \`±2 g\` Full Scale, \`115200\` Baud CSV Stream (\`t_us,az_m_s2\`)
- **Active FFT Sub-Window Mode:** \`${subWindowMode}\` with \`${windowFunction.toUpperCase()}\` taper (Mean gravity offset removed prior to windowing)
- **Tracked Modal Frequency Band:** \`${modeBandMinHz.toFixed(1)} Hz to ${modeBandMaxHz.toFixed(1)} Hz\`

---

## 1. Three-Condition Modal Frequency Comparison

| Structural Condition | Valid Trials ($N$) | Mean Dominant Frequency $\\bar{f}_1$ (Hz) | Trial Repeatability $s_f$ (Hz) | Mean Rayleigh Bin Resolution $\\Delta f_{\\text{bin}}$ (Hz) | Frequency Shift vs. Secured Baseline ($\\Delta f$) | Percentage Shift ($\\Delta f / \\bar{f}_{\\text{sec}}$) | Provenance |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Brace Secured (Baseline)** | ${conditionStats.secured.count} | ${
      conditionStats.secured.count > 0
        ? `${conditionStats.secured.meanFreqHz.toFixed(3)} Hz`
        : 'N/A'
    } | ${
      conditionStats.secured.count > 1
        ? `±${conditionStats.secured.stdFreqHz.toFixed(3)} Hz`
        : 'N/A (N < 2)'
    } | ±${conditionStats.secured.meanBinSpacingHz.toFixed(3)} Hz | 0.000 Hz (Baseline) | 0.00% | ${
      conditionStats.secured.hasSynthetic ? 'Includes SYNTHETIC' : 'EMPIRICAL'
    } |
| **2. Brace Disengaged (Altered)** | ${conditionStats.disengaged.count} | ${
      conditionStats.disengaged.count > 0
        ? `${conditionStats.disengaged.meanFreqHz.toFixed(3)} Hz`
        : 'N/A'
    } | ${
      conditionStats.disengaged.count > 1
        ? `±${conditionStats.disengaged.stdFreqHz.toFixed(3)} Hz`
        : 'N/A (N < 2)'
    } | ±${conditionStats.disengaged.meanBinSpacingHz.toFixed(3)} Hz | ${
      conditionStats.deltaDisengagedHz !== null
        ? `${conditionStats.deltaDisengagedHz >= 0 ? '+' : ''}${conditionStats.deltaDisengagedHz.toFixed(3)} Hz`
        : 'N/A'
    } | ${
      conditionStats.deltaDisengagedPct !== null
        ? `${conditionStats.deltaDisengagedPct >= 0 ? '+' : ''}${conditionStats.deltaDisengagedPct.toFixed(2)}%`
        : 'N/A'
    } | ${
      conditionStats.disengaged.hasSynthetic ? 'Includes SYNTHETIC' : 'EMPIRICAL'
    } |
| **3. Brace Restored (Control)** | ${conditionStats.restored.count} | ${
      conditionStats.restored.count > 0
        ? `${conditionStats.restored.meanFreqHz.toFixed(3)} Hz`
        : 'N/A'
    } | ${
      conditionStats.restored.count > 1
        ? `±${conditionStats.restored.stdFreqHz.toFixed(3)} Hz`
        : 'N/A (N < 2)'
    } | ±${conditionStats.restored.meanBinSpacingHz.toFixed(3)} Hz | ${
      conditionStats.deltaRestoredHz !== null
        ? `${conditionStats.deltaRestoredHz >= 0 ? '+' : ''}${conditionStats.deltaRestoredHz.toFixed(3)} Hz`
        : 'N/A'
    } | ${
      conditionStats.deltaRestoredPct !== null
        ? `${conditionStats.deltaRestoredPct >= 0 ? '+' : ''}${conditionStats.deltaRestoredPct.toFixed(2)}%`
        : 'N/A'
    } | ${
      conditionStats.restored.hasSynthetic ? 'Includes SYNTHETIC' : 'EMPIRICAL'
    } |

### Structural-Change Indicator (Relative to Baseline Uncertainty)
- **Minimum Detectable Frequency Shift Threshold:** $\\Delta f_{\\text{min}} = \\max(\\Delta f_{\\text{bin}}, 2\\sqrt{s_{\\text{sec}}^2 + s_{\\text{dis}}^2}) = \\mathbf{\\pm ${conditionStats.minDetectableShiftHz.toFixed(
      3
    )}\\text{ Hz}}$
- **Evaluation:** ${
      conditionStats.deltaDisengagedHz === null
        ? 'Insufficient condition coverage (record both Brace Secured and Brace Disengaged trials).'
        : conditionStats.isShiftRepeatable
        ? `**DETECTABLE MODAL SHIFT OBSERVED:** $|\\Delta f_{\\text{dis}}| = ${Math.abs(
            conditionStats.deltaDisengagedHz
          ).toFixed(3)}\\text{ Hz} > ${conditionStats.minDetectableShiftHz.toFixed(
            3
          )}\\text{ Hz}$. Disengaging the diagonal brace produced a repeatable shift in global midspan bending frequency exceeding the baseline experimental uncertainty.`
        : `**WITHIN BASELINE VARIATION:** $|\\Delta f_{\\text{dis}}| = ${Math.abs(
            conditionStats.deltaDisengagedHz
          ).toFixed(3)}\\text{ Hz} \\le ${conditionStats.minDetectableShiftHz.toFixed(
            3
          )}\\text{ Hz}$. The measured shift does not exceed the Rayleigh resolution / trial-to-trial repeatability threshold.`
    }

---

## 2. Individual Trial Log, Timestamps & Sampling Diagnostics

| Provenance | Condition | Trial Label | Recorded Timestamp | Samples ($f_s$) | Median $\\Delta t$ (P99 Jitter) | Analyzed Sub-Window | Peak Frequency ($\\pm \\Delta f_{\\text{bin}}$) | Peak Amplitude | Commissioning Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${trialRowsMd || '| None | — | — | — | — | — | — | — | — | — |'}

---

## 3. Experimental Uncertainty & Methodological Limitations (IB Physics Evaluation)

1. **Rayleigh Frequency Resolution vs. Ring-Down Window Duration:**
   - Slicing a shorter analysis window $T_{\\text{win}} = t_{\\text{end}} - t_{\\text{start}}$ around the decaying free vibration prevents a 10-second Hann window from suppressing the high-SNR transient right after release, but widens the fundamental Rayleigh bin spacing to $\\Delta f_{\\text{bin}} = 1 / T_{\\text{win}}$ (e.g., $\\pm 0.286\\text{ Hz}$ for a $3.5\\text{ s}$ window vs. $\\pm 0.100\\text{ Hz}$ for a $10.0\\text{ s}$ window). Zero-padding to 2048 points and 3-point parabolic interpolation refine peak localization when SNR is high, but cannot separate two closely spaced modes closer than $1 / T_{\\text{win}}$.
2. **Digital Low-Pass Filter Passband Roll-Off:**
   - Under \`DLPF_CFG = 4\` (\`-3 dB\` corner at \`21 Hz\`), acceleration amplitudes at \`21 Hz\` are attenuated by \`29.3%\` (\`-3.0 dB\`) and at \`30 Hz\` by \`42.6%\` (\`-4.83 dB\`). While smooth filter roll-off does not shift the frequency of an isolated resonance peak, comparing modal amplitudes above \`20 Hz\` requires switching to \`DLPF_CFG = 3\` (\`44 Hz\` bandwidth) between trials.
3. **Boundary of Scientific Inference (No Safety Certification):**
   - This single-sensor midspan prototype measures global linear-elastic modal stiffness shifts ($f_n \\propto \\sqrt{k_{\\text{eff}} / m_{\\text{eff}}}$) on a \`60 × 12 × 12 cm\` wooden model. **It cannot classify any bridge as structurally safe or unsafe, cannot localize defects near modal strain nodes, and cannot predict structural collapse.**
`;

    triggerFileDownload(
      `BRIDGE_X_IB_Physics_Experimental_Report_${new Date()
        .toISOString()
        .slice(0, 10)}.md`,
      reportMd,
      'text/markdown;charset=utf-8;'
    );
  };

  // Max amplitude in 1.5-35 Hz for scaling the multi-condition FFT SVG plot
  const maxPlotAmp = useMemo(() => {
    let maxA = 0.2;
    for (const t of visibleTrials) {
      for (const b of t.fftBins) {
        if (b.freqHz >= 1.5 && b.freqHz <= 35 && b.amplitudeMs2 > maxA) {
          maxA = b.amplitudeMs2;
        }
      }
    }
    return maxA * 1.15;
  }, [visibleTrials]);

  const anyVisibleSynthetic = visibleTrials.some(
    (t) => t.provenance === 'SYNTHETIC_SIMULATION'
  );

  return (
    <div className="space-y-8">
      {/* Top Import & Export Bar (Modules C, D, F) */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500">
              Modules C, D &amp; F · Decaying-Vibration FFT, Three-Condition Comparison &amp; IB Physics Report Export
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              Bridge Condition Comparator: Brace Secured vs. Disengaged vs. Restored
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-100 px-3 py-1.5 rounded-md cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={excludeSynthetic}
                onChange={(e) => setExcludeSynthetic(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Empirical Hardware Trials Only</span>
            </label>

            <button
              onClick={handleDownloadIbPhysicsReport}
              disabled={visibleTrials.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download IB Physics Summary (.md)</span>
            </button>

            <button
              onClick={handleExportComparisonSummaryCsv}
              disabled={visibleTrials.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Summary (.csv)</span>
            </button>
          </div>
        </div>

        {/* Import / Paste Raw CSV Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-4">
            <div className="text-xs font-semibold text-slate-900">
              1. Import Saved Trial CSV Files or Assign Condition
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(['secured', 'disengaged', 'restored'] as BridgeCondition[]).map(
                (cond) => (
                  <button
                    key={cond}
                    onClick={() => setTargetCondition(cond)}
                    className={`px-2.5 py-2 text-xs font-medium rounded border text-center transition-colors cursor-pointer whitespace-nowrap truncate ${
                      targetCondition === cond
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {CONDITION_META[cond].short}
                  </button>
                )
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              <div className="sm:col-span-7">
                <label className="block text-xs text-slate-600 mb-1">
                  Label for Imported / Pasted Trial
                </label>
                <input
                  type="text"
                  value={customTrialLabel}
                  onChange={(e) => setCustomTrialLabel(e.target.value)}
                  placeholder="e.g., Secured Run #1"
                  className="w-full text-xs bg-white border border-slate-300 rounded px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="sm:col-span-5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.log"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload CSV File(s)</span>
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">
                2. Or Paste Serial Monitor Output (<code className="font-mono">t_us,az_m_s2</code> +{' '}
                <code className="font-mono">#</code> Diagnostics)
              </span>
              <span className="font-mono text-slate-500">
                Validates 32-bit wrap, overruns &amp; #END:CLEAN
              </span>
            </div>
            <div className="flex gap-2.5">
              <textarea
                rows={3}
                value={pastedCsvText}
                onChange={(e) => setPastedCsvText(e.target.value)}
                placeholder={`#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4\n#COLUMNS:t_us,az_m_s2\n1250000,9.8124\n1255000,10.4210\n...`}
                className="flex-1 text-xs font-mono bg-white border border-slate-300 rounded p-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                onClick={handleImportPastedCsv}
                disabled={!pastedCsvText.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded transition-colors cursor-pointer whitespace-nowrap self-stretch"
              >
                Add Trial
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Module C & D: Decaying Sub-Window Controls, 3-Condition Cards & Overlaid FFT Spectrum */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500">
              Module C &amp; D · Mean Removal, Decaying Ring-Down Sub-Window FFT &amp; Condition Shift Analysis
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Overlaid Multi-Condition FFT Spectrum &amp; Modal Frequency Shifts
            </h2>
          </div>

          {/* Configurable Dominant Frequency Search Band */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2 text-xs">
            <span className="font-medium text-slate-700">Analysis Band:</span>
            <div className="flex items-center gap-1.5 font-mono">
              <input
                type="number"
                min={1}
                max={modeBandMaxHz - 1}
                step={0.5}
                value={modeBandMinHz}
                onChange={(e) => setModeBandMinHz(Number(e.target.value))}
                className="w-16 bg-white border border-slate-300 rounded px-2 py-1 text-center"
              />
              <span>to</span>
              <input
                type="number"
                min={modeBandMinHz + 1}
                max={45}
                step={0.5}
                value={modeBandMaxHz}
                onChange={(e) => setModeBandMaxHz(Number(e.target.value))}
                className="w-16 bg-white border border-slate-300 rounded px-2 py-1 text-center"
              />
              <span>Hz</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setModeBandMinHz(2.0);
                  setModeBandMaxHz(30.0);
                }}
                className="px-2 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
              >
                2–30 Hz
              </button>
              <button
                onClick={() => {
                  setModeBandMinHz(6.0);
                  setModeBandMaxHz(20.0);
                }}
                className="px-2 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
              >
                Mode 1 (6–20 Hz)
              </button>
            </div>
          </div>
        </div>

        {/* Decaying Free-Vibration Sub-Window Selector Bar */}
        <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong className="text-slate-900">
                Decaying Free-Vibration Sub-Window Selection:
              </strong>{' '}
              <span className="text-slate-600">
                Focuses the Hann window on the active decay right after release so early vibration energy is not suppressed by a 10-second taper.
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-600 font-medium">Window Function:</span>
              {(
                [
                  { id: 'hann', label: 'Hann Window (Standard)' },
                  { id: 'tukey', label: 'Tukey α=0.25' },
                  { id: 'rectangular', label: 'Rectangular' },
                ] as { id: WindowFunctionType; label: string }[]
              ).map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => setWindowFunction(wf.id)}
                  className={`px-2.5 py-1 rounded border font-mono text-[11px] transition-colors cursor-pointer whitespace-nowrap ${
                    windowFunction === wf.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {wf.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/80">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-600 font-medium">Segment Mode:</span>
              <button
                onClick={() => setSubWindowMode('auto_ringdown')}
                className={`px-2.5 py-1 rounded border font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  subWindowMode === 'auto_ringdown'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Auto Ring-Down From Release Peak
              </button>
              <button
                onClick={() => setSubWindowMode('custom')}
                className={`px-2.5 py-1 rounded border font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  subWindowMode === 'custom'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Custom Segment [t_start, t_end]
              </button>
              <button
                onClick={() => setSubWindowMode('full_10s')}
                className={`px-2.5 py-1 rounded border font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  subWindowMode === 'full_10s'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Full 10.0s Recording
              </button>
            </div>

            {subWindowMode === 'auto_ringdown' && (
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-700">Segment Length:</span>
                {[2.0, 3.5, 5.0].map((dur) => (
                  <button
                    key={dur}
                    onClick={() => setAutoRingdownDurationS(dur)}
                    className={`px-2 py-0.5 rounded border text-[11px] cursor-pointer ${
                      autoRingdownDurationS === dur
                        ? 'bg-blue-50 text-blue-800 border-blue-300 font-semibold'
                        : 'bg-white text-slate-600 border-slate-300'
                    }`}
                  >
                    {dur.toFixed(1)}s (Δf={(1 / dur).toFixed(2)} Hz)
                  </button>
                ))}
              </div>
            )}

            {subWindowMode === 'custom' && (
              <div className="flex items-center gap-1.5 font-mono">
                <span>t_start:</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0.1, customWinEndS - 0.5)}
                  step={0.1}
                  value={customWinStartS}
                  onChange={(e) => setCustomWinStartS(Number(e.target.value))}
                  className="w-16 bg-white border border-slate-300 rounded px-2 py-0.5 text-center"
                />
                <span>s to t_end:</span>
                <input
                  type="number"
                  min={customWinStartS + 0.5}
                  max={10.0}
                  step={0.1}
                  value={customWinEndS}
                  onChange={(e) => setCustomWinEndS(Number(e.target.value))}
                  className="w-16 bg-white border border-slate-300 rounded px-2 py-0.5 text-center"
                />
                <span>s</span>
              </div>
            )}
          </div>
        </div>

        {/* 4-Card Condition Comparison & Structural-Change Indicator */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {(['secured', 'disengaged', 'restored'] as BridgeCondition[]).map(
            (cond) => {
              const st = conditionStats[cond];
              const meta = CONDITION_META[cond];
              return (
                <div
                  key={cond}
                  className="p-4 border border-slate-200 rounded-md bg-slate-50/70 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">
                      {meta.short}
                    </span>
                    <span className="font-mono text-slate-500">
                      N = {st.count} trial(s)
                    </span>
                  </div>
                  <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                    {st.count > 0 ? `${st.meanFreqHz.toFixed(2)} Hz` : '—'}
                  </div>
                  <div className="text-xs font-mono text-slate-600 tabular-nums">
                    {st.count > 1
                      ? `Repeatability s_f = ±${st.stdFreqHz.toFixed(3)} Hz`
                      : st.count === 1
                      ? `Rayleigh Δf_bin = ±${st.meanBinSpacingHz.toFixed(2)} Hz`
                      : 'No valid trials'}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 pt-1">
                    {st.hasEmpirical && st.hasSynthetic
                      ? 'Provenance: MIXED (Real + SYNTHETIC DATA)'
                      : st.hasEmpirical
                      ? 'Provenance: EMPIRICAL HARDWARE'
                      : st.hasSynthetic
                      ? 'Provenance: SYNTHETIC DATA'
                      : 'Provenance: —'}
                  </div>
                </div>
              );
            }
          )}

          {/* Frequency-Shift Percentage & Structural-Change Indicator Card */}
          <div className="p-4 border border-slate-200 rounded-md bg-white space-y-1.5">
            <div className="text-xs font-semibold text-slate-900">
              Brace Disengaged Frequency Shift (Δf)
            </div>
            <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {conditionStats.deltaDisengagedHz !== null
                ? `${
                    conditionStats.deltaDisengagedHz >= 0 ? '+' : ''
                  }${conditionStats.deltaDisengagedHz.toFixed(2)} Hz (${
                    conditionStats.deltaDisengagedPct !== null &&
                    conditionStats.deltaDisengagedPct >= 0
                      ? '+'
                      : ''
                  }${conditionStats.deltaDisengagedPct?.toFixed(1)}%)`
                : 'Need Baseline + Altered'}
            </div>
            <div className="text-xs font-mono text-slate-600 tabular-nums">
              Restored Control Δf:{' '}
              {conditionStats.deltaRestoredHz !== null
                ? `${
                    conditionStats.deltaRestoredHz >= 0 ? '+' : ''
                  }${conditionStats.deltaRestoredHz.toFixed(2)} Hz (${conditionStats.deltaRestoredPct?.toFixed(
                    2
                  )}%)`
                : '—'}
            </div>
            <div
              className={`text-[11px] font-mono pt-1 ${
                conditionStats.deltaDisengagedHz === null
                  ? 'text-slate-500'
                  : conditionStats.isShiftRepeatable
                  ? 'text-emerald-700 font-semibold'
                  : 'text-amber-700 font-semibold'
              }`}
            >
              {conditionStats.deltaDisengagedHz === null
                ? 'Awaiting Secured + Disengaged trials'
                : conditionStats.isShiftRepeatable
                ? `● Structural Stiffness Change Detected (|Δf| > ${conditionStats.minDetectableShiftHz.toFixed(
                    2
                  )} Hz)`
                : `▲ Within Baseline Uncertainty (|Δf| ≤ ${conditionStats.minDetectableShiftHz.toFixed(
                    2
                  )} Hz)`}
            </div>
          </div>
        </div>

        {/* Non-Negotiable Scientific Scope & Safety Disclaimer */}
        <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 leading-relaxed flex flex-wrap items-center justify-between gap-4">
          <div>
            <strong className="text-slate-900">
              Experimental Scope &amp; Uncertainty Limitation:
            </strong>{' '}
            This indicator compares measured midspan modal frequency shifts against your baseline repeatability (<code className="font-mono">s_f</code>) and Rayleigh window resolution (<code className="font-mono">Δf_bin = 1 / T_win</code>).{' '}
            <strong>
              Never classify a real bridge as safe or unsafe, certify structural integrity, or predict collapse based on this student prototype.
            </strong>
          </div>
        </div>

        {/* Overlaid Multi-Condition FFT Plot with Export Buttons */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-600">
            <div>
              <span className="font-semibold text-slate-900">
                OVERLAID {windowFunction.toUpperCase()}-WINDOWED FFT SPECTRUM (0 – 35 HZ)
              </span>
              {anyVisibleSynthetic && (
                <span className="ml-2 text-amber-700 font-bold">
                  [INCLUDES SYNTHETIC DATA — DASHED CURVES]
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-blue-600">■ Secured</span>
              <span className="text-amber-600">■ Disengaged</span>
              <span className="text-emerald-600">■ Restored</span>
              <button
                onClick={() =>
                  exportSvgElementAsFile(
                    fftSvgRef.current,
                    'BRIDGE_X_Overlaid_FFT_Spectrum',
                    'png'
                  )
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-sans font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                <ImageIcon className="w-3 h-3" />
                <span>Export FFT (.png)</span>
              </button>
              <button
                onClick={() =>
                  exportSvgElementAsFile(
                    fftSvgRef.current,
                    'BRIDGE_X_Overlaid_FFT_Spectrum',
                    'svg'
                  )
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-sans font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Export FFT (.svg)</span>
              </button>
            </div>
          </div>

          <svg
            ref={fftSvgRef}
            viewBox="0 0 760 280"
            className="w-full h-auto bg-slate-50 border border-slate-200 rounded cursor-crosshair"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * 760;
              const f = ((relX - 55) / 675) * 35;
              if (f >= 0 && f <= 35) setHoverFreqHz(f);
            }}
            onMouseLeave={() => setHoverFreqHz(null)}
          >
            {/* Shaded Analysis Band */}
            <rect
              x={55 + (modeBandMinHz / 35) * 675}
              y={24}
              width={((modeBandMaxHz - modeBandMinHz) / 35) * 675}
              height={216}
              fill="#EFF6FF"
            />
            <text
              x={55 + (((modeBandMinHz + modeBandMaxHz) * 0.5) / 35) * 675}
              y={38}
              textAnchor="middle"
              className="text-[10px] font-mono fill-blue-700"
            >
              Analysis Band ({modeBandMinHz.toFixed(1)}–{modeBandMaxHz.toFixed(1)} Hz)
            </text>

            {/* Provenance Header inside SVG for Export Integrity */}
            <text
              x={58}
              y={16}
              className="text-[10px] font-mono font-bold fill-slate-700"
            >
              {anyVisibleSynthetic
                ? 'BRIDGE-X FFT SPECTRUM OVERLAY — INCLUDES SYNTHETIC DATA (DASHED LINES = SYNTHETIC DATA)'
                : 'BRIDGE-X EMPIRICAL FFT SPECTRUM OVERLAY — SECURED vs. DISENGAGED vs. RESTORED'}
            </text>

            {/* Frequency Grid */}
            {[0, 5, 10, 15, 20, 25, 30, 35].map((f) => {
              const x = 55 + (f / 35) * 675;
              return (
                <g key={f}>
                  <line x1={x} y1={24} x2={x} y2={240} stroke="#E2E8F0" />
                  <text
                    x={x}
                    y={258}
                    textAnchor="middle"
                    className="text-[10px] font-mono fill-slate-500"
                  >
                    {f} Hz
                  </text>
                </g>
              );
            })}

            {/* Amplitude Grid (m/s^2) */}
            {[0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
              const val = frac * maxPlotAmp;
              const y = 240 - frac * 216;
              return (
                <g key={frac}>
                  <line x1={55} y1={y} x2={730} y2={y} stroke="#E2E8F0" />
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

            {/* Plot each visible trial */}
            {visibleTrials.map((trial) => {
              const color = CONDITION_META[trial.condition].stroke;
              const isSynthetic = trial.provenance === 'SYNTHETIC_SIMULATION';
              const isSelected = trial.id === selectedDetailTrial?.id;

              const pts = trial.fftBins
                .filter((b) => b.freqHz <= 35)
                .map((b) => {
                  const x = 55 + (b.freqHz / 35) * 675;
                  const y = Math.max(
                    24,
                    240 - (b.amplitudeMs2 / maxPlotAmp) * 216
                  );
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                });

              return (
                <polyline
                  key={trial.id}
                  fill="none"
                  stroke={color}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={isSynthetic ? '4 3' : undefined}
                  strokeOpacity={isSelected ? 1.0 : 0.75}
                  points={pts.join(' ')}
                />
              );
            })}

            {hoverFreqHz !== null && (
              <g>
                <line
                  x1={55 + (hoverFreqHz / 35) * 675}
                  y1={24}
                  x2={55 + (hoverFreqHz / 35) * 675}
                  y2={240}
                  stroke="#0F172A"
                />
                <text
                  x={725}
                  y={38}
                  textAnchor="end"
                  className="text-[11px] font-mono font-semibold fill-slate-900"
                >
                  Cursor: {hoverFreqHz.toFixed(2)} Hz (DLPF4:{' '}
                  {getDlpfDb(hoverFreqHz, 4).toFixed(1)} dB)
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* Loaded Trials Table */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">
              Recorded &amp; Reference Trials Inventory (Click Any Row to Inspect Ring-Down Waveform)
            </h3>
            {trials.some((t) => t.provenance === 'SYNTHETIC_SIMULATION') && (
              <button
                onClick={onClearSyntheticTrials}
                className="text-xs font-mono text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded transition-colors cursor-pointer"
              >
                Clear All Synthetic Reference Trials
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-sans font-semibold">
                  <th className="py-2.5 px-3">Provenance</th>
                  <th className="py-2.5 px-3">Condition</th>
                  <th className="py-2.5 px-3">Trial Label</th>
                  <th className="py-2.5 px-3">Samples (f_s)</th>
                  <th className="py-2.5 px-3">Analyzed Segment</th>
                  <th className="py-2.5 px-3">Dominant Peak (±Δf_bin)</th>
                  <th className="py-2.5 px-3">Verdict</th>
                  <th className="py-2.5 px-3">Export / Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {visibleTrials.map((trial) => {
                  const pk = findModePeakInBand(
                    trial.fftBins,
                    modeBandMinHz,
                    modeBandMaxHz
                  );
                  const isSelected = trial.id === selectedDetailTrial?.id;
                  const isEmpirical =
                    trial.provenance === 'EMPIRICAL_MEASUREMENT';
                  return (
                    <tr
                      key={trial.id}
                      onClick={() => setSelectedTrialIdForDetail(trial.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-semibold ${
                            isEmpirical ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {isEmpirical ? '● EMPIRICAL' : '◆ SYNTHETIC DATA'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-900">
                        {CONDITION_META[trial.condition].short}
                      </td>
                      <td className="py-2.5 px-3 font-sans">{trial.label}</td>
                      <td className="py-2.5 px-3">
                        {trial.sampleCount} ({trial.effectiveFsHz.toFixed(1)} Hz)
                      </td>
                      <td className="py-2.5 px-3">
                        [{trial.windowStartS.toFixed(2)}s, {trial.windowEndS.toFixed(2)}s]
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        {pk.parabolicFreqHz.toFixed(2)} Hz (±{trial.binSpacingHz.toFixed(2)} Hz) ·{' '}
                        {pk.peakAmpMs2.toFixed(3)} m/s²
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            trial.verdict === 'PASS'
                              ? 'text-emerald-700'
                              : trial.verdict === 'WARN'
                              ? 'text-amber-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {trial.verdict === 'PASS' && (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          {trial.verdict === 'WARN' && (
                            <AlertTriangle className="w-3.5 h-3.5" />
                          )}
                          {trial.verdict === 'REJECT' && (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          {trial.verdict} (#{trial.endStatus})
                        </span>
                      </td>
                      <td
                        className="py-2.5 px-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleExportSingleTrialCsv(trial)}
                            className="px-2 py-1 text-[11px] font-sans font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer whitespace-nowrap"
                          >
                            Download CSV
                          </button>
                          <button
                            onClick={() => onRemoveTrial(trial.id)}
                            title="Delete trial"
                            className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Trial Ring-Down Waveform & Diagnostics Inspector */}
        {selectedDetailTrial && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-slate-900">
                Selected Trial Ring-Down Waveform &amp; Diagnostics:{' '}
                <span>{selectedDetailTrial.label}</span>{' '}
                <span
                  className={`font-mono ml-1 ${
                    selectedDetailTrial.provenance === 'SYNTHETIC_SIMULATION'
                      ? 'text-amber-700 font-bold'
                      : 'text-emerald-700 font-bold'
                  }`}
                >
                  [
                  {selectedDetailTrial.provenance === 'SYNTHETIC_SIMULATION'
                    ? 'SYNTHETIC DATA'
                    : 'EMPIRICAL HARDWARE'}
                  ]
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-slate-600">
                  Mean a_z = {selectedDetailTrial.meanAzMs2.toFixed(4)} m/s² · Median Δt ={' '}
                  {selectedDetailTrial.medianDtUs.toFixed(1)} µs · P99 Jitter = ±
                  {selectedDetailTrial.p99JitterUs.toFixed(0)} µs
                </span>
                <button
                  onClick={() =>
                    exportSvgElementAsFile(
                      waveformSvgRef.current,
                      `BRIDGE_X_Waveform_${selectedDetailTrial.label.replace(/\s+/g, '_')}`,
                      'png'
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
                >
                  <ImageIcon className="w-3 h-3" />
                  <span>Export Waveform (.png)</span>
                </button>
              </div>
            </div>

            {selectedDetailTrial.samples.length > 2 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>
                    ZERO-MEAN DYNAMIC ACCELERATION (a_z - mean) · SHADED BLUE BOX = ANALYZED{' '}
                    {(
                      selectedDetailTrial.windowEndS - selectedDetailTrial.windowStartS
                    ).toFixed(2)}
                    S FFT SEGMENT
                  </span>
                  <span>
                    Detected Release Onset: t = {selectedDetailTrial.ringdownOnsetS.toFixed(2)} s
                  </span>
                </div>

                <svg
                  ref={waveformSvgRef}
                  viewBox="0 0 760 140"
                  className="w-full h-auto bg-white border border-slate-200 rounded"
                >
                  {(() => {
                    const dur = Math.max(selectedDetailTrial.durationS, 0.1);
                    const winX1 = 50 + (selectedDetailTrial.windowStartS / dur) * 690;
                    const winX2 = 50 + (selectedDetailTrial.windowEndS / dur) * 690;
                    const mean = selectedDetailTrial.meanAzMs2;
                    let maxAbs = 0.5;
                    for (const s of selectedDetailTrial.samples) {
                      const d = Math.abs(s.azMs2 - mean);
                      if (d > maxAbs) maxAbs = d;
                    }
                    maxAbs *= 1.12;

                    const stride = Math.max(
                      1,
                      Math.floor(selectedDetailTrial.samples.length / 750)
                    );
                    const pts: string[] = [];
                    for (
                      let i = 0;
                      i < selectedDetailTrial.samples.length;
                      i += stride
                    ) {
                      const s = selectedDetailTrial.samples[i];
                      const x = 50 + (s.unwrappedTimeS / dur) * 690;
                      const y = 72 - ((s.azMs2 - mean) / maxAbs) * 52;
                      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                    }

                    return (
                      <>
                        <text
                          x={54}
                          y={16}
                          className="text-[9px] font-mono font-bold fill-slate-600"
                        >
                          {selectedDetailTrial.provenance === 'SYNTHETIC_SIMULATION'
                            ? `SYNTHETIC DATA — ${selectedDetailTrial.label}`
                            : `EMPIRICAL RECORDING — ${selectedDetailTrial.label}`}
                        </text>
                        <rect
                          x={winX1}
                          y={20}
                          width={Math.max(2, winX2 - winX1)}
                          height={104}
                          fill="#DBEAFE"
                          fillOpacity={0.65}
                          stroke="#2563EB"
                          strokeDasharray="3 2"
                        />
                        <line x1={50} y1={72} x2={740} y2={72} stroke="#CBD5E1" />
                        <polyline
                          fill="none"
                          stroke={CONDITION_META[selectedDetailTrial.condition].stroke}
                          strokeWidth={1.3}
                          points={pts.join(' ')}
                        />
                        <text
                          x={44}
                          y={26}
                          textAnchor="end"
                          className="text-[9px] font-mono fill-slate-500"
                        >
                          +{maxAbs.toFixed(1)}
                        </text>
                        <text
                          x={44}
                          y={75}
                          textAnchor="end"
                          className="text-[9px] font-mono fill-slate-500"
                        >
                          0.0
                        </text>
                        <text
                          x={44}
                          y={122}
                          textAnchor="end"
                          className="text-[9px] font-mono fill-slate-500"
                        >
                          -{maxAbs.toFixed(1)}
                        </text>
                        {[0, 2, 4, 6, 8, 10].map((sec) => {
                          if (sec > dur + 0.5) return null;
                          const tx = 50 + (sec / dur) * 690;
                          return (
                            <text
                              key={sec}
                              x={tx}
                              y={135}
                              textAnchor="middle"
                              className="text-[9px] font-mono fill-slate-500"
                            >
                              {sec}s
                            </text>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>
            )}

            <div className="text-slate-700">
              <strong>Commissioning Audit:</strong>{' '}
              {selectedDetailTrial.verdictReasons.join(' | ')}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
