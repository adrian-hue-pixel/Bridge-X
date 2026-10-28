import React, { useState } from 'react';
import { MPU6050_DLPF_OPTIONS } from '../data/mpu6050Data';
import { getDlpfDb } from '../utils/dspAndValidation';

interface TimingAndHardwareViewProps {
  selectedDlpfCfg: number;
  onSelectDlpfCfg: (cfg: number) => void;
}

export const TimingAndHardwareView: React.FC<TimingAndHardwareViewProps> = ({
  selectedDlpfCfg,
  onSelectDlpfCfg,
}) => {
  // 1. GY-521 Power & I2C Logic-Level Verifier State
  const [vccSource, setVccSource] = useState<'5V' | '3.3V'>('5V');
  const [gyPullupKOhm, setGyPullupKOhm] = useState<number>(4.7);
  const [useLevelShifter, setUseLevelShifter] = useState<boolean>(true);
  const [disableAvrPullups, setDisableAvrPullups] = useState<boolean>(true);
  const [unoVccVolts, setUnoVccVolts] = useState<number>(5.0);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({
    dmmPullup: true,
    ldoCheck: true,
    intPinCheck: true,
  });

  // 2. Timing, I2C & UART Budget State
  const [sampleRateHz, setSampleRateHz] = useState<number>(200);
  const [i2cClockKhz, setI2cClockKhz] = useState<100 | 400>(400);
  const [baudRate, setBaudRate] = useState<57600 | 115200 | 230400>(115200);
  const [decimalPlaces, setDecimalPlaces] = useState<number>(4);
  const [includeOverrunDiag, setIncludeOverrunDiag] = useState<boolean>(false);

  // Derived GY-521 Electrical Math
  // Onboard MIC5205/4B2X 3.3V LDO has ~0.15V dropout when fed 3.3V -> ~3.15V; when fed 5V -> 3.30V
  const vLdo = vccSource === '5V' ? 3.3 : 3.15;
  const rAvrPullupKOhm = 35.0; // Nominal ATmega328P internal pull-up (20k - 50k)

  // Voltage on MPU6050 SDA/SCL side and Uno A4/A5 side
  let vMpuSda = vLdo;
  let vUnoA4 = unoVccVolts;

  if (!useLevelShifter) {
    if (disableAvrPullups) {
      vMpuSda = vLdo;
      vUnoA4 = vLdo;
    } else {
      // Voltage divider between GY-521 pull-up (to vLdo) and AVR internal 35k pull-up (to unoVccVolts)
      const vThev =
        (vLdo / gyPullupKOhm + unoVccVolts / rAvrPullupKOhm) /
        (1 / gyPullupKOhm + 1 / rAvrPullupKOhm);
      vMpuSda = vThev;
      vUnoA4 = vThev;
    }
  }

  const mpuMaxSafeV = vLdo + 0.5; // Datasheet VLOGIC + 0.5V
  const unoTwiVihMin = 0.7 * unoVccVolts; // ATmega328P TWI spec: 0.7 * VCC
  const unoInt0VihMin = 0.6 * unoVccVolts; // ATmega328P GPIO D2 spec: 0.6 * VCC

  const isMpuSafe = vMpuSda <= mpuMaxSafeV;
  const isUnoTwiSpecMet = vUnoA4 >= unoTwiVihMin;
  const isInt0SpecMet = vLdo >= unoInt0VihMin;

  let voltageVerdict: 'NOMINAL' | 'MARGINAL' | 'UNSAFE' = 'NOMINAL';
  if (!isMpuSafe || !isInt0SpecMet) {
    voltageVerdict = 'UNSAFE';
  } else if (!isUnoTwiSpecMet || vccSource === '3.3V') {
    voltageVerdict = 'MARGINAL';
  }

  // Derived Timing & UART Math
  const periodUs = 1_000_000 / sampleRateHz;
  const isrLatencyUs = 4.5;
  const criticalSectionUs = 1.5;
  // 2-byte I2C burst (START + ADDR_W + REG + REP_START + ADDR_R + 2*DATA + STOP ≈ 47 bits + software TWI ISR overhead)
  const i2cBurstUs = i2cClockKhz === 400 ? 125 : 475;
  const floatFormatCpuUs = 95; // dtostrf / Serial.print float formatting on 8-bit AVR

  // Worst-case CSV row: "4294967295,-19.6133\n" -> 10 + 1 + (4 + decimalPlaces) + 1
  const maxSampleRowBytes = 10 + 1 + 4 + decimalPlaces + 1;
  const typSampleRowBytes = 8 + 1 + 2 + decimalPlaces + 1;
  const overrunDiagBytes = includeOverrunDiag ? 32 : 0; // "#ERR:OVERRUN,missed=1,t_us=...\n"
  const totalFrameBytes = maxSampleRowBytes + overrunDiagBytes;

  const bitTimeUs = 1_000_000 / baudRate;
  const byteTimeUs = 10 * bitTimeUs; // 8N1 = 10 bits per byte
  const uartDrainTimeUs = totalFrameBytes * byteTimeUs;
  const bytesPerSecMax = maxSampleRowBytes * sampleRateHz;
  const uartCapacityBytesPerSec = baudRate / 10;
  const uartUtilizationPct = (uartDrainTimeUs / periodUs) * 100;

  // Does the 64-byte ring buffer overflow or block?
  const txBufferLimitBytes = 63; // HardwareSerial 64-byte ring buffer holds 63 bytes max
  const willBlockOnSingleFrame = totalFrameBytes > txBufferLimitBytes || uartDrainTimeUs > periodUs;
  const blockingWaitUs =
    uartDrainTimeUs > periodUs
      ? uartDrainTimeUs - periodUs
      : totalFrameBytes > txBufferLimitBytes
      ? (totalFrameBytes - txBufferLimitBytes) * byteTimeUs
      : 0;

  const totalCpuActiveUs =
    isrLatencyUs + criticalSectionUs + i2cBurstUs + floatFormatCpuUs + blockingWaitUs;
  const freeCpuMarginUs = Math.max(0, periodUs - totalCpuActiveUs);

  const activeDlpf =
    MPU6050_DLPF_OPTIONS.find((d) => d.dlpfCfg === selectedDlpfCfg) ||
    MPU6050_DLPF_OPTIONS[4];

  return (
    <div className="space-y-8">
      {/* MODULE 1: GY-521 Power & I2C Voltage Compatibility Verifier */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500 uppercase">
              Hardware Safety & Logic Threshold Verification
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              GY-521 Breakout Power & I²C Voltage Compatibility Analyzer
            </h2>
          </div>
          <div
            className={`px-3 py-1.5 rounded border text-xs font-mono font-semibold ${
              voltageVerdict === 'NOMINAL'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : voltageVerdict === 'MARGINAL'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {voltageVerdict === 'NOMINAL' && '● NOMINAL: ALL LOGIC & VOLTAGE SPECS MET'}
            {voltageVerdict === 'MARGINAL' && '▲ MARGINAL: BELOW ATMEGA328P 0.7×VCC TWI SPEC'}
            {voltageVerdict === 'UNSAFE' && '✖ UNSAFE: LOGIC THRESHOLD OR OVERVOLTAGE VIOLATION'}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Controls */}
          <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Hardware Wiring & Pull-Up Configuration
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                1. GY-521 <code className="font-mono">VCC</code> Power Input Pin
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setVccSource('5V')}
                  className={`px-3 py-2 text-xs font-mono rounded border text-left transition-colors cursor-pointer ${
                    vccSource === '5V'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Nano 5V → VCC (Rec.)
                </button>
                <button
                  onClick={() => setVccSource('3.3V')}
                  className={`px-3 py-2 text-xs font-mono rounded border text-left transition-colors cursor-pointer ${
                    vccSource === '3.3V'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Nano 3V3 → VCC (LDO Drop)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                2. Bidirectional I²C Level Shifter on SDA (A4) & SCL (A5)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setUseLevelShifter(true)}
                  className={`px-3 py-2 text-xs font-mono rounded border text-left transition-colors cursor-pointer ${
                    useLevelShifter
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Level Shifter Installed
                </button>
                <button
                  onClick={() => setUseLevelShifter(false)}
                  className={`px-3 py-2 text-xs font-mono rounded border text-left transition-colors cursor-pointer ${
                    !useLevelShifter
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Direct Wire (No Shifter)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                3. Measured GY-521 Onboard Pull-Up Resistance (SDA/SCL to 3.3V)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[2.2, 4.7, 10.0].map((val) => (
                  <button
                    key={val}
                    onClick={() => setGyPullupKOhm(val)}
                    className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors cursor-pointer ${
                      gyPullupKOhm === val
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {val.toFixed(1)} kΩ {val === 4.7 ? '(Std)' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                4. ATmega328P Internal 5V Pull-Ups (<code className="font-mono">PORTC4/5</code> after <code className="font-mono">Wire.begin()</code>)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDisableAvrPullups(true)}
                  className={`px-3 py-2 text-xs font-mono rounded border text-left transition-colors cursor-pointer ${
                    disableAvrPullups
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Cleared LOW in setup()
                </button>
                <button
                  onClick={() => setDisableAvrPullups(false)}
                  className={`px-3 py-2 text-xs font-mono rounded border text-left transition-colors cursor-pointer ${
                    !disableAvrPullups
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Left Enabled (Default Wire)
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-700">Nano 5V Rail Actual USB Voltage</span>
                <span className="font-mono font-semibold text-slate-900">{unoVccVolts.toFixed(2)} V</span>
              </div>
              <input
                type="range"
                min={4.6}
                max={5.15}
                step={0.05}
                value={unoVccVolts}
                onChange={(e) => setUnoVccVolts(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          {/* Computed Electrical Telemetry & Pre-Power Checklist */}
          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 border border-slate-200 rounded-md bg-white">
                <div className="text-[11px] font-mono text-slate-500 uppercase">
                  MPU6050 Side SDA/SCL
                </div>
                <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
                  {vMpuSda.toFixed(2)} <span className="text-xs font-normal text-slate-500">V</span>
                </div>
                <div
                  className={`text-xs font-mono mt-1 ${
                    isMpuSafe ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {isMpuSafe
                    ? `● Safe (≤ ${mpuMaxSafeV.toFixed(2)} V max)`
                    : `✖ Exceeds ${mpuMaxSafeV.toFixed(2)} V!`}
                </div>
              </div>

              <div className="p-3.5 border border-slate-200 rounded-md bg-white">
                <div className="text-[11px] font-mono text-slate-500 uppercase">
                  Nano A4/A5 High Level
                </div>
                <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
                  {vUnoA4.toFixed(2)} <span className="text-xs font-normal text-slate-500">V</span>
                </div>
                <div
                  className={`text-xs font-mono mt-1 ${
                    isUnoTwiSpecMet ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {isUnoTwiSpecMet
                    ? `● ≥ ${unoTwiVihMin.toFixed(2)} V (0.7×VCC)`
                    : `▲ < ${unoTwiVihMin.toFixed(2)} V (0.7×VCC)`}
                </div>
              </div>

              <div className="p-3.5 border border-slate-200 rounded-md bg-white">
                <div className="text-[11px] font-mono text-slate-500 uppercase">
                  Nano D2 (INT0) Pulse High
                </div>
                <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
                  {vLdo.toFixed(2)} <span className="text-xs font-normal text-slate-500">V</span>
                </div>
                <div
                  className={`text-xs font-mono mt-1 ${
                    isInt0SpecMet ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {isInt0SpecMet
                    ? `● ≥ ${unoInt0VihMin.toFixed(2)} V (0.6×VCC)`
                    : `✖ < ${unoInt0VihMin.toFixed(2)} V`}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 space-y-2 leading-relaxed">
              <div className="font-semibold text-slate-900">
                Engineering Diagnostic Explanation for Current Selection:
              </div>
              {useLevelShifter ? (
                <p>
                  <strong>Optimal Configuration Active:</strong> With the bidirectional MOSFET level shifter installed (<code className="font-mono">LV = 3V3</code>, <code className="font-mono">HV = {unoVccVolts.toFixed(2)}V</code>), the MPU6050 <code className="font-mono">SDA/SCL</code> pins see a clean <strong>{vMpuSda.toFixed(2)} V</strong> (protecting the 3.3 V MEMS silicon), while the Arduino Nano <code className="font-mono">A4/A5</code> TWI pins see <strong>{vUnoA4.toFixed(2)} V</strong>, comfortably exceeding the ATmega328P datasheet <code className="font-mono">V_IH(min) = 0.7 × V_CC = {unoTwiVihMin.toFixed(2)} V</code> requirement at 400 kHz Fast Mode.
                </p>
              ) : (
                <p>
                  <strong>Direct Connection Notice:</strong> Without the level shifter, the Nano <code className="font-mono">A4/A5</code> pins see <strong>{vUnoA4.toFixed(2)} V</strong>, which is slightly below the ATmega328P datasheet worst-case TWI threshold of <strong>{unoTwiVihMin.toFixed(2)} V</strong> (<code className="font-mono">0.7 × V_CC</code>). While this often functions on short bench jumpers, long bridge-midspan leads (30–50 cm) at 400 kHz have reduced noise immunity. Installing your available bidirectional level shifter is strongly recommended.
                </p>
              )}
            </div>

            <div className="p-4 border border-slate-200 rounded-md space-y-2.5">
              <div className="text-xs font-semibold text-slate-900">
                Mandatory Pre-Power Bench Verification Checklist (GY-521 Module)
              </div>
              {[
                {
                  key: 'ldoCheck',
                  text: 'Inspect 5-pin SOT-23 regulator (U2, typically marked 4B2X or KB33) on GY-521; wire Nano 5V to GY-521 VCC and confirm 3.28–3.33 V on regulator output pin.',
                },
                {
                  key: 'dmmPullup',
                  text: 'Unpowered DMM resistance check: measure resistance between GY-521 SDA and 3.3V LDO output (confirm 2.2 kΩ – 4.7 kΩ pull-up goes to 3.3 V, NEVER directly to the raw 5V VCC pin).',
                },
                {
                  key: 'intPinCheck',
                  text: 'Confirm GY-521 INT is wired to Uno D2 configured as INPUT (never INPUT_PULLUP), and AD0 is tied low (or floating with onboard pull-down) for address 0x68.',
                },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!!checkedSteps[item.key]}
                    onChange={(e) =>
                      setCheckedSteps((prev) => ({
                        ...prev,
                        [item.key]: e.target.checked,
                      }))
                    }
                    className="mt-0.5 accent-blue-600"
                  />
                  <span>{item.text}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MODULE 2: Selectable MPU6050 DLPF Filter Explorer for Bridge Vibration Ranges */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500 uppercase">
              Selectable Digital Low-Pass Filter (Register 0x1A CONFIG)
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              MPU6050 Filter Response Across the 2–30 Hz Bridge Analysis Band
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { cfg: 4, label: 'DLPF=4 (21 Hz Initial)' },
              { cfg: 3, label: 'DLPF=3 (44 Hz Flat 2–30 Hz)' },
              { cfg: 2, label: 'DLPF=2 (94 Hz Wide)' },
              { cfg: 5, label: 'DLPF=5 (10 Hz Narrow)' },
            ].map((btn) => (
              <button
                key={btn.cfg}
                onClick={() => onSelectDlpfCfg(btn.cfg)}
                className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors cursor-pointer ${
                  selectedDlpfCfg === btn.cfg
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Interactive SVG Bode Magnitude Curve (0 - 100 Hz) */}
          <div className="lg:col-span-8 bg-slate-50 border border-slate-200 rounded-md p-4">
            <div className="flex items-center justify-between text-xs font-mono text-slate-600 mb-2">
              <span>FILTER MAGNITUDE RESPONSE |H(f)| (0 – 100 Hz NYQUIST)</span>
              <span>Shaded Band: 2–30 Hz Target Bridge Modes</span>
            </div>

            <svg
              viewBox="0 0 680 250"
              className="w-full h-auto bg-white border border-slate-200 rounded"
            >
              {/* 2-30 Hz Target Analysis Band Highlight */}
              <rect
                x={55 + (2 / 100) * 595}
                y={20}
                width={((30 - 2) / 100) * 595}
                height={190}
                fill="#EFF6FF"
              />
              <text
                x={55 + (16 / 100) * 595}
                y={34}
                textAnchor="middle"
                className="text-[10px] font-mono fill-blue-700"
              >
                2–30 Hz Analysis Band
              </text>

              {/* Horizontal dB Grid Lines (0, -3, -6, -12, -18, -24 dB) */}
              {[0, -3, -6, -12, -18, -24].map((db) => {
                const y = 20 + ((0 - db) / 26) * 190;
                return (
                  <g key={db}>
                    <line
                      x1={55}
                      y1={y}
                      x2={650}
                      y2={y}
                      stroke={db === -3 ? '#94A3B8' : '#E2E8F0'}
                      strokeDasharray={db === -3 ? '4 3' : undefined}
                    />
                    <text
                      x={48}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[10px] font-mono fill-slate-500"
                    >
                      {db} dB
                    </text>
                  </g>
                );
              })}

              {/* Vertical Frequency Grid Lines */}
              {[0, 10, 21, 30, 44, 60, 80, 100].map((f) => {
                const x = 55 + (f / 100) * 595;
                return (
                  <g key={f}>
                    <line
                      x1={x}
                      y1={20}
                      x2={x}
                      y2={210}
                      stroke={f === 30 || f === 100 ? '#CBD5E1' : '#F1F5F9'}
                    />
                    <text
                      x={x}
                      y={226}
                      textAnchor="middle"
                      className="text-[10px] font-mono fill-slate-600"
                    >
                      {f}Hz
                    </text>
                  </g>
                );
              })}

              {/* Plot curves for DLPF_CFG = 2, 3, 4, 5 */}
              {[2, 3, 4, 5].map((cfg) => {
                const isSelected = cfg === selectedDlpfCfg;
                const pts: string[] = [];
                for (let f = 0; f <= 100; f += 1) {
                  const db = Math.max(-26, getDlpfDb(f, cfg));
                  const x = 55 + (f / 100) * 595;
                  const y = 20 + ((0 - db) / 26) * 190;
                  pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                }
                const color =
                  cfg === 3
                    ? '#059669'
                    : cfg === 4
                    ? '#2563EB'
                    : cfg === 2
                    ? '#D97706'
                    : '#64748B';
                return (
                  <polyline
                    key={cfg}
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 1.25}
                    strokeOpacity={isSelected ? 1 : 0.45}
                    points={pts.join(' ')}
                  />
                );
              })}
            </svg>
          </div>

          {/* Selected Filter Summary Card */}
          <div className="lg:col-span-4 space-y-3 text-xs">
            <div className="p-4 border border-slate-200 rounded-md bg-slate-50 space-y-2.5">
              <div className="font-mono text-slate-500 uppercase">
                Selected Filter Telemetry
              </div>
              <div className="text-lg font-bold text-slate-900">
                DLPF_CFG = {activeDlpf.dlpfCfg} ({activeDlpf.accelBandwidthHz} Hz Corner)
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-slate-700 pt-1">
                <div>CONFIG (0x1A): {activeDlpf.configHex}</div>
                <div>SMPLRT_DIV: {activeDlpf.smplrtDivHex}</div>
                <div>20 Hz Gain: {activeDlpf.attenuationAt20HzDb.toFixed(2)} dB</div>
                <div>30 Hz Gain: {activeDlpf.attenuationAt30HzDb.toFixed(2)} dB</div>
                <div>100 Hz Gain: {activeDlpf.nyquistAttenuationAt100HzDb.toFixed(1)} dB</div>
                <div>Group Delay: {activeDlpf.accelDelayMs.toFixed(1)} ms</div>
              </div>
              <p className="text-slate-600 leading-relaxed pt-1 border-t border-slate-200">
                {activeDlpf.engineeringNotes}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MODULE 3: Interactive 200 Hz Timing, I2C & UART Calculator */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-mono text-slate-500 uppercase">
              ATmega328P Real-Time Deadline & Serial Ring-Buffer Calculator
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Interactive 200 Hz Sample Frame & 115200 Baud Throughput Budget
            </h2>
          </div>
          <div
            className={`px-3 py-1.5 rounded border text-xs font-mono font-semibold ${
              !willBlockOnSingleFrame && freeCpuMarginUs > 1500
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {!willBlockOnSingleFrame && freeCpuMarginUs > 1500
              ? `● DETERMINISTIC: ${freeCpuMarginUs.toFixed(0)} µs FREE CPU MARGIN / SAMPLE`
              : `✖ OVERRUN RISK: UART BLOCKING (${blockingWaitUs.toFixed(0)} µs)`}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Controls */}
          <div className="lg:col-span-4 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-700">Sample Rate (f_s)</span>
                <span className="font-mono font-semibold text-slate-900">
                  {sampleRateHz} Hz ({periodUs.toFixed(0)} µs period)
                </span>
              </div>
              <input
                type="range"
                min={100}
                max={500}
                step={25}
                value={sampleRateHz}
                onChange={(e) => setSampleRateHz(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                I²C Bus Clock (<code className="font-mono">Wire.setClock</code>)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[400, 100].map((khz) => (
                  <button
                    key={khz}
                    onClick={() => setI2cClockKhz(khz as 100 | 400)}
                    className={`px-3 py-1.5 text-xs font-mono rounded border cursor-pointer ${
                      i2cClockKhz === khz
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {khz} kHz {khz === 400 ? '(Fast)' : '(Std)'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                UART Baud Rate (8N1 Framing = 10 bits/byte)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[57600, 115200, 230400].map((b) => (
                  <button
                    key={b}
                    onClick={() => setBaudRate(b as 57600 | 115200 | 230400)}
                    className={`px-2 py-1.5 text-xs font-mono rounded border cursor-pointer ${
                      baudRate === b
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-700">Acceleration Decimal Places</span>
                <span className="font-mono font-semibold text-slate-900">{decimalPlaces} decimals</span>
              </div>
              <input
                type="range"
                min={2}
                max={6}
                step={1}
                value={decimalPlaces}
                onChange={(e) => setDecimalPlaces(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={includeOverrunDiag}
                onChange={(e) => setIncludeOverrunDiag(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Simulate Simultaneous #ERR:OVERRUN Line (+32 B burst)</span>
            </label>
          </div>

          {/* Timing Waterfall & Metrics */}
          <div className="lg:col-span-8 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 border border-slate-200 rounded-md">
                <div className="text-[11px] font-mono text-slate-500">I²C 2-BYTE BURST</div>
                <div className="text-xl font-mono font-bold text-slate-900 mt-0.5">
                  {i2cBurstUs} <span className="text-xs font-normal text-slate-500">µs</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  {((i2cBurstUs / periodUs) * 100).toFixed(1)}% of period
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-md">
                <div className="text-[11px] font-mono text-slate-500">MAX CSV LINE LENGTH</div>
                <div className="text-xl font-mono font-bold text-slate-900 mt-0.5">
                  {totalFrameBytes} <span className="text-xs font-normal text-slate-500">B</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  Typ: {typSampleRowBytes} B / 63 B buffer
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-md">
                <div className="text-[11px] font-mono text-slate-500">UART DRAIN TIME</div>
                <div className="text-xl font-mono font-bold text-slate-900 mt-0.5">
                  {uartDrainTimeUs.toFixed(0)} <span className="text-xs font-normal text-slate-500">µs</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  {uartUtilizationPct.toFixed(1)}% of {uartCapacityBytesPerSec} B/s
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-md">
                <div className="text-[11px] font-mono text-slate-500">THROUGHPUT @ {sampleRateHz}HZ</div>
                <div className="text-xl font-mono font-bold text-slate-900 mt-0.5">
                  {bytesPerSecMax} <span className="text-xs font-normal text-slate-500">B/s</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  Cap: {uartCapacityBytesPerSec} B/s
                </div>
              </div>
            </div>

            {/* Visual Timeline Bar of the 5,000 us Sample Period */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3">
              <div className="flex justify-between text-xs font-mono text-slate-700">
                <span>PER-SAMPLE CPU & BUS TIMELINE ({periodUs.toFixed(0)} µs DEADLINE)</span>
                <span>CPU Active: {totalCpuActiveUs.toFixed(0)} µs · Idle Margin: {freeCpuMarginUs.toFixed(0)} µs</span>
              </div>

              <div className="w-full h-8 bg-slate-200 rounded overflow-hidden flex border border-slate-300">
                <div
                  style={{ width: `${Math.min(100, ((isrLatencyUs + criticalSectionUs) / periodUs) * 100)}%` }}
                  className="bg-amber-500 h-full"
                  title="ISR + Atomic Copy (~6 µs)"
                />
                <div
                  style={{ width: `${Math.min(100, (i2cBurstUs / periodUs) * 100)}%` }}
                  className="bg-blue-600 h-full"
                  title={`I2C Burst Read (${i2cBurstUs} µs)`}
                />
                <div
                  style={{ width: `${Math.min(100, (floatFormatCpuUs / periodUs) * 100)}%` }}
                  className="bg-indigo-500 h-full"
                  title="Float Formatting & Ring Buffer Copy (~95 µs)"
                />
                {blockingWaitUs > 0 && (
                  <div
                    style={{ width: `${Math.min(100, (blockingWaitUs / periodUs) * 100)}%` }}
                    className="bg-rose-600 h-full"
                    title={`UART Blocking Wait (${blockingWaitUs.toFixed(0)} µs)`}
                  />
                )}
                <div className="flex-1 bg-emerald-500/20 h-full" />
              </div>

              <div className="flex flex-wrap gap-4 text-[11px] font-mono text-slate-600">
                <span>■ ISR + Atomic: 6 µs</span>
                <span className="text-blue-700">■ I²C Burst: {i2cBurstUs} µs</span>
                <span className="text-indigo-700">■ Float/Buffer Copy: 95 µs</span>
                <span className="text-slate-700">
                  ■ Background Hardware UART TX Drain: {uartDrainTimeUs.toFixed(0)} µs
                </span>
                <span className="text-emerald-700">
                  ■ Free CPU Headroom: {freeCpuMarginUs.toFixed(0)} µs
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
