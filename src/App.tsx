/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ARDUINO_FIRMWARE_SKETCH,
} from './data/mpu6050Data';
import {
  generateSyntheticBridgeTrial,
  triggerFileDownload,
  TrialAnalysis,
} from './utils/dspAndValidation';
import { LiveMonitorView } from './components/LiveMonitorView';
import { TrialComparatorView } from './components/TrialComparatorView';
import { SyntheticSimulatorView } from './components/SyntheticSimulatorView';
import { ArduinoFirmwareView } from './components/ArduinoFirmwareView';
import { TimingAndHardwareView } from './components/TimingAndHardwareView';
import { SetupGuideView } from './components/SetupGuideView';
import { Download, Check } from 'lucide-react';

type ActiveTab = 'monitor' | 'comparator' | 'simulator' | 'firmware' | 'readme';

function createInitialSyntheticReferenceSet(dlpfCfg: number): TrialAnalysis[] {
  return [
    generateSyntheticBridgeTrial({
      condition: 'secured',
      label: 'SYNTHETIC DATA · Brace Secured Baseline (14.20 Hz)',
      sampleCount: 2000,
      fsHz: 200,
      dlpfCfg,
      f1Hz: 14.2,
      amp1Ms2: 1.45,
      zeta1: 0.018,
      f2Hz: 27.5,
      amp2Ms2: 0.65,
      zeta2: 0.02,
      noiseStdMs2: 0.022,
      jitterStdUs: 8,
      injectedOverruns: 0,
      startNearWrap: false,
      seedOffset: 101,
    }),
    generateSyntheticBridgeTrial({
      condition: 'disengaged',
      label: 'SYNTHETIC DATA · Brace Disengaged Altered (11.60 Hz)',
      sampleCount: 2000,
      fsHz: 200,
      dlpfCfg,
      f1Hz: 11.6,
      amp1Ms2: 1.65,
      zeta1: 0.021,
      f2Hz: 24.1,
      amp2Ms2: 0.72,
      zeta2: 0.024,
      noiseStdMs2: 0.022,
      jitterStdUs: 8,
      injectedOverruns: 0,
      startNearWrap: false,
      seedOffset: 202,
    }),
    generateSyntheticBridgeTrial({
      condition: 'restored',
      label: 'SYNTHETIC DATA · Brace Restored Control (14.15 Hz)',
      sampleCount: 2000,
      fsHz: 200,
      dlpfCfg,
      f1Hz: 14.15,
      amp1Ms2: 1.42,
      zeta1: 0.018,
      f2Hz: 27.4,
      amp2Ms2: 0.64,
      zeta2: 0.02,
      noiseStdMs2: 0.022,
      jitterStdUs: 8,
      injectedOverruns: 0,
      startNearWrap: false,
      seedOffset: 303,
    }),
  ];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('monitor');
  const [selectedDlpfCfg, setSelectedDlpfCfg] = useState<number>(4);
  const [downloadedSketchCta, setDownloadedSketchCta] = useState<boolean>(false);

  const [trials, setTrials] = useState<TrialAnalysis[]>(() =>
    createInitialSyntheticReferenceSet(4)
  );

  const handleDownloadArduinoFirmwareTop = () => {
    triggerFileDownload(
      'bridge_x_firmware.ino',
      ARDUINO_FIRMWARE_SKETCH,
      'text/plain;charset=utf-8;'
    );
    setDownloadedSketchCta(true);
    setTimeout(() => setDownloadedSketchCta(false), 2000);
  };

  const handleAddTrial = (newTrial: TrialAnalysis, navigateToComparator = false) => {
    setTrials((prev) => [newTrial, ...prev]);
    if (navigateToComparator) {
      setActiveTab('comparator');
    }
  };

  const handleRemoveTrial = (id: string) => {
    setTrials((prev) => prev.filter((t) => t.id !== id));
  };

  const handleClearSyntheticTrials = () => {
    setTrials((prev) =>
      prev.filter((t) => t.provenance === 'EMPIRICAL_MEASUREMENT')
    );
  };

  const handleLoadSyntheticSetIntoComparator = (newSet: TrialAnalysis[]) => {
    setTrials((prev) => [
      ...newSet,
      ...prev.filter((t) => t.provenance === 'EMPIRICAL_MEASUREMENT'),
    ]);
    setActiveTab('comparator');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Strict 1-Row, 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('monitor');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          BRIDGE-X
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav
          className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto"
          aria-label="Primary Instrumentation Navigation"
        >
          <button
            onClick={() => setActiveTab('monitor')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'monitor'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Live Monitor
          </button>
          <button
            onClick={() => setActiveTab('comparator')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'comparator'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            FFT &amp; Comparison
          </button>
          <button
            onClick={() => setActiveTab('simulator')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'simulator'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Simulation Lab
          </button>
          <button
            onClick={() => setActiveTab('firmware')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'firmware'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Arduino Firmware
          </button>
          <button
            onClick={() => setActiveTab('readme')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'readme'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Setup Guide
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={handleDownloadArduinoFirmwareTop}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {downloadedSketchCta ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>
              {downloadedSketchCta
                ? 'Downloaded bridge_x_firmware.ino'
                : 'Download Arduino Firmware'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        {activeTab === 'monitor' && (
          <LiveMonitorView
            selectedDlpfCfg={selectedDlpfCfg}
            onSelectDlpfCfg={setSelectedDlpfCfg}
            onSaveTrialToComparator={handleAddTrial}
          />
        )}

        {activeTab === 'comparator' && (
          <TrialComparatorView
            trials={trials}
            onAddTrial={(t) => handleAddTrial(t, false)}
            onRemoveTrial={handleRemoveTrial}
            onClearSyntheticTrials={handleClearSyntheticTrials}
          />
        )}

        {activeTab === 'simulator' && (
          <SyntheticSimulatorView
            selectedDlpfCfg={selectedDlpfCfg}
            onSelectDlpfCfg={setSelectedDlpfCfg}
            onLoadSyntheticSetIntoComparator={handleLoadSyntheticSetIntoComparator}
          />
        )}

        {activeTab === 'firmware' && (
          <div className="space-y-8">
            <ArduinoFirmwareView />
            <TimingAndHardwareView
              selectedDlpfCfg={selectedDlpfCfg}
              onSelectDlpfCfg={setSelectedDlpfCfg}
            />
          </div>
        )}

        {activeTab === 'readme' && <SetupGuideView />}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            BRIDGE-X · IB Physics Collaborative Sciences Project · 60 × 12 × 12 cm Wooden Truss Bridge Vibration Instrumentation
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono">
            <span>Arduino Nano (ATmega328P) · MPU6050 (0x68) · 200.0 Hz INT0 (D2) · 115200 Baud</span>
            <a
              href="/BRIDGE_X_GitHub_Repository.zip"
              download="BRIDGE_X_GitHub_Repository.zip"
              className="inline-flex items-center gap-1 text-blue-700 hover:underline font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download GitHub Repo (.zip)</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
