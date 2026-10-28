import React, { useState, useMemo } from 'react';
import {
  ARDUINO_FIRMWARE_SKETCH,
} from '../data/mpu6050Data';
import {
  runBridgeXSelfTests,
  triggerFileDownload,
} from '../utils/dspAndValidation';
import {
  Download,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  FileText,
  FileCode,
} from 'lucide-react';

export const README_SETUP_GUIDE_MARKDOWN = `# BRIDGE-X — Hardware Setup, Arduino Nano Firmware & Experimental Protocol Guide

**Project:** IB Physics Collaborative Sciences Project (\`BRIDGE-X\`)  
**Specimen:** Miniature Wooden Truss Bridge (\`60 × 12 × 12 cm\`), MPU-6050 Accelerometer Mounted Rigidly at Midspan (\`+Z\` Vertical)  
**Target Microcontroller:** **Arduino Nano (\`ATmega328P\`, 16 MHz, 2 KB SRAM)** *(also 100% compatible with Arduino Uno R3)*  
**Acquisition Architecture:** 200.0 Hz Hardware Data-Ready Interrupt (\`INT -> Nano Pin D2\`), \`±2 g\` Range, Initial \`DLPF_CFG = 4\` (\`21 Hz\` Bandwidth), \`115200\` Baud Serial Stream (\`t_us,az_m_s2\`), \`2,000\` Samples per Trial (\`10.00 s\`)

---

## 1. Pre-Power Electronics Verification & Exact Arduino Nano Wiring Table

### Bare MPU-6050 IC vs. GY-521 Breakout Board Distinction
Never assume every board sold as an "MPU-6050" or "GY-521" tolerates 5 V power or 5 V logic without checking the physical board first:

1. **Bare InvenSense MPU-6050 Chip (\`QFN-24\` IC):**
   - Strictly a **3.3 V device** (\`VDD = 2.375 V – 3.46 V\`, absolute maximum logic pin rating \`VLOGIC + 0.5 V ≈ 3.80 V\`).
   - Applying 5.0 V directly to a bare MPU-6050 pin without regulation or level shifting will permanently damage the sensor.
2. **Standard GY-521 Breakout Module:**
   - Includes an onboard **5-pin SOT-23 3.3 V Low-Dropout (LDO) voltage regulator** (often marked \`KB33\`, \`4B2X\`, or \`LG33\`) connected to the \`VCC\` header pin, plus onboard \`4.7 kΩ\` I²C pull-up resistors connected to the internal \`3.3 V\` rail.
   - **Pre-Power Multimeter Check (Do This Before Connecting USB Power):**
     1. Visually confirm the 5-pin SOT-23 regulator chip is present next to the \`VCC\` pin.
     2. With the board **unpowered**, set your multimeter to resistance/continuity mode and verify that the pull-up resistors on \`SDA\` and \`SCL\` connect to the output of the \`3.3 V\` regulator—**not** directly to the \`VCC\` input pin.
3. **Why a Bidirectional I²C Level Shifter Is Recommended (and Nano \`3V3\` Pin Note):**
   - The 5.0 V ATmega328P hardware Two-Wire Interface (\`A4/A5\` on the Nano) specifies a minimum high-level input threshold of $V_{IH(\\min)} = 0.7 \\times V_{CC} = 3.50\\text{ V}$, whereas a 3.3 V pull-up rail sits at \`3.30 V\` (marginal by 0.20 V) and exposes the MPU-6050 to 5 V if internal AVR pull-ups are ever active.
   - Using an inexpensive **4-channel bidirectional MOSFET I²C level shifter** (BSS138 type, ~₹40–₹80) with \`HV = 5V\` and \`LV = 3V3\` ensures full 5.0 V logic swing on the Arduino Nano side and strict 3.3 V logic protection on the MPU-6050 side.
   - **Arduino Nano \`3V3\` Rail Note:** On the Arduino Nano, the \`3V3\` output comes from the onboard USB-serial bridge (\`FT232RL\` or \`CH340G\`, ~30–50 mA max). Powering \`GY-521 VCC\` from the Nano **\`5V\`** pin (using the GY-521's onboard 3.3 V LDO) while connecting the Nano **\`3V3\`** pin to the level shifter **\`LV\`** reference pin draws < 1 mA from \`3V3\`.

### Exact Conditional Wiring Table (Arduino Nano ATmega328P)

| Signal | Arduino Nano (\`ATmega328P\`) Pin | Option A: GY-521 + Bidirectional I²C Level Shifter (Recommended Default) | Option B: Verified GY-521 Direct (ONLY After Multimeter Check Confirming 3.3 V Pull-Ups) | Option C: Bare 3.3 V Breakout (No Onboard 3.3 V LDO Regulator) |
| :--- | :--- | :--- | :--- | :--- |
| **Power (\`VCC\`)** | \`5V\` / \`3V3\` | Connect Nano \`5V\` → GY-521 \`VCC\` *(feeds onboard 3.3 V LDO)*; connect Nano \`5V\` → Shifter \`HV\` and Nano \`3V3\` → Shifter \`LV\` | Connect Nano \`5V\` → GY-521 \`VCC\` *(feeds onboard 3.3 V LDO; feeding 3.3 V to VCC causes LDO dropout)* | Connect Nano \`3V3\` → Breakout \`VCC/VDD\` *(NEVER connect 5 V)* + Connect Level Shifter \`HV=5V\`, \`LV=3V3\` |
| **Ground (\`GND\`)** | \`GND\` | Connect Nano \`GND\` → Shifter \`GND\` → GY-521 \`GND\` (common ground mandatory) | Connect Nano \`GND\` → GY-521 \`GND\` | Connect Nano \`GND\` → Shifter \`GND\` → Breakout \`GND\` |
| **I²C Data (\`SDA\`)** | \`A4\` | Nano \`A4\` → Shifter \`HV1\`; Shifter \`LV1\` → GY-521 \`SDA\` | Nano \`A4\` → GY-521 \`SDA\` *(firmware disables internal 5 V pull-up immediately after \`Wire.begin()\`)* | Via Level Shifter \`HV1 ↔ LV1\` only |
| **I²C Clock (\`SCL\`)** | \`A5\` | Nano \`A5\` → Shifter \`HV2\`; Shifter \`LV2\` → GY-521 \`SCL\` | Nano \`A5\` → GY-521 \`SCL\` *(firmware disables internal 5 V pull-up immediately after \`Wire.begin()\`)* | Via Level Shifter \`HV2 ↔ LV2\` only |
| **Data-Ready Interrupt (\`INT\`)** | \`D2\` (\`INT0\`) | GY-521 \`INT\` → Nano \`D2\` *(or via Shifter \`LV3 → HV3\`; \`INT\` is configured as a 3.3 V active-high push-pull output, which exceeds \`D2\` threshold $0.6 V_{CC} = 3.0\\text{ V}$)* | GY-521 \`INT\` → Nano \`D2\` *(configured as \`INPUT\`, never \`INPUT_PULLUP\`)* | Breakout \`INT\` → Nano \`D2\` (or via Shifter \`LV3 → HV3\`) |
| **I²C Address (\`AD0\`)** | \`GND\` | Tie \`AD0\` to \`GND\` (or leave unconnected if onboard pull-down is verified) for I²C address \`0x68\` | Tie \`AD0\` to \`GND\` for \`0x68\` | Tie \`AD0\` to \`GND\` for \`0x68\` |

---

## 2. Installing Arduino IDE on Windows & Uploading \`bridge_x_firmware.ino\` to Arduino Nano

1. **Install Arduino IDE:** Download and install **Arduino IDE 2.x for Windows** from [https://www.arduino.cc/en/software](https://www.arduino.cc/en/software) (and install the \`CH340\` driver if your Nano uses a CH340G USB chip).
2. **Open \`bridge_x_firmware.ino\`:** Click **Download bridge_x_firmware.ino** in the top navigation bar and open the file in Arduino IDE (accept the prompt to place it inside a \`bridge_x_firmware\` folder).
3. **Select Arduino Nano, Processor & COM Port:**
   - Go to **Tools → Board → Arduino AVR Boards → Arduino Nano**.
   - Go to **Tools → Processor** and select **\`ATmega328P\`** (or **\`ATmega328P (Old Bootloader)\`** if upload times out with \`stk500_getsync()\` on a clone Nano).
   - Go to **Tools → Port** and select your Nano's \`COMx\` port.
4. **Compile & Upload:** Click **Verify (\`✓\`)** and then **Upload (\`→\`)**. Wait for \`Done uploading.\`

---

## 3. Verifying Sensor Detection, Stationary Gravity (\`9.81 m/s²\`), and 10-Second Trials

1. **Verify Sensor Detection:** Open **Tools → Serial Monitor** at **\`115200 baud\`**. Confirm the startup header prints \`#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4...\` with no \`#ERR:WHO_AM_I\` lines.
2. **Verify Stationary Gravity (\`+9.81 m/s²\`):** With the bridge resting flat and the MPU-6050 \`+Z\` axis vertical upward, verify \`az_m_s2\` reads steady near \`+9.81 m/s²\` (within \`+9.00\` to \`+10.60 m/s²\`).
3. **Collect a 10-Second Trial:** Close the Arduino Serial Monitor, open the **Live Monitor** tab in BRIDGE-X, click **Connect Arduino Nano (Web Serial 115200)**, click **Send 'R' (Start Trial)**, gently deflect midspan by \`2–3 mm\` and release. After 2,000 samples (10.0 seconds), verify \`#END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0\` is logged.
4. **Compare Brace Secured, Disengaged, and Restored:** Record 3–5 clean trials in each of the three structural states and inspect the overlaid FFT spectra, frequency-shift percentage, and baseline variation indicator in the **FFT & Comparison** tab.
`;

export const SetupGuideView: React.FC = () => {
  const [copiedReadme, setCopiedReadme] = useState(false);
  const selfTests = useMemo(() => runBridgeXSelfTests(), []);

  const handleCopyReadme = async () => {
    await navigator.clipboard.writeText(README_SETUP_GUIDE_MARKDOWN);
    setCopiedReadme(true);
    setTimeout(() => setCopiedReadme(false), 2000);
  };

  const handleDownloadReadme = () => {
    triggerFileDownload(
      'README.md',
      README_SETUP_GUIDE_MARKDOWN,
      'text/markdown;charset=utf-8;'
    );
  };

  const handleDownloadFirmware = () => {
    triggerFileDownload(
      'bridge_x_firmware.ino',
      ARDUINO_FIRMWARE_SKETCH,
      'text/plain;charset=utf-8;'
    );
  };

  return (
    <div className="space-y-8">
      {/* Header & Download Actions */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500">
              Deliverable 3 · Beginner-Friendly Arduino Nano Hardware, Windows Arduino IDE &amp; Experimental Setup Guide
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              BRIDGE-X Arduino Nano Setup Handbook (<code className="font-mono">README.md</code>) &amp; Verification Status
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/BRIDGE_X_GitHub_Repository.zip"
              download="BRIDGE_X_GitHub_Repository.zip"
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Full GitHub Repo (.zip)</span>
            </a>
            <button
              onClick={handleDownloadReadme}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download README.md</span>
            </button>
            <button
              onClick={handleCopyReadme}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              {copiedReadme ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedReadme ? 'Copied README.md' : 'Copy README.md'}</span>
            </button>
            <button
              onClick={handleDownloadFirmware}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Download bridge_x_firmware.ino</span>
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-700 leading-relaxed">
          Follow the step-by-step instructions below to verify your MPU-6050 breakout voltage compatibility with a multimeter, wire the <strong>Arduino Nano (ATmega328P)</strong>, install Arduino IDE on Windows, select <strong>Board: Arduino Nano</strong> + <strong>Processor: ATmega328P / ATmega328P (Old Bootloader)</strong>, upload <code className="font-mono">bridge_x_firmware.ino</code>, verify stationary gravity near <code className="font-mono">+9.81 m/s²</code>, and record 10-second free-vibration trials across the three bridge conditions.
        </p>
      </section>

      {/* 1. Conditional Wiring Table & Bare IC vs. GY-521 Distinction */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3">
          <div className="text-xs font-mono text-blue-600 font-semibold">
            1. PRE-POWER ELECTRONICS VERIFICATION &amp; ARDUINO NANO CONDITIONAL WIRING TABLE
          </div>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">
            Bare MPU-6050 IC (3.3 V) vs. GY-521 Breakout (Onboard LDO) &amp; I²C Level Shifter
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-700 leading-relaxed">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded space-y-1.5">
            <div className="font-semibold text-slate-900">
              Bare MPU-6050 Chip (QFN-24 Silicon)
            </div>
            <p>
              The bare InvenSense MPU-6050 IC is strictly a <strong>3.3 V device</strong> (<code className="font-mono">VDD = 2.375–3.46 V</code>; absolute maximum logic voltage on <code className="font-mono">SDA</code>, <code className="font-mono">SCL</code>, and <code className="font-mono">INT</code> is <code className="font-mono">VLOGIC + 0.5 V ≈ 3.80 V</code>). Never connect 5 V directly to a bare 3.3 V breakout that lacks an onboard voltage regulator.
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded space-y-1.5">
            <div className="font-semibold text-slate-900">
              Standard GY-521 Breakout Module
            </div>
            <p>
              A standard GY-521 includes a 5-pin SOT-23 <strong>3.3 V LDO regulator</strong> on <code className="font-mono">VCC</code> and <code className="font-mono">4.7 kΩ</code> pull-up resistors to the 3.3 V rail. <strong>Verify before powering:</strong> inspect the regulator chip and use an unpowered multimeter to confirm <code className="font-mono">SDA/SCL</code> pull-ups connect to the 3.3 V LDO output, not <code className="font-mono">VCC</code>.
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded space-y-1.5">
            <div className="font-semibold text-slate-900">
              Nano 3V3 Pin &amp; Bidirectional I²C Level Shifter
            </div>
            <p>
              Arduino Nano <code className="font-mono">A4/A5</code> TWI inputs require <code className="font-mono">V_IH(min) = 0.7 × 5.0 V = 3.50 V</code>, while a 3.3 V pull-up rail is only <code className="font-mono">3.30 V</code>. Feed GY-521 <code className="font-mono">VCC</code> from Nano <code className="font-mono">5V</code> (using the GY-521 LDO) and use Nano <code className="font-mono">3V3</code> as the low-current reference for Shifter <code className="font-mono">LV</code> (<code className="font-mono">HV = 5V</code>).
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                <th className="py-2.5 px-3">Signal</th>
                <th className="py-2.5 px-3">Arduino Nano Pin</th>
                <th className="py-2.5 px-3">Option A: GY-521 + Bidirectional I²C Level Shifter (Recommended)</th>
                <th className="py-2.5 px-3">Option B: Verified GY-521 Direct (After Multimeter Check)</th>
                <th className="py-2.5 px-3">Option C: Bare 3.3 V Breakout (No Onboard LDO)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">VCC</td>
                <td className="py-2.5 px-3 font-mono">5V / 3V3</td>
                <td className="py-2.5 px-3">
                  Nano <code className="font-mono">5V</code> → GY-521 <code className="font-mono">VCC</code> (feeds LDO) + Shifter <code className="font-mono">HV</code>; Nano <code className="font-mono">3V3</code> → Shifter <code className="font-mono">LV</code>
                </td>
                <td className="py-2.5 px-3">
                  Nano <code className="font-mono">5V</code> → GY-521 <code className="font-mono">VCC</code> (only after verifying onboard 3.3 V LDO)
                </td>
                <td className="py-2.5 px-3">
                  Nano <code className="font-mono">3V3</code> → Breakout <code className="font-mono">VCC</code> (NEVER 5 V) + Shifter required
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">GND</td>
                <td className="py-2.5 px-3 font-mono">GND</td>
                <td className="py-2.5 px-3">Common ground across Nano <code className="font-mono">GND</code>, Shifter <code className="font-mono">GND</code>, and GY-521 <code className="font-mono">GND</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">GND</code> → GY-521 <code className="font-mono">GND</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">GND</code> → Shifter <code className="font-mono">GND</code> → Breakout <code className="font-mono">GND</code></td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">SDA</td>
                <td className="py-2.5 px-3 font-mono">A4</td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A4</code> → Shifter <code className="font-mono">HV1</code>; Shifter <code className="font-mono">LV1</code> → GY-521 <code className="font-mono">SDA</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A4</code> → GY-521 <code className="font-mono">SDA</code> (internal 5 V pull-up disabled in setup)</td>
                <td className="py-2.5 px-3">Via Level Shifter <code className="font-mono">HV1 ↔ LV1</code> only</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">SCL</td>
                <td className="py-2.5 px-3 font-mono">A5</td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A5</code> → Shifter <code className="font-mono">HV2</code>; Shifter <code className="font-mono">LV2</code> → GY-521 <code className="font-mono">SCL</code></td>
                <td className="py-2.5 px-3">Nano <code className="font-mono">A5</code> → GY-521 <code className="font-mono">SCL</code> (internal 5 V pull-up disabled in setup)</td>
                <td className="py-2.5 px-3">Via Level Shifter <code className="font-mono">HV2 ↔ LV2</code> only</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">INT</td>
                <td className="py-2.5 px-3 font-mono">D2 (INT0)</td>
                <td className="py-2.5 px-3">GY-521 <code className="font-mono">INT</code> → Nano <code className="font-mono">D2</code> (3.3 V push-pull output exceeds D2 3.0 V threshold)</td>
                <td className="py-2.5 px-3">GY-521 <code className="font-mono">INT</code> → Nano <code className="font-mono">D2</code> (<code className="font-mono">pinMode(2, INPUT)</code>)</td>
                <td className="py-2.5 px-3">Breakout <code className="font-mono">INT</code> → Nano <code className="font-mono">D2</code></td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">AD0</td>
                <td className="py-2.5 px-3 font-mono">GND</td>
                <td className="py-2.5 px-3">Tie to <code className="font-mono">GND</code> (or onboard pull-down) for I²C address <code className="font-mono">0x68</code></td>
                <td className="py-2.5 px-3">Tie to <code className="font-mono">GND</code> (<code className="font-mono">0x68</code>)</td>
                <td className="py-2.5 px-3">Tie to <code className="font-mono">GND</code> (<code className="font-mono">0x68</code>)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Step-by-Step Windows Setup & Experimental Workflow */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <div className="text-xs font-mono text-blue-600 font-semibold">
              2. WINDOWS ARDUINO IDE &amp; ARDUINO NANO UPLOAD (STEPS 1–6)
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Installing Arduino IDE, Selecting Nano Processor &amp; Checking Gravity
            </h2>
          </div>

          <ol className="space-y-3 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
            <li>
              <strong className="text-slate-900">Install Arduino IDE on Windows:</strong> Download and run the Windows installer for <strong>Arduino IDE 2.x</strong> from <code className="font-mono">arduino.cc/en/software</code>, accepting USB/CH340 driver prompts.
            </li>
            <li>
              <strong className="text-slate-900">Open <code className="font-mono">bridge_x_firmware.ino</code>:</strong> Click <strong>Download Arduino Firmware</strong> at the top of this app and open the sketch in Arduino IDE. No external libraries need to be installed—only built-in <code className="font-mono">&lt;Arduino.h&gt;</code> and <code className="font-mono">&lt;Wire.h&gt;</code> are used.
            </li>
            <li>
              <strong className="text-slate-900">Select Arduino Nano, Processor &amp; COM Port:</strong> Under <strong>Tools → Board → Arduino AVR Boards</strong>, select <strong>Arduino Nano</strong>. Under <strong>Tools → Processor</strong>, select <code className="font-mono">ATmega328P</code> (or <code className="font-mono">ATmega328P (Old Bootloader)</code> if using a CH340G clone Nano that gives a sync timeout). Under <strong>Tools → Port</strong>, select your Nano&apos;s <code className="font-mono">COMx</code> port.
            </li>
            <li>
              <strong className="text-slate-900">Compile &amp; Upload:</strong> Click <strong>Verify</strong> and then <strong>Upload</strong>. Wait for <code className="font-mono">Done uploading.</code>
            </li>
            <li>
              <strong className="text-slate-900">Verify Sensor Detection (<code className="font-mono">0x68</code>):</strong> Open <strong>Tools → Serial Monitor</strong> at <code className="font-mono">115200 baud</code>. Confirm you see <code className="font-mono">#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4...</code> and <code className="font-mono">#START:TRIAL,target_samples=2000</code>.
            </li>
            <li>
              <strong className="text-slate-900">Verify Stationary Acceleration Near <code className="font-mono">+9.81 m/s²</code>:</strong> With the sensor mounted rigidly at midspan (<code className="font-mono">+Z</code> vertical upward) and the bridge at rest, confirm <code className="font-mono">az_m_s2</code> reads near <code className="font-mono">+9.81 m/s²</code> (<code className="font-mono">+9.00</code> to <code className="font-mono">+10.60 m/s²</code>). Close the Arduino Serial Monitor before connecting the web app.
            </li>
          </ol>
        </section>

        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <div className="text-xs font-mono text-blue-600 font-semibold">
              3. COLLECTING &amp; COMPARING BRIDGE TRIALS (STEPS 7–10)
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              10-Second Recording &amp; Three-Condition Experimental Protocol
            </h2>
          </div>

          <ol start={7} className="space-y-3 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
            <li>
              <strong className="text-slate-900">Connect Nano to BRIDGE-X Web App:</strong> Open the <strong>Live Monitor</strong> tab in Chrome or Edge (open in a standalone browser tab if embedded preview blocks USB). Click <strong>Connect Arduino Nano (Web Serial 115200)</strong> and choose your Nano&apos;s COM port.
            </li>
            <li>
              <strong className="text-slate-900">Collect a 10-Second Secured-Brace Trial:</strong> Select <strong>Brace Secured</strong>, click <strong>Send &apos;R&apos; (Start Trial)</strong>, gently press midspan downward by <code className="font-mono">2–3 mm</code> and release cleanly. Wait 10.0 seconds for 2,000 samples and <code className="font-mono">#END:CLEAN</code>. Repeat 3–5 times.
            </li>
            <li>
              <strong className="text-slate-900">Repeat with Brace Disengaged &amp; Brace Restored:</strong> Unfasten the removable diagonal brace (retaining permanent members), select <strong>Brace Disengaged</strong>, and record 3–5 clean trials. Then re-secure the diagonal brace, select <strong>Brace Restored</strong>, and record 3–5 control trials.
            </li>
            <li>
              <strong className="text-slate-900">Analyse Ring-Down FFT &amp; Export Report:</strong> Open <strong>FFT &amp; Comparison</strong>, verify the <strong>Auto Ring-Down Sub-Window (3.5 s)</strong> isolates the decaying oscillation after release, inspect the overlaid FFT spectra and percentage frequency shift <code className="font-mono">Δf %</code>, and click <strong>Download IB Physics Summary (.md)</strong>.
            </li>
          </ol>
        </section>
      </div>

      {/* 3. Automated Self-Verification & Honest Toolchain Audit */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-mono text-slate-500">
              Section 5 Verification Audit · Automated Parser, Rollover, Overrun &amp; FFT Self-Tests
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Implementation &amp; Verification Audit
            </h2>
          </div>
          <span className="text-xs font-mono font-semibold text-emerald-700">
            {selfTests.filter((t) => t.passed).length} / {selfTests.length} Automated Software Checks Passed
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {selfTests.map((t, idx) => (
            <div
              key={idx}
              className="p-3.5 bg-slate-50 border border-slate-200 rounded flex items-start gap-3 text-xs"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-slate-900">{t.name}</div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  {t.detail}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded text-xs text-amber-950 space-y-1.5 leading-relaxed">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Honest Verification Statement (Arduino AVR Toolchain &amp; Physical Hardware Status)
            </span>
          </div>
          <p>
            <strong>Verified in This Environment:</strong> The React/TypeScript production build (<code className="font-mono">npm run build</code>), CSV parser validation, 32-bit <code className="font-mono">micros()</code> rollover unwrapping, <code className="font-mono">#END:CLEAN</code> vs. <code className="font-mono">#END:DEGRADED</code> fault classification, and Cooley-Tukey Hann/Tukey ring-down FFT frequency recovery against known synthetic frequencies have been executed and verified.
          </p>
          <p>
            <strong>Unverified in Cloud Container (Requires Local Arduino IDE &amp; Physical Bench):</strong> Because an Arduino AVR compiler toolchain (<code className="font-mono">arduino-cli</code> / <code className="font-mono">avr-g++</code>) and physical USB hardware are not installed in this cloud container, compilation of <code className="font-mono">bridge_x_firmware.ino</code> for <code className="font-mono">ATmega328P</code> and physical bridge testing are marked as <strong>unverified in-container</strong> and must be performed on your Windows laptop using Arduino IDE and the bench checklist above.
          </p>
        </div>
      </section>
    </div>
  );
};
