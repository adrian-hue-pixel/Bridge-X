# BRIDGE-X — COMPLETE EMBEDDED ACQUISITION ARCHITECTURE, EXPERIMENTAL MEASUREMENT REVIEW & FIRMWARE SPECIFICATION
**Project:** IB Physics Collaborative Sciences Project (BRIDGE-X)
**Physical Specimen:** Wooden Model Bridge (~60 × 12 × 12 cm), MPU-6050 mounted rigidly at midspan with Z-axis vertical
**Experimental Conditions Compared:**
1. Additional brace secured (Intact Baseline)
2. Additional brace disengaged, permanent members retained (Altered State)
3. Additional brace restored (Reversibility & Control State)

---

## 0. WHO AND WHAT IS BEHIND THE ENGINEERING LOGIC (PROVENANCE & FIRST PRINCIPLES)

Every architectural choice, register bitfield, timing equation, voltage threshold, and signal-processing rule in this document is derived deterministically from primary hardware datasheets, microcontroller silicon specifications, and classical structural vibration / Fourier analysis theory—not heuristic guesswork:

1. **InvenSense MPU-6000 / MPU-6050 Primary Documentation**:
   - *MPU-6000 and MPU-6050 Register Map and Descriptions (Revision 4.2, Document RM-MPU-6000A-00)* and *Product Specification (Revision 3.4, Document PS-MPU-6000A-00)*.
   - **Rate Equation (Register 25 `SMPLRT_DIV = 0x19`, Sec. 4.2):**
     $$\text{Sample Rate} = \frac{\text{Gyroscope Output Rate}}{1 + \text{SMPLRT\_DIV}}$$
     where Gyroscope Output Rate is **8 kHz** when `DLPF_CFG = 0` or `7`, and **1 kHz** when `DLPF_CFG = 1..6`. Crucially, the internal **Accelerometer Output Rate is fixed at 1 kHz** regardless of `DLPF_CFG`. Setting `DLPF_CFG = 4` (`CONFIG = 0x04`) sets Gyroscope Output Rate = 1,000 Hz; setting `SMPLRT_DIV = 4` (`0x04`) divides 1,000 Hz by $(1 + 4) = 5$ to yield an exact **200.0 Hz** update rate and **200.0 Hz** `DATA_RDY_INT` pulse rate.
2. **Microchip ATmega328P (8-Bit AVR) & Arduino Core Hardware Mechanics**:
   - *ATmega328P Datasheet (DS40002061B)* & *Arduino AVR Core (`ArduinoCore-avr`)*.
   - **8-Bit Atomicity:** Because the ATmega328P has an 8-bit data bus, reading a 32-bit `volatile uint32_t` timestamp in `loop()` requires four sequential 8-bit load instructions (`LDS`). An interrupt firing mid-read corrupts the multi-byte value if a carry occurs across byte boundaries. Thus, `noInterrupts()` (`cli`) / `interrupts()` (`sei`) critical sections (~1.5 µs) are mandatory.
   - **Timer0 `micros()` Quantization & Rollover:** On a 16 MHz Uno, Timer0 uses a prescaler of 64, ticking every $64 / 16\text{ MHz} = 4\text{ }\mu\text{s}$, and overflows a 32-bit unsigned integer at $2^{32} - 1 = 4,294,967,295\text{ }\mu\text{s}$ ($\approx 71.58\text{ minutes}$). Unsigned modular subtraction `(uint32_t)(t_curr - t_prev)` is algebraically invariant across rollover.
   - **I²C Electrical Thresholds & Internal Pull-up Hazard:** ATmega328P Table 29-14 specifies that when the Two-Wire Interface (TWI) is enabled on `A4 (SDA)` and `A5 (SCL)`, the minimum high-level input voltage is $V_{IH(\min)} = 0.7 \times V_{CC} = 3.50\text{ V}$ (at $V_{CC} = 5.0\text{ V}$), whereas standard digital pin `D2 (INT0)` requires $V_{IH(\min)} = 0.6 \times V_{CC} = 3.00\text{ V}$. Additionally, Arduino's `Wire.begin()` calls `twi_init()`, which enables internal 20–50 kΩ pull-ups to 5 V on `A4/A5`.
3. **Classical Modal Vibration & Decaying Ring-Down Signal Processing (DSP) Theory**:
   - **Euler-Bernoulli Beam Scaling:** Natural bending mode frequencies scale with flexural rigidity $EI$ and inverse square root of mass: $f_n = \frac{\beta_n^2}{2\pi L^2}\sqrt{\frac{EI}{\rho A}}$. Engaging or disengaging a structural brace modifies effective stiffness $K_{\text{eff}}$, shifting $f_n$ only for modes where that brace experiences non-zero modal strain.
   - **Zero-Mean Sub-Windowed FFT for Decaying Vibrations:** Because a gently plucked model bridge vibrates most strongly right after release ($a_z(t) \propto e^{-\zeta \omega_n t}$), applying a symmetric 10-second Hann window across the entire recording suppresses the initial high-SNR transient near $t = 0$. Isolating a focused analysis sub-window $[t_{\text{onset}}, t_{\text{onset}} + T_{\text{win}}]$ (e.g., $3.5\text{ s}$ starting at release onset) or applying a Tukey ($\alpha = 0.25$) taper after subtracting the empirical mean preserves early vibration energy while eliminating 0 Hz gravity leakage.

---

## A. RECOMMENDED ACQUISITION ARCHITECTURE & ENGINEERING JUSTIFICATION

### Selected Architecture (Single Resolved Design)
**Hardware Data-Ready Interrupt (`INT` → Uno `D2 / INT0`) at 200 Hz + Direct 2-Byte I²C Burst Read (`ACCEL_ZOUT_H..L`, `0x3F..0x40`) in `loop()`**

### Architectural Comparison
| Candidate Architecture | Timing Defensibility | Uno R3 (2 KB SRAM) Fit | Decision |
| :--- | :--- | :--- | :--- |
| **1. Software `micros()` Polling** | **Poor:** Uno's 16 MHz ceramic resonator (~±0.5% tolerance) is asynchronous to the MPU6050's internal MEMS PLL. Polling every 5,000 Uno µs drifts relative to sensor updates, periodically reading stale registers twice or skipping samples silently. | Low SRAM (~40 B), 4 wires | **REJECTED** |
| **2. Hardware `DATA_RDY_INT` on `D2` + Direct Burst Read** | **Excellent:** Phase-locked 1:1 to the MPU6050 sample clock. `micros()` is captured inside the `INT0` ISR within ~3.5 µs of sample completion. Missed deadlines are deterministically caught via `isr_pending_count > 1`. | Minimal SRAM (~250 B total incl. Wire/Serial), simple 2-byte I²C burst | **SELECTED (RECOMMENDED)** |
| **3. MPU6050 Hardware FIFO (`0x74`)** | **Indirect:** FIFO packets contain no per-sample microcontroller timestamps; timestamps must be reconstructed by interpolation. Furthermore, setting `ACCEL_FIFO_EN` pushes all 3 accelerometer axes (6 bytes/sample instead of 2), tripling I²C bus load. | Higher SRAM & complex packet realignment on overflow | **REJECTED** |

### Detailed Architectural Explanations
1. **Sensor Output Sample Rate vs. Arduino Read Rate:**
   The MPU6050 accelerometer ADC and digital low-pass filter run internally at **1,000 Hz**. When `DLPF_CFG` is 1–6, the Gyroscope Output Rate is also **1,000 Hz**. The Sample Rate Divider (`SMPLRT_DIV = 4`) updates the user-facing output registers (`0x3B..0x40`) and asserts `DATA_RDY_INT` every $(1 + 4) = 5\text{ ms}$ (**200.0 Hz**). Because the Arduino only reads `0x3F..0x40` when `INT0` fires, the Arduino read rate is locked 1:1 to the sensor register update rate.
2. **How Genuinely Fresh Readings Are Identified:**
   Each rising edge on `D2` proves the MPU6050 has just latched a fresh sample into `ACCEL_ZOUT_H..L`. The ISR increments `volatile uint8_t g_isr_pending`. When `loop()` sees `g_isr_pending == 1`, the sample is guaranteed fresh.
3. **Whether Data-Ready Events Can Be Missed or Coalesced:**
   Yes—if `loop()` stalls for $>5,000\text{ }\mu\text{s}$ (e.g., if the 64-byte Serial TX buffer were ever allowed to fill and block), a second `DATA_RDY_INT` pulse arrives before the first is serviced. Because `g_isr_pending` is a counter rather than a boolean flag, `g_isr_pending` increments to $\ge 2$. `loop()` detects `pending > 1` and immediately logs `#ERR:OVERRUN,missed=<pending-1>,t_us=<sample_t_us>`.
4. **Whether a Register Read Could Return a Newer Measurement Than the Event Timestamped:**
   If `INT0` fires at $t_n = 0\text{ ms}$ and `loop()` were delayed until $4.95\text{ ms}$ before starting the I²C read, the next sensor update at $t_{n+1} = 5.00\text{ ms}$ could overwrite `ACCEL_ZOUT` right before or during the read. Under our design, the I²C burst read starts within ~10 µs of `INT0` and finishes in ~125 µs (at 400 kHz I²C), leaving a **4,865 µs safety margin** before the next register update. Additionally, firmware checks whether `g_isr_pending` became non-zero *during* the 125 µs I²C read itself to flag any race condition (`#WARN:LATE_READ`).
5. **What Can and Cannot Be Detected Without a Sensor Sequence Number:**
   - *Detectable:* Any CPU/UART delay causing missed interrupts (`g_isr_pending > 1`), I²C NACK/timeout faults, and any physical interrupt drop lasting $\ge 1$ period (visible as $\Delta t \approx 10,000\text{ }\mu\text{s}$ in `t_us`).
   - *Not directly numbered by silicon:* Because MPU6050 registers lack a rolling sample index byte, if the `INT` wire were physically disconnected and reconnected, the sensor does not report how many internal samples elapsed—Python detects the exact duration of the dropout from the `t_us` jump.
6. **Why This Approach Suits This School Experiment:**
   It uses only built-in Arduino libraries (`<Wire.h>`), requires 1 external wire (`INT -> D2`) beyond I²C, consumes <13% of the Uno's 2 KB SRAM, and achieves ~4 µs hardware timestamp accuracy without black-box DMP firmware blobs.

---

## B. VERIFIED CONFIGURATION TABLE & SELECTABLE FILTERING

### Verified Rate Equations & Selectable Filter Options
- **Gyroscope Output Rate:** 1 kHz when `DLPF_CFG = 1..6`; 8 kHz when `DLPF_CFG = 0` or `7`.
- **Accelerometer Internal Rate:** Fixed at 1 kHz.
- **Sample Rate Divider Equation:** $\text{Sample Rate} = \text{Gyroscope Output Rate} / (1 + \text{SMPLRT\_DIV})$.
- **Selectable Filter Rationale (21 Hz vs. 44 Hz) & Trial Lockout:** The initial brief specifies `DLPF_CFG = 4` (~21 Hz bandwidth) and a 2–30 Hz analysis band. Because 21 Hz is the $-3\text{ dB}$ corner, frequencies near 30 Hz experience $\approx -4.83\text{ dB}$ amplitude attenuation. Firmware therefore supports compile-time and serial-command (`'3'`/`'4'`) selection between `DLPF_CFG = 4` (21 Hz baseline) and `DLPF_CFG = 3` (44 Hz passband-flat option for 2–30 Hz), **locked strictly to idle periods between trials** so a single recording can never mix filter configurations.

| `DLPF_CFG` | `CONFIG (0x1A)` | Accel BW (-3 dB) | Accel Delay | Gyro BW (Rate) | `SMPLRT_DIV (0x19)` for 200 Hz | Gain @ 30 Hz | Gain @ 100 Hz (Nyquist) | Suitability for Bridge |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `0` | `0x00` | 260 Hz | 0.0 ms | 256 Hz (8 kHz) | `39` (`0x27`) | -0.06 dB | -0.60 dB | Not Recommended at 200 Hz |
| `1` | `0x01` | 184 Hz | 2.0 ms | 188 Hz (1 kHz) | `4` (`0x04`) | -0.11 dB | -1.13 dB | Not Recommended at 200 Hz |
| `2` | `0x02` | 94 Hz | 3.0 ms | 98 Hz (1 kHz) | `4` (`0x04`) | -0.42 dB | -3.28 dB | Wideband (Higher Aliasing Risk) |
| `3` | `0x03` | 44 Hz | 4.9 ms | 42 Hz (1 kHz) | `4` (`0x04`) | -1.66 dB | -7.90 dB | Recommended (2-30 Hz Flat) |
| `4` **(ACTIVE)** | `0x04` | 21 Hz | 8.5 ms | 20 Hz (1 kHz) | `4` (`0x04`) | -4.83 dB | -13.74 dB | Initial Baseline (21 Hz Corner) |
| `5` | `0x05` | 10 Hz | 13.8 ms | 10 Hz (1 kHz) | `4` (`0x04`) | -10.00 dB | -20.04 dB | Low-Freq Only (<10 Hz) |
| `6` | `0x06` | 5 Hz | 19.0 ms | 5 Hz (1 kHz) | `4` (`0x04`) | -15.68 dB | -26.03 dB | Low-Freq Only (<10 Hz) |

### Verified Register Map (Address `0x68`, `AD0 = GND`)
| Register Name | Addr (Hex) | R/W | Bitfields | Proposed Value | Verified Purpose & Primary Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `WHO_AM_I` | `0x75` | R | Bits [6:1] WHO_AM_I (Bit 7 & Bit 0 reserved = 0) | `0x68 (Expected)` (`01101000`) | Verifies I²C communication and identity of genuine MPU-6050 silicon before configuring registers (note: AD0 pin changes slave address 0x68/0x69, but WHO_AM_I always reads 0x68; some clones return 0x70/0x98). *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.32 (p. 45))* |
| `PWR_MGMT_1` | `0x6B` | R/W | Bit 7 DEVICE_RESET=0, Bit 6 SLEEP=0, Bit 5 CYCLE=0, Bit 3 TEMP_DIS=0, Bits [2:0] CLKSEL=001 | `0x01` (`00000001`) | Wakes device from default power-on SLEEP state (0x40) and locks clock source to PLL with X-axis gyroscope reference (CLKSEL=1) for superior frequency stability over the internal 8 MHz RC oscillator (CLKSEL=0). *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.28 (p. 40))* |
| `CONFIG` | `0x1A` | R/W | Bits [5:3] EXT_SYNC_SET=000 (disabled), Bits [2:0] DLPF_CFG=4 (21 Hz Accel BW) | `0x04` (`00000100`) | Sets Digital Low-Pass Filter to DLPF_CFG=4: Accelerometer BW = 21 Hz (delay 8.5 ms, 1 kHz Fs); Gyro BW = 20 Hz (1 kHz internal output rate). *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.3 (p. 13))* |
| `SMPLRT_DIV` | `0x19` | R/W | Bits [7:0] SMPLRT_DIV = 4 | `0x04` (`00000100`) | Divides Gyroscope Output Rate (1000 Hz) by (1 + 4) = 5 to yield exactly 200.0 Hz Sample Rate and 200.0 Hz DATA_RDY_INT assertion. *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.2 (p. 11–12))* |
| `ACCEL_CONFIG` | `0x1C` | R/W | Bits [7:5] XA_ST/YA_ST/ZA_ST=000 (Self-test off), Bits [4:3] AFS_SEL=00 (±2g) | `0x00` (`00000000`) | Selects ±2g full-scale range (sensitivity = 16,384 LSB/g, resolution ≈ 0.00059855 m/s²/LSB) for maximum sensitivity to gentle midspan free vibrations. *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.5 (p. 15))* |
| `USER_CTRL` | `0x6A` | R/W | Bit 6 FIFO_EN=0, Bit 5 I2C_MST_EN=0, Bit 2 FIFO_RESET=0 | `0x00` (`00000000`) | Explicitly disables the internal 1024-byte hardware FIFO and auxiliary I²C master so direct sensor output registers update synchronously at 200 Hz. *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.27 (p. 38))* |
| `FIFO_EN` | `0x23` | R/W | All bits [7:0] = 0 (TEMP/GYRO/ACCEL/SLV FIFO routing off) | `0x00` (`00000000`) | Confirms no sensor channels are routed into the FIFO buffer. *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.6 (p. 16))* |
| `INT_PIN_CFG` | `0x37` | R/W | Bit 7 INT_LEVEL=0 (active high), Bit 6 INT_OPEN=0 (push-pull), Bit 5 LATCH_INT_EN=0 (50 µs pulse), Bit 4 INT_RD_CLEAR=1 | `0x10` (`00010000`) | Configures INT pin as active-high, push-pull 3.3 V output emitting a clean 50 µs pulse on each new sample; RISING edge on Uno D2 (INT0) triggers immediately without requiring an extra I²C read of INT_STATUS (0x3A) on every sample. *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.14 (p. 26))* |
| `INT_ENABLE` | `0x38` | R/W | Bit 4 FIFO_OFLOW_EN=0, Bit 3 I2C_MST_INT_EN=0, Bit 0 DATA_RDY_EN=1 | `0x01` (`00000001`) | Enables the Data Ready interrupt (DATA_RDY_EN), firing once every 5,000 µs (200 Hz) when sensor output registers finish updating. *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.15 (p. 27))* |
| `ACCEL_ZOUT_H / L` | `0x3F / 0x40` | R | ACCEL_ZOUT_H [15:8] (0x3F), ACCEL_ZOUT_L [7:0] (0x40) — two’s complement int16_t | `2-Byte Burst Read` (`Big-Endian MSB:LSB`) | High and low bytes of Z-axis specific force measurement. Must be read as a contiguous 2-byte I²C burst starting at 0x3F so the internal shadow register guarantees MSB/LSB coherence from the same sample. *(MPU-6000/MPU-6050 Register Map Rev 4.2, Sec 4.17 (p. 29))* |

---

## C. ACQUISITION STATE MACHINE & CONCISE PSEUDOCODE

### State Machine Lifecycle
1. **STATE 0 — BOOT & BUS INIT:** Initialize `Serial` at 115200 baud, initialize `Wire`, immediately disable ATmega328P internal 5 V pull-ups on `A4/A5`, set I²C clock to 400 kHz, and enable a 3,000 µs I²C hardware timeout (`Wire.setWireTimeout(3000, true)`).
2. **STATE 1 — SENSOR IDENTITY & REGISTER VERIFICATION:** Read `WHO_AM_I (0x75)` and verify it equals `0x68`. Write `PWR_MGMT_1`, wait 100 ms, then write and read-back verify `USER_CTRL`, `FIFO_EN`, `CONFIG`, `SMPLRT_DIV`, `ACCEL_CONFIG`, `INT_PIN_CFG`, and `INT_ENABLE`. Any mismatch transitions to **STATE 5 (FAULT)**.
3. **STATE 2 — SETTLING & WARM-UP:** Wait for and discard the first 10 `DATA_RDY_INT` samples (50 ms) so the digital low-pass filter (`DLPF`) step response settles completely. Print `#BRIDGE-X`, `#COLUMNS`, and `#START:TRIAL` headers.
4. **STATE 3 — ACTIVE 200 HZ ACQUISITION (SETTINGS LOCKED):** On each `INT0` rising edge, ISR captures `micros()` and increments `g_isr_pending`. `loop()` rejects any `'3'`/`'4'` filter-change commands (`#WARN:CMD_LOCKED`), atomically snapshots `g_isr_t_us` and `g_isr_pending`, logs `#ERR:OVERRUN` if `pending > 1`, performs a 2-byte burst read of `0x3F..0x40`, checks for late-read races (`#WARN:LATE_READ`) and saturation near $\pm 32760\text{ LSB}$ (`#WARN:CLIP`), and prints `t_us,az_m_s2\n`.
5. **STATE 4 — TRIAL COMPLETION & IDLE:** Upon reaching 2,000 valid samples, print `#END:CLEAN,...` **only** if all fault counters are zero; otherwise print `#END:DEGRADED,status=POTENTIALLY_INVALID,...`. Then wait non-blockingly in idle state where `'3'`/`'4'` (switch DLPF bandwidth) and `'R'` (start next trial) are accepted.
6. **STATE 5 — FAULT / ABORT:** Detach `INT0`, emit `#ERR:...` and `#END:ABORT,reason=...`, and wait for manual reset or `'R'`.

### Concise Pseudocode
```cpp
volatile uint32_t g_isr_t_us = 0;
volatile uint8_t  g_isr_pending = 0;

void onMpuDataReadyISR() { // INT0 (Pin D2), RISING edge — ~3.5 us execution
  g_isr_t_us = micros();
  if (g_isr_pending < 255) g_isr_pending++;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  digitalWrite(SDA, LOW); digitalWrite(SCL, LOW); // Disable Uno internal 5V pull-ups
  Wire.setClock(400000UL);
  Wire.setWireTimeout(3000, true);

  if (readReg(0x68, 0x75) != 0x68) {
    Serial.print("#ERR:WHO_AM_I\n#END:ABORT,reason=WHO_AM_I\n");
    while (1) {}
  }
  writeAndVerifyReg(0x68, 0x6B, 0x01); // Wake, PLL with X-axis gyro reference
  delay(100);
  writeAndVerifyReg(0x68, 0x6A, 0x00); // USER_CTRL: FIFO off
  writeAndVerifyReg(0x68, 0x23, 0x00); // FIFO_EN: off
  writeAndVerifyReg(0x68, 0x1A, 0x04); // CONFIG: DLPF_CFG = 4 (21 Hz)
  writeAndVerifyReg(0x68, 0x19, 0x04); // SMPLRT_DIV = 4 -> 200 Hz
  writeAndVerifyReg(0x68, 0x1C, 0x00); // ACCEL_CONFIG: +/- 2g (16384 LSB/g)
  writeAndVerifyReg(0x68, 0x37, 0x10); // INT_PIN_CFG: 50 us push-pull pulse
  writeAndVerifyReg(0x68, 0x38, 0x01); // INT_ENABLE: DATA_RDY_EN

  pinMode(2, INPUT); // NEVER INPUT_PULLUP
  attachInterrupt(digitalPinToInterrupt(2), onMpuDataReadyISR, RISING);
  discardWarmupSamples(10);
  printTrialHeader();
}

void loop() {
  pollSerialCommands(); // Rejects '3'/'4' with #WARN:CMD_LOCKED while trial_active == true
  if (!trial_active) return;

  noInterrupts();
  uint8_t  pending     = g_isr_pending;
  uint32_t sample_t_us = g_isr_t_us;
  g_isr_pending = 0;
  interrupts();

  if (pending == 0) return;
  if (pending > 1) {
    total_overruns += (pending - 1);
    Serial.print("#ERR:OVERRUN,missed="); Serial.print(pending - 1);
    Serial.print(",t_us="); Serial.print(sample_t_us); Serial.print('\n');
  }

  int16_t raw_az = 0;
  if (!readAccelZBurst(0x68, &raw_az)) {
    total_i2c_errs++;
    Serial.print("#ERR:I2C,t_us="); Serial.print(sample_t_us); Serial.print('\n');
    if (++consecutive_i2c_errs >= 5) abortTrial("I2C_FAULT");
    return;
  }
  consecutive_i2c_errs = 0;

  if (raw_az <= -32760 || raw_az >= 32760) {
    total_clips++;
    Serial.print("#WARN:CLIP,raw="); Serial.print(raw_az);
    Serial.print(",t_us="); Serial.print(sample_t_us); Serial.print('\n');
  }

  float az_m_s2 = (float)raw_az * (9.80665f / 16384.0f);
  Serial.print(sample_t_us); Serial.print(',');
  Serial.print(az_m_s2, 4);  Serial.print('\n');

  if (++samples_collected >= 2000) finishTrial(); // Prints #END:CLEAN only if all fault counters == 0; else #END:DEGRADED
}
```

---

## D. TIMING, MEMORY & THROUGHPUT CALCULATIONS

- **Timestamp Semantics (`t_us`):** Represents the `micros()` value latched inside the `INT0` ISR upon the rising edge of `DATA_RDY_INT`.
  - *Filter Group Delay:* Constant 8.5 ms (for `DLPF_CFG = 4`), which shifts the entire waveform uniformly without altering inter-sample spacing $\Delta t$.
  - *ISR Latency & Resolution:* ~3.5 µs interrupt entry latency; `micros()` has 4 µs quantization on 16 MHz AVR.
  - *Why USB Arrival Time Must Never Be Used:* Windows USB-serial drivers buffer incoming packets on 1–16 ms USB frame boundaries, which would inject severe artificial jitter into a 5.00 ms (200 Hz) signal.
- **CSV Line Length:**
  - Typical numeric row (`12500000,9.8124\n`): **16 bytes**.
  - Worst-case numeric row (`4294967295,-19.6133\n`): **20 bytes** (10-digit `uint32_t` max + comma + sign + 2 integer digits + decimal point + 4 fractional digits + `\n`).
- **UART Capacity & 64-Byte Buffer Blocking Analysis:**
  - At **115200 baud (8N1 = 10 bits/byte)**, maximum channel capacity is $115,200 / 10 = 11,520\text{ bytes/s}$ ($86.81\text{ }\mu\text{s/byte}$).
  - At 200 Hz, 16–20 bytes/sample equals **3,200 to 4,000 bytes/s** (**27.8% to 34.7% of UART capacity**).
  - Transmitting a 20-byte line takes $20 \times 86.81\text{ }\mu\text{s} = 1,736\text{ }\mu\text{s}$, so the Uno's 64-byte `HardwareSerial` TX ring buffer completely drains $3,264\text{ }\mu\text{s}$ before the next 5,000 µs interrupt occurs. Blocking risk during normal operation is **zero**.
- **I²C Transaction Duration & Timing Margin:**
  - A 2-byte burst read of `0x3F..0x40` requires ~47 I²C bit periods plus TWI state machine overhead: **~125 µs at 400 kHz Fast Mode** (or ~475 µs at 100 kHz Standard Mode).
  - Total CPU work per 5,000 µs period (ISR ~4 µs + I²C ~125 µs + float formatting & `Serial.print` buffer copy ~210 µs) is **~340 µs**, leaving **4,660 µs (93.2%) CPU idle margin**.
- **SRAM Footprint (out of 2,048 Bytes on ATmega328P):**
  - `HardwareSerial` RX + TX buffers: 128 B
  - `Wire` (`twi`) buffers: 96 B
  - Global state & stack variables: ~26 B
  - **Total SRAM:** ~250 Bytes (**12.2% of 2 KB**), leaving >1,750 Bytes free.

---

## E. EXACT SERIAL-DATA CONTRACT

- **Numeric Data Rows:** `unsigned_timestamp_us,signed_acceleration_m_s2\n`
  - Example: `1250000,9.8124\n`
  - Units: microseconds (`uint32_t`) and meters per second squared ($	ext{m/s}^2$, 4 decimal places, where $+1g = 9.80665\text{ m/s}^2$).
  - Line Terminator: LF (`\n`, `0x0A`).
- **Diagnostic & Lifecycle Lines (Prefixed with `#`, never extra CSV columns):**
  - `#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4,bw_hz=21,delay_ms=8.5,range_g=2`
  - `#COLUMNS:t_us,az_m_s2`
  - `#START:TRIAL,target_samples=2000`
  - `#ERR:OVERRUN,missed=<N>,t_us=<uint32_t>`
  - `#ERR:I2C,code=<err>,t_us=<uint32_t>`
  - `#WARN:CLIP,raw=<int16_t>,t_us=<uint32_t>`
  - `#WARN:LATE_READ,t_us=<uint32_t>`
  - `#WARN:CMD_LOCKED,msg=Cannot_change_DLPF_during_active_trial`
  - `#END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0` *(emitted ONLY when all fault counters are zero)*
  - `#END:DEGRADED,status=POTENTIALLY_INVALID,samples=2000,overruns=<N>,i2c_errs=<N>,clips=<N>,late_reads=<N>` *(emitted whenever any overrun, I²C error, clip, or late read occurred during the 2,000 samples)*
  - `#END:ABORT,reason=<REASON>,samples=<N>`

---

## F. PYTHON READER RESPONSIBILITIES & RING-DOWN SIGNAL PROCESSING PIPELINE

```python
#!/usr/bin/env python3
"""
BRIDGE-X Experimental Vibration Acquisition, Validator & Ring-Down Modal FFT Analyzer
IB Physics Collaborative Sciences Project
Compatible with the BRIDGE-X Arduino Uno R3 Serial Data Contract (115200 baud).

Includes:
- Wrap-safe uint32 timestamp validation & #END:CLEAN vs #END:DEGRADED status checking
- Decaying-vibration sub-window selection (auto ring-down onset detection or custom [t_start, t_end])
  so a 10-second Hann window does not suppress early high-SNR free-vibration data after release.
"""

import sys
import csv
import json
import math
import argparse
from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional, Dict
import numpy as np

# Provisional Commissioning Criteria (Subject to Pilot Validation on Bridge)
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

def parse_bridge_x_stream(lines: List[str], condition: str = "unspecified") -> Tuple[np.ndarray, np.ndarray, List[str], TrialDiagnostics]:
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
            provenance=provenance, condition=condition, sample_count=n,
            duration_s=0.0, effective_fs_hz=0.0, median_dt_us=0.0,
            p99_jitter_us=0.0, max_gap_us=0.0, wrap_events=0,
            non_monotonic_count=0, overrun_lines=overrun_lines,
            i2c_error_lines=i2c_error_lines, clip_count=clip_count,
            end_status=end_status, verdict="REJECT",
            reasons=["Insufficient numeric samples (< 2)."],
            mean_az_m_s2=0.0, rms_dynamic_m_s2=0.0
        )
        return np.array([]), np.array([]), diagnostics, diag

    # Wrap-safe uint32 delta calculation
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
        provenance=provenance, condition=condition, sample_count=n,
        duration_s=duration_s, effective_fs_hz=effective_fs,
        median_dt_us=median_dt, p99_jitter_us=p99_jitter,
        max_gap_us=max_gap, wrap_events=wrap_events,
        non_monotonic_count=non_monotonic, overrun_lines=overrun_lines,
        i2c_error_lines=i2c_error_lines, clip_count=clip_count,
        end_status=end_status, verdict=verdict, reasons=reasons,
        mean_az_m_s2=mean_az, rms_dynamic_m_s2=rms_dyn
    )
    return unwrapped_us * 1e-6, az_arr, diagnostics, diag

def detect_ringdown_onset_s(t_s: np.ndarray, az_zero_mean: np.ndarray) -> float:
    """Finds the start of the free-vibration decay so the window focuses on the active ring-down."""
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
    """Returns a Hann, Tukey (alpha=0.25), or Rectangular window of length n."""
    if window_type == "rectangular":
        return np.ones(n, dtype=np.float64)
    if window_type == "tukey":
        # Tukey window with alpha=0.25 preserves early ring-down amplitude while tapering edges
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
    window_type: str = "hann"
):
    """
    Slices the active decaying vibration sub-window [t_start, t_end] (or auto-detects release
    onset + ringdown_duration_s), removes empirical mean, applies the selected window
    (Hann, Tukey alpha=0.25, or Rectangular), and zero-pads to at least 2048 points.
    """
    full_mean = float(np.mean(az_m_s2))
    az_Full_zero = az_m_s2 - full_mean

    if t_start is None:
        t_start = detect_ringdown_onset_s(t_s, az_Full_zero)
    if t_end is None:
        t_end = min(float(t_s[-1]), t_start + ringdown_duration_s)

    sub_mask = (t_s >= t_start) & (t_s <= t_end)
    if np.sum(sub_mask) < 32:
        sub_mask = np.ones_like(t_s, dtype=bool)

    t_sub = t_s[sub_mask]
    az_sub = az_m_s2[sub_mask]
    n_sub = len(az_sub)
    fs = (n_sub - 1) / (t_sub[-1] - t_sub[0])

    # 1. Remove empirical sub-window mean (eliminates gravity + tilt + sensor zero-g offset)
    az_zero_mean = az_sub - np.mean(az_sub)
    # 2. Apply selected window with coherent gain correction
    window = make_taper_window(n_sub, window_type=window_type)
    coherent_gain = float(np.mean(window))
    y_win = az_zero_mean * window
    # 3. Zero-pad to at least 2048 points for smooth peak frequency interpolation
    n_fft = max(2048, 1 << int(math.ceil(math.log2(n_sub))))
    spec = np.fft.rfft(y_win, n=n_fft)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / fs)
    amps = (2.0 / (n_sub * coherent_gain)) * np.abs(spec)
    # 4. Identify peak within the target structural mode window [f_min, f_max]
    mask = (freqs >= f_min) & (freqs <= f_max)
    band_freqs = freqs[mask]
    band_amps = amps[mask]
    peak_idx = int(np.argmax(band_amps))
    true_bin_spacing_hz = fs / n_sub
    return freqs, amps, float(band_freqs[peak_idx]), float(band_amps[peak_idx]), true_bin_spacing_hz, (float(t_sub[0]), float(t_sub[-1]))

```

---

## G. ACCEPTANCE TESTS, PROVISIONAL COMMISSIONING CRITERIA & FAILURE RESPONSES

1. **Stationary & Orientation Check:** `WHO_AM_I == 0x68`; stationary mean $\bar{a}_z \in [+9.0, +10.6]\text{ m/s}^2$ (+Z vertical up), dynamic RMS noise $< 0.08\text{ m/s}^2$. Inverted board reads $\approx -9.81\text{ m/s}^2$.
2. **Sample Rate, Jitter & Clean Footer Verification:** Median $\Delta t \in [4950, 5050]\text{ }\mu\text{s}$ ($200 \pm 2\text{ Hz}$); 99th-percentile jitter $\le 250\text{ }\mu\text{s}$; maximum gap $\le 15,000\text{ }\mu\text{s}$; trial footer must be `#END:CLEAN` (any `#END:DEGRADED` trial is flagged as potentially invalid).
3. **Gentle Excitation & Saturation Check:** Controlled finger release or thread-cut deflection at midspan producing peak $|a_z| < 19.20\text{ m/s}^2$ (zero `#WARN:CLIP` lines).
4. **What to Do If Brace Removal Produces No Repeatable Frequency Shift ($|\Delta f| \le \max(\Delta f_{\text{bin}}, 2 s_f)$):**
   - Do **not** perform destructive testing or invent frequency shifts.
   - Check whether the removable brace sits near a zero-strain nodal point of the fundamental bending mode.
   - Check whether joint friction or permanent gussets dominate low-amplitude stiffness.
   - Perform a non-destructive positive-control test by clamping a known reversible mass (e.g., 100 g or 200 g) at midspan to verify the measurement chain resolves the theoretical mass-loading shift $f \propto (m_{\text{eff}} + \Delta m)^{-1/2}$.
   - Repeat using `DLPF_CFG = 3` (44 Hz BW, selected between trials) to inspect second/higher vibration modes between 20 Hz and 35 Hz.

---

## H. GY-521 POWER, I²C VOLTAGE COMPATIBILITY & PRE-POWER HARDWARE CHECKLIST

1. **Verify Electronics Before Powering:** Before connecting USB or 5 V power, visually inspect the GY-521 breakout for the 5-pin SOT-23 3.3 V LDO regulator and verify with a multimeter (unpowered) that the onboard pull-up resistors on `SDA` and `SCL` connect to the 3.3 V LDO output rail, not to `VCC`.
2. **GY-521 Power Supply (`VCC`):** Connect `GY-521 VCC` to **Arduino Uno `5V`** (not `3.3V`) when the onboard 3.3 V LDO regulator is present (dropout ~150 mV). Feeding 3.3 V into `VCC` starves the LDO output to ~3.0–3.1 V.
3. **I²C Logic Level Compatibility (`SDA/A4`, `SCL/A5`) — Keep Level Shifter Recommendation:**
   - MPU6050 `VLOGIC` is 3.3 V (max pin rating $V_{\text{LOGIC}} + 0.5\text{ V} = 3.80\text{ V}$).
   - ATmega328P hardware TWI (`A4/A5`) requires $V_{IH(\min)} = 0.7 \times V_{CC} = 3.50\text{ V}$ when powered at $5.0\text{ V}$.
   - **Recommended Wiring:** Place the **bidirectional MOSFET level shifter** (`LV = 3.3V`, `HV = 5V`) between Uno `A4/A5` and GY-521 `SDA/SCL`, especially until the exact GY-521 breakout's voltage requirements have been verified on the bench.
   - **Direct-Wire Mitigation:** Firmware also executes `digitalWrite(SDA, LOW); digitalWrite(SCL, LOW);` immediately after `Wire.begin()` to disable the Uno's internal 20–50 kΩ pull-ups to 5 V.
4. **Interrupt Pin (`GY-521 INT` → `Uno D2`):** Configure `INT_PIN_CFG = 0x10` (3.3 V active-high push-pull) and Uno `pinMode(2, INPUT)` (never `INPUT_PULLUP`). Standard AVR GPIO `D2` has $V_{IH(\min)} = 0.6 \times V_{CC} = 3.00\text{ V} < 3.30\text{ V}$.

---

================================================================================
SECTION I: SPECIFICATION TO PASTE INTO GEMINI (BRIDGE-X ARDUINO UNO FIRMWARE)
================================================================================

ROLE AND OBJECTIVE
You are writing production-quality, deterministic Arduino Uno R3 (ATmega328P) C++ firmware (.ino) for the BRIDGE-X IB Physics structural vibration experiment. Follow every normative requirement below using RFC-2119 keywords (MUST, MUST NOT, SHOULD, MAY). All architectural decisions have already been resolved; do NOT invent alternative architectures, third-party MPU6050 libraries, or modified CSV column layouts.

1. HARDWARE & INTERFACE CONSTRAINTS
- Target MCU: Arduino Uno R3 (ATmega328P, 16 MHz, 2 KB SRAM).
- Sensor: MPU-6050 on GY-521 breakout at 7-bit I²C address 0x68 (AD0 = GND).
- Pre-Power Verification & Recommended Wiring:
  * Before applying power, inspect the breakout board and verify with a multimeter whether an onboard 3.3 V LDO regulator and 3.3 V pull-ups are fitted.
  * Uno 5V -> GY-521 VCC (feeds onboard 3.3 V LDO regulator; if using a bare 3.3 V module without an LDO, connect to 3.3V).
  * Uno GND -> GY-521 GND.
  * Uno A4 (SDA) & A5 (SCL) -> GY-521 SDA & SCL via a bidirectional I²C level shifter (LV = 3.3V, HV = 5V). Keep the level shifter in place, especially until the exact GY-521 breakout's voltage requirements are verified on the bench.
  * GY-521 INT -> Uno Digital Pin 2 (INT0 external interrupt).
- Libraries: Firmware MUST use ONLY the built-in Arduino <Wire.h> and <Arduino.h> headers. Firmware MUST NOT include <I2Cdev.h>, <MPU6050.h>, <Adafruit_MPU6050.h>, or use the C++ String class or dynamic heap allocation (malloc/new).

2. SELECTABLE DLPF CONFIGURATION & REGISTER INITIALIZATION
- Firmware MUST define a compile-time constant `#define BRIDGE_X_DLPF_CFG 4` (currently set to DLPF_CFG = 4 for 21 Hz accelerometer bandwidth, 8.5 ms group delay) and support changing it between trials:
  * `4`: 21 Hz Accel BW, 8.5 ms delay (initial project baseline; note -4.8 dB roll-off at 30 Hz)
  * `3`: 44 Hz Accel BW, 4.9 ms delay (passband-preserving option for full 2–30 Hz bridge analysis)
  * `2`: 94 Hz Accel BW, 3.0 ms delay (wideband option)
  * `5`: 10 Hz Accel BW, 13.8 ms delay (low-frequency fundamental-only option)
- Immediately after calling `Wire.begin()`, firmware MUST disable the ATmega328P internal 5 V pull-up resistors on A4/A5 (`digitalWrite(SDA, LOW); digitalWrite(SCL, LOW);`) before any I²C traffic to prevent pulling the 3.3 V GY-521 bus toward 5 V, and then set `Wire.setClock(400000UL)` (400 kHz Fast Mode) and `Wire.setWireTimeout(3000, true)` (3,000 µs timeout with bus reset on lockup).
- Firmware MUST verify `WHO_AM_I` (register `0x75`). If the returned byte is not `0x68`, firmware MUST print `#ERR:WHO_AM_I,val=0xXX` and halt in a fault state.
- Firmware MUST write and verify via read-back the following exact registers on address `0x68`:
  1. `PWR_MGMT_1 (0x6B) = 0x01` (Wake from sleep, CLKSEL = 1 PLL with X-axis gyro reference; wait 100 ms after write for PLL lock and filter settling).
  2. `USER_CTRL  (0x6A) = 0x00` (Disable FIFO and auxiliary I²C master).
  3. `FIFO_EN    (0x23) = 0x00` (Route no channels to FIFO).
  4. `CONFIG     (0x1A) = 0x04` (EXT_SYNC_SET = 0, DLPF_CFG = 4 -> 21 Hz Accel BW, 1 kHz gyro output rate).
  5. `SMPLRT_DIV (0x19) = 0x04` (Divider = 4 -> Sample Rate = 1000 / (1 + 4) = 200.0 Hz).
  6. `ACCEL_CONFIG (0x1C) = 0x00` (AFS_SEL = 0 -> ±2g full scale = 16,384 LSB/g).
  7. `INT_PIN_CFG  (0x37) = 0x10` (Active-high, push-pull, 50 µs pulse, INT_RD_CLEAR = 1).
  8. `INT_ENABLE   (0x38) = 0x01` (DATA_RDY_EN = 1).

3. INTERRUPT SERVICE ROUTINE (ISR) & ATOMICITY
- Attach `INT0` on `digitalPinToInterrupt(2)` with mode `RISING`.
- Inside the ISR:
  * Capture `isr_timestamp_us = micros();`
  * Increment `volatile uint8_t isr_pending_count;` (saturating at 255).
  * Perform NO I²C reads, NO floating-point math, and NO Serial printing inside the ISR.
- In `loop()`:
  * Enter a brief critical section (`noInterrupts();`), copy `isr_timestamp_us` to a local `uint32_t sample_t_us` and `isr_pending_count` to `uint8_t pending`, reset `isr_pending_count = 0;`, and immediately restore interrupts (`interrupts();`).
  * If `pending == 0`, return immediately.
  * If `pending > 1`, record an overrun fault and emit a diagnostic line `#ERR:OVERRUN,missed=<pending-1>,t_us=<sample_t_us>\n` BEFORE emitting the newly read sample row. Firmware MUST NEVER fabricate synthetic intermediate timestamps or duplicate samples to hide a gap.

4. I²C BURST READ & PHYSICAL UNIT CONVERSION
- For each acquired event, perform a 2-byte burst read from register `0x3F` (`ACCEL_ZOUT_H` and `ACCEL_ZOUT_L`):
  * `Wire.beginTransmission(0x68); Wire.write(0x3F); uint8_t err = Wire.endTransmission(false);`
  * `uint8_t n = Wire.requestFrom((uint8_t)0x68, (uint8_t)2, (uint8_t)true);`
  * If `err != 0` or `n != 2`, increment `i2c_error_count`, emit `#ERR:I2C,code=<err>,t_us=<sample_t_us>\n`, and do NOT print a bogus numeric row. If `i2c_error_count >= 5` consecutive failures, emit `#END:ABORT,reason=I2C_FAULT\n` and halt.
- Reconstruct the signed 16-bit integer safely:
  * `int16_t raw_az = (int16_t)(((uint16_t)msb << 8) | (uint16_t)lsb);`
- Convert to vertical specific force in m/s² without subtracting 9.81 on the Arduino:
  * `const float LSB_TO_MS2 = 9.80665f / 16384.0f; // 0.0005985504f m/s^2 per LSB`
  * `float az_m_s2 = (float)raw_az * LSB_TO_MS2;`
- Check for sensor saturation (`raw_az <= -32760 || raw_az >= 32760`): if saturated, increment `total_clips` and emit `#WARN:CLIP,raw=<raw_az>,t_us=<sample_t_us>\n`.
- Check for late-read race (`g_isr_pending > 0` immediately after the I²C burst read): if non-zero, increment `total_late_reads` and emit `#WARN:LATE_READ,t_us=<sample_t_us>\n`.

5. SERIAL DATA CONTRACT, LOCKED SETTINGS & TRIAL LIFECYCLE
- Configure `Serial.begin(115200)`.
- Use `\n` (LF, `Serial.print('\n')`) line endings on all output lines to minimize UART framing overhead.
- On startup (after settling 100 ms and discarding the first 10 warm-up samples), emit metadata header lines prefixed with `#`:
  * `#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4,bw_hz=21,delay_ms=8.5,range_g=2\n`
  * `#COLUMNS:t_us,az_m_s2\n`
  * `#START:TRIAL,target_samples=2000\n`
- For each valid sample, emit exactly two comma-separated numeric fields with 4 decimal places on `az_m_s2`:
  * `<sample_t_us>,<az_m_s2_with_4_decimals>\n` (Example: `1245000,9.8124\n`).
- Firmware MUST collect `TARGET_SAMPLES = 2000` valid samples per trial, and upon completing 2,000 samples MUST distinguish a genuinely clean trial from a degraded/potentially invalid trial:
  * ONLY if `total_overruns == 0 && total_i2c_errs == 0 && total_clips == 0 && total_late_reads == 0`, emit:
    `#END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0\n`
  * Otherwise (if ANY overrun, I²C error, saturation clip, or late read occurred during the trial), firmware MUST NOT print `#END:CLEAN`; it MUST emit:
    `#END:DEGRADED,status=POTENTIALLY_INVALID,samples=2000,overruns=<total_overruns>,i2c_errs=<total_i2c_errs>,clips=<total_clips>,late_reads=<total_late_reads>\n`
- Firmware MUST lock sensor filter settings during an active trial:
  * Command `'R'` -> Reset counters and start a fresh 2,000-sample trial immediately without requiring USB DTR reboot.
  * Commands `'3'` or `'4'` -> Switch `CONFIG (0x1A)` between `DLPF_CFG=3` (44 Hz) and `DLPF_CFG=4` (21 Hz) ONLY when a trial is NOT active (`STATE_IDLE_COMPLETE` or `STATE_FAULT_ABORTED`). If `'3'` or `'4'` is received during `STATE_ACTIVE_TRIAL`, firmware MUST ignore the change and emit `#WARN:CMD_LOCKED,msg=Cannot_change_DLPF_during_active_trial\n` so a single recording never mixes two filter configurations.
================================================================================

---

# BRIDGE-X — ARDUINO NANO (ATMEGA328P) FIRMWARE IMPLEMENTATION, WIRING & COMMISSIONING GUIDE (SECTIONS A – H)

---

## A. ACQUISITION DESIGN, TIMING SEMANTICS & ENGINEERING TRADE-OFFS

1. **Sensor Output Rate vs. Arduino Read Rate vs. Serial Transmission Rate**:
   - **Internal Sensor ADC & DLPF Rate (1,000 Hz):** Inside the MPU-6050, the MEMS accelerometer ADC and Digital Low-Pass Filter (DLPF) run at a fixed internal rate of **1 kHz**. When `DLPF_CFG` is set to `1..6` (we initialize `DLPF_CFG = 4`, ~21 Hz bandwidth), the internal Gyroscope Output Rate is also **1 kHz**.
   - **Sensor Register Update & Interrupt Rate (200.0 Hz):** Register `SMPLRT_DIV (0x19) = 4` divides the 1 kHz rate by $(1 + 4) = 5$, latching a fresh acceleration measurement into `ACCEL_ZOUT_H..L (0x3F..0x40)` and emitting a 50 µs active-high hardware pulse on the `INT` pin every **5,000 µs (200.0 Hz)**.
   - **Arduino Read Rate (200.0 Hz, Phase-Locked):** Rather than polling `micros()` every 5,000 µs—which drifts relative to the sensor because the Arduino Nano's 16 MHz ceramic resonator (~±0.5% tolerance) and the MPU-6050's MEMS PLL oscillator run on independent clocks—the Nano triggers an external interrupt (`INT0` on Pin `D2`) on every rising edge of `INT`. This guarantees that every I²C burst read fetches a genuinely fresh sample.
   - **Serial Transmission Rate (115200 Baud = 11,520 Bytes/s):** Each sample row (`t_us,az_m_s2\n`) is 16–20 bytes long. At 200 samples/s, the data stream consumes **3,200–4,000 bytes/s** (~31% of the 115200 8N1 UART capacity). Each 20-byte line drains from the Nano's 64-byte `Serial` TX ring buffer in **1,736 µs**, finishing 3.26 ms before the next 5,000 µs interrupt arrives.
2. **Timestamp Semantics (`t_us`) & Wrap-Safe Arithmetic**:
   - `t_us` records the unsigned 32-bit `micros()` value captured inside `onMpuDataReadyISR()` within ~3.5 µs of the MPU-6050 asserting `DATA_RDY_INT`.
   - On a 16 MHz Arduino Nano (ATmega328P), `micros()` has a resolution of **4 µs** and wraps from `4,294,967,295` (`0xFFFFFFFF`) back to `0` every **71.58 minutes** ($2^{32}\text{ }\mu\text{s}$). Unsigned modular subtraction (`uint32_t dt = t_curr - t_prev` in C++, or `(t_curr - t_prev) % (1 << 32)` in Python) is wrap-safe across rollover.
   - Note that the MPU-6050's internal digital low-pass filter adds a constant deterministic group delay (**8.5 ms** at `DLPF_CFG = 4`, or **4.9 ms** at `DLPF_CFG = 3`). Because this delay is constant across the passband, it shifts the entire time axis by a fixed offset without altering sample-to-sample spacing $\Delta t$ or FFT modal frequencies.
3. **Why We Do Not Subtract 9.81 on the Arduino**:
   - The MPU-6050 Z-axis factory zero-$g$ offset tolerance is $\pm 80\text{ mg}$ ($\pm 0.78\text{ m/s}^2$), and any slight bridge deck tilt scales static gravity by $g\cos\theta$. Subtracting a hardcoded `9.81` in firmware leaves a residual DC step that causes severe 0 Hz spectral leakage into the 2–5 Hz band when windowed. Streaming total vertical specific force (reading $\approx +9.81\text{ m/s}^2$ at rest) lets you verify sensor orientation immediately and allows Python to subtract the exact empirical mean $\bar{a}_z$ of each trial.
4. **Clipping Detection, Orientation & Why Acceleration $\ne$ Direct Displacement**:
   - At $\pm 2g$ full scale (`16,384 LSB/g`), the 16-bit signed ADC clips at $-32768 / +32767\text{ LSB}$ ($\approx \pm 19.61\text{ m/s}^2$). Since gravity already biases the Z-axis to $+1g$ ($+9.81\text{ m/s}^2$), upward dynamic acceleration saturates at $+1g$ dynamic ($+2g$ total). If `|raw_az| >= 32760`, firmware emits `#WARN:CLIP`.
   - For a harmonic vibration mode $z(t) = Z_0 \sin(2\pi f t)$, vertical acceleration is the second time derivative: $a_z(t) = -(2\pi f)^2 z(t)$. Peak frequencies in the acceleration FFT are identical to displacement modal frequencies, while acceleration amplitudes scale by $(2\pi f)^2$ (enhancing higher-frequency modes relative to displacement and avoiding double-integration drift).
5. **21 Hz Filter Behavior in the 2–30 Hz Band, Locked Trial Settings & Decaying-Vibration Windowing**:
   - `DLPF_CFG = 4` has a $-3\text{ dB}$ corner at **21 Hz**, which attenuates signal amplitude near **30 Hz by ~4.8 dB (~43%)** while preserving peak frequency location. Moreover, it is a gradual low-order digital filter running at 1 kHz—not a brick-wall anti-alias filter at the 100 Hz Nyquist frequency (~13.7 dB rejection at 100 Hz). Use gentle finger-release deflection (never a hard metal hammer tap), and use the built-in `'3'` serial command **between trials** to switch to `DLPF_CFG = 3` (**44 Hz bandwidth**, only $-1.66\text{ dB}$ loss at 30 Hz) if modes between 20 Hz and 30 Hz are studied.
   - **Locked Settings During Active Trials:** Commands `'3'` and `'4'` are rejected while a trial is recording (`#WARN:CMD_LOCKED`) so a single recording can never contain samples collected under two different filter configurations.
   - **Clean vs. Degraded End Status:** Upon reaching 2,000 samples, firmware prints `#END:CLEAN` **only** if `overruns == 0`, `i2c_errs == 0`, `clips == 0`, and `late_reads == 0`. If any fault occurred during the trial, firmware prints `#END:DEGRADED,status=POTENTIALLY_INVALID,...` so compromised recordings are flagged immediately.
   - **FFT Sub-Windowing for Decaying Vibrations:** Because the wooden bridge vibrates most strongly immediately after release and rings down over 2–4 seconds, applying a symmetric Hann window across the entire 10-second recording tapers the initial high-energy ring-down near $t = 0$ toward zero. Python and the BRIDGE-X Workbench therefore support cropping a focused sub-window around the active ring-down (e.g., 3.5 s starting at release onset, or using a Tukey $\alpha = 0.25$ window) to preserve early signal-to-noise ratio.

### Illustrative Serial Output Example (Illustrative Format Only — Not Measured Bridge Data)
```text
#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg=4,bw_hz=21,delay_ms=8.5,range_g=2
#COLUMNS:t_us,az_m_s2
#START:TRIAL,target_samples=2000
1145000,9.8124
1150000,9.8118
1155004,10.6421
1160000,11.1045
...
#END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0
```
*(If any overrun, I²C error, clip, or late read occurred during the 2,000 samples, the final line instead reads: `#END:DEGRADED,status=POTENTIALLY_INVALID,samples=2000,overruns=1,i2c_errs=0,clips=0,late_reads=0`)*

- **Python Reader Compatibility:** If your existing Python script strictly calls `float()` on every line without checking for `#`, add one line at the top of your loop: `if line.startswith('#') or not line.strip(): continue`, and stop recording when `line.startswith('#END:')`.

---

## B. EXACT LIBRARY NAMES & VERSION ASSUMPTIONS

1. **`<Arduino.h>`** — Built into the **Arduino AVR Boards** core (bundled with all Arduino IDE 1.8.x and 2.x installations). Provides `micros()`, `millis()`, `pinMode()`, `digitalWrite()`, `attachInterrupt()`, `digitalPinToInterrupt()`, `noInterrupts()`, `interrupts()`, and `Serial`.
2. **`<Wire.h>`** — Built into the **Arduino AVR Boards** core. Provides controller-mode I²C functions `Wire.begin()`, `Wire.setClock()`, `Wire.beginTransmission()`, `Wire.write()`, `Wire.endTransmission()`, `Wire.requestFrom()`, and `Wire.read()`.
   - *Version Note:* `Wire.setWireTimeout(3000UL, true)` requires **Arduino AVR Boards core v1.8.3 or newer** (standard in Arduino IDE 1.8.13+ and all Arduino IDE 2.x releases). The sketch wraps this call in `#if defined(WIRE_HAS_TIMEOUT)` so it compiles cleanly on any version.
3. **Zero External Libraries:** Do **not** install `MPU6050` by Electronic Cats/Jeff Rowberg or `Adafruit_MPU6050`; direct register access via `<Wire.h>` avoids hidden configuration overrides and saves >600 bytes of SRAM.

---

## C. ARDUINO NANO CONDITIONAL WIRING TABLE & PRE-POWER BREAKOUT VOLTAGE VERIFICATION

### Pre-Power Multimeter Verification & Why the I²C Level Shifter Is Recommended
- **Verify Before Powering:** Never assume every breakout labeled "GY-521" has the same regulator or pull-up resistors. Before connecting power, visually inspect the PCB for the 5-pin SOT-23 3.3 V LDO regulator and use a multimeter (resistance/continuity mode, unpowered) to verify that the onboard pull-up resistors on `SDA` and `SCL` connect to the **3.3 V regulator output**, not to the `VCC` input pin.
- **Keep the Bidirectional I²C Level Shifter Recommendation:** Even on a standard GY-521 with a 3.3 V LDO, the bare InvenSense MPU-6050 IC has an absolute operational logic limit of `VLOGIC + 0.5 V` (~3.8 V max), whereas the 5.0 V ATmega328P hardware Two-Wire Interface (`A4/A5` on the Nano) specifies a minimum high-level input threshold of $V_{IH(\min)} = 0.7 \times V_{CC} = 3.50\text{ V}$ (ATmega328P Datasheet Table 29-14). Using the **bidirectional MOSFET I²C level shifter (`LV = 3V3`, `HV = 5V`)** protects the MPU-6050 from 5 V exposure and gives the Nano a full 5.0 V logic swing.

| Signal / Pin | Arduino Nano Pin | Option 1: GY-521 + Bidirectional I²C Level Shifter (Recommended Default) | Option 2: Standard GY-521 Direct (ONLY After Bench Multimeter Verification) | Option 3: Bare 3.3V Breakout (No Onboard LDO Regulator) |
| :--- | :--- | :--- | :--- | :--- |
| **Power Supply** | `5V` or `3V3` | Nano `5V` → GY-521 `VCC` *(feeds onboard 3.3 V LDO)*; also connect Nano `5V` → Shifter `HV` and Nano `3V3` → Shifter `LV` | Nano `5V` → GY-521 `VCC` *(ONLY after verifying onboard 5-pin SOT-23 3.3V LDO regulator is present)* | Nano `3V3` → Breakout `VCC/VDD` *(NEVER connect 5V if no LDO is installed)* + Level Shifter required |
| **Ground** | `GND` | Nano `GND` → Shifter `GND` → GY-521 `GND` | Nano `GND` → GY-521 `GND` | Nano `GND` → Shifter `GND` → Breakout `GND` |
| **I²C Data (`SDA`)** | `A4` | Nano `A4` → Shifter `HV1`; Shifter `LV1` → GY-521 `SDA` | Nano `A4` → GY-521 `SDA` *(sketch disables Nano internal 5V pull-up immediately after `Wire.begin()`)* | Via Level Shifter `HV1 ↔ LV1` only |
| **I²C Clock (`SCL`)** | `A5` | Nano `A5` → Shifter `HV2`; Shifter `LV2` → GY-521 `SCL` | Nano `A5` → GY-521 `SCL` *(sketch disables Nano internal 5V pull-up immediately after `Wire.begin()`)* | Via Level Shifter `HV2 ↔ LV2` only |
| **Data Ready (`INT`)** | `D2` (`INT0`) | GY-521 `INT` → Nano `D2` *(3.3V push-pull output; Nano GPIO `D2` has $V_{IH(\min)} = 0.6 V_{CC} = 3.0\text{ V}$, so 3.3V is valid directly)* | GY-521 `INT` → Nano `D2` *(configured as `INPUT`, never `INPUT_PULLUP`)* | Breakout `INT` → Nano `D2` |
| **Address Select (`AD0`)** | `GND` | Leave unconnected (internal/onboard pull-down to `GND` sets address `0x68`) or tie to `GND` | Leave unconnected or tie to `GND` (`0x68`) | Tie to `GND` (`0x68`) |

---

## D. COMPLETE ARDUINO SKETCH (`bridge_x_firmware.ino`)

```cpp
/*
 * ============================================================================
 * BRIDGE-X: Midspan Vertical Free-Vibration Acquisition Firmware (v1.1)
 * IB Physics Collaborative Sciences Project
 * ============================================================================
 * Target Board : Arduino Nano (ATmega328P, 16 MHz, 2 KB SRAM)
 *                -> Arduino IDE: Tools -> Board -> Arduino Nano
 *                -> Processor  : ATmega328P (or "ATmega328P (Old Bootloader)"
 *                                for CH340G / clone Nano boards)
 *                (Also 100% pin- and register-compatible with Arduino Uno R3)
 * Sensor       : InvenSense MPU-6050 (on GY-521 or compatible breakout, Addr 0x68)
 * Nano Pinout  : SDA = A4, SCL = A5, INT = Digital Pin D2 (INT0), Shared GND
 *                Power: Nano 5V -> GY-521 VCC (feeds onboard 3.3V LDO) & Shifter HV
 *                       Nano 3V3 -> Bidirectional I2C Level Shifter LV
 * Sampling     : 200.0 Hz hardware-paced via MPU-6050 DATA_RDY_INT -> Nano Pin D2 (INT0)
 * Serial Output: 115200 baud, 8N1, LF ('\n') line endings
 * Data Contract: t_us,az_m_s2 (2 numeric columns; all diagnostics prefixed with '#')
 * Trial Length : 2,000 valid samples (~10.00 seconds at 200 Hz)
 * Commands     : Send 'R' over Serial to start/restart a 2,000-sample trial
 *                Send '3' BETWEEN trials to select DLPF_CFG = 3 (44 Hz BW, 4.9 ms delay)
 *                Send '4' BETWEEN trials to select DLPF_CFG = 4 (21 Hz BW, 8.5 ms delay)
 *                (Commands '3' and '4' are locked out during an active trial so a single
 *                 recording can never mix two different filter configurations.)
 *
 * REQUIRED LIBRARIES (Built into Arduino IDE / Arduino AVR Boards Core):
 *   1. <Arduino.h> (Standard AVR core runtime, timers, external interrupts, Serial)
 *   2. <Wire.h>    (Standard Two-Wire I2C controller library; AVR core >= 1.8.3
 *                   recommended for hardware bus lockup timeout protection)
 *   -> NO third-party MPU6050 or I2Cdev libraries are required or used.
 * ============================================================================
 */

#include <Arduino.h>
#include <Wire.h>

// ----------------------------------------------------------------------------
// 1. HARDWARE PIN & I2C ADDRESS DEFINITIONS (ARDUINO NANO ATmega328P)
// ----------------------------------------------------------------------------
static const uint8_t MPU6050_I2C_ADDR     = 0x68; // AD0 pin tied to GND (default on GY-521)
static const uint8_t PIN_MPU_INT          = 2;    // Nano Digital Pin D2 -> External Interrupt INT0

// ----------------------------------------------------------------------------
// 2. VERIFIED MPU-6050 REGISTER MAP (Document RM-MPU-6000A-00 Rev 4.2)
// ----------------------------------------------------------------------------
static const uint8_t REG_SMPLRT_DIV       = 0x19; // Sample Rate Divider (R/W)
static const uint8_t REG_CONFIG           = 0x1A; // FSYNC & Digital Low-Pass Filter (R/W)
static const uint8_t REG_ACCEL_CONFIG     = 0x1C; // Accelerometer Full-Scale Range (R/W)
static const uint8_t REG_FIFO_EN          = 0x23; // FIFO Channel Enable (R/W)
static const uint8_t REG_INT_PIN_CFG      = 0x37; // Interrupt Pin / Bypass Configuration (R/W)
static const uint8_t REG_INT_ENABLE       = 0x38; // Interrupt Enable (R/W)
static const uint8_t REG_INT_STATUS       = 0x3A; // Interrupt Status (Read-Only)
static const uint8_t REG_ACCEL_ZOUT_H     = 0x3F; // Z-Axis Accel High Byte [15:8] (Read-Only)
static const uint8_t REG_ACCEL_ZOUT_L     = 0x40; // Z-Axis Accel Low Byte  [7:0]  (Read-Only)
static const uint8_t REG_USER_CTRL        = 0x6A; // FIFO & I2C Master Control (R/W)
static const uint8_t REG_PWR_MGMT_1       = 0x6B; // Power Management 1 & Clock Source (R/W)
static const uint8_t REG_WHO_AM_I         = 0x75; // Device Identity Register (Read-Only, expects 0x68)

// ----------------------------------------------------------------------------
// 3. ACQUISITION & PHYSICAL CONVERSION CONSTANTS
// ----------------------------------------------------------------------------
static const uint16_t TARGET_SAMPLES      = 2000; // 10.0 seconds at 200.0 Hz
static const uint8_t  WARMUP_SAMPLES      = 10;   // Discard first 10 samples (50 ms) after settling
static const uint8_t  DEFAULT_DLPF_CFG    = 4;    // Initial DLPF_CFG = 4 (21 Hz Accel BW, 8.5 ms delay)
static const uint8_t  SMPLRT_DIV_200HZ    = 4;    // 1000 Hz / (1 + 4) = 200.0 Hz
static const uint8_t  MAX_CONSEC_I2C_ERRS = 5;    // Abort trial if 5 consecutive I2C reads fail

// At +/-2g full-scale (AFS_SEL = 0), sensitivity = 16,384 LSB/g.
// Standard gravity g_0 = 9.80665 m/s^2 -> 1 LSB = 0.0005985504 m/s^2.
static const float    LSB_TO_MS2          = 9.80665f / 16384.0f;
static const int16_t  CLIP_RAW_THRESHOLD  = 32760; // Warn when raw 16-bit ADC nears +/-32767 rail

// ----------------------------------------------------------------------------
// 4. VOLATILE ISR SYNCHRONIZATION STATE (Modified in ISR, Read Atomically in loop)
// ----------------------------------------------------------------------------
volatile uint32_t g_isr_t_us              = 0;    // micros() captured on RISING edge of D2
volatile uint8_t  g_isr_pending           = 0;    // Counts unserviced DATA_RDY_INT pulses

// ----------------------------------------------------------------------------
// 5. TRIAL STATE MACHINE & DIAGNOSTIC COUNTERS
// ----------------------------------------------------------------------------
enum AcquisitionState : uint8_t {
  STATE_ACTIVE_TRIAL = 0,
  STATE_IDLE_COMPLETE = 1,
  STATE_FAULT_ABORTED = 2
};

static AcquisitionState g_state           = STATE_IDLE_COMPLETE;
static uint8_t  g_active_dlpf_cfg         = DEFAULT_DLPF_CFG; // 4 (21 Hz) or 3 (44 Hz)
static uint16_t g_samples_collected       = 0;
static uint16_t g_total_overruns          = 0;
static uint16_t g_total_i2c_errs          = 0;
static uint16_t g_total_clips             = 0;
static uint16_t g_total_late_reads        = 0;
static uint8_t  g_consecutive_i2c_errs    = 0;

// ----------------------------------------------------------------------------
// 6. MINIMAL INTERRUPT SERVICE ROUTINE (ISR)
// ----------------------------------------------------------------------------
// Runs on RISING edge of Digital Pin 2 (INT0). Execution time: ~3.5 microseconds.
// Performs NO I2C transactions, NO floating-point math, and NO Serial printing.
void onMpuDataReadyISR() {
  g_isr_t_us = micros();
  if (g_isr_pending < 255) {
    g_isr_pending++;
  }
}

// ----------------------------------------------------------------------------
// 7. LOW-LEVEL VERIFIED I2C REGISTER HELPERS
// ----------------------------------------------------------------------------
bool readRegisterByte(uint8_t devAddr, uint8_t regAddr, uint8_t *outVal, uint8_t *outErrCode) {
  Wire.beginTransmission(devAddr);
  Wire.write(regAddr);
  uint8_t err = Wire.endTransmission(false); // Repeated START keeps bus ownership
  if (err != 0) {
    if (outErrCode) *outErrCode = err;
    return false;
  }
  uint8_t n = Wire.requestFrom(devAddr, (uint8_t)1, (uint8_t)true); // STOP after 1 byte
  if (n != 1 || !Wire.available()) {
    if (outErrCode) *outErrCode = 5; // Short read / NACK on SLA+R
    return false;
  }
  *outVal = (uint8_t)Wire.read();
  if (outErrCode) *outErrCode = 0;
  return true;
}

bool writeAndVerifyRegister(uint8_t devAddr, uint8_t regAddr, uint8_t value, uint8_t *outErrCode) {
  Wire.beginTransmission(devAddr);
  Wire.write(regAddr);
  Wire.write(value);
  uint8_t err = Wire.endTransmission(true);
  if (err != 0) {
    if (outErrCode) *outErrCode = err;
    return false;
  }
  delayMicroseconds(500);
  uint8_t readBack = 0xFF;
  if (!readRegisterByte(devAddr, regAddr, &readBack, outErrCode)) {
    return false;
  }
  if (readBack != value) {
    if (outErrCode) *outErrCode = 6; // Read-back verification mismatch
    return false;
  }
  return true;
}

// Contiguous 2-byte burst read of ACCEL_ZOUT_H (0x3F) and ACCEL_ZOUT_L (0x40).
// Reading both bytes in a single burst guarantees internal shadow-register coherence.
bool readAccelZBurst(uint8_t devAddr, int16_t *outRawAz, uint8_t *outErrCode) {
  Wire.beginTransmission(devAddr);
  Wire.write(REG_ACCEL_ZOUT_H);
  uint8_t err = Wire.endTransmission(false); // Repeated START
  if (err != 0) {
    if (outErrCode) *outErrCode = err;
    return false;
  }
  uint8_t n = Wire.requestFrom(devAddr, (uint8_t)2, (uint8_t)true); // Read 2 bytes & STOP
  if (n != 2 || Wire.available() < 2) {
    if (outErrCode) *outErrCode = 5;
    return false;
  }
  uint8_t msb = (uint8_t)Wire.read();
  uint8_t lsb = (uint8_t)Wire.read();
  *outRawAz = (int16_t)(((uint16_t)msb << 8) | (uint16_t)lsb);
  if (outErrCode) *outErrCode = 0;
  return true;
}

// ----------------------------------------------------------------------------
// 8. MPU-6050 INITIALIZATION & FILTER CONFIGURATION
// ----------------------------------------------------------------------------
bool configureMpu6050(uint8_t dlpfCfg) {
  uint8_t errCode = 0;
  uint8_t whoAmI  = 0;

  // Step 1: Verify sensor identity via WHO_AM_I (0x75) -> Expect 0x68
  if (!readRegisterByte(MPU6050_I2C_ADDR, REG_WHO_AM_I, &whoAmI, &errCode)) {
    Serial.print(F("#ERR:I2C_INIT,stage=WHO_AM_I,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }
  if (whoAmI != 0x68) {
    Serial.print(F("#ERR:WHO_AM_I,expected=0x68,actual=0x"));
    Serial.print(whoAmI, HEX);
    Serial.print('\n');
    return false;
  }

  // Step 2: Wake from SLEEP and select PLL with X-axis gyroscope reference (CLKSEL = 001 -> 0x01)
  if (!writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_PWR_MGMT_1, 0x01, &errCode)) {
    Serial.print(F("#ERR:REG_VERIFY,reg=PWR_MGMT_1,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }
  delay(100); // Allow MEMS PLL oscillator and analog front-end to stabilize

  // Step 3: Explicitly disable hardware FIFO and auxiliary I2C master
  if (!writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_USER_CTRL, 0x00, &errCode) ||
      !writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_FIFO_EN,   0x00, &errCode)) {
    Serial.print(F("#ERR:REG_VERIFY,reg=USER_CTRL_FIFO,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }

  // Step 4: Set Digital Low-Pass Filter (CONFIG 0x1A = dlpfCfg; 4 -> 21 Hz, 3 -> 44 Hz)
  // Both DLPF_CFG=4 and DLPF_CFG=3 set Gyroscope Output Rate = 1,000 Hz.
  if (!writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_CONFIG, dlpfCfg & 0x07, &errCode)) {
    Serial.print(F("#ERR:REG_VERIFY,reg=CONFIG,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }

  // Step 5: Set Sample Rate Divider (SMPLRT_DIV 0x19 = 4 -> 1000 Hz / (1 + 4) = 200.0 Hz)
  if (!writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_SMPLRT_DIV, SMPLRT_DIV_200HZ, &errCode)) {
    Serial.print(F("#ERR:REG_VERIFY,reg=SMPLRT_DIV,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }

  // Step 6: Set Accelerometer Full-Scale Range to +/-2g (ACCEL_CONFIG 0x1C = 0x00)
  if (!writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_ACCEL_CONFIG, 0x00, &errCode)) {
    Serial.print(F("#ERR:REG_VERIFY,reg=ACCEL_CONFIG,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }

  // Step 7: Configure INT pin (INT_PIN_CFG 0x37 = 0x10):
  // Active-high (bit7=0), push-pull 3.3V output (bit6=0), 50us pulse (bit5=0), INT_RD_CLEAR=1 (bit4=1)
  if (!writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_INT_PIN_CFG, 0x10, &errCode)) {
    Serial.print(F("#ERR:REG_VERIFY,reg=INT_PIN_CFG,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }

  // Step 8: Enable Data Ready Interrupt (INT_ENABLE 0x38 = 0x01 -> DATA_RDY_EN = 1)
  if (!writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_INT_ENABLE, 0x01, &errCode)) {
    Serial.print(F("#ERR:REG_VERIFY,reg=INT_ENABLE,code="));
    Serial.print(errCode);
    Serial.print('\n');
    return false;
  }

  // Clear any pending interrupt status latch by reading INT_STATUS (0x3A) once
  uint8_t dummyStatus = 0;
  readRegisterByte(MPU6050_I2C_ADDR, REG_INT_STATUS, &dummyStatus, &errCode);

  return true;
}

// ----------------------------------------------------------------------------
// 9. WARM-UP SETTLING & TRIAL HEADER EMISSION
// ----------------------------------------------------------------------------
bool discardWarmupSamples(uint8_t count) {
  uint8_t discarded = 0;
  uint32_t startWaitMs = millis();

  while (discarded < count) {
    if ((uint32_t)(millis() - startWaitMs) > 500UL) {
      // Timeout: INT0 on Pin D2 is not firing!
      Serial.print(F("#ERR:INT0_TIMEOUT,pin=D2,msg=No_DATA_RDY_pulses_detected\n"));
      return false;
    }

    noInterrupts();
    uint8_t pending = g_isr_pending;
    g_isr_pending = 0;
    interrupts();

    if (pending > 0) {
      int16_t dummyAz = 0;
      uint8_t errCode = 0;
      readAccelZBurst(MPU6050_I2C_ADDR, &dummyAz, &errCode);
      discarded++;
    }
  }
  return true;
}

void printTrialHeader() {
  uint8_t bwHz = (g_active_dlpf_cfg == 3) ? 44 : 21;
  const char *delayStr = (g_active_dlpf_cfg == 3) ? "4.9" : "8.5";

  Serial.print(F("#BRIDGE-X,fw=1.1,mcu=ATmega328P,fs_hz=200,dlpf_cfg="));
  Serial.print(g_active_dlpf_cfg);
  Serial.print(F(",bw_hz="));
  Serial.print(bwHz);
  Serial.print(F(",delay_ms="));
  Serial.print(delayStr);
  Serial.print(F(",range_g=2\n"));

  Serial.print(F("#COLUMNS:t_us,az_m_s2\n"));
  Serial.print(F("#START:TRIAL,target_samples="));
  Serial.print(TARGET_SAMPLES);
  Serial.print('\n');
}

void startNewTrial() {
  g_samples_collected    = 0;
  g_total_overruns       = 0;
  g_total_i2c_errs       = 0;
  g_total_clips          = 0;
  g_total_late_reads     = 0;
  g_consecutive_i2c_errs = 0;

  noInterrupts();
  g_isr_pending = 0;
  interrupts();

  if (!discardWarmupSamples(WARMUP_SAMPLES)) {
    Serial.print(F("#END:ABORT,reason=INT0_TIMEOUT,samples=0\n"));
    g_state = STATE_FAULT_ABORTED;
    return;
  }

  noInterrupts();
  g_isr_pending = 0;
  interrupts();

  printTrialHeader();
  g_state = STATE_ACTIVE_TRIAL;
}

// Evaluates all fault counters at the end of 2,000 samples:
// Emits #END:CLEAN ONLY when zero overruns, zero I2C errors, zero clips, and zero late reads occurred.
// Otherwise emits #END:DEGRADED,status=POTENTIALLY_INVALID so compromised trials are never mistaken for clean.
void finishTrial() {
  g_state = STATE_IDLE_COMPLETE;
  bool isClean = (g_total_overruns == 0) &&
                 (g_total_i2c_errs == 0) &&
                 (g_total_clips == 0) &&
                 (g_total_late_reads == 0);

  if (isClean) {
    Serial.print(F("#END:CLEAN,samples="));
  } else {
    Serial.print(F("#END:DEGRADED,status=POTENTIALLY_INVALID,samples="));
  }
  Serial.print(g_samples_collected);
  Serial.print(F(",overruns="));
  Serial.print(g_total_overruns);
  Serial.print(F(",i2c_errs="));
  Serial.print(g_total_i2c_errs);
  Serial.print(F(",clips="));
  Serial.print(g_total_clips);
  Serial.print(F(",late_reads="));
  Serial.print(g_total_late_reads);
  Serial.print('\n');
}

void abortTrial(const __FlashStringHelper *reason) {
  g_state = STATE_FAULT_ABORTED;
  Serial.print(F("#END:ABORT,reason="));
  Serial.print(reason);
  Serial.print(F(",samples="));
  Serial.print(g_samples_collected);
  Serial.print('\n');
}

// ----------------------------------------------------------------------------
// 10. NON-BLOCKING SERIAL COMMAND HANDLER ('R', '3', '4')
// ----------------------------------------------------------------------------
// Commands '3' and '4' (changing filter bandwidth) are LOCKED during an active
// trial so a single 2,000-sample recording can never mix two configurations.
void handleSerialCommands() {
  while (Serial.available() > 0) {
    char cmd = (char)Serial.read();
    if (cmd == 'r' || cmd == 'R') {
      if (configureMpu6050(g_active_dlpf_cfg)) {
        startNewTrial();
      } else {
        abortTrial(F("REINIT_FAILED"));
      }
    } else if (cmd == '3' || cmd == '4') {
      if (g_state == STATE_ACTIVE_TRIAL) {
        Serial.print(F("#WARN:CMD_LOCKED,msg=Cannot_change_DLPF_during_active_trial\n"));
        continue;
      }
      uint8_t newDlpf = (uint8_t)(cmd - '0');
      g_active_dlpf_cfg = newDlpf;
      uint8_t errCode = 0;
      if (writeAndVerifyRegister(MPU6050_I2C_ADDR, REG_CONFIG, g_active_dlpf_cfg, &errCode)) {
        Serial.print(F("#INFO:DLPF_CFG_SET,dlpf_cfg="));
        Serial.print(g_active_dlpf_cfg);
        Serial.print(F(",bw_hz="));
        Serial.print((g_active_dlpf_cfg == 3) ? 44 : 21);
        Serial.print(F(",msg=Send_R_to_start_trial\n"));
      } else {
        Serial.print(F("#ERR:DLPF_SET_FAIL,code="));
        Serial.print(errCode);
        Serial.print('\n');
      }
    }
  }
}

// ----------------------------------------------------------------------------
// 11. ARDUINO SETUP()
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  // Initialize I2C controller
  Wire.begin();

  // CRITICAL ELECTRICAL PROTECTION FOR 3.3V GY-521 BREAKOUT:
  // Wire.begin() enables ATmega328P internal 20-50 kOhm pull-ups to 5.0V on A4 (SDA) and A5 (SCL).
  // Immediately drive PORTC bits low to disable internal 5V pull-ups so the bus rests at the
  // GY-521's 3.3V pull-up rail (or external level shifter reference).
  digitalWrite(SDA, LOW);
  digitalWrite(SCL, LOW);

  // Use 400 kHz I2C Fast Mode so a 2-byte burst read takes ~125 us instead of ~475 us
  Wire.setClock(400000UL);

  // Enable 3,000 us I2C hardware timeout with automatic TWI bus reset (Arduino AVR Core >= 1.8.3)
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(3000UL, true);
#endif

  // Configure Pin D2 (INT0) as standard high-impedance input (NEVER INPUT_PULLUP to 5V)
  pinMode(PIN_MPU_INT, INPUT);

  delay(50); // Brief power-up stabilization before I2C transactions

  if (!configureMpu6050(g_active_dlpf_cfg)) {
    abortTrial(F("SENSOR_INIT_FAILURE"));
    return;
  }

  // Attach hardware interrupt on rising edge of MPU6050 INT -> Uno Pin D2
  attachInterrupt(digitalPinToInterrupt(PIN_MPU_INT), onMpuDataReadyISR, RISING);

  // Automatically start the first 2,000-sample trial upon boot/reset
  startNewTrial();
}

// ----------------------------------------------------------------------------
// 12. ARDUINO LOOP() — NON-BLOCKING ATOMIC ACQUISITION & STREAMING
// ----------------------------------------------------------------------------
void loop() {
  handleSerialCommands();

  if (g_state != STATE_ACTIVE_TRIAL) {
    return;
  }

  // --- Atomic Critical Section (<1.5 us on 16 MHz 8-bit AVR) ---
  noInterrupts();
  uint8_t  pending     = g_isr_pending;
  uint32_t sample_t_us = g_isr_t_us;
  g_isr_pending        = 0;
  interrupts();
  // -------------------------------------------------------------

  if (pending == 0) {
    return;
  }

  // Detect if one or more 5,000 us deadlines were missed before this read
  if (pending > 1) {
    uint8_t missed = pending - 1;
    g_total_overruns += missed;
    Serial.print(F("#ERR:OVERRUN,missed="));
    Serial.print(missed);
    Serial.print(F(",t_us="));
    Serial.print(sample_t_us);
    Serial.print('\n');
  }

  // Read fresh Z-axis acceleration from 0x3F..0x40
  int16_t raw_az  = 0;
  uint8_t i2c_err = 0;
  if (!readAccelZBurst(MPU6050_I2C_ADDR, &raw_az, &i2c_err)) {
    g_total_i2c_errs++;
    g_consecutive_i2c_errs++;
    Serial.print(F("#ERR:I2C,code="));
    Serial.print(i2c_err);
    Serial.print(F(",t_us="));
    Serial.print(sample_t_us);
    Serial.print('\n');

    if (g_consecutive_i2c_errs >= MAX_CONSEC_I2C_ERRS) {
      abortTrial(F("I2C_BUS_LOCKUP"));
    }
    return;
  }
  g_consecutive_i2c_errs = 0;

  // Detect if a new DATA_RDY interrupt fired while the I2C read was in flight (late-read hazard)
  noInterrupts();
  uint8_t race_during_read = g_isr_pending;
  interrupts();
  if (race_during_read > 0) {
    g_total_late_reads++;
    Serial.print(F("#WARN:LATE_READ,t_us="));
    Serial.print(sample_t_us);
    Serial.print('\n');
  }

  // Check for ADC saturation near +/-2g (+/-32768 LSB)
  if (raw_az <= -CLIP_RAW_THRESHOLD || raw_az >= CLIP_RAW_THRESHOLD) {
    g_total_clips++;
    Serial.print(F("#WARN:CLIP,raw="));
    Serial.print(raw_az);
    Serial.print(F(",t_us="));
    Serial.print(sample_t_us);
    Serial.print('\n');
  }

  // Convert raw signed 16-bit integer to m/s^2 (includes static +1g gravity baseline)
  float az_m_s2 = (float)raw_az * LSB_TO_MS2;

  // Emit strictly two numeric CSV columns: t_us,az_m_s2
  Serial.print(sample_t_us);
  Serial.print(',');
  Serial.print(az_m_s2, 4);
  Serial.print('\n');

  g_samples_collected++;
  if (g_samples_collected >= TARGET_SAMPLES) {
    finishTrial();
  }
}

```

---

## E. STEP-BY-STEP ARDUINO IDE UPLOAD INSTRUCTIONS FOR WINDOWS (ARDUINO NANO)

1. **Verify Electronics Before Powering:** With everything unpowered, verify your GY-521 breakout and wire the bidirectional I²C level shifter according to **Section C** (confirming `GND`, `VCC`, `SDA -> A4`, `SCL -> A5`, and `INT -> D2`).
2. **Install Arduino IDE:** Download and install **Arduino IDE 2.x** (or 1.8.19) for Windows from [arduino.cc/en/software](https://www.arduino.cc/en/software).
3. **Create Sketch Folder:** Open Arduino IDE, click **File → New Sketch**, delete the template code, paste the complete sketch from **Section D**, and save it as `bridge_x_firmware` (Arduino IDE will create `bridge_x_firmware/bridge_x_firmware.ino`).
4. **Select Arduino Nano Board, Processor & COM Port:**
   - Plug the Nano USB cable into your Windows laptop.
   - Go to **Tools → Board → Arduino AVR Boards → Arduino Nano**.
   - Go to **Tools → Processor** and select **`ATmega328P`** (or **`ATmega328P (Old Bootloader)`** if upload times out with `stk500_getsync()` on a CH340G clone Nano).
   - Go to **Tools → Port** and select your Nano's `COMx` port (check Windows **Device Manager → Ports (COM & LPT)** if unsure).
5. **Compile & Upload:**
   - Click the **Verify (Checkmark)** button to compile. Confirm the output console reports ~5,500 bytes of program storage (~18% of Nano's 30,720 bytes) and ~250 bytes of dynamic memory (~12% of 2,048 bytes).
   - Click the **Upload (Right Arrow)** button and wait for `Done uploading.`
6. **Verify Live Stream in Serial Monitor:**
   - Open **Tools → Serial Monitor**.
   - Set the baud rate dropdown in the bottom-right corner to **`115200 baud`** and line ending to **`Newline`** (or `No line ending`).
   - Observe `#BRIDGE-X,fw=1.1,...`, `#COLUMNS:t_us,az_m_s2`, `#START:TRIAL,target_samples=2000`, followed by 2,000 rows of `t_us,az_m_s2` and `#END:CLEAN,samples=2000,overruns=0,i2c_errs=0,clips=0,late_reads=0`.
   - **Important:** Close the Arduino Serial Monitor before connecting the BRIDGE-X WebSerial Workbench or running your Python script, because Windows allows only one program to hold a `COM` port open at a time.

---

## F. SEVEN-POINT COMMISSIONING CHECKLIST

| Step | Check Name | Procedure | Pass Criterion |
| :--- | :--- | :--- | :--- |
| **1** | **Device Detected** | Open Serial Monitor at 115200 baud (or press `R`). | Startup banner prints `#BRIDGE-X,fw=1.1,...` with zero `#ERR:WHO_AM_I` or `#ERR:I2C_INIT` lines. |
| **2** | **Stationary Gravity Baseline** | Leave the bridge completely still on the bench for a 10 s trial. | Mean of `az_m_s2` is within **$+9.0\text{ to }+10.6\text{ m/s}^2$** (nominal $+9.81\text{ m/s}^2 \pm$ factory zero-$g$ offset), and dynamic RMS noise around the mean is $< 0.08\text{ m/s}^2$. |
| **3** | **Z-Axis Sign & Orientation** | Temporarily hold the unmounted sensor flat (+Z up) vs. upside-down (+Z down). | +Z pointing upward reads $\approx +9.81\text{ m/s}^2$; inverted reads $\approx -9.81\text{ m/s}^2$. Rigidly mount at midspan with +Z vertical. |
| **4** | **Actual Sampling Rate** | Inspect the timestamp difference $(t_{1999} - t_0)$ across 2,000 samples in the Trial Comparator or Python. | Total duration is **$9.995\text{ s} \pm 0.08\text{ s}$**, median interval $\Delta t = 5,000 \pm 50\text{ }\mu\text{s}$ ($f_s = 200.0 \pm 2.0\text{ Hz}$). |
| **5** | **Timing Jitter & Clean End Status** | Inspect the trial footer line and $\Delta t$ distribution. | Footer is `#END:CLEAN` (not `#END:DEGRADED`) with `overruns=0,i2c_errs=0,clips=0,late_reads=0`, 99th-percentile jitter $\le 250\text{ }\mu\text{s}$, and max interval $\le 15,000\text{ }\mu\text{s}$. |
| **6** | **No Clipping Under Excitation** | Gently deflect bridge midspan downward by ~2–3 mm with a finger or thread and release cleanly. | Peak $|a_z| < 19.20\text{ m/s}^2$ and `clips=0` in `#END:CLEAN` (no `#WARN:CLIP` lines). |
| **7** | **Ring-Down Sub-Window FFT Usability** | Load the saved CSV or connect via WebSerial in the **Trial Comparator** tab. | Verdict badges **PASS**, the Ring-Down Sub-Window isolates the decaying vibration immediately after release, and the FFT displays a sharp fundamental peak in the 2–30 Hz window. |

---

## G. TROUBLESHOOTING TABLE FOR COMMON FAILURES

| Observed Symptom / Diagnostic Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| `#ERR:I2C_INIT,stage=WHO_AM_I,code=2` | Sensor did not ACK I²C address `0x68` (NACK on address). | Check that `SDA -> A4` and `SCL -> A5` are not swapped, `GND` is shared, `VCC` has power, and `AD0` is not pulled high to 3.3 V (which moves address to `0x69`). |
| `#ERR:WHO_AM_I,expected=0x68,actual=0x70` (or `0x98` / `0x72`) | Breakout board contains an MPU-6500 (`0x70`) or clone IC sold as an MPU-6050. | Swap for a genuine MPU-6050 module, or if forced to use the clone after teacher approval, verify its register map and update the `whoAmI != 0x68` check. |
| `#ERR:INT0_TIMEOUT,pin=D2,msg=No_DATA_RDY_pulses_detected` | The `INT` wire from the GY-521 to Uno Digital Pin `2` is missing, loose, or connected to the wrong pin. | Connect `GY-521 INT` to **Arduino Uno Digital Pin 2** (only Pins 2 and 3 support hardware `attachInterrupt` on the Uno R3). |
| `#WARN:CMD_LOCKED,msg=Cannot_change_DLPF_during_active_trial` | Serial command `'3'` or `'4'` was sent while a 2,000-sample trial was actively recording. | Wait for `#END:CLEAN` / `#END:DEGRADED` (idle state) before sending `'3'` or `'4'`, then send `'R'` to start the new trial. |
| `#END:DEGRADED,status=POTENTIALLY_INVALID,...` | At least one overrun, I²C error, ADC clip, or late read occurred during the 2,000-sample recording. | Inspect the diagnostic counters in the `#END:DEGRADED` line; if `clips > 0`, use a gentler bridge release; if `overruns > 0` or `i2c_errs > 0`, check wiring and repeat the trial. |
| Broad, noisy FFT with weak modal peak | Applying a 10-second Hann window across a short 2–3 s decay, or mounting sensor with soft foam tape. | Select the **Auto Ring-Down Sub-Window (3.5 s from onset)** or **Tukey Window** in Python / Workbench, and mount the PCB rigidly at midspan. |

---

## H. CONCISE EXPLANATION FOR YOUR IB PHYSICS TEACHER

> *"Our Arduino Uno firmware uses the MPU-6050's internal 1 kHz MEMS phase-locked loop and sample-rate divider (`SMPLRT_DIV = 4`) to generate a hardware Data-Ready interrupt on Digital Pin 2 at exactly 200.0 Hz. Inside a 3.5-microsecond interrupt routine, the Arduino records the hardware `micros()` timestamp, and the main loop reads the 16-bit vertical acceleration register over 400 kHz I²C and streams timestamped specific force (`t_us,az_m_s2`) at 115200 baud for 2,000 samples (10 seconds). Filter settings are locked during each active recording, and the firmware only reports `#END:CLEAN` if zero overruns, zero I²C errors, zero clipping events, and zero late reads occurred—otherwise flagging the trial as `#END:DEGRADED,status=POTENTIALLY_INVALID`. Because free vibrations decay rapidly after release, Python isolates the active ring-down window immediately following release and subtracts the empirical mean before computing the windowed FFT. While this setup accurately resolves repeatable shifts in midspan natural frequencies between the secured, disengaged, and restored brace states, it measures global modal stiffness changes on a laboratory model and cannot localize real-world structural defects or predict bridge collapse."*

---

## VERIFICATION & HONESTY STATEMENT (CODE REVIEW VS. HARDWARE TESTING)

- **Performed:** Complete static code verification against the official InvenSense MPU-6000/MPU-6050 Register Map (Rev 4.2), ATmega328P Datasheet (DS40002061B), and `ArduinoCore-avr` (`<Arduino.h>` and `<Wire.h>` API signatures), plus full compilation of the BRIDGE-X TypeScript/Vite analysis workbench.
- **Not Performed in This Cloud Container:** Physical upload to an ATmega328P board over USB and physical vibration testing on your wooden bridge model have **not** been executed in this browser environment—you must verify your breakout electronics with a multimeter before powering and run the **Section F Seven-Point Commissioning Checklist** on your physical hardware before recording formal IB Physics trials.

