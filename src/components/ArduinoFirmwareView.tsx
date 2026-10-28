import React, { useState } from 'react';
import {
  ARDUINO_FIRMWARE_SKETCH,
  buildCompleteArduinoFirmwareGuideMarkdown,
} from '../data/mpu6050Data';
import { triggerFileDownload } from '../utils/dspAndValidation';
import {
  Copy,
  Check,
  Download,
  FileCode,
  CheckSquare,
  Square,
  ExternalLink,
} from 'lucide-react';

interface CommissioningItem {
  step: number;
  title: string;
  procedure: string;
  criterion: string;
}

const COMMISSIONING_ITEMS: CommissioningItem[] = [
  {
    step: 1,
    title: 'Device Detected on I²C Bus (0x68) After Pre-Power Voltage Check',
    procedure:
      'Before applying power, verify your GY-521 LDO regulator and 3.3 V pull-ups with a multimeter and connect the bidirectional I²C level shifter. Then open Serial Monitor at 115200 baud.',
    criterion:
      'Prints #BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4... with zero #ERR:WHO_AM_I or #ERR:I2C_INIT messages.',
  },
  {
    step: 2,
    title: 'Stationary Acceleration Magnitude Near +9.81 m/s²',
    procedure:
      'Leave the wooden bridge undisturbed on the lab bench for one complete 2,000-sample (10.0 s) trial.',
    criterion:
      'Mean az_m_s2 is within [+9.00, +10.60] m/s² (1g ± factory zero-g tolerance) and dynamic RMS noise is < 0.08 m/s².',
  },
  {
    step: 3,
    title: 'Z-Axis Orientation & Sign Verification',
    procedure:
      'Verify PCB silkscreen +Z arrow points vertically upward (+az_m_s2 ≈ +9.81 m/s²); flipping the sensor upside down before mounting reads ≈ -9.81 m/s².',
    criterion:
      'Sensor is clamped or screwed rigidly at midspan with +Z vertical (never mounted with soft foam tape).',
  },
  {
    step: 4,
    title: 'Actual Sampling Rate Near 200.0 Hz Target',
    procedure:
      'Compute (t_us[1999] - t_us[0]) across a 2,000-sample trial or load the CSV into the Trial Comparator tab.',
    criterion:
      'Total duration is 9.995 s ± 0.08 s; median sample interval Δt is within 5,000 ± 50 µs (effective fs = 200.0 ± 2.0 Hz).',
  },
  {
    step: 5,
    title: 'Timing Jitter & Clean vs. Degraded End Footer Assessed',
    procedure:
      'Check that the trial footer prints #END:CLEAN (and NOT #END:DEGRADED,status=POTENTIALLY_INVALID) and inspect the Δt distribution.',
    criterion:
      'overruns=0, i2c_errs=0, clips=0, late_reads=0, 99th-percentile jitter ≤ 250 µs, and maximum gap ≤ 15,000 µs.',
  },
  {
    step: 6,
    title: 'No Clipping & Filter Settings Locked During Active Trial',
    procedure:
      'Deflect midspan downward by ~2–3 mm with a finger or thread and release cleanly. Verify commands "3" and "4" are only sent between trials.',
    criterion:
      'Peak |az_m_s2| remains < 19.20 m/s² and clips=0 in #END:CLEAN (zero #WARN:CLIP or #WARN:CMD_LOCKED messages).',
  },
  {
    step: 7,
    title: 'Python / Workbench Ring-Down Sub-Window FFT Analysis',
    procedure:
      'Import the saved trial into the Trial Comparator or run bridge_x_analyzer.py using the Auto Ring-Down Sub-Window (3.5 s from release onset).',
    criterion:
      '# diagnostic lines are parsed out-of-band, early decaying vibration is preserved without 10s Hann suppression, and FFT resolves a sharp modal peak in 2–30 Hz.',
  },
];

export const ArduinoFirmwareView: React.FC = () => {
  const [copiedSketch, setCopiedSketch] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState(false);
  const [copiedTeacherNote, setCopiedTeacherNote] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});

  const guideMarkdown = buildCompleteArduinoFirmwareGuideMarkdown();

  const teacherExplanationText =
    'Our Arduino Nano (ATmega328P) firmware uses the MPU-6050’s internal 1 kHz MEMS phase-locked loop and sample-rate divider (SMPLRT_DIV = 4) to generate a hardware Data-Ready interrupt on Digital Pin D2 at 200.0 Hz. Inside a ~3.5-microsecond interrupt routine, the Arduino Nano records the hardware micros() timestamp, and the main loop reads the 16-bit vertical acceleration register over 400 kHz I²C and streams timestamped specific force (t_us,az_m_s2) at 115200 baud for 2,000 samples (10.0 seconds). Sensor filter commands (3 and 4) are locked out during active trials so a recording never mixes configurations, and firmware only prints #END:CLEAN when overruns, I²C errors, clipping, and late reads are all zero—otherwise reporting #END:DEGRADED,status=POTENTIALLY_INVALID. Because the bridge vibrates most strongly immediately after release, Python isolates a focused ring-down sub-window around the active decay and subtracts the empirical mean before computing the windowed FFT. While this setup resolves repeatable shifts in midspan natural frequencies between the secured, disengaged, and restored brace states, it measures global modal stiffness changes on a laboratory model and cannot localize real-world structural defects or predict bridge collapse.';

  const handleCopySketch = async () => {
    await navigator.clipboard.writeText(ARDUINO_FIRMWARE_SKETCH);
    setCopiedSketch(true);
    setTimeout(() => setCopiedSketch(false), 2200);
  };

  const handleDownloadSketch = () => {
    triggerFileDownload(
      'bridge_x_firmware.ino',
      ARDUINO_FIRMWARE_SKETCH,
      'text/plain;charset=utf-8;'
    );
  };

  const handleCopyGuide = async () => {
    await navigator.clipboard.writeText(guideMarkdown);
    setCopiedGuide(true);
    setTimeout(() => setCopiedGuide(false), 2200);
  };

  const handleDownloadGuide = () => {
    triggerFileDownload(
      'BRIDGE_X_Arduino_Firmware_Guide_A_to_H.md',
      guideMarkdown,
      'text/markdown;charset=utf-8;'
    );
  };

  const handleCopyTeacherNote = async () => {
    await navigator.clipboard.writeText(teacherExplanationText);
    setCopiedTeacherNote(true);
    setTimeout(() => setCopiedTeacherNote(false), 2200);
  };

  const toggleStep = (step: number) => {
    setCheckedSteps((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  const completedCount = Object.values(checkedSteps).filter(Boolean).length;

  return (
    <div className="space-y-8">
      {/* Top Action Header */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-blue-600 font-semibold uppercase">
              Complete Arduino Nano (ATmega328P) Implementation &amp; Validation Guide (Sections A – H)
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
              BRIDGE-X Production Firmware (<code className="font-mono text-xl">bridge_x_firmware.ino</code>)
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadSketch}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download bridge_x_firmware.ino</span>
            </button>
            <button
              onClick={handleCopySketch}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              {copiedSketch ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSketch ? 'Copied .ino Sketch!' : 'Copy .ino Sketch'}</span>
            </button>
            <button
              onClick={handleDownloadGuide}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Download Full A–H Guide (.md)</span>
            </button>
            <button
              onClick={handleCopyGuide}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              {copiedGuide ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedGuide ? 'Copied Guide' : 'Copy A–H Guide'}</span>
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-700 leading-relaxed">
          This module provides the complete, beginner-friendly <strong>Arduino Nano (ATmega328P)</strong> firmware and commissioning handbook matching the BRIDGE-X Serial Data Contract (<code className="font-mono">115200</code> baud, <code className="font-mono">t_us,az_m_s2</code>, 2,000 samples per trial, <code className="font-mono">INT0</code> on Nano Pin <code className="font-mono">D2</code> at 200.0 Hz, initial <code className="font-mono">DLPF_CFG = 4</code> / <code className="font-mono">SMPLRT_DIV = 4</code>, and serial commands <code className="font-mono">&apos;R&apos;</code>, <code className="font-mono">&apos;3&apos;</code>, and <code className="font-mono">&apos;4&apos;</code>).
        </p>
      </section>

      {/* Section A & B: Design Trade-Offs & Exact Library Names */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION A</span>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Acquisition Design, Rate Distinctions &amp; Trade-Offs
            </h2>
          </div>

          <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
            <div>
              <strong className="text-slate-900">1. Sensor Output Rate vs. Arduino Read Rate vs. Serial Rate:</strong>{' '}
              The MPU-6050 internal accelerometer ADC and digital low-pass filter (DLPF) run at <strong>1,000 Hz</strong>. With <code className="font-mono">DLPF_CFG = 4</code> (21 Hz bandwidth), the Gyroscope Output Rate is also <strong>1,000 Hz</strong>. Setting <code className="font-mono">SMPLRT_DIV = 4</code> divides 1,000 Hz by <code className="font-mono">(1 + 4) = 5</code>, updating the output registers and pulsing the <code className="font-mono">INT</code> pin at <strong>200.0 Hz</strong> (every 5,000 µs). Because the Arduino Nano triggers an external interrupt (<code className="font-mono">INT0</code> on <code className="font-mono">D2</code>) on every <code className="font-mono">INT</code> pulse rather than polling <code className="font-mono">micros()</code> every 5 ms, the Arduino read rate is phase-locked 1:1 to the sensor clock—preventing duplicate stale reads or skipped samples caused by clock drift between the Nano’s ±0.5% ceramic resonator and the MPU-6050’s MEMS PLL. At 115200 baud (11,520 B/s capacity), transmitting 200 rows/s (16–20 B/row = 3,200–4,000 B/s) uses ~31% of UART capacity, draining the 64-byte TX buffer in 1.74 ms.
            </div>
            <div>
              <strong className="text-slate-900">2. Timestamp Meaning &amp; Wrap-Safe Arithmetic:</strong>{' '}
              <code className="font-mono">t_us</code> is the unsigned 32-bit <code className="font-mono">micros()</code> timestamp latched inside the ISR within ~3.5 µs of <code className="font-mono">DATA_RDY_INT</code> assertion (4 µs resolution on 16 MHz Nano, wrapping at <code className="font-mono">2^32 µs ≈ 71.58 min</code>). The DLPF introduces a constant 8.5 ms group delay (<code className="font-mono">DLPF_CFG=4</code>) or 4.9 ms (<code className="font-mono">DLPF_CFG=3</code>), shifting all samples uniformly without affecting <code className="font-mono">Δt</code> or FFT frequencies.
            </div>
            <div>
              <strong className="text-slate-900">3. Why 9.81 Is Not Subtracted on Arduino &amp; Acceleration vs. Displacement:</strong>{' '}
              Streaming total specific force (<code className="font-mono">≈ +9.81 m/s²</code> at rest) confirms vertical sensor orientation and lets Python subtract the exact 2,000-sample mean <code className="font-mono">mean(az)</code> (eliminating both gravity <code className="font-mono">g·cos θ</code> and the sensor’s ±80 mg zero-g offset). For harmonic motion <code className="font-mono">z(t) = Z_0 sin(2πft)</code>, acceleration is <code className="font-mono">a_z(t) = -(2πf)² z(t)</code>: modal peak frequencies in the acceleration FFT are identical to displacement modal frequencies without double-integration drift.
            </div>
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION B</span>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Exact Library Names &amp; Primary Sources
            </h2>
          </div>

          <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded">
              <div className="font-mono font-semibold text-slate-900">1. &lt;Arduino.h&gt; (Built-in AVR Core)</div>
              <p className="mt-1">
                Standard runtime bundled with Arduino IDE 1.8.x and 2.x (<code className="font-mono">Arduino AVR Boards</code>). Provides <code className="font-mono">micros()</code>, <code className="font-mono">attachInterrupt()</code>, <code className="font-mono">noInterrupts()</code>/<code className="font-mono">interrupts()</code>, and <code className="font-mono">Serial</code>.
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded">
              <div className="font-mono font-semibold text-slate-900">2. &lt;Wire.h&gt; (Built-in AVR I²C Library)</div>
              <p className="mt-1">
                Standard Two-Wire Interface library. <code className="font-mono">Wire.setWireTimeout(3000UL, true)</code> was introduced in <strong>Arduino AVR Boards v1.8.3</strong> (Arduino IDE 1.8.13+ and all 2.x versions) and is guarded by <code className="font-mono">#if defined(WIRE_HAS_TIMEOUT)</code>. Zero external libraries (<code className="font-mono">I2Cdev</code>, <code className="font-mono">Adafruit_MPU6050</code>) are needed.
              </p>
            </div>

            <div className="pt-1 space-y-1">
              <div className="font-semibold text-slate-900">Verified Primary Documentation Links:</div>
              <ul className="space-y-1 font-mono text-[11px] text-blue-700">
                <li>
                  <a
                    href="https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Register-Map1.pdf"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline inline-flex items-center gap-1"
                  >
                    <span>InvenSense MPU-6000/MPU-6050 Register Map Rev 4.2</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Datasheet1.pdf"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline inline-flex items-center gap-1"
                  >
                    <span>MPU-6000/MPU-6050 Product Specification Rev 3.4</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://docs.arduino.cc/language-reference/en/functions/communication/wire/"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline inline-flex items-center gap-1"
                  >
                    <span>Arduino Wire Library Reference (setClock / setWireTimeout)</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      {/* Section C: Conditional Wiring Table */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3">
          <span className="text-xs font-mono text-blue-600 font-semibold">SECTION C</span>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">
            Arduino Nano Conditional Wiring Table (Separating Bare MPU-6050 IC vs. GY-521 Breakout Requirements)
          </h2>
        </div>

        <p className="text-xs text-slate-700 leading-relaxed">
          <strong>Bare Chip vs. Breakout Distinction:</strong> The bare InvenSense MPU-6050 IC is a strict <strong>3.3 V device</strong> (<code className="font-mono">VDD</code> and <code className="font-mono">VLOGIC</code> max operational rating = <code className="font-mono">3.46 V</code>; I²C/INT pins rated to <code className="font-mono">VLOGIC + 0.5 V = 3.80 V</code>). However, a standard <strong>GY-521 breakout board</strong> adds an onboard 5-pin SOT-23 3.3 V LDO regulator on <code className="font-mono">VCC</code> and 4.7 kΩ pull-up resistors to the 3.3 V rail. Always inspect your breakout with a magnifier and multimeter before applying power.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                <th className="py-2.5 px-3">Signal</th>
                <th className="py-2.5 px-3">Arduino Nano Pin</th>
                <th className="py-2.5 px-3">Option 1: GY-521 + Bidirectional I²C Level Shifter (Recommended)</th>
                <th className="py-2.5 px-3">Option 2: GY-521 Direct (After Verifying 3.3V Pull-Ups)</th>
                <th className="py-2.5 px-3">Option 3: Bare 3.3V Breakout (No Onboard LDO)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">VCC / VDD</td>
                <td className="py-2.5 px-3 font-mono">5V &amp; 3V3</td>
                <td className="py-2.5 px-3">
                  Nano <code className="font-mono">5V</code> → GY-521 <code className="font-mono">VCC</code> (feeds onboard LDO) &amp; Shifter <code className="font-mono">HV</code>; Nano <code className="font-mono">3V3</code> → Shifter <code className="font-mono">LV</code>
                </td>
                <td className="py-2.5 px-3">
                  Nano <code className="font-mono">5V</code> → GY-521 <code className="font-mono">VCC</code> (only after confirming onboard LDO regulator is present)
                </td>
                <td className="py-2.5 px-3">
                  Nano <code className="font-mono">3V3</code> → Breakout <code className="font-mono">VDD</code> (NEVER 5V) + Shifter <code className="font-mono">LV</code>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">GND</td>
                <td className="py-2.5 px-3 font-mono">GND</td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">GND</code> → Shifter <code className="font-mono">GND</code> → GY-521 <code className="font-mono">GND</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">GND</code> → GY-521 <code className="font-mono">GND</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">GND</code> → Shifter <code className="font-mono">GND</code> → Breakout <code className="font-mono">GND</code></td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">SDA</td>
                <td className="py-2.5 px-3 font-mono">A4</td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A4</code> → Shifter <code className="font-mono">HV1</code>; Shifter <code className="font-mono">LV1</code> → GY-521 <code className="font-mono">SDA</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A4</code> → GY-521 <code className="font-mono">SDA</code> (firmware clears Nano internal 5V pull-up)</td>
                <td className="py-2.5 px-3">Via Level Shifter <code className="font-mono">HV1 ↔ LV1</code> only</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">SCL</td>
                <td className="py-2.5 px-3 font-mono">A5</td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A5</code> → Shifter <code className="font-mono">HV2</code>; Shifter <code className="font-mono">LV2</code> → GY-521 <code className="font-mono">SCL</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A5</code> → GY-521 <code className="font-mono">SCL</code> (firmware clears Nano internal 5V pull-up)</td>
                <td className="py-2.5 px-3">Via Level Shifter <code className="font-mono">HV2 ↔ LV2</code> only</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">INT</td>
                <td className="py-2.5 px-3 font-mono">D2 (INT0)</td>
                <td className="py-2.5 px-3">
                  GY-521 <code className="font-mono">INT</code> → Nano <code className="font-mono">D2</code> (3.3V push-pull output exceeds D2 <code className="font-mono">0.6×Vcc = 3.0V</code> threshold)
                </td>
                <td className="py-2.5 px-3">GY-521 <code className="font-mono">INT</code> → Nano <code className="font-mono">D2</code> (<code className="font-mono">pinMode(2, INPUT)</code>)</td>
                <td className="py-2.5 px-3">Breakout <code className="font-mono">INT</code> → Nano <code className="font-mono">D2</code></td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">AD0</td>
                <td className="py-2.5 px-3 font-mono">GND</td>
                <td className="py-2.5 px-3">Tie to <code className="font-mono">GND</code> or leave default pulled-low (sets address <code className="font-mono">0x68</code>)</td>
                <td className="py-2.5 px-3">Tie to <code className="font-mono">GND</code> (<code className="font-mono">0x68</code>)</td>
                <td className="py-2.5 px-3">Tie to <code className="font-mono">GND</code> (<code className="font-mono">0x68</code>)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section D: Complete Arduino Sketch */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION D</span>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Complete Arduino Nano (ATmega328P) Sketch (<code className="font-mono text-base">bridge_x_firmware.ino</code>)
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySketch}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
            >
              {copiedSketch ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSketch ? 'Copied Sketch' : 'Copy Sketch'}</span>
            </button>
            <button
              onClick={handleDownloadSketch}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save .ino File</span>
            </button>
          </div>
        </div>

        <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-5 rounded-md overflow-x-auto leading-relaxed max-h-[640px]">
          {ARDUINO_FIRMWARE_SKETCH}
        </pre>
      </section>

      {/* Section E & F: Upload Instructions + Interactive Commissioning Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION E</span>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Windows Arduino IDE Upload Steps (Arduino Nano)
            </h2>
          </div>

          <ol className="list-decimal pl-5 space-y-2.5 text-xs text-slate-700 leading-relaxed">
            <li>
              <strong>Save the Sketch:</strong> Click <em>Download bridge_x_firmware.ino</em> above and open it in <strong>Arduino IDE 2.x</strong> on Windows (when prompted, allow Arduino IDE to place it inside a <code className="font-mono">bridge_x_firmware</code> folder).
            </li>
            <li>
              <strong>Select Board, Processor &amp; Port:</strong> Choose <strong>Tools → Board → Arduino AVR Boards → Arduino Nano</strong>, set <strong>Tools → Processor → ATmega328P</strong> (or <code className="font-mono">ATmega328P (Old Bootloader)</code> for CH340G clone Nanos), and select your Nano under <strong>Tools → Port (COMx)</strong>.
            </li>
            <li>
              <strong>Compile &amp; Upload:</strong> Click <strong>Verify</strong> (checkmark), then <strong>Upload</strong> (right arrow). Wait for <code className="font-mono">Done uploading.</code>
            </li>
            <li>
              <strong>Verify in Serial Monitor:</strong> Open <strong>Tools → Serial Monitor</strong>, set baud rate to <strong>115200 baud</strong> and line ending to <strong>Newline</strong>. Confirm <code className="font-mono">#BRIDGE-X...</code>, 2,000 rows of <code className="font-mono">t_us,az_m_s2</code>, and <code className="font-mono">#END:CLEAN</code> appear.
            </li>
            <li>
              <strong>Runtime Serial Commands:</strong> Send <code className="font-mono">R</code> to start a new 2,000-sample trial at any time; send <code className="font-mono">3</code> (44 Hz BW) or <code className="font-mono">4</code> (21 Hz BW) between trials to switch the MPU-6050 digital low-pass filter.
            </li>
            <li>
              <strong>Release COM Port for Python / WebSerial:</strong> Close the Arduino IDE Serial Monitor before connecting the BRIDGE-X WebSerial Workbench or running <code className="font-mono">bridge_x_analyzer.py</code>.
            </li>
          </ol>
        </section>

        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <span className="text-xs font-mono text-blue-600 font-semibold">SECTION F</span>
              <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                Interactive 7-Point Commissioning Checklist
              </h2>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-700">
              {completedCount} / {COMMISSIONING_ITEMS.length} Verified
            </span>
          </div>

          <div className="space-y-2">
            {COMMISSIONING_ITEMS.map((item) => {
              const checked = !!checkedSteps[item.step];
              return (
                <div
                  key={item.step}
                  onClick={() => toggleStep(item.step)}
                  className={`p-3 rounded-md border transition-colors cursor-pointer flex items-start gap-3 ${
                    checked
                      ? 'bg-emerald-50/50 border-emerald-200'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <button
                    type="button"
                    className="mt-0.5 text-slate-700 shrink-0"
                    aria-label={`Toggle step ${item.step}`}
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                  <div className="text-xs space-y-1">
                    <div className="font-semibold text-slate-900">
                      {item.step}. {item.title}
                    </div>
                    <div className="text-slate-600">{item.procedure}</div>
                    <div className="font-mono text-[11px] text-slate-800">
                      Pass Criterion: {item.criterion}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Section G & H: Troubleshooting Table & Teacher Explanation */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3">
          <span className="text-xs font-mono text-blue-600 font-semibold">SECTION G</span>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">
            Troubleshooting Table for Common Hardware &amp; Serial Failures
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                <th className="py-2.5 px-3">Observed Symptom / Diagnostic Code</th>
                <th className="py-2.5 px-3">Probable Root Cause</th>
                <th className="py-2.5 px-3">Corrective Engineering Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              <tr>
                <td className="py-2.5 px-3 font-mono text-rose-700">#ERR:I2C_INIT,stage=WHO_AM_I,code=2</td>
                <td className="py-2.5 px-3">Address NACK on 0x68 (wiring swapped, unpowered sensor, or AD0 high).</td>
                <td className="py-2.5 px-3">Verify Uno A4=SDA, A5=SCL, shared GND, 5V on GY-521 VCC, and AD0 tied/pulled to GND.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono text-rose-700">#ERR:WHO_AM_I,expected=0x68,actual=0x70</td>
                <td className="py-2.5 px-3">Breakout carries an MPU-6500 (0x70) or clone IC instead of genuine MPU-6050.</td>
                <td className="py-2.5 px-3">Replace with a genuine MPU-6050 module or document the silicon ID difference before adjusting the check.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono text-rose-700">#ERR:INT0_TIMEOUT,pin=D2</td>
                <td className="py-2.5 px-3">No rising-edge pulses reaching Uno Digital Pin 2.</td>
                <td className="py-2.5 px-3">Confirm physical jumper wire from GY-521 INT to Uno Digital Pin 2 (INT0).</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono text-amber-700">#WARN:CLIP,raw=32767 (or -32768)</td>
                <td className="py-2.5 px-3">Excitation exceeded ±2g (±19.61 m/s²) full-scale range.</td>
                <td className="py-2.5 px-3">Use a gentler 2 mm finger/thread release at midspan; never tap the sensor housing directly.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono text-amber-700">#WARN:CMD_LOCKED,msg=Cannot_change_DLPF_during_active_trial</td>
                <td className="py-2.5 px-3">Serial command &apos;3&apos; or &apos;4&apos; was sent while a 2,000-sample trial was actively recording.</td>
                <td className="py-2.5 px-3">Wait for the trial to finish (#END:CLEAN or #END:DEGRADED) before changing filter bandwidth, then send &apos;R&apos;.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono text-rose-700">#END:DEGRADED,status=POTENTIALLY_INVALID,...</td>
                <td className="py-2.5 px-3">One or more overruns, I²C errors, ADC clips, or late reads occurred during the 2,000 samples.</td>
                <td className="py-2.5 px-3">Do not treat the trial as clean; inspect the non-zero fault counter in the footer and repeat the trial.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION H</span>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Concise Explanation for Your IB Physics Teacher
            </h2>
          </div>
          <button
            onClick={handleCopyTeacherNote}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
          >
            {copiedTeacherNote ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedTeacherNote ? 'Copied Explanation' : 'Copy Teacher Explanation'}</span>
          </button>
        </div>

        <blockquote className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md p-4 leading-relaxed">
          “{teacherExplanationText}”
        </blockquote>
      </section>
    </div>
  );
};
