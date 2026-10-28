import React, { useState } from 'react';
import {
  MPU6050_DLPF_OPTIONS,
  getVerifiedRegisters,
  buildGeminiFirmwareSpecification,
  buildCompleteEngineeringDossierMarkdown,
  ARDUINO_FIRMWARE_SKETCH,
  PYTHON_ANALYZER_SCRIPT,
} from '../data/mpu6050Data';
import { triggerFileDownload } from '../utils/dspAndValidation';
import { Copy, Check, Download, FileCode, FileText } from 'lucide-react';

interface SpecificationViewProps {
  selectedDlpfCfg: number;
  onSelectDlpfCfg: (cfg: number) => void;
  onNavigateTab: (
    tab: 'spec' | 'firmware' | 'timing' | 'simulator' | 'comparator'
  ) => void;
}

const SECTION_LINKS = [
  { id: 'sec-0', code: '0', title: 'Who & What Is Behind the Logic' },
  { id: 'sec-a', code: 'A', title: 'Architecture & Justification' },
  { id: 'sec-b', code: 'B', title: 'Verified Configuration Table' },
  { id: 'sec-c', code: 'C', title: 'State Machine & Pseudocode' },
  { id: 'sec-d', code: 'D', title: 'Timing, Memory & Throughput' },
  { id: 'sec-e', code: 'E', title: 'Exact Serial-Data Contract' },
  { id: 'sec-f', code: 'F', title: 'Python Reader & DSP Pipeline' },
  { id: 'sec-g', code: 'G', title: 'Acceptance Tests & Responses' },
  { id: 'sec-h', code: 'H', title: 'GY-521 Voltage & Hardware Checks' },
  { id: 'sec-i', code: 'I', title: 'Specification to Paste into Gemini' },
];

export const SpecificationView: React.FC<SpecificationViewProps> = ({
  selectedDlpfCfg,
  onSelectDlpfCfg,
  onNavigateTab,
}) => {
  const [copiedSpec, setCopiedSpec] = useState(false);
  const [copiedFullDossier, setCopiedFullDossier] = useState(false);
  const [copiedPython, setCopiedPython] = useState(false);
  const [activeSection, setActiveSection] = useState('sec-0');

  const activeDlpf =
    MPU6050_DLPF_OPTIONS.find((d) => d.dlpfCfg === selectedDlpfCfg) ||
    MPU6050_DLPF_OPTIONS[4];
  const verifiedRegisters = getVerifiedRegisters(selectedDlpfCfg);
  const geminiSpecText = buildGeminiFirmwareSpecification(selectedDlpfCfg);
  const fullDossierMarkdown = buildCompleteEngineeringDossierMarkdown(selectedDlpfCfg);

  const handleCopyGeminiSpec = async () => {
    await navigator.clipboard.writeText(geminiSpecText);
    setCopiedSpec(true);
    setTimeout(() => setCopiedSpec(false), 2200);
  };

  const handleCopyFullDossier = async () => {
    await navigator.clipboard.writeText(fullDossierMarkdown);
    setCopiedFullDossier(true);
    setTimeout(() => setCopiedFullDossier(false), 2200);
  };

  const handleDownloadFullDossier = () => {
    triggerFileDownload(
      `BRIDGE_X_Complete_Architecture_A_to_I_DLPF${selectedDlpfCfg}.md`,
      fullDossierMarkdown,
      'text/markdown;charset=utf-8;'
    );
  };

  const handleDownloadMasterJsonBundle = () => {
    const bundle = {
      project: 'BRIDGE-X IB Physics Collaborative Sciences Project',
      generatedAt: new Date().toISOString(),
      logicProvenance: {
        sensorDatasheet:
          'InvenSense MPU-6000 and MPU-6050 Register Map and Descriptions Rev 4.2 (RM-MPU-6000A-00) & Product Specification Rev 3.4 (PS-MPU-6000A-00)',
        mcuDatasheet:
          'Microchip/Atmel ATmega328P 8-Bit AVR Microcontroller Datasheet (DS40002061B) & ArduinoCore-avr (Wire/twi.c & HardwareSerial)',
        breakoutSchematic:
          'GY-521 Reference Schematic (Onboard 3.3V LDO regulator + 4.7kOhm I2C pull-ups to 3.3V rail)',
        dspTheory:
          'Euler-Bernoulli beam modal vibration scaling, empirical sample-mean DC removal, Hann window coherent gain (0.50), Cooley-Tukey Radix-2 FFT',
      },
      activeFilterConfig: activeDlpf,
      verifiedRegisters,
      completeMarkdownDossier: fullDossierMarkdown,
      sectionIFirmwareSpecification: geminiSpecText,
      pythonAnalyzerScript: PYTHON_ANALYZER_SCRIPT,
    };
    triggerFileDownload(
      `BRIDGE_X_Master_Bundle_DLPF${selectedDlpfCfg}.json`,
      JSON.stringify(bundle, null, 2),
      'application/json;charset=utf-8;'
    );
  };

  const handleCopyPython = async () => {
    await navigator.clipboard.writeText(PYTHON_ANALYZER_SCRIPT);
    setCopiedPython(true);
    setTimeout(() => setCopiedPython(false), 2200);
  };

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left Sticky Section Directory & Active Filter Configuration */}
      <aside className="lg:col-span-3 lg:sticky lg:top-20 bg-white border border-slate-200 rounded-lg p-5 space-y-6">
        <div>
          <div className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-1">
            Engineering Blueprint
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            Sections 0 &amp; A – I Index
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Complete acquisition design, provenance, and verification review for the 60 × 12 × 12 cm wooden bridge.
          </p>
        </div>

        <nav className="space-y-1" aria-label="Specification sections">
          {SECTION_LINKS.map((sec) => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => scrollToSection(sec.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="truncate">
                  <span className="font-mono mr-2">{sec.code}.</span>
                  {sec.title}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-slate-200 space-y-3">
          <label
            htmlFor="spec-dlpf-select"
            className="block text-xs font-medium text-slate-700"
          >
            Active MPU6050 Filter Preset (DLPF_CFG)
          </label>
          <select
            id="spec-dlpf-select"
            value={selectedDlpfCfg}
            onChange={(e) => onSelectDlpfCfg(Number(e.target.value))}
            className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded-md px-2.5 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value={4}>DLPF_CFG = 4 · 21 Hz BW (Initial Brief)</option>
            <option value={3}>DLPF_CFG = 3 · 44 Hz BW (Flat 2–30 Hz)</option>
            <option value={2}>DLPF_CFG = 2 · 94 Hz BW (Wideband)</option>
            <option value={5}>DLPF_CFG = 5 · 10 Hz BW (Low-Freq Only)</option>
            <option value={6}>DLPF_CFG = 6 · 5 Hz BW (Ultra-Low Sway)</option>
          </select>
          <div className="text-xs text-slate-600 font-mono space-y-1 bg-slate-50 p-2.5 rounded border border-slate-200">
            <div>CONFIG (0x1A): {activeDlpf.configHex}</div>
            <div>SMPLRT_DIV (0x19): {activeDlpf.smplrtDivHex} (200 Hz)</div>
            <div>30 Hz Gain: {activeDlpf.attenuationAt30HzDb.toFixed(2)} dB</div>
            <div>Group Delay: {activeDlpf.accelDelayMs.toFixed(1)} ms</div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 space-y-2">
          <button
            onClick={handleDownloadFullDossier}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Entire A–I Dossier (.md)</span>
          </button>
          <button
            onClick={handleCopyFullDossier}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
          >
            {copiedFullDossier ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedFullDossier ? 'Copied Entire A–I Dossier!' : 'Copy Entire A–I Dossier'}</span>
          </button>
          <button
            onClick={handleCopyGeminiSpec}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
          >
            {copiedSpec ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSpec ? 'Copied Section I Spec' : 'Copy Section I Only'}</span>
          </button>
          <button
            onClick={handleDownloadMasterJsonBundle}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Download JSON Bundle (.json)</span>
          </button>
        </div>
      </aside>

      {/* Main Engineering Specification Content (Sections 0 and A through I) */}
      <div className="lg:col-span-9 space-y-8">
        {/* Top Scope, Download Bar & Honesty Statement */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <div className="text-xs font-mono text-slate-500">
                IB PHYSICS COLLABORATIVE SCIENCES · MIDSPAN ACCELEROMETRY SPECIFICATION
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mt-1">
                BRIDGE-X Embedded Acquisition Architecture &amp; Review
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleDownloadFullDossier}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Entire A–I Dossier for ChatGPT (.md)</span>
              </button>
              <button
                onClick={handleCopyFullDossier}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
              >
                {copiedFullDossier ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedFullDossier ? 'Copied Full Dossier' : 'Copy All for ChatGPT'}</span>
              </button>
              <button
                onClick={() => onNavigateTab('comparator')}
                className="px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
              >
                Open Real Trial Comparator
              </button>
            </div>
          </div>

          <p className="text-sm text-slate-700 leading-relaxed">
            <strong>Experimental Scope &amp; Epistemic Boundary:</strong> This system records gentle midspan vertical free vibrations (<code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">az_m_s2</code>) on a 60 × 12 × 12 cm wooden model bridge across three controlled configurations—<em>Additional Brace Secured</em>, <em>Additional Brace Disengaged (permanent members retained)</em>, and <em>Brace Restored</em>. It investigates shifts in modal vibration characteristics (natural frequencies and damping). A single midspan uniaxial accelerometer on a tabletop model <strong>cannot certify real-world structural safety, reliably localize internal damage, or predict collapse</strong>.
          </p>
        </div>

        {/* SECTION 0: WHO & WHAT IS BEHIND THE LOGIC */}
        <section id="sec-0" className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 scroll-mt-20">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION 0 · PROVENANCE &amp; FIRST PRINCIPLES</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Who &amp; What Is Behind the Logic (Primary Hardware Datasheets &amp; Mathematical Foundations)
            </h2>
          </div>

          <p className="text-xs text-slate-700 leading-relaxed">
            Every architectural decision, register address, bitfield value, timing budget calculation, and signal-processing algorithm in BRIDGE-X is derived deterministically from four primary engineering sources—with zero unverified library abstractions or black-box heuristics:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
              <div className="font-mono text-[11px] text-blue-700 font-semibold">
                1. INVENSENSE SILICON DOCUMENTATION
              </div>
              <h3 className="font-semibold text-slate-900">
                MPU-6000 / MPU-6050 Register Map Rev 4.2 &amp; Product Spec Rev 3.4
              </h3>
              <p>
                Defines the internal 1 kHz accelerometer ADC/DLPF architecture, the Gyroscope Output Rate (8 kHz when <code className="font-mono">DLPF_CFG=0</code>, 1 kHz when <code className="font-mono">DLPF_CFG=1..6</code>), the divider formula <code className="font-mono">Sample Rate = Gyro Rate / (1 + SMPLRT_DIV)</code> (Sec. 4.2), the <code className="font-mono">CONFIG (0x1A)</code> bandwidth/delay table (Sec. 4.3), the 50 µs push-pull <code className="font-mono">DATA_RDY_INT</code> pulse on <code className="font-mono">INT_PIN_CFG (0x37)</code> (Sec. 4.14), and contiguous MSB/LSB shadow latching on <code className="font-mono">ACCEL_ZOUT_H..L (0x3F..0x40)</code> (Sec. 4.17).
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
              <div className="font-mono text-[11px] text-blue-700 font-semibold">
                2. ATMEL / MICROCHIP 8-BIT AVR ARCHITECTURE
              </div>
              <h3 className="font-semibold text-slate-900">
                ATmega328P Datasheet (DS40002061B) &amp; ArduinoCore-avr
              </h3>
              <p>
                Governs 8-bit bus atomicity (requiring <code className="font-mono">cli/sei</code> critical sections when copying 32-bit <code className="font-mono">micros()</code> timestamps from an ISR), Timer0 prescaler-64 quantization (<code className="font-mono">4 µs</code> resolution and <code className="font-mono">2^32 µs ≈ 71.58 min</code> modular rollover), TWI minimum high-level input threshold (<code className="font-mono">V_IH(min) = 0.7 × V_CC = 3.50 V</code> on <code className="font-mono">A4/A5</code> vs <code className="font-mono">0.6 × V_CC = 3.00 V</code> on <code className="font-mono">D2</code>), and the 64-byte <code className="font-mono">HardwareSerial</code> ring buffer drain math at 115200 8N1 (<code className="font-mono">86.81 µs/byte</code>).
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
              <div className="font-mono text-[11px] text-blue-700 font-semibold">
                3. GY-521 BREAKOUT CIRCUIT TOPOLOGY
              </div>
              <h3 className="font-semibold text-slate-900">
                Onboard 3.3 V LDO Regulator &amp; I²C Pull-Up Network Analysis
              </h3>
              <p>
                Resolves the voltage-domain mismatch between the 5.0 V Arduino Uno R3 and the 3.3 V MPU-6050 (<code className="font-mono">VLOGIC = 3.3 V</code>, absolute max pin rating <code className="font-mono">3.8 V</code>). Explains why <code className="font-mono">GY-521 VCC</code> connects to Uno <code className="font-mono">5V</code> (feeding the onboard LDO), why <code className="font-mono">Wire.begin()</code>’s internal 5 V pull-ups on <code className="font-mono">A4/A5</code> must be disabled, and how a bidirectional MOSFET level shifter guarantees legal logic thresholds on both sides.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
              <div className="font-mono text-[11px] text-blue-700 font-semibold">
                4. STRUCTURAL MODAL DYNAMICS &amp; FOURIER DSP
              </div>
              <h3 className="font-semibold text-slate-900">
                Euler-Bernoulli Beam Vibration &amp; Windowed Cooley-Tukey FFT
              </h3>
              <p>
                Applies empirical sample-mean subtraction (<code className="font-mono">a_z - mean(a_z)</code>) to strip gravity (<code className="font-mono">g·cos θ</code>) and zero-g offset before applying a Hann window (coherent gain <code className="font-mono">0.50</code>), avoiding 0 Hz spectral leakage into 2–5 Hz. Distinguishes nominal bin spacing (<code className="font-mono">Δf = f_s / N = 0.10 Hz</code>) from true ring-down-limited resolution (<code className="font-mono">≈ 1 / T_ring</code>) and tracks modal peaks within bounded physical windows across Secured, Disengaged, and Restored states.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION A */}
        <section id="sec-a" className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 scroll-mt-20">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION A</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Recommended Acquisition Architecture & Engineering Justification
            </h2>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-4">
            <div className="text-xs font-mono uppercase text-slate-500">Selected Single Architecture (Resolved Decision)</div>
            <div className="text-sm font-semibold text-slate-900 mt-1">
              Hardware Data-Ready Interrupt (<code className="font-mono text-xs">INT</code> → Uno <code className="font-mono text-xs">D2 / INT0</code>) at 200 Hz + Direct 2-Byte I²C Burst Read (<code className="font-mono text-xs">ACCEL_ZOUT_H..L</code>) in <code className="font-mono text-xs">loop()</code>
            </div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              The MPU6050 divides its 1 kHz PLL-stabilized internal sample clock by <code className="font-mono">1 + SMPLRT_DIV = 5</code> to assert a 50 µs active-high pulse on <code className="font-mono">INT</code> every 5,000 µs (200.0 Hz). The Arduino Uno captures <code className="font-mono">micros()</code> immediately inside the <code className="font-mono">INT0</code> ISR and increments a pending counter, while <code className="font-mono">loop()</code> performs a 2-byte I²C burst read of <code className="font-mono">0x3F..0x40</code> at 400 kHz and streams <code className="font-mono">t_us,az_m_s2</code> at 115200 baud.
            </p>
          </div>

          {/* Comparison Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3">Architecture Option</th>
                  <th className="py-2.5 px-3">Timing Defensibility</th>
                  <th className="py-2.5 px-3">Uno SRAM & Complexity</th>
                  <th className="py-2.5 px-3">Engineering Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr>
                  <td className="py-2.5 px-3 font-medium">1. Software Timer / <code className="font-mono">micros()</code> Polling</td>
                  <td className="py-2.5 px-3">
                    <strong>Inferior:</strong> Asynchronous to the MPU6050 internal ADC clock. Because the Uno R3 uses a ±0.5% ceramic resonator and the MPU6050 uses its own MEMS PLL, reading every 5,000 Uno microseconds drifts relative to sensor updates—periodically reading the same register sample twice or skipping a sample without detection.
                  </td>
                  <td className="py-2.5 px-3">Low SRAM (~40 B), no INT wire required.</td>
                  <td className="py-2.5 px-3 font-mono text-amber-700">REJECTED (Async slip)</td>
                </tr>
                <tr className="bg-blue-50/40">
                  <td className="py-2.5 px-3 font-semibold text-slate-900">2. Hardware <code className="font-mono">DATA_RDY_INT</code> on D2 + Direct Read</td>
                  <td className="py-2.5 px-3">
                    <strong>Best:</strong> Synchronized directly to the sensor sample clock. <code className="font-mono">micros()</code> is latched within ~3–5 µs of sample completion inside the ISR. Missed deadlines are deterministically caught whenever <code className="font-mono">isr_pending_count &gt; 1</code>.
                  </td>
                  <td className="py-2.5 px-3">Minimal SRAM (~64 B), simple 2-byte I²C burst (<code className="font-mono">0x3F..0x40</code>).</td>
                  <td className="py-2.5 px-3 font-mono text-emerald-700 font-semibold">SELECTED (Recommended)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">3. Hardware FIFO Buffer (<code className="font-mono">0x74</code>)</td>
                  <td className="py-2.5 px-3">
                    <strong>Indirect:</strong> Preserves sample sequence during brief host stalls, but FIFO packets carry no hardware timestamps; individual sample times must be interpolated from batch read times. Furthermore, routing <code className="font-mono">ACCEL_FIFO_EN</code> pushes all 3 axes (6 bytes/sample instead of 2).
                  </td>
                  <td className="py-2.5 px-3">Higher SRAM & complex packet realignment if 1024 B FIFO overflows.</td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">REJECTED (Unnecessary complexity)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">1. Sensor Output Rate vs. Arduino Read Rate</h3>
              <p>
                Inside the MPU6050, the accelerometer ADC and digital low-pass filter (DLPF) run at a fixed internal rate of <strong>1 kHz</strong>. When <code className="font-mono">DLPF_CFG</code> is 1–6, the Gyroscope Output Rate is also 1 kHz. The Sample Rate Divider (<code className="font-mono">SMPLRT_DIV = 4</code>) latches new measurements into the user-facing output registers (<code className="font-mono">0x3B..0x40</code>) and triggers <code className="font-mono">DATA_RDY_INT</code> at <code className="font-mono">1000 / (1 + 4) = 200 Hz</code>. Because the Arduino only reads in response to <code className="font-mono">DATA_RDY_INT</code>, the Arduino read rate is phase-locked 1:1 with the sensor register update rate.
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">2. Identifying Genuinely Fresh Readings & Overruns</h3>
              <p>
                A reading is genuinely fresh if and only if <code className="font-mono">DATA_RDY_INT</code> has fired since the previous read. The ISR increments <code className="font-mono">volatile uint8_t isr_pending_count</code> on every rising edge of <code className="font-mono">D2</code>. If <code className="font-mono">loop()</code> services every interrupt within 5,000 µs, <code className="font-mono">isr_pending_count == 1</code>. If <code className="font-mono">loop()</code> is delayed beyond 5,000 µs (e.g., by UART blocking), a second interrupt fires and <code className="font-mono">isr_pending_count</code> becomes <code className="font-mono">&gt;= 2</code>, proving that <code className="font-mono">isr_pending_count - 1</code> samples were overwritten before being read.
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">3. Late Read Hazard (Timestamp vs. Register Mismatch)</h3>
              <p>
                Because the MPU6050 output registers are double-buffered without a FIFO queue, if the ISR fires at <code className="font-mono">t_n</code> (<code className="font-mono">0 ms</code>) and <code className="font-mono">loop()</code> does not start the I²C read until <code className="font-mono">4.95 ms</code>, a new sample update at <code className="font-mono">t_n+1</code> (<code className="font-mono">5.00 ms</code>) could overwrite the register right before or during the read. <strong>Mitigation:</strong> Under normal operation at 400 kHz I²C and 115200 baud, <code className="font-mono">loop()</code> starts the I²C read within ~10 µs of the ISR and completes it by ~135 µs—leaving a <strong>4,865 µs safety margin</strong> before the next register update. In addition, after the I²C read completes, firmware re-checks if <code className="font-mono">isr_pending_count</code> incremented during the I²C transaction itself and flags an ambiguity warning if so.
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">4. What Cannot Be Detected Without a Hardware Sequence Number</h3>
              <p>
                The MPU6050 does not embed a sample counter in <code className="font-mono">ACCEL_ZOUT</code>. Therefore, if the physical <code className="font-mono">INT</code> wire glitches (EMI spike) or disconnects intermittently for an exact multiple of 5 ms while interrupts are masked for &gt;5 ms, the host relies on <code className="font-mono">micros()</code> interval <code className="font-mono">Δt = t[k] - t[k-1]</code> to detect the ~10,000 µs gap. Combining <code className="font-mono">isr_pending_count</code> on Arduino with <code className="font-mono">Δt</code> interval auditing in Python catches both CPU overruns and missing interrupt pulses.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION B */}
        <section id="sec-b" className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 scroll-mt-20">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
            <div>
              <span className="text-xs font-mono text-blue-600 font-semibold">SECTION B</span>
              <h2 className="text-xl font-bold text-slate-900 mt-0.5">
                Verified MPU6050 Register Configuration & Selectable Filtering
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-slate-500">Active Filter:</span>
              <span className="font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-200">
                DLPF_CFG = {activeDlpf.dlpfCfg} ({activeDlpf.accelBandwidthHz} Hz BW)
              </span>
            </div>
          </div>

          <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
            <p>
              <strong>Verified Rate Equations (InvenSense Document RM-MPU-6000A-00 Rev 4.2, Section 4.2):</strong>
            </p>
            <div className="font-mono bg-slate-50 border border-slate-200 rounded p-3 text-slate-900 space-y-1">
              <div>Sample Rate = Gyroscope Output Rate / (1 + SMPLRT_DIV)</div>
              <div>• When DLPF_CFG = 1..6: Gyroscope Output Rate = 1,000 Hz → SMPLRT_DIV = 4 yields 1000 / (1 + 4) = 200.0 Hz.</div>
              <div>• When DLPF_CFG = 0:    Gyroscope Output Rate = 8,000 Hz → SMPLRT_DIV = 39 yields 8000 / (1 + 39) = 200.0 Hz.</div>
              <div>• Critical Distinction: The Accelerometer internal output rate is ALWAYS 1,000 Hz regardless of DLPF_CFG.</div>
            </div>
            <p>
              <strong>Selectable Filter Engineering Note for 2–30 Hz Bridge Vibrations:</strong> The project brief specifies an initial low-pass bandwidth of approximately <strong>21 Hz (<code className="font-mono">DLPF_CFG = 4</code>)</strong> and an analysis band of <strong>2–30 Hz</strong>. Because 21 Hz is the <code className="font-mono">-3.0 dB</code> cutoff corner, vibration modes between 21 Hz and 30 Hz experience noticeable amplitude roll-off (approx. <code className="font-mono">-4.83 dB</code> or 43% amplitude reduction at 30 Hz, though frequency location <code className="font-mono">f_peak</code> is unaffected). Therefore, the firmware and workbench provide <strong>selectable MPU6050 filtering</strong> so experimentalists can switch between <code className="font-mono">DLPF_CFG = 4</code> (21 Hz initial baseline) and <code className="font-mono">DLPF_CFG = 3</code> (<strong>44 Hz bandwidth</strong>, only <code className="font-mono">-1.66 dB</code> at 30 Hz and 4.9 ms delay) whenever modes between 20–30 Hz are investigated.
            </p>
          </div>

          {/* Selectable DLPF Comparison Sub-Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-sans font-semibold">
                  <th className="py-2 px-2.5">Select</th>
                  <th className="py-2 px-2.5">DLPF_CFG</th>
                  <th className="py-2 px-2.5">CONFIG (0x1A)</th>
                  <th className="py-2 px-2.5">Accel BW</th>
                  <th className="py-2 px-2.5">Delay</th>
                  <th className="py-2 px-2.5">Gain @ 30 Hz</th>
                  <th className="py-2 px-2.5">SMPLRT_DIV (200 Hz)</th>
                  <th className="py-2 px-2.5 font-sans">Bridge Range Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {MPU6050_DLPF_OPTIONS.map((opt) => {
                  const selected = opt.dlpfCfg === selectedDlpfCfg;
                  return (
                    <tr
                      key={opt.dlpfCfg}
                      onClick={() => onSelectDlpfCfg(opt.dlpfCfg)}
                      className={`cursor-pointer transition-colors ${
                        selected ? 'bg-blue-50/70 text-slate-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <td className="py-2 px-2.5">
                        <input
                          type="radio"
                          name="dlpf-row"
                          checked={selected}
                          onChange={() => onSelectDlpfCfg(opt.dlpfCfg)}
                          className="accent-blue-600"
                        />
                      </td>
                      <td className="py-2 px-2.5">{opt.dlpfCfg}</td>
                      <td className="py-2 px-2.5">{opt.configHex}</td>
                      <td className="py-2 px-2.5">{opt.accelBandwidthHz} Hz</td>
                      <td className="py-2 px-2.5">{opt.accelDelayMs.toFixed(1)} ms</td>
                      <td className="py-2 px-2.5">{opt.attenuationAt30HzDb.toFixed(2)} dB</td>
                      <td className="py-2 px-2.5">
                        {opt.smplrtDivFor200Hz} ({opt.smplrtDivHex})
                      </td>
                      <td className="py-2 px-2.5 font-sans text-xs">{opt.bridgeSuitability}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Complete Register Table */}
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3">Register Name</th>
                  <th className="py-2.5 px-3">Addr (Hex)</th>
                  <th className="py-2.5 px-3">R/W</th>
                  <th className="py-2.5 px-3">Bitfields</th>
                  <th className="py-2.5 px-3">Proposed Value</th>
                  <th className="py-2.5 px-3">Verified Purpose & Documentation Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {verifiedRegisters.map((reg) => (
                  <tr key={reg.name}>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{reg.name}</td>
                    <td className="py-2.5 px-3 font-mono">{reg.addressHex}</td>
                    <td className="py-2.5 px-3 font-mono">{reg.rw}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">{reg.bitfields}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <span className="font-semibold text-blue-700">{reg.proposedValueHex}</span>
                      <div className="text-[10px] text-slate-500">{reg.proposedValueBin}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div>{reg.purpose}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">{reg.sourceRef}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* SECTION C */}
        <section id="sec-c" className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 scroll-mt-20">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION C</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Acquisition State Machine, Atomic AVR Access & Concise Pseudocode
            </h2>
          </div>

          <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-4 rounded-md overflow-x-auto leading-relaxed">
{`┌──────────────┐    Power-On / USB DTR Reset     ┌─────────────────────────┐
│ 0. BOOT/INIT │ ──────────────────────────────► │ 1. SENSOR VERIFY        │
│ Serial 115200│                                 │ Read WHO_AM_I (0x75)    │
│ Wire 400 kHz │                                 │ Write & Verify Regs     │
└──────────────┘                                 └────────────┬────────────┘
                                                              │
       ┌──────────────────────────────────────────────────────┼──── WHO_AM_I != 0x68
       │ Pass (WHO_AM_I == 0x68 & Regs Match)                 ▼     or I²C NACK
       ▼                                         ┌─────────────────────────┐
┌──────────────────────────┐                     │ 5. FAULT / ABORT STATE  │
│ 2. PLL & DLPF SETTLING   │                     │ Detach INT0             │
│ Delay 100 ms + Discard   │                     │ Print #ERR:... &        │
│ First 10 DRDY Samples    │                     │ #END:ABORT, halt/wait R │
└──────────────┬───────────┘                     └─────────────────────────┘
               │ Emit #BRIDGE-X, #COLUMNS, #START:TRIAL       ▲
               ▼                                              │ >= 5 Consecutive
┌──────────────────────────┐                                  │ I²C Read Errors
│ 3. ACTIVE ACQUISITION    │ ─────────────────────────────────┘
│ Wait for INT0 (200 Hz)   │   (Commands '3'/'4' LOCKED here)
│ Atomic snapshot t_us     │ ─── Sample Count == 2000 ──► ┌─────────────────────────┐
│ Read 0x3F..0x40 (2 B)    │                              │ 4. TRIAL COMPLETE (IDLE)│
│ Emit t_us,az_m_s2        │ ◄── Serial 'R' Command ───── │ #END:CLEAN (0 faults)   │
└──────────────────────────┘                              │ or #END:DEGRADED        │
                                                          └─────────────────────────┘`}
          </pre>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700">
            <div className="p-4 border border-slate-200 rounded-md space-y-1.5">
              <h3 className="font-semibold text-slate-900">Atomic Multi-Byte Access on 8-Bit AVR (ATmega328P)</h3>
              <p>
                The ATmega328P is an 8-bit CPU: reading or writing a 32-bit <code className="font-mono">volatile uint32_t isr_t_us</code> in <code className="font-mono">loop()</code> compiles to four separate 8-bit <code className="font-mono">LDS</code> instructions. Without protection, <code className="font-mono">INT0</code> could fire mid-read (e.g., after reading the lower 2 bytes during a carry propagation from <code className="font-mono">0x0000FFFF</code> to <code className="font-mono">0x00010000</code>), corrupting the timestamp by up to 65.5 ms. Therefore, <code className="font-mono">loop()</code> MUST disable interrupts via <code className="font-mono">noInterrupts()</code> (<code className="font-mono">cli</code>), copy <code className="font-mono">isr_t_us</code> and <code className="font-mono">isr_pending_count</code> into local stack variables, clear <code className="font-mono">isr_pending_count = 0</code>, and immediately call <code className="font-mono">interrupts()</code> (<code className="font-mono">sei</code>). Total critical section duration is under 1.5 µs (24 clock cycles).
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-md space-y-1.5">
              <h3 className="font-semibold text-slate-900">Locked Filter Settings &amp; Clean vs. Degraded End Status</h3>
              <p>
                Filter-switching commands <code className="font-mono">&apos;3&apos;</code> and <code className="font-mono">&apos;4&apos;</code> are rejected with <code className="font-mono">#WARN:CMD_LOCKED</code> while a trial is active so one 2,000-sample recording can never combine data from two filter bandwidths. Furthermore, upon reaching 2,000 samples, firmware emits <code className="font-mono">#END:CLEAN</code> <strong>only</strong> if zero overruns, zero I²C errors, zero clips, and zero late reads occurred; otherwise it emits <code className="font-mono">#END:DEGRADED,status=POTENTIALLY_INVALID</code>.
              </p>
            </div>
          </div>

          <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-4 rounded-md overflow-x-auto leading-relaxed">
{`// CONCISE ARCHITECTURAL PSEUDOCODE (NO I2C OR SERIAL INSIDE ISR)
volatile uint32_t g_isr_t_us = 0;
volatile uint8_t  g_isr_pending = 0;

void onMpuDataReadyISR() { // Attached to INT0 (Pin D2), RISING edge
  g_isr_t_us = micros();
  if (g_isr_pending < 255) g_isr_pending++;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  digitalWrite(SDA, LOW); digitalWrite(SCL, LOW); // Disable AVR 5V internal pull-ups
  Wire.setClock(400000UL);
  Wire.setWireTimeout(3000, true);                // 3 ms bus lockup protection

  if (readReg(0x68, 0x75) != 0x68) {
    Serial.print("#ERR:WHO_AM_I\\n#END:ABORT\\n");
    while (1) {}
  }
  writeAndVerifyReg(0x68, 0x6B, 0x01); // PWR_MGMT_1: Wake, PLL X-Gyro
  delay(100);                          // Allow PLL & DLPF settling
  writeAndVerifyReg(0x68, 0x6A, 0x00); // USER_CTRL: FIFO disabled
  writeAndVerifyReg(0x68, 0x23, 0x00); // FIFO_EN: 0x00
  writeAndVerifyReg(0x68, 0x1A, ${activeDlpf.configHex}); // CONFIG: DLPF_CFG = ${activeDlpf.dlpfCfg} (${activeDlpf.accelBandwidthHz} Hz)
  writeAndVerifyReg(0x68, 0x19, ${activeDlpf.smplrtDivHex}); // SMPLRT_DIV = ${activeDlpf.smplrtDivFor200Hz} -> 200 Hz
  writeAndVerifyReg(0x68, 0x1C, 0x00); // ACCEL_CONFIG: +/- 2g
  writeAndVerifyReg(0x68, 0x37, 0x10); // INT_PIN_CFG: 50 us push-pull pulse, INT_RD_CLEAR
  writeAndVerifyReg(0x68, 0x38, 0x01); // INT_ENABLE: DATA_RDY_EN

  pinMode(2, INPUT);
  attachInterrupt(digitalPinToInterrupt(2), onMpuDataReadyISR, RISING);
  discardWarmupSamples(10);
  printTrialHeader();
}

void loop() {
  handleNonBlockingSerialCommand(); // Rejects '3'/'4' with #WARN:CMD_LOCKED while trial_active
  if (!trial_active) return;

  noInterrupts();
  uint8_t  pending = g_isr_pending;
  uint32_t sample_t_us = g_isr_t_us;
  g_isr_pending = 0;
  interrupts();

  if (pending == 0) return;
  if (pending > 1) {
    total_overruns += (pending - 1);
    Serial.print("#ERR:OVERRUN,missed="); Serial.print(pending - 1);
    Serial.print(",t_us="); Serial.print(sample_t_us); Serial.print('\\n');
  }

  int16_t raw_az = 0;
  if (!readAccelZBurst(0x68, &raw_az)) {
    total_i2c_errs++;
    Serial.print("#ERR:I2C,t_us="); Serial.print(sample_t_us); Serial.print('\\n');
    if ( ++consecutive_i2c_errs >= 5 ) abortTrial("I2C_LOCKUP");
    return;
  }
  consecutive_i2c_errs = 0;

  if (raw_az <= -32760 || raw_az >= 32760) {
    total_clips++;
    Serial.print("#WARN:CLIP,raw="); Serial.print(raw_az);
    Serial.print(",t_us="); Serial.print(sample_t_us); Serial.print('\\n');
  }

  float az_m_s2 = (float)raw_az * (9.80665f / 16384.0f);
  Serial.print(sample_t_us); Serial.print(',');
  Serial.print(az_m_s2, 4);  Serial.print('\\n');

  if (++samples_collected >= 2000) finishTrial(); // #END:CLEAN only if 0 faults; else #END:DEGRADED
}`}
          </pre>
        </section>

        {/* SECTION D */}
        <section id="sec-d" className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 scroll-mt-20">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION D</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Timestamp Semantics, Timing Budget, Memory & UART Throughput Calculations
            </h2>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-4 text-xs text-slate-700 space-y-2">
            <div className="font-semibold text-slate-900">
              Chosen Timestamp Semantics: <code className="font-mono">t_us</code> = Data-Ready Interrupt (<code className="font-mono">DATA_RDY_INT</code>) ISR Capture Time
            </div>
            <p>
              <strong>Why:</strong> Every sample traverses four physical stages: (1) Mechanical bridge acceleration → (2) Internal MEMS + DLPF group delay (<code className="font-mono">{activeDlpf.accelDelayMs} ms</code> for <code className="font-mono">DLPF_CFG={activeDlpf.dlpfCfg}</code>) → (3) <code className="font-mono">DATA_RDY_INT</code> assertion & ISR <code className="font-mono">micros()</code> capture (latency ~3.5 µs, resolution 4 µs) → (4) I²C read (~125 µs) → (5) UART framing (~1.74 ms) and Windows USB-serial driver arrival (1–16 ms variable OS scheduling jitter). Timestamping at Stage 3 inside the ISR removes all variable I²C, UART, and Windows USB bulk-transfer jitter, while Stage 2’s constant group delay shifts the entire waveform uniformly in time without altering inter-sample intervals <code className="font-mono">Δt</code> or FFT modal frequencies.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-sans font-semibold">
                  <th className="py-2.5 px-3">Parameter / Resource</th>
                  <th className="py-2.5 px-3">Derived Value</th>
                  <th className="py-2.5 px-3">Hardware Limit / Capacity</th>
                  <th className="py-2.5 px-3 font-sans">Engineering Derivation & Safety Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr>
                  <td className="py-2.5 px-3 font-sans font-medium">Sample Period (<code className="font-mono">T_s</code>)</td>
                  <td className="py-2.5 px-3">5,000 µs</td>
                  <td className="py-2.5 px-3">200.0 Hz</td>
                  <td className="py-2.5 px-3 font-sans">Available time budget per sample on the 16 MHz ATmega328P.</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans font-medium">Typical / Max CSV Line Length</td>
                  <td className="py-2.5 px-3">16 B typ / 20 B max</td>
                  <td className="py-2.5 px-3">64 B TX Ring Buffer</td>
                  <td className="py-2.5 px-3 font-sans">
                    Worst-case numeric row: <code className="font-mono">4294967295,-19.6133\n</code> = 10 + 1 + 8 + 1 = <strong>20 bytes</strong>. Typical row (<code className="font-mono">12500000,9.8124\n</code>) = <strong>16 bytes</strong>.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans font-medium">Serial Throughput @ 200 Hz</td>
                  <td className="py-2.5 px-3">3,200 – 4,000 B/s</td>
                  <td className="py-2.5 px-3">11,520 B/s (115200 8N1)</td>
                  <td className="py-2.5 px-3 font-sans">
                    8N1 framing uses 10 bits/byte (1 start + 8 data + 1 stop) = 86.81 µs/byte. 20 bytes take <strong>1,736 µs</strong> (34.7% of the 5,000 µs period), leaving <strong>65.3% UART idle bandwidth</strong>.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans font-medium">64-Byte Serial TX Buffer Risk</td>
                  <td className="py-2.5 px-3">Non-blocking (0 µs wait)</td>
                  <td className="py-2.5 px-3">64 Bytes</td>
                  <td className="py-2.5 px-3 font-sans">
                    Because 1,736 µs drain time is much less than the 5,000 µs inter-sample period, the 64-byte <code className="font-mono">HardwareSerial</code> TX ring buffer completely empties ~3.26 ms before the next sample arrives. Even if an <code className="font-mono">#ERR:OVERRUN</code> line (34 B) is prepended to a 20 B sample (54 B total &lt; 63 B usable), <code className="font-mono">Serial.print()</code> will not block.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans font-medium">I²C 2-Byte Burst Duration</td>
                  <td className="py-2.5 px-3">~125 µs @ 400 kHz</td>
                  <td className="py-2.5 px-3">~475 µs @ 100 kHz</td>
                  <td className="py-2.5 px-3 font-sans">
                    Transaction: START + SLA+W + ACK + REG(0x3F) + ACK + REP_START + SLA+R + ACK + MSB + ACK + LSB + NACK + STOP ≈ 47 bit-times + TWI software overhead. Even at 100 kHz (~475 µs), total CPU active time (ISR + I²C + float fmt) is &lt;850 µs out of 5,000 µs.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans font-medium">ATmega328P SRAM Footprint</td>
                  <td className="py-2.5 px-3">~250 Bytes (~12.2%)</td>
                  <td className="py-2.5 px-3">2,048 Bytes</td>
                  <td className="py-2.5 px-3 font-sans">
                    <code className="font-mono">HardwareSerial</code> RX/TX buffers (128 B) + <code className="font-mono">Wire</code> buffers (96 B) + state variables (~26 B). Zero <code className="font-mono">String</code> heap objects or sample arrays stored in RAM.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* SECTION E */}
        <section id="sec-e" className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 scroll-mt-20">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION E</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Exact Serial-Data Contract
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 leading-relaxed">
            <div className="space-y-2">
              <p>
                <strong>Numeric Row Format:</strong> Strictly two comma-separated numeric fields terminated by LF (<code className="font-mono">\n</code>, <code className="font-mono">0x0A</code>):
              </p>
              <div className="font-mono bg-slate-100 p-2.5 rounded border border-slate-200 text-slate-900">
                unsigned_timestamp_us,signed_acceleration_m_s2\n
              </div>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <code className="font-mono">unsigned_timestamp_us</code>: Base-10 integer (<code className="font-mono">0</code> to <code className="font-mono">4294967295</code>) representing the ISR <code className="font-mono">micros()</code> capture time.
                </li>
                <li>
                  <code className="font-mono">signed_acceleration_m_s2</code>: Fixed-point decimal in <code className="font-mono">m/s²</code> with <strong>4 decimal places</strong> (<code className="font-mono">Serial.print(az, 4)</code>), since 1 LSB at ±2g equals <code className="font-mono">0.00059855 m/s²</code>.
                </li>
                <li>
                  <strong>Clean vs. Degraded End Footer:</strong> Firmware emits <code className="font-mono">#END:CLEAN</code> <strong>only</strong> when all fault counters are zero (<code className="font-mono">overruns=0,i2c_errs=0,clips=0,late_reads=0</code>). If any overrun, I²C error, saturation clip, or late read occurred during the 2,000 samples, firmware emits <code className="font-mono">#END:DEGRADED,status=POTENTIALLY_INVALID,...</code> so compromised recordings are flagged immediately.
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <p>
                <strong>Out-of-Band Diagnostic Lines (Prefixed with <code className="font-mono">#</code>):</strong> Never insert extra columns into numeric rows. All configuration telemetry, warnings, and fault terminations are emitted on dedicated lines starting with <code className="font-mono">#</code>:
              </p>
              <pre className="font-mono text-[11px] bg-slate-900 text-slate-100 p-3 rounded overflow-x-auto">
{`#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=${activeDlpf.dlpfCfg},bw_hz=${activeDlpf.accelBandwidthHz},delay_ms=${activeDlpf.accelDelayMs},range_g=2
#COLUMNS:t_us,az_m_s2
#START:TRIAL,target_samples=2000
1145000,9.8124
1150000,9.8118
...
#END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0

// If overruns, I2C errors, clips, or late reads occurred:
#ERR:OVERRUN,missed=1,t_us=1160000
1160000,9.7982
#WARN:CLIP,raw=32767,t_us=1165000
1165000,19.6127
...
#END:DEGRADED,status=POTENTIALLY_INVALID,samples=2000,overruns=1,i2c_errs=0,clips=1,late_reads=0`}
              </pre>
            </div>
          </div>
        </section>

        {/* SECTION F */}
        <section id="sec-f" className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 scroll-mt-20">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
            <div>
              <span className="text-xs font-mono text-blue-600 font-semibold">SECTION F</span>
              <h2 className="text-xl font-bold text-slate-900 mt-0.5">
                Required Python Reader Updates & Decaying Ring-Down Signal Processing Analysis
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyPython}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
              >
                {copiedPython ? <Check className="w-3.5 h-3.5" /> : <FileCode className="w-3.5 h-3.5" />}
                <span>{copiedPython ? 'Copied Python Script' : 'Copy Python Analyzer'}</span>
              </button>
              <button
                onClick={() =>
                  triggerFileDownload(
                    'bridge_x_analyzer.py',
                    PYTHON_ANALYZER_SCRIPT,
                    'text/x-python;charset=utf-8;'
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download bridge_x_analyzer.py</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">1. Why Empirical Mean Removal in Python Beats Subtracting 9.81 on Arduino</h3>
              <p>
                The MPU6050 Z-axis factory zero-g offset tolerance is <code className="font-mono">±80 mg</code> (<code className="font-mono">±0.78 m/s²</code>), and any slight static bridge camber/tilt scales gravity by <code className="font-mono">g·cos(θ)</code>. If Arduino blindly subtracts <code className="font-mono">9.81</code>, a residual static offset of <code className="font-mono">0.1–0.8 m/s²</code> remains. When a window function multiplies a non-zero DC offset, its large 0 Hz main lobe and side lobes leak into low frequencies (2–4 Hz). Subtracting the exact sample mean <code className="font-mono">az - np.mean(az)</code> of the analysis window in Python eliminates the static baseline completely while keeping raw <code className="font-mono">+9.81 m/s²</code> available to verify vertical sensor orientation.
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">2. Sub-Window Selection for Decaying Vibrations (Avoiding 10s Hann Suppression)</h3>
              <p>
                Because the wooden bridge vibrates most strongly immediately after release and decays over <code className="font-mono">T_ring ≈ 2.0–4.0 s</code>, applying a symmetric Hann window across the entire 10-second recording (<code className="font-mono">w[0] = 0</code>, peaking at <code className="font-mono">t = 5.0 s</code>) severely attenuates the early high-SNR vibration while weighting late-trial sensor noise. Both <code className="font-mono">bridge_x_analyzer.py</code> and the interactive <strong>Trial Comparator</strong> therefore support selecting a focused <strong>Ring-Down Analysis Sub-Window</strong> (automatically detecting release onset and slicing <code className="font-mono">[t_onset, t_onset + 3.5 s]</code>, or a custom <code className="font-mono">[t_start, t_end]</code> window, plus <code className="font-mono">Hann</code>, <code className="font-mono">Tukey α=0.25</code>, or <code className="font-mono">Rectangular</code> tapers) zero-padded to 2,048 points.
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">3. Small Timing Jitter vs. Missing Samples & Effective Frequency Resolution</h3>
              <p>
                Random timing jitter <code className="font-mono">σ_t ≈ 4–20 µs</code> on a <code className="font-mono">5,000 µs</code> period (<code className="font-mono">&lt;0.4%</code> phase perturbation) has negligible effect on FFT peak frequencies below 30 Hz. By contrast, a missing sample shifts the phase of all subsequent samples, splitting the spectral peak. For a sub-window of duration <code className="font-mono">T_win = 3.5 s</code> (<code className="font-mono">N_sub = 700</code> samples), the true physical frequency resolution is <code className="font-mono">Δf = 1 / T_win ≈ 0.286 Hz</code>, while zero-padding to 2,048 points and parabolic interpolation locate the peak center cleanly.
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">4. Mode Tracking, 30 Hz DLPF Attenuation & Aliasing Reality</h3>
              <p>
                <strong>Mode Identity:</strong> Minor variations in plucking location or impulse sharpness can excite a 2nd bending or torsional mode (~22 Hz) more strongly than the 1st bending mode (~9 Hz) in one trial. Python must search for peaks within a <strong>defined modal frequency band</strong> <code className="font-mono">[f_min, f_max]</code> rather than blindly picking <code className="font-mono">argmax(FFT)</code> over 2–30 Hz.<br />
                <strong>30 Hz Attenuation & Aliasing:</strong> With <code className="font-mono">DLPF_CFG = 4</code> (21 Hz), signals at 30 Hz are attenuated by ~4.8 dB (switchable between trials to <code className="font-mono">DLPF_CFG = 3</code>, 44 Hz, where 30 Hz loss is only 1.66 dB). Excitations must be gentle finger releases (never hard impacts).
              </p>
            </div>
          </div>
        </section>

        {/* SECTION G */}
        <section id="sec-g" className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 scroll-mt-20">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION G</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Verification Plan, Provisional Commissioning Criteria & Failure Responses
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3">Verification Stage</th>
                  <th className="py-2.5 px-3">Provisional Commissioning Criterion</th>
                  <th className="py-2.5 px-3">Action / Failure Response</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr>
                  <td className="py-2.5 px-3 font-medium">1. Sensor ID & Stationary Baseline</td>
                  <td className="py-2.5 px-3 font-mono">WHO_AM_I == 0x68; stationary mean az ∈ [+9.0, +10.6] m/s²; RMS noise &lt; 0.08 m/s²</td>
                  <td className="py-2.5 px-3">If <code className="font-mono">WHO_AM_I != 0x68</code>, check AD0 pin and clone chip ID; if RMS noise is high, check mechanical mounting rigidity at midspan.</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">2. Orientation & Sign Check</td>
                  <td className="py-2.5 px-3 font-mono">+Z facing up reads ~+9.81 m/s²; inverted reads ~-9.81 m/s²</td>
                  <td className="py-2.5 px-3">Verify PCB silkscreen Z arrow is vertical and perpendicular to bridge deck; re-clamp rigidly if tilted.</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">3. Actual Sample Rate, Jitter & Clean Footer</td>
                  <td className="py-2.5 px-3 font-mono">Median Δt ∈ [4950, 5050] µs (f_s = 200 ± 2 Hz); P99 jitter ≤ 250 µs; #END:CLEAN footer</td>
                  <td className="py-2.5 px-3">Reject or repeat any trial ending in <code className="font-mono">#END:DEGRADED,status=POTENTIALLY_INVALID</code>.</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">4. Gentle Excitation & Saturation</td>
                  <td className="py-2.5 px-3 font-mono">Peak |az| &lt; 19.20 m/s² (zero #WARN:CLIP events)</td>
                  <td className="py-2.5 px-3">Use controlled midspan static deflection-and-release (e.g., 2 mm downward pull or hanging mass thread cut) instead of sharp impacts. If gentle release still clips ±2g, switch <code className="font-mono">ACCEL_CONFIG</code> to ±4g (<code className="font-mono">0x08</code>, 8192 LSB/g).</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">5. Synthetic Python Signal Test</td>
                  <td className="py-2.5 px-3 font-mono">Recover known synthetic 12.40 Hz & 24.80 Hz peaks within ±0.05 Hz</td>
                  <td className="py-2.5 px-3">Run strictly on synthetic CSV tagged <code className="font-mono">#PROVENANCE:SYNTHETIC_SIMULATION</code> to verify Python FFT scaling before analyzing physical trials.</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">6. Repeated Intact / Disengaged / Restored Trials</td>
                  <td className="py-2.5 px-3 font-mono">≥ 3 valid trials per state; |f_restored - f_secured| ≤ 2·s_f</td>
                  <td className="py-2.5 px-3">
                    <strong>If brace removal produces no repeatable frequency change (<code className="font-mono">|Δf| ≤ max(Δf_bin, 2·s_f)</code>):</strong> Do NOT fabricate a shift or over-stress the bridge to failure. Document this honestly as an empirical finding: (a) check whether the brace is located at a zero-strain nodal point of the fundamental vertical bending mode, (b) check whether joint friction/gusset stiffness dominates over the single brace at low amplitude, (c) add a known reversible non-destructive midspan concentrated mass (e.g., 100 g or 200 g) to verify that the system resolves a predictable <code className="font-mono">f ∝ 1/√(m_eff + Δm)</code> shift, and (d) inspect higher modes (up to 30–44 Hz using <code className="font-mono">DLPF_CFG = 3</code>).
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* SECTION H */}
        <section id="sec-h" className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 scroll-mt-20">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-mono text-blue-600 font-semibold">SECTION H</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Verified GY-521 Power, I²C Voltage Compatibility & Pre-Power Hardware Checks
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">1. Verify Electronics Before Powering (GY-521 Power Supply)</h3>
              <p>
                Before applying USB or 5 V power, visually inspect your GY-521 breakout for the onboard 5-pin SOT-23 3.3 V low-dropout regulator (typically 4B2X / MIC5205-3.3, dropout ~150 mV) and verify with a multimeter (unpowered) that the onboard pull-up resistors connect to the 3.3 V regulator output rail, not to <code className="font-mono">VCC</code>. When the onboard LDO is confirmed present, <code className="font-mono">GY-521 VCC</code> is powered from Arduino Uno <code className="font-mono">5V</code> so the LDO outputs a clean <code className="font-mono">3.30 V</code> to the MPU6050 <code className="font-mono">VDD</code> and <code className="font-mono">VLOGIC</code> pins (operational max <code className="font-mono">3.46 V</code>; I²C pins rated to <code className="font-mono">VLOGIC + 0.5 V = 3.80 V</code>).
              </p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2">
              <h3 className="font-semibold text-slate-900">2. Keep the Bidirectional I²C Level Shifter Recommendation</h3>
              <p>
                • <strong>SDA / SCL (Uno A4 / A5):</strong> The GY-521 pulls <code className="font-mono">SDA</code> and <code className="font-mono">SCL</code> up to its onboard <code className="font-mono">3.3 V</code> rail via <code className="font-mono">4.7 kΩ</code> resistors, whereas Arduino’s <code className="font-mono">Wire.begin()</code> activates ATmega328P internal <code className="font-mono">20–50 kΩ</code> pull-ups to <code className="font-mono">5.0 V</code>, and the ATmega328P datasheet (Table 29-14) specifies a minimum high-level TWI input threshold of <code className="font-mono">V_IH(min) = 0.7 × V_CC = 3.50 V</code>.<br />
                • <strong>Recommended Practice:</strong> Keep the <strong>bidirectional MOSFET I²C level shifter</strong> (<code className="font-mono">LV = 3.3V</code>, <code className="font-mono">HV = 5V</code>) in place between Uno <code className="font-mono">A4/A5</code> and GY-521 <code className="font-mono">SDA/SCL</code>, especially until your exact GY-521 breakout’s voltage requirements have been verified on the bench.<br />
                • <strong>INT Pin (GY-521 INT → Uno D2):</strong> Unidirectional 3.3 V push-pull output from MPU6050 into Uno digital pin <code className="font-mono">D2</code> (<code className="font-mono">pinMode(2, INPUT)</code>). For standard GPIO pin <code className="font-mono">D2</code>, <code className="font-mono">V_IH(min) = 0.6 × V_CC = 3.00 V</code>, so the <code className="font-mono">3.30 V</code> pulse is within spec directly.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION I */}
        <section id="sec-i" className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 scroll-mt-20">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
            <div>
              <span className="text-xs font-mono text-blue-600 font-semibold">SECTION I</span>
              <h2 className="text-xl font-bold text-slate-900 mt-0.5">
                SPECIFICATION TO PASTE INTO GEMINI (Self-Contained Implementation Blueprint)
              </h2>
            </div>
            <button
              onClick={handleCopyGeminiSpec}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
            >
              {copiedSpec ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedSpec ? 'Copied to Clipboard!' : 'Copy Specification for Gemini'}</span>
            </button>
          </div>

          <p className="text-xs text-slate-600">
            This specification automatically reflects your selected MPU6050 filter (<code className="font-mono">DLPF_CFG = {activeDlpf.dlpfCfg}</code>, <code className="font-mono">{activeDlpf.accelBandwidthHz} Hz</code> bandwidth) and resolves all architectural, register, ISR, atomic access, and serial formatting decisions.
          </p>

          <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-5 rounded-md overflow-x-auto leading-relaxed select-all">
            {geminiSpecText}
          </pre>
        </section>
      </div>
    </div>
  );
};
