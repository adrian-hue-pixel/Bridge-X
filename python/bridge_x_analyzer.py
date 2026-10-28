#!/usr/bin/env python3
"""
BRIDGE-X Experimental Vibration Acquisition, Validator & Ring-Down Modal FFT Analyzer
IB Physics Collaborative Sciences Project
Compatible with the BRIDGE-X Arduino Nano (ATmega328P) Serial Data Contract (115200 baud).

Features:
- Wrap-safe uint32 microsecond timestamp validation & #END:CLEAN vs #END:DEGRADED checking
- Decaying-vibration sub-window selection (auto ring-down onset detection or custom [t_start, t_end])
  so a 10-second Hann window does not suppress early high-SNR free-vibration data after release.
"""

import sys
import json
import math
import argparse
from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional
import numpy as np

TARGET_FS_HZ = 200.0
NOMINAL_DT_US = 5000.0
MIN_COMPLETENESS_RATIO = 0.990     # >= 1980 of 2000 samples
MAX_MEDIAN_DT_TOL_US = 50.0        # 5000 +/- 50 us (1% clock accuracy)
MAX_P99_JITTER_US = 250.0          # 99% of intervals within +/- 250 us of median
MAX_SINGLE_GAP_US = 15000.0        # Reject trial if any single gap > 15 ms (3 samples)
CLIP_THRESHOLD_MS2 = 19.20         # Warn if |az| approaches +/- 2g (19.6133 m/s^2)
UINT32_MOD = 1 << 32


@dataclass
class TrialDiagnostics:
    provenance: str
    condition: str
    sample_count: int
    duration_s: float
    effective_fs_hz: float
    median_dt_us: float
    p99_jitter_us: float
    max_gap_us: float
    wrap_events: int
    non_monotonic_count: int
    overrun_lines: int
    i2c_error_lines: int
    clip_count: int
    end_status: str   # CLEAN, DEGRADED, ABORT, or MISSING_END
    verdict: str      # PASS, WARN, or REJECT
    reasons: List[str]
    mean_az_m_s2: float
    rms_dynamic_m_s2: float


def parse_bridge_x_stream(
    lines: List[str], condition: str = "unspecified"
) -> Tuple[np.ndarray, np.ndarray, List[str], TrialDiagnostics]:
    t_list: List[int] = []
    az_list: List[float] = []
    diagnostics: List[str] = []
    overrun_lines = 0
    i2c_error_lines = 0
    clip_count = 0
    end_status = "MISSING_END"
    provenance = "EMPIRICAL_MEASUREMENT"

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            diagnostics.append(line)
            if "SYNTHETIC" in line.upper():
                provenance = "SYNTHETIC_SIMULATION"
            if line.startswith("#ERR:OVERRUN"):
                overrun_lines += 1
            elif line.startswith("#ERR:I2C"):
                i2c_error_lines += 1
            elif line.startswith("#WARN:CLIP"):
                clip_count += 1
            elif line.startswith("#END:CLEAN"):
                end_status = "CLEAN"
            elif line.startswith("#END:DEGRADED"):
                end_status = "DEGRADED"
            elif line.startswith("#END:ABORT"):
                end_status = "ABORT"
                i2c_error_lines += 1
            continue

        parts = line.split(",")
        if len(parts) != 2:
            continue
        try:
            t_val = int(parts[0])
            az_val = float(parts[1])
            t_list.append(t_val)
            az_list.append(az_val)
            if abs(az_val) >= CLIP_THRESHOLD_MS2:
                clip_count += 1
        except ValueError:
            continue

    n = len(t_list)
    reasons: List[str] = []
    if n < 2:
        diag = TrialDiagnostics(
            provenance=provenance,
            condition=condition,
            sample_count=n,
            duration_s=0.0,
            effective_fs_hz=0.0,
            median_dt_us=0.0,
            p99_jitter_us=0.0,
            max_gap_us=0.0,
            wrap_events=0,
            non_monotonic_count=0,
            overrun_lines=overrun_lines,
            i2c_error_lines=i2c_error_lines,
            clip_count=clip_count,
            end_status=end_status,
            verdict="REJECT",
            reasons=["Insufficient numeric samples (< 2)."],
            mean_az_m_s2=0.0,
            rms_dynamic_m_s2=0.0,
        )
        return np.array([]), np.array([]), diagnostics, diag

    unwrapped_us = np.zeros(n, dtype=np.float64)
    dt_us = np.zeros(n - 1, dtype=np.float64)
    wrap_events = 0
    non_monotonic = 0

    for i in range(1, n):
        raw_diff = (t_list[i] - t_list[i - 1]) % UINT32_MOD
        if t_list[i] < t_list[i - 1] and raw_diff < 1_000_000:
            wrap_events += 1
        if raw_diff == 0 or raw_diff > 0x80000000:
            non_monotonic += 1
            dt_us[i - 1] = 0.0
        else:
            dt_us[i - 1] = float(raw_diff)
        unwrapped_us[i] = unwrapped_us[i - 1] + dt_us[i - 1]

    az_arr = np.array(az_list, dtype=np.float64)
    duration_s = unwrapped_us[-1] * 1e-6
    effective_fs = (n - 1) / duration_s if duration_s > 0 else 0.0
    median_dt = float(np.median(dt_us))
    p99_jitter = float(np.percentile(np.abs(dt_us - median_dt), 99))
    max_gap = float(np.max(dt_us))
    mean_az = float(np.mean(az_arr))
    rms_dyn = float(np.sqrt(np.mean((az_arr - mean_az) ** 2)))

    verdict = "PASS"
    if end_status == "ABORT":
        verdict = "REJECT"
        reasons.append("Firmware aborted trial (#END:ABORT).")
    elif end_status == "DEGRADED":
        verdict = "WARN"
        reasons.append("Firmware flagged trial as #END:DEGRADED (status=POTENTIALLY_INVALID).")

    if n < int(2000 * MIN_COMPLETENESS_RATIO):
        verdict = "WARN" if verdict != "REJECT" else "REJECT"
        reasons.append(f"Sample count {n} below 1980 target.")
    if non_monotonic > 0:
        verdict = "REJECT"
        reasons.append(f"{non_monotonic} non-monotonic timestamp steps.")
    if i2c_error_lines > 0:
        verdict = "REJECT"
        reasons.append(f"{i2c_error_lines} I2C bus errors reported.")
    if max_gap > MAX_SINGLE_GAP_US:
        verdict = "REJECT"
        reasons.append(f"Maximum sample gap {max_gap:.0f} us exceeds {MAX_SINGLE_GAP_US:.0f} us.")
    elif overrun_lines > 0:
        verdict = "WARN" if verdict != "REJECT" else "REJECT"
        reasons.append(f"{overrun_lines} overrun(s) reported.")
    if abs(median_dt - NOMINAL_DT_US) > MAX_MEDIAN_DT_TOL_US:
        verdict = "WARN" if verdict != "REJECT" else "REJECT"
        reasons.append(f"Median dt {median_dt:.1f} us deviates from 5000 us.")
    if clip_count > 0:
        verdict = "WARN" if verdict != "REJECT" else "REJECT"
        reasons.append(f"{clip_count} sample(s) near +/- 2g saturation limit.")

    diag = TrialDiagnostics(
        provenance=provenance,
        condition=condition,
        sample_count=n,
        duration_s=duration_s,
        effective_fs_hz=effective_fs,
        median_dt_us=median_dt,
        p99_jitter_us=p99_jitter,
        max_gap_us=max_gap,
        wrap_events=wrap_events,
        non_monotonic_count=non_monotonic,
        overrun_lines=overrun_lines,
        i2c_error_lines=i2c_error_lines,
        clip_count=clip_count,
        end_status=end_status,
        verdict=verdict,
        reasons=reasons,
        mean_az_m_s2=mean_az,
        rms_dynamic_m_s2=rms_dyn,
    )
    return unwrapped_us * 1e-6, az_arr, diagnostics, diag


def detect_ringdown_onset_s(t_s: np.ndarray, az_zero_mean: np.ndarray) -> float:
    peak_idx = int(np.argmax(np.abs(az_zero_mean)))
    peak_amp = float(np.abs(az_zero_mean[peak_idx]))
    if peak_amp < 0.05:
        return float(t_s[0])
    threshold = max(0.08, 0.20 * peak_amp)
    onset_idx = 0
    for i in range(len(az_zero_mean)):
        if abs(az_zero_mean[i]) >= threshold:
            onset_idx = max(0, i - 3)
            break
    return float(t_s[onset_idx])


def make_taper_window(n: int, window_type: str = "hann") -> np.ndarray:
    if window_type == "rectangular":
        return np.ones(n, dtype=np.float64)
    if window_type == "tukey":
        alpha = 0.25
        x = np.linspace(0.0, 1.0, n, endpoint=False)
        w = np.ones(n, dtype=np.float64)
        first = x < (alpha / 2.0)
        last = x >= (1.0 - alpha / 2.0)
        w[first] = 0.5 * (1.0 + np.cos(2.0 * np.pi / alpha * (x[first] - alpha / 2.0)))
        w[last] = 0.5 * (1.0 + np.cos(2.0 * np.pi / alpha * (x[last] - 1.0 + alpha / 2.0)))
        return w
    return np.hanning(n)


def compute_windowed_fft(
    t_s: np.ndarray,
    az_m_s2: np.ndarray,
    f_min: float = 2.0,
    f_max: float = 30.0,
    t_start: Optional[float] = None,
    t_end: Optional[float] = None,
    ringdown_duration_s: float = 3.5,
    window_type: str = "hann",
):
    full_mean = float(np.mean(az_m_s2))
    az_full_zero = az_m_s2 - full_mean

    if t_start is None:
        t_start = detect_ringdown_onset_s(t_s, az_full_zero)
    if t_end is None:
        t_end = min(float(t_s[-1]), t_start + ringdown_duration_s)

    sub_mask = (t_s >= t_start) & (t_s <= t_end)
    if np.sum(sub_mask) < 32:
        sub_mask = np.ones_like(t_s, dtype=bool)

    t_sub = t_s[sub_mask]
    az_sub = az_m_s2[sub_mask]
    n_sub = len(az_sub)
    fs = (n_sub - 1) / (t_sub[-1] - t_sub[0])

    az_zero_mean = az_sub - np.mean(az_sub)
    window = make_taper_window(n_sub, window_type=window_type)
    coherent_gain = float(np.mean(window))
    y_win = az_zero_mean * window
    n_fft = max(2048, 1 << int(math.ceil(math.log2(n_sub))))
    spec = np.fft.rfft(y_win, n=n_fft)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / fs)
    amps = (2.0 / (n_sub * coherent_gain)) * np.abs(spec)
    mask = (freqs >= f_min) & (freqs <= f_max)
    band_freqs = freqs[mask]
    band_amps = amps[mask]
    peak_idx = int(np.argmax(band_amps))
    true_bin_spacing_hz = fs / n_sub
    return (
        freqs,
        amps,
        float(band_freqs[peak_idx]),
        float(band_amps[peak_idx]),
        true_bin_spacing_hz,
        (float(t_sub[0]), float(t_sub[-1])),
    )


def main():
    parser = argparse.ArgumentParser(
        description="BRIDGE-X Modal FFT & Serial Telemetry Validator"
    )
    parser.add_argument("csv_file", help="Path to recorded BRIDGE-X CSV file")
    parser.add_argument("--condition", default="secured", help="Bridge condition label")
    parser.add_argument("--fmin", type=float, default=2.0, help="Min analysis frequency (Hz)")
    parser.add_argument("--fmax", type=float, default=30.0, help="Max analysis frequency (Hz)")
    parser.add_argument(
        "--window",
        choices=["hann", "tukey", "rectangular"],
        default="hann",
        help="Window function",
    )
    parser.add_argument(
        "--ringdown-s",
        type=float,
        default=3.5,
        help="Duration of active ring-down window after release (s)",
    )
    args = parser.parse_args()

    with open(args.csv_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    t_s, az_arr, _, diag = parse_bridge_x_stream(lines, condition=args.condition)
    if len(t_s) < 32:
        print(json.dumps(asdict(diag), indent=2))
        sys.exit(1)

    _, _, peak_f, peak_amp, df_bin, (w_start, w_end) = compute_windowed_fft(
        t_s,
        az_arr,
        f_min=args.fmin,
        f_max=args.fmax,
        ringdown_duration_s=args.ringdown_s,
        window_type=args.window,
    )

    summary = {
        "diagnostics": asdict(diag),
        "fft_analysis": {
            "window_type": args.window,
            "sub_window_s": [round(w_start, 4), round(w_end, 4)],
            "analysis_band_hz": [args.fmin, args.fmax],
            "dominant_freq_hz": round(peak_f, 4),
            "dominant_amp_m_s2": round(peak_amp, 4),
            "rayleigh_bin_spacing_hz": round(df_bin, 4),
        },
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
