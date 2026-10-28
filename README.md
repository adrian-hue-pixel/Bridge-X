# BRIDGE-X: Hardware-Paced MEMS Accelerometry & Modal Ring-Down FFT Workbench

[![Target MCU](https://img.shields.io/badge/MCU-Arduino_Nano_(ATmega328P)-00979D?style=flat-square)](./firmware/bridge_x_firmware/bridge_x_firmware.ino)
[![Sensor](https://img.shields.io/badge/MEMS-InvenSense_MPU--6050_(0x68)-2563EB?style=flat-square)](./firmware/bridge_x_firmware/bridge_x_firmware.ino)
[![Sampling](https://img.shields.io/badge/Sampling-200.0_Hz_Hardware_INT0-059669?style=flat-square)](./firmware/bridge_x_firmware/bridge_x_firmware.ino)
[![Workbench](https://img.shields.io/badge/Workbench-React_19_%2B_TypeScript_%2B_WebSerial-0F172A?style=flat-square)](./src)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)

**BRIDGE-X** is an open-source experimental physics and embedded-systems instrumentation platform designed to measure repeatable shifts in the vertical free-vibration modal frequencies of a miniature wooden truss bridge (`60 × 12 × 12 cm`) across controlled structural stiffness states.

Developed for the **IB Physics Collaborative Sciences Project** and engineered from primary silicon datasheets (*InvenSense MPU-6000/MPU-6050 Register Map Rev 4.2* and *Microchip ATmega328P Datasheet DS40002061B*), the system pairs bare-metal register-level C++ firmware on an **Arduino Nano (`ATmega328P`)** with a browser-native **Web Serial + Fast Fourier Transform (FFT) Signal-Processing Workbench** and a standalone **Python modal analysis pipeline**.

---

## Key Engineering Highlights

1. **Phase-Locked 200.0 Hz Hardware Interrupt Acquisition (`INT0 -> Pin D2`)**
   - Eliminates software `micros()` polling drift between the Arduino Nano's $\pm 0.5\%$ ceramic resonator and the MPU-6050's internal MEMS Phase-Locked Loop (PLL).
   - Configures the MPU-6050 X-axis gyroscope PLL clock (`PWR_MGMT_1 = 0x01`), Digital Low-Pass Filter (`CONFIG = 0x04` for $21\text{ Hz}$ corner or `0x03` for $44\text{ Hz}$ corner), and Sample Rate Divider (`SMPLRT_DIV = 4`), dividing the $1,000\text{ Hz}$ internal output rate by $(1 + 4) = 5$ to assert a $50\text{ }\mu\text{s}$ push-pull hardware interrupt pulse every **$5,000\text{ }\mu\text{s}$ ($200.0\text{ Hz}$)**.
   - Captures 32-bit `micros()` timestamps inside a **$\sim 3.5\text{ }\mu\text{s}$ Interrupt Service Routine (ISR)** with zero I²C or UART calls inside the interrupt context.

2. **Deterministic Fault Detection & Mid-Trial Configuration Lockout**
   - Tracks real-time interrupt overruns (`g_isr_pending > 1`), I²C NACK/bus-lockup timeouts (`3,000 µs` hardware TWI reset), late-read race hazards, and 16-bit ADC rail saturation near $\pm 2g$ (`|raw_az| >= 32760`).
   - Locks digital low-pass filter commands (`3` and `4`) during active 2,000-sample recordings (`#WARN:CMD_LOCKED`) so a trial can never mix two filter transfer functions.
   - Emits `#END:CLEAN` **if and only if** all four hardware fault counters equal zero across 2,000 samples; otherwise flags the recording as `#END:DEGRADED,status=POTENTIALLY_INVALID`.

3. **Ring-Down Sub-Windowed FFT for Decaying Structural Vibrations**
   - Lightly damped wooden truss bridges exhibit rapid exponential decay ($a_z(t) \propto e^{-\zeta \omega_n t}\sin(\omega_d t)$) over the first $2\text{--}4\text{ s}$ following midspan release.
   - Applying a symmetric 10-second Hann window across the entire recording attenuates the highest-SNR oscillation near $t = 0$. Both the TypeScript workbench and Python analyzer automatically isolate the active **ring-down sub-window** (`3.5 s` from release onset, or user-defined $[t_{\text{start}}, t_{\text{end}}]$) and support **Hann**, **Tukey ($\alpha = 0.25$)**, and **Rectangular** tapers with exact coherent-gain amplitude correction and zero-padded parabolic peak interpolation.

4. **Three-Condition Reversibility Protocol**
   - Compares **(1) Brace Secured (Baseline)**, **(2) Additional Diagonal Brace Disengaged (Altered Stiffness)**, and **(3) Brace Restored (Control)** to separate genuine reversible stiffness shifts ($\Delta f_1 \propto \sqrt{k_{\text{eff}}/m_{\text{eff}}}$) from non-structural joint settling or thermal drift.

---

## Repository Structure

```text
bridge-x/
├── firmware/
│   └── bridge_x_firmware/
│       └── bridge_x_firmware.ino     # Production Arduino Nano (ATmega328P) C++ sketch
├── python/
│   └── bridge_x_analyzer.py          # Standalone Python CLI validator & ring-down FFT analyzer
├── docs/
│   └── BRIDGE_X_Engineering_Architecture_Dossier.md
├── src/                              # React 19 + TypeScript Scientific Instrumentation Workbench
│   ├── components/
│   │   ├── LiveMonitorView.tsx       # Module A & B: 115200-baud WebSerial & 200 Hz live monitor
│   │   ├── TrialComparatorView.tsx   # Module C, D & F: Ring-down FFT, 3-state overlay & exports
│   │   ├── SyntheticSimulatorView.tsx# Module E: 2-DOF damped modal synthesizer & fault injector
│   │   ├── ArduinoFirmwareView.tsx   # Register map, sketch viewer & 7-point commissioning guide
│   │   ├── TimingAndHardwareView.tsx # GY-521 logic-level analyzer & UART/CPU timing budget
│   │   └── SetupGuideView.tsx        # Interactive hardware handbook & automated self-test suite
│   ├── data/
│   │   └── mpu6050Data.ts            # Verified register definitions & datasheet constants
│   └── utils/
│       └── dspAndValidation.ts       # Wrap-safe parser, Cooley-Tukey FFT & unit self-tests
├── data/
│   └── README.md                     # Directory for empirical CSV recordings & exported plots
├── bridge_x_firmware.ino             # Root copy of Arduino Nano firmware
├── package.json
└── README.md
```

---

## 1. Pre-Power Electronics Verification & Exact Arduino Nano Wiring Table

### Bare MPU-6050 IC vs. GY-521 Breakout Board Distinction
Never assume every board sold as an "MPU-6050" or "GY-521" tolerates 5 V power or 5 V logic without checking the physical board first:

1. **Bare InvenSense MPU-6050 Chip (`QFN-24` IC):**
   - Strictly a **3.3 V device** (`VDD = 2.375 V – 3.46 V`, absolute maximum logic pin rating `VLOGIC + 0.5 V ≈ 3.80 V`).
   - Applying 5.0 V directly to a bare MPU-6050 pin without regulation or level shifting will permanently damage the sensor.
2. **Standard GY-521 Breakout Module:**
   - Includes an onboard **5-pin SOT-23 3.3 V Low-Dropout (LDO) voltage regulator** (often marked `KB33`, `4B2X`, or `LG33`) connected to the `VCC` header pin, plus onboard `4.7 kΩ` I²C pull-up resistors connected to the internal `3.3 V` rail.
   - **Pre-Power Multimeter Check (Perform Before Connecting USB Power):**
     1. Visually confirm the 5-pin SOT-23 regulator chip is present next to the `VCC` pin.
     2. With the board **unpowered**, set your multimeter to resistance/continuity mode and verify that the pull-up resistors on `SDA` and `SCL` connect to the output of the `3.3 V` regulator—**not** directly to the `VCC` input pin.
3. **Why a Bidirectional I²C Level Shifter Is Recommended (and Nano `3V3` Pin Note):**
   - The 5.0 V ATmega328P hardware Two-Wire Interface (`A4/A5` on the Nano) specifies a minimum high-level input threshold of $V_{IH(\min)} = 0.7 \times V_{CC} = 3.50\text{ V}$, whereas a 3.3 V pull-up rail sits at `3.30 V` (marginal by 0.20 V) and exposes the MPU-6050 to 5 V if internal AVR pull-ups are ever active.
   - Using a **4-channel bidirectional MOSFET I²C level shifter** (BSS138 type) with `HV = 5V` and `LV = 3V3` ensures full 5.0 V logic swing on the Arduino Nano side and strict 3.3 V logic protection on the MPU-6050 side.
   - **Arduino Nano `3V3` Rail Note:** On the Arduino Nano, the `3V3` output pin is regulated by the onboard USB-to-serial bridge (`FT232RL` or `CH340G`, rated ~30–50 mA max). Powering `GY-521 VCC` from the Nano **`5V`** pin (so the GY-521's onboard 3.3 V LDO supplies sensor power) while connecting the Nano **`3V3`** pin to the level shifter **`LV`** reference pin draws $< 1\text{ mA}$ from `3V3`.

### Exact Conditional Wiring Table (Arduino Nano `ATmega328P`)

| Signal | Arduino Nano (`ATmega328P`) Pin | Option A: GY-521 + Bidirectional I²C Level Shifter (Recommended Default) | Option B: Verified GY-521 Direct (ONLY After Multimeter Check Confirming 3.3 V Pull-Ups) | Option C: Bare 3.3 V Breakout (No Onboard 3.3 V LDO Regulator) |
| :--- | :--- | :--- | :--- | :--- |
| **Power (`VCC`)** | `5V` / `3V3` | Connect Nano `5V` → GY-521 `VCC` *(feeds onboard 3.3 V LDO)*; connect Nano `5V` → Shifter `HV` and Nano `3V3` → Shifter `LV` | Connect Nano `5V` → GY-521 `VCC` *(feeds onboard 3.3 V LDO; feeding 3.3 V to VCC causes LDO dropout)* | Connect Nano `3V3` → Breakout `VCC/VDD` *(NEVER connect 5 V)* + Connect Level Shifter `HV=5V`, `LV=3V3` |
| **Ground (`GND`)** | `GND` | Connect Nano `GND` → Shifter `GND` → GY-521 `GND` (common ground mandatory) | Connect Nano `GND` → GY-521 `GND` | Connect Nano `GND` → Shifter `GND` → Breakout `GND` |
| **I²C Data (`SDA`)** | `A4` | Nano `A4` → Shifter `HV1`; Shifter `LV1` → GY-521 `SDA` | Nano `A4` → GY-521 `SDA` *(firmware disables internal 5 V pull-up immediately after `Wire.begin()`)* | Via Level Shifter `HV1 ↔ LV1` only |
| **I²C Clock (`SCL`)** | `A5` | Nano `A5` → Shifter `HV2`; Shifter `LV2` → GY-521 `SCL` | Nano `A5` → GY-521 `SCL` *(firmware disables internal 5 V pull-up immediately after `Wire.begin()`)* | Via Level Shifter `HV2 ↔ LV2` only |
| **Data-Ready Interrupt (`INT`)** | `D2` (`INT0`) | GY-521 `INT` → Nano `D2` *(or via Shifter `LV3 → HV3`; `INT` is configured as a 3.3 V active-high push-pull output, which exceeds `D2` threshold $0.6 V_{CC} = 3.0\text{ V}$)* | GY-521 `INT` → Nano `D2` *(configured as `INPUT`, never `INPUT_PULLUP`)* | Breakout `INT` → Nano `D2` (or via Shifter `LV3 → HV3`) |
| **I²C Address (`AD0`)** | `GND` | Tie `AD0` to `GND` (or leave unconnected if onboard pull-down is verified) for I²C address `0x68` | Tie `AD0` to `GND` for `0x68` | Tie `AD0` to `GND` for `0x68` |

> **Mechanical Mounting Rule:** Mount the MPU-6050 breakout **rigidly** at the midspan of the `60 × 12 × 12 cm` wooden truss bridge using small M2/M3 machine screws, a rigid nylon clamp, or thin cyanoacrylate/hot-melt adhesive on a rigid mounting plate, with the PCB `+Z` axis pointing vertically upward. **Never use thick double-sided foam tape**, which acts as a compliant viscoelastic spring-damper and attenuates vibration amplitudes above 15 Hz.

---

## 2. Uploading `bridge_x_firmware.ino` to Arduino Nano (Windows / macOS / Linux)

1. **Install Arduino IDE 2.x:** Download from [arduino.cc/en/software](https://www.arduino.cc/en/software).
2. **Open Sketch:** Open `firmware/bridge_x_firmware/bridge_x_firmware.ino` in Arduino IDE.
   - **Zero External Libraries:** The firmware uses only built-in `<Arduino.h>` and `<Wire.h>`. Do not install third-party `MPU6050` or `I2Cdev` libraries.
3. **Select Arduino Nano Board & Processor:**
   - **Board:** `Tools → Board → Arduino AVR Boards → Arduino Nano`
   - **Processor:** `Tools → Processor → ATmega328P` *(or select **`ATmega328P (Old Bootloader)`** if using a CH340G-based Nano clone that times out with `stk500_getsync()` during upload)*.
   - **Port:** Select your Nano's `COMx` (Windows) or `/dev/cu.usbserial-*` (macOS) port.
4. **Compile & Upload:** Click **Verify (`✓`)** then **Upload (`→`)**.
5. **Verify Serial Output at `115200` Baud:**
   - Open `Tools → Serial Monitor` at **`115200 baud`**.
   - Confirm the startup header and `t_us,az_m_s2` stream:
     ```text
     #BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4,bw_hz=21,delay_ms=8.5,range_g=2
     #COLUMNS:t_us,az_m_s2
     #START:TRIAL,target_samples=2000
     1145000,9.8124
     1150000,9.8098
     ...
     #END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0
     ```
   - **Important:** Close the Arduino IDE Serial Monitor before connecting the Web Application or running the Python script so the serial port is not locked.

---

## 3. Running the Web Instrumentation Workbench Locally

### Prerequisites
- **Node.js** `>= 18.x` and `npm`
- **Google Chrome** or **Microsoft Edge** (for hardware `navigator.serial` Web Serial API support)

### Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Start the local development server on http://localhost:3000
npm run dev

# 3. Type-check and build production bundle
npm run lint
npm run build
```

### Standalone Python CLI Analyzer
You can also run the standalone Python validator and ring-down FFT analyzer in `python/bridge_x_analyzer.py`:
```bash
pip install numpy
python python/bridge_x_analyzer.py data/your_recorded_trial.csv --condition secured --fmin 2.0 --fmax 30.0 --window hann
```

---

## 4. Experimental Protocol: Three-Condition Bridge Comparison

1. **Condition 1 — Brace Secured (Intact Baseline):**
   - Secure the removable diagonal brace at midspan.
   - Connect the Arduino Nano at `115200` baud in the **Live Monitor** tab, select **Brace Secured**, and click **Send `'R'` (Start Trial)**.
   - Apply a repeatable `2–3 mm` downward static deflection at midspan and release cleanly.
   - Record **3–5 clean trials** (`#END:CLEAN`) to establish baseline mean frequency $\bar{f}_{\text{secured}}$ and trial-to-trial repeatability standard deviation $s_f$.
2. **Condition 2 — Brace Disengaged (Altered Structural Stiffness):**
   - Disengage the removable diagonal brace while retaining all permanent truss members and keeping sensor mass and cable routing unchanged.
   - Record **3–5 clean trials** under identical midspan release excitation.
3. **Condition 3 — Brace Restored (Reversibility Control):**
   - Re-secure the diagonal brace to its original state and record **3–5 clean control trials**.
   - Comparing **Brace Restored** against **Brace Secured** verifies that the frequency shift $\Delta f_1$ was caused by the reversible brace stiffness change rather than permanent joint loosening or support slip.

---

## 5. Troubleshooting Reference

| Symptom / `#` Diagnostic Message | Root Cause | Resolution |
| :--- | :--- | :--- |
| `stk500_getsync(): not in sync` during Nano upload | Nano clone uses the Old Bootloader (`ATmega328P`). | In Arduino IDE, select **Tools → Processor → `ATmega328P (Old Bootloader)`** and upload again. |
| `#ERR:I2C_INIT,stage=WHO_AM_I,code=2` | Sensor did not ACK I²C address `0x68`. | Check `SDA -> A4`, `SCL -> A5`, common `GND`, `VCC` power, and verify `AD0` is tied to `GND`. |
| `#ERR:INT0_TIMEOUT,pin=D2` | No rising edges detected on Nano Digital Pin `D2`. | Connect `GY-521 INT` to **Nano Pin `D2`** (`INT0`). |
| `#WARN:CMD_LOCKED` | Filter command `3` or `4` sent during an active trial. | Wait until `#END:CLEAN` or `#END:DEGRADED` before switching filter bandwidth. |
| `#END:DEGRADED,status=POTENTIALLY_INVALID` | Overrun, I²C error, clip, or late read occurred during recording. | Inspect fault counters; use gentler `2–3 mm` deflection if `clips > 0`, verify wiring if `i2c_errs > 0`, and re-run trial. |

---

## 6. Scientific Scope & Limitations

- **What BRIDGE-X Measures:** Repeatable shifts in the global vertical free-vibration modal frequencies ($f_n \propto \sqrt{k_{\text{eff}} / m_{\text{eff}}}$) of a `60 × 12 × 12 cm` wooden model truss bridge across controlled brace states within `2–30 Hz`, bounded by Rayleigh bin spacing $\Delta f_{\text{bin}} = 1 / T_{\text{win}}$ and trial-to-trial repeatability $s_f$.
- **What BRIDGE-X Does Not Claim:** This single-point midspan prototype does **not** certify real-world civil bridge safety, does **not** localize damage near modal strain nodes, and does **not** predict structural collapse or ultimate load capacity.

---

## License

Released under the [MIT License](./LICENSE).
