import { describe, expect, it } from "bun:test";
import { PACES } from "./app.js";
import { BreathDetector } from "./breathDetector.js";
import { parseHeartRateMeasurement, calculateRMSSD, HeartRateMonitor } from "./heartRate.js";
import { TECHNIQUES, getTechniqueById } from "./techniques.js";
import { saveSession, calculateStreak, getHistorySummary, clearHistory } from "./history.js";

describe("Still Breathing App Tests", () => {
  it("defines correct pace settings", () => {
    expect(PACES.slow).toBeDefined();
    expect(PACES.medium).toBeDefined();
    expect(PACES.fast).toBeDefined();

    expect(PACES.slow.inhale).toBe(2.4);
    expect(PACES.slow.exhale).toBe(2.4);

    expect(PACES.medium.inhale).toBe(1.7);
    expect(PACES.medium.exhale).toBe(1.7);

    expect(PACES.fast.inhale).toBe(1.2);
    expect(PACES.fast.exhale).toBe(1.2);
  });

  it("calculates time formatting accurately", () => {
    const formatTime = (ms: number) => {
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      return `${pad(minutes)}:${pad(seconds)}`;
    };

    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(9500)).toBe("00:09");
    expect(formatTime(60000)).toBe("01:00");
    expect(formatTime(85000)).toBe("01:25");
    expect(formatTime(125000)).toBe("02:05");
  });

  it("checks breathing round and retention stats structure", () => {
    const retentionTimes = [75000, 105000, 120000]; // 1:15, 1:45, 2:00
    const maxTime = Math.max(...retentionTimes);
    expect(maxTime).toBe(120000);

    const totalRetentionSec = Math.round(retentionTimes.reduce((a, b) => a + b, 0) / 1000);
    expect(totalRetentionSec).toBe(300); // 5 minutes total
  });

  it("configures BreathDetector thresholds and sensitivities", () => {
    const detector = new BreathDetector();
    expect(detector.sensitivity).toBe("normal");

    detector.noiseFloor = 0.02;
    detector.setSensitivity("normal");
    const normalThreshold = detector.triggerThreshold;

    detector.setSensitivity("high");
    expect(detector.triggerThreshold).toBeLessThan(normalThreshold);

    detector.setSensitivity("low");
    expect(detector.triggerThreshold).toBeGreaterThan(normalThreshold);
  });

  it("handles cycle mode: Inhale + Exhale = 1 breath", () => {
    let counted = 0;
    let subCycle = '';
    const detector = new BreathDetector({
      onBreathCounted: (count) => {
        counted = count;
      },
      onSubCycleChange: (phase) => {
        subCycle = phase;
      }
    });

    expect(detector.cycleMode).toBe('cycle');
    expect(detector.subCycle).toBe(0);

    // Manuaalinen lisäys lisää aina täyden toiston
    detector.registerManualBreath();
    expect(counted).toBe(1);
    expect(subCycle).toBe('exhale_done');
  });

  it("correctly classifies Inhale vs Exhale using peakRatio and recorded samples", () => {
    const detector = new BreathDetector();

    // 1. Ilman näytteitä: yleinen muotoluokittelu
    // Inhale (huippu lopussa, peakRatio 0.70)
    expect(detector.classifyBreath(0.04, 1200, 0.70)).toBe('inhale');
    // Exhale (huippu heti alussa, peakRatio 0.25)
    expect(detector.classifyBreath(0.04, 1200, 0.25)).toBe('exhale');

    // 2. Tallennetuilla näytteillä:
    detector.sampleInhale = { peakRms: 0.045, duration: 1300, peakRatio: 0.65 };
    detector.sampleExhale = { peakRms: 0.035, duration: 1100, peakRatio: 0.28 };

    // Uusi hengitys lähempänä sisäänhengityksen profiilia
    expect(detector.classifyBreath(0.042, 1250, 0.60)).toBe('inhale');
    // Uusi hengitys lähempänä uloshengityksen profiilia
    expect(detector.classifyBreath(0.038, 1050, 0.32)).toBe('exhale');
  });

  it("disambiguates nose breaths using 2-band spectral features", () => {
    const detector = new BreathDetector();

    // Molemmilla on sama peakRatio (0.42) ja kesto (1200ms), mutta erilainen taajuussuhde
    detector.sampleInhale = { peakRms: 0.04, duration: 1200, peakRatio: 0.42, spectralRatio: 1.8, centroid: 2400 };
    detector.sampleExhale = { peakRms: 0.04, duration: 1200, peakRatio: 0.42, spectralRatio: 0.6, centroid: 950 };

    // Korkea suhina (1.6) -> Sisäänhengitys
    expect(detector.classifyBreath(0.04, 1200, 0.42, 1.6, 2300)).toBe('inhale');

    // Matala puhallus (0.7) -> Uloshengitys
    expect(detector.classifyBreath(0.04, 1200, 0.42, 0.7, 1000)).toBe('exhale');
  });

  it("handles custom slider duration settings and tank visualizer progress calculations", () => {
    const customInhale = 2; // sekuntia
    const customExhale = 40; // sekuntia
    const totalCycle = customInhale + customExhale;

    expect(totalCycle).toBe(42);

    // Testaa säiliön täyttymisen progress-laskentaa (0 -> 100%)
    const calcFillPercent = (elapsedMs: number, durationMs: number) => {
      const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
      return progress * 100;
    };

    // Testaa säiliön tyhjentymisen progress-laskentaa (100 -> 0%)
    const calcDrainPercent = (elapsedMs: number, durationMs: number) => {
      const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
      return (1 - progress) * 100;
    };

    // Sisäänhengitys 2s: puolivälissä 1s -> 50%
    expect(calcFillPercent(1000, 2000)).toBe(50);
    expect(calcFillPercent(2000, 2000)).toBe(100);

    // Uloshengitys 40s: puolivälissä 20s -> 50%, lopussa 40s -> 0%
    expect(calcDrainPercent(20000, 40000)).toBe(50);
    expect(calcDrainPercent(30000, 40000)).toBe(25);
    expect(calcDrainPercent(40000, 40000)).toBe(0);
  });

  it("mutes and unmutes sounds via sound.setMuted and voice.setEnabled", async () => {
    const { sound } = await import("./audio.js");
    const { voice } = await import("./speech.js");

    sound.setMuted(true);
    voice.setEnabled(false);
    expect(sound.isMuted).toBe(true);
    expect(voice.isEnabled).toBe(false);

    sound.setMuted(false);
    voice.setEnabled(true);
    expect(sound.isMuted).toBe(false);
    expect(voice.isEnabled).toBe(true);
  });

  it("stops active nodes immediately and disconnects when sound.setMuted(true) is called", async () => {
    const { sound } = await import("./audio.js");

    let stopped = false;
    let disconnected = false;
    const mockNode = {
      stop: () => { stopped = true; },
      disconnect: () => { disconnected = true; },
      onended: null as any
    };

    sound.registerActiveNode(mockNode);
    expect(sound.activeNodes.has(mockNode)).toBe(true);

    // Muting stops and disconnects all currently active nodes
    sound.setMuted(true);
    expect(stopped).toBe(true);
    expect(disconnected).toBe(true);
    expect(sound.activeNodes.size).toBe(0);
    expect(sound.isMuted).toBe(true);

    // Reset back to unmuted
    sound.setMuted(false);
    expect(sound.isMuted).toBe(false);
  });

  it("calculates progressive ladder and pyramid breath sequences accurately", () => {
    const generateLadderSequence = (start: number, step: number, max: number, isPyramid = true) => {
      const seq: number[] = [];
      for (let val = start; val <= max; val += step) {
        seq.push(val);
      }
      if (isPyramid) {
        for (let val = max - step; val >= start; val -= step) {
          seq.push(val);
        }
      }
      return seq;
    };

    // Esim. 5s -> 40s askeleella 5s pyramidi (käyttäjän esimerkki)
    const pyramid = generateLadderSequence(5, 5, 40, true);
    expect(pyramid).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 35, 30, 25, 20, 15, 10, 5]);
    expect(pyramid.length).toBe(15);
    expect(pyramid[7]).toBe(40); // Huippu keskellä

    // Pelkkä nousu (ladder up)
    const ladderUp = generateLadderSequence(5, 5, 40, false);
    expect(ladderUp).toEqual([5, 10, 15, 20, 25, 30, 35, 40]);
    expect(ladderUp.length).toBe(8);

    // Kokonaiskesto kiinteällä 5s sisäänhengityksellä
    const fixedInhale = 5;
    const totalDurationSec = pyramid.reduce((acc, exhale) => acc + (fixedInhale + exhale), 0);
    // 15 * 5s sisään = 75s; ulos = 5+10+15+20+25+30+35+40+35+30+25+20+15+10+5 = 320s; yht = 395s (~6.5 min)
    expect(totalDurationSec).toBe(395);
  });

  it("parses BLE 0x2A37 8-bit and 16-bit heart rate packets with RR intervals", () => {
    // 8-bit BPM (flag 0x00), value 68
    const buf8 = new Uint8Array([0x00, 68]).buffer;
    const res8 = parseHeartRateMeasurement(new DataView(buf8));
    expect(res8.bpm).toBe(68);
    expect(res8.rrIntervalsMs).toEqual([]);

    // 16-bit BPM (bit 0 = 1) + RR intervals present (bit 4 = 1 -> 0x11)
    // BPM = 300 (0x012C little-endian: 0x2C, 0x01), RR1 = 1024 (1000 ms), RR2 = 512 (500 ms)
    const buf16 = new Uint8Array([0x11, 0x2c, 0x01, 0x00, 0x04, 0x00, 0x02]).buffer;
    const res16 = parseHeartRateMeasurement(new DataView(buf16));
    expect(res16.bpm).toBe(300);
    expect(res16.rrIntervalsMs.length).toBe(2);
    expect(Math.round(res16.rrIntervalsMs[0])).toBe(1000);
    expect(Math.round(res16.rrIntervalsMs[1])).toBe(500);
  });

  it("calculates HRV RMSSD and records HeartRateMonitor stats", () => {
    expect(calculateRMSSD([800])).toBeNull();
    // Diffs: +20, -20 => squares 400, 400 => mean 400 => sqrt = 20
    expect(calculateRMSSD([800, 820, 800])).toBe(20);

    const monitor = new HeartRateMonitor();
    monitor.startRecording();
    expect(monitor.recording).toBe(true);

    // Simulate two BLE notifications
    const packet1 = parseHeartRateMeasurement(new DataView(new Uint8Array([0x10, 62, 0x00, 0x04, 0x20, 0x04]).buffer));
    const packet2 = parseHeartRateMeasurement(new DataView(new Uint8Array([0x00, 74]).buffer));
    monitor.handleMeasurement(packet1.bpm, packet1.rrIntervalsMs);
    monitor.handleMeasurement(packet2.bpm, packet2.rrIntervalsMs);

    const stats = monitor.stopRecording();
    expect(monitor.recording).toBe(false);
    expect(stats).not.toBeNull();
    expect(stats!.min).toBe(62);
    expect(stats!.max).toBe(74);
    expect(stats!.avg).toBe(68);
    expect(stats!.points.length).toBe(2);
  });

  it("provides breathing techniques with valid phases and instructions", () => {
    expect(TECHNIQUES.box.phases).toEqual({ inhale: 4, holdIn: 4, exhale: 4, holdOut: 4 });
    expect(TECHNIQUES.relax478.phases).toEqual({ inhale: 4, holdIn: 7, exhale: 8, holdOut: 0 });
    expect(TECHNIQUES.buteyko.phases).toEqual({ inhale: 3, holdIn: 0, exhale: 4, holdOut: 4 });
    expect(TECHNIQUES.tummo.phases).toEqual({ inhale: 6, holdIn: 2, exhale: 6, holdOut: 2 });

    const fallback = getTechniqueById("unknown-id");
    expect(fallback.id).toBe("box");
  });

  it("tracks session history and calculates consecutive day streaks", () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); }
    };

    const refDate = new Date("2026-11-15T12:00:00Z");
    saveSession({ dateIso: "2026-11-15T10:00:00Z", title: "Box Breathing", durationSec: 180, rounds: 6 }, mockStorage);
    saveSession({ dateIso: "2026-11-14T10:00:00Z", title: "Wim Hof", durationSec: 420, rounds: 3, maxRetentionMs: 95000 }, mockStorage);
    saveSession({ dateIso: "2026-11-12T10:00:00Z", title: "Buteyko", durationSec: 120, rounds: 8 }, mockStorage);

    const summary = getHistorySummary(mockStorage, refDate);
    expect(summary.totalSessions).toBe(3);
    expect(summary.streakDays).toBe(2); // 15.11 + 14.11 (13.11 puuttuu)
    expect(summary.totalMinutes).toBe(12);

    // Putki katkeaa jos viimeisin harjoitus oli yli 1 pv sitten
    expect(calculateStreak([{ dateIso: "2026-11-10T10:00:00Z" }], refDate)).toBe(0);

    clearHistory(mockStorage);
    expect(getHistorySummary(mockStorage, refDate).totalSessions).toBe(0);
  });
});
