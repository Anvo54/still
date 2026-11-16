// heartRate.js - Web Bluetooth API (GATT 0x180D) tuki Polar Verity Senselle ja muille BLE-sykesensoreille

export function parseHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRRIntervals = (flags & 0x10) !== 0;

  let offset = 1;
  let bpm = 0;

  if (is16Bit) {
    bpm = dataView.getUint16(offset, true);
    offset += 2;
  } else {
    bpm = dataView.getUint8(offset);
    offset += 1;
  }

  if (hasEnergyExpended) {
    offset += 2;
  }

  const rrIntervalsMs = [];
  if (hasRRIntervals) {
    while (offset + 1 < dataView.byteLength) {
      const rrRaw = dataView.getUint16(offset, true);
      // Bluetooth GATT määrittää RR-intervallin yksiköksi 1/1024 sekuntia
      const rrMs = Math.round((rrRaw / 1024) * 1000);
      rrIntervalsMs.push(rrMs);
      offset += 2;
    }
  }

  return { bpm, rrIntervalsMs };
}

export function calculateRMSSD(rrList) {
  if (!rrList || rrList.length < 2) return null;
  let sumSquaredDiffs = 0;
  let count = 0;
  for (let i = 1; i < rrList.length; i++) {
    const diff = rrList[i] - rrList[i - 1];
    sumSquaredDiffs += diff * diff;
    count++;
  }
  if (count === 0) return null;
  return Math.round(Math.sqrt(sumSquaredDiffs / count));
}

export class HeartRateMonitor {
  constructor(callbacks = {}) {
    this.onHeartRate = callbacks.onHeartRate || (() => {});
    this.onStatusChange = callbacks.onStatusChange || (() => {});
    this.onBatteryLevel = callbacks.onBatteryLevel || (() => {});

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnected = false;
    this.deviceName = '';

    this.currentBpm = null;
    this.recentRR = [];
    this.history = [];
    this.recording = false;
    this.recordStartTime = 0;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async connect() {
    if (!HeartRateMonitor.isSupported()) {
      throw new Error('BLUETOOTH_NOT_SUPPORTED');
    }

    this.onStatusChange('connecting', 'Yhdistetään...');

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['battery_service']
      });

      this.deviceName = this.device.name || 'Polar / BLE-syke';

      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService('heart_rate');
      this.characteristic = await service.getCharacteristic('heart_rate_measurement');

      this.characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        const { bpm, rrIntervalsMs } = parseHeartRateMeasurement(value);
        this.handleMeasurement(bpm, rrIntervalsMs);
      });

      await this.characteristic.startNotifications();
      this.isConnected = true;
      this.onStatusChange('connected', this.deviceName);

      // Yritetään lukea akun taso taustalla
      this.readBatteryLevel();

      return this.deviceName;
    } catch (err) {
      this.isConnected = false;
      if (err && err.name === 'NotFoundError') {
        this.onStatusChange('disconnected', 'Ei yhdistetty');
        return null;
      }
      this.onStatusChange('error', 'Yhteys epäonnistui');
      throw err;
    }
  }

  async readBatteryLevel() {
    if (!this.server || !this.server.connected) return;
    try {
      const batteryService = await this.server.getPrimaryService('battery_service');
      const batteryChar = await batteryService.getCharacteristic('battery_level');
      const val = await batteryChar.readValue();
      const level = val.getUint8(0);
      this.onBatteryLevel(level);
    } catch (e) {
      // Akun lukeminen on valinnaista
    }
  }

  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    } else {
      this.handleDisconnect();
    }
  }

  handleDisconnect() {
    this.isConnected = false;
    this.currentBpm = null;
    this.onStatusChange('disconnected', 'Ei yhdistetty');
  }

  handleMeasurement(bpm, rrIntervalsMs) {
    if (!bpm || bpm <= 0) return;
    this.currentBpm = bpm;

    if (rrIntervalsMs && rrIntervalsMs.length > 0) {
      this.recentRR.push(...rrIntervalsMs);
      if (this.recentRR.length > 30) {
        this.recentRR = this.recentRR.slice(-30);
      }
    }

    const hrv = calculateRMSSD(this.recentRR);

    if (this.recording) {
      this.history.push({
        t: Date.now() - this.recordStartTime,
        bpm,
        hrv
      });
    }

    this.onHeartRate({ bpm, hrv, rrIntervalsMs });
  }

  startRecording() {
    this.history = [];
    this.recentRR = [];
    this.recordStartTime = Date.now();
    this.recording = true;
    if (this.currentBpm) {
      this.history.push({ t: 0, bpm: this.currentBpm, hrv: null });
    }
  }

  stopRecording() {
    this.recording = false;
    return this.getStats();
  }

  getStats() {
    if (!this.history || this.history.length === 0) {
      return null;
    }
    const bpms = this.history.map(p => p.bpm);
    const min = Math.min(...bpms);
    const max = Math.max(...bpms);
    const avg = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
    const hrvValues = this.history.map(p => p.hrv).filter(v => v !== null);
    const avgHrv = hrvValues.length > 0
      ? Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length)
      : null;

    return {
      min,
      max,
      avg,
      avgHrv,
      points: this.history
    };
  }
}
