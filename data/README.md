# BRIDGE-X Experimental Data Directory

Place your recorded trial `.csv` files and exported `.svg` / `.png` FFT spectra in this directory:

- `empirical_trials/` — Real hardware recordings captured from the **Arduino Nano (`ATmega328P`) + MPU-6050 (`0x68`)** at `200.0 Hz` (`115200` baud).
  - Recommended naming convention:
    - `EMPIRICAL_secured_Run_1.csv`
    - `EMPIRICAL_disengaged_Run_1.csv`
    - `EMPIRICAL_restored_Run_1.csv`
- `synthetic_reference/` — Clearly labelled simulated test files (`SYNTHETIC_...csv`) used only for software pipeline validation. Never mix synthetic test files with empirical bridge measurements.
