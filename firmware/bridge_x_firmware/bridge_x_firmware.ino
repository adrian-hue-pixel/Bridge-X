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
 * Sensor       : InvenSense MPU-6050 (GY-521 or compatible breakout, Addr 0x68)
 * Nano Pinout  : SDA = A4, SCL = A5, INT = Digital Pin D2 (INT0), Shared GND
 *                Power: Nano 5V -> GY-521 VCC (feeds onboard 3.3V LDO) & Shifter HV
 *                       Nano 3V3 -> Bidirectional I2C Level Shifter LV
 * Sampling     : 200.0 Hz hardware-paced via MPU-6050 DATA_RDY_INT -> Pin D2
 * Range & Filt : +/-2g (16,384 LSB/g), Initial DLPF_CFG = 4 (21 Hz BW, 8.5 ms)
 *                Initial SMPLRT_DIV = 4 -> 1000 Hz / (1 + 4) = 200.0 Hz
 * Serial Output: 115200 baud, 8N1, LF ('\n') line endings
 * Data Contract: t_us,az_m_s2 (strictly 2 numeric columns; '#' for diagnostics)
 * Trial Length : 2,000 valid samples (~10.00 seconds at 200.0 Hz)
 * Commands     : Send 'R' over Serial to start/restart a 2,000-sample trial
 *                Send '3' BETWEEN trials to select DLPF_CFG = 3 (44 Hz BW)
 *                Send '4' BETWEEN trials to select DLPF_CFG = 4 (21 Hz BW)
 *                (Filter commands '3' and '4' are locked out during an active
 *                 recording so a trial never mixes two filter configurations.)
 *
 * REQUIRED LIBRARIES (Built into Arduino IDE / Arduino AVR Boards Core):
 *   1. <Arduino.h> (Standard AVR runtime, micros(), external interrupts, Serial)
 *   2. <Wire.h>    (Standard Two-Wire I2C controller library; AVR core >= 1.8.3
 *                   recommended for hardware bus timeout protection)
 *   -> Zero third-party MPU6050 libraries and zero dynamic String allocations.
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
// 2. VERIFIED MPU-6050 REGISTER MAP (RM-MPU-6000A-00 Rev 4.2)
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
  STATE_ACTIVE_TRIAL  = 0,
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

  // Attach hardware interrupt on rising edge of MPU6050 INT -> Digital Pin 2
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
