// breathDetector.js - Vakaa ja luotettava Web Audio DSP -hengityksentunnistin mobiililaitteille
// Sisältää: Spektrisen 2-kaista-analyysin (Spectral Centroid / Ratio), päästöviiveen (Hang-time) ja tilakorjauksen

export class BreathDetector {
  constructor(options = {}) {
    this.onBreathCounted = options.onBreathCounted || (() => {});
    this.onPhaseChange = options.onPhaseChange || (() => {});
    this.onSubCycleChange = options.onSubCycleChange || (() => {});
    this.onLevelUpdate = options.onLevelUpdate || (() => {});
    this.onCalibrationComplete = options.onCalibrationComplete || (() => {});
    this.onError = options.onError || (() => {});

    this.audioCtx = null;
    this.stream = null;
    this.source = null;
    this.preamp = null;
    this.filter = null;
    this.analyser = null;

    this.isRunning = false;
    this.isCalibrating = false;
    this.rafId = null;

    // Herkkyysasetukset
    this.sensitivity = 'normal'; // 'low', 'normal', 'high', 'max'
    this.noiseFloor = 0.005;
    this.triggerThreshold = 0.020;
    this.releaseThreshold = 0.010;

    // Tallennetut kalibrointinäytteet (amplitudi, muoto ja spektri)
    this.sampleInhale = null;
    this.sampleExhale = null;

    // Akustinen vaimennus / kaiuttimen takaisinkytkennän esto
    this.ignoreAudioUntil = 0;

    // Laskentatila: 'cycle' = Sisään + Ulos = 1 toisto; 'single' = 1 ääni = 1 toisto
    this.cycleMode = 'cycle';
    this.subCycle = 0; // 0 = odotetaan sisäänhengitystä, 1 = odotetaan uloshengitystä
    this.lastHalfBreathTime = 0;

    // Tilanseuranta ja päästöviive (Hang-time)
    this.currentPhase = 'idle'; // 'idle', 'active'
    this.phaseStartTime = 0;
    this.peakTime = 0;
    this.belowThresholdStartTime = 0;
    this.breathCount = 0;
    this.lastCountTime = -1000;
    this.peakEnergyInCycle = 0;

    // Spektridatan keruu aktiivisen vaiheen aikana
    this.activeFrames = 0;
    this.activeSpectralRatioSum = 0;
    this.activeCentroidSum = 0;

    // Liukuva keskiarvo
    this.smoothedEnergy = 0;
  }

  setCycleMode(mode) {
    this.cycleMode = mode;
    this.subCycle = 0;
  }

  setSensitivity(level) {
    this.sensitivity = level;
    this.updateThresholds();
  }

  increaseSensitivity() {
    const levels = ['low', 'normal', 'high', 'max'];
    const idx = levels.indexOf(this.sensitivity);
    if (idx < levels.length - 1) {
      this.setSensitivity(levels[idx + 1]);
      return levels[idx + 1];
    }
    return this.sensitivity;
  }

  decreaseSensitivity() {
    const levels = ['low', 'normal', 'high', 'max'];
    const idx = levels.indexOf(this.sensitivity);
    if (idx > 0) {
      this.setSensitivity(levels[idx - 1]);
      return levels[idx - 1];
    }
    return this.sensitivity;
  }

  updateThresholds() {
    let multiplier = 2.2;
    let minOffset = 0.012;

    if (this.sensitivity === 'low') {
      multiplier = 3.2;
      minOffset = 0.020;
    } else if (this.sensitivity === 'normal') {
      multiplier = 2.2;
      minOffset = 0.012;
    } else if (this.sensitivity === 'high') {
      multiplier = 1.6;
      minOffset = 0.007;
    } else if (this.sensitivity === 'max') {
      multiplier = 1.3;
      minOffset = 0.004;
    }

    const baseFloor = Math.max(0.003, this.noiseFloor);
    this.triggerThreshold = Math.max(0.012, baseFloor * multiplier + minOffset);
    this.releaseThreshold = Math.max(0.006, this.triggerThreshold * 0.55);
  }

  // Laskee taajuuskaistat: matala ilmavirta (puhallus) vs korkea nenäsuhina
  computeSpectralFeatures(freqBuffer, sampleRate = 48000) {
    const totalBins = freqBuffer.length;
    const binSize = (sampleRate / 2) / totalBins;

    // Kaistat:
    // Matala puhallus (200 Hz - 1100 Hz)
    const minLowBin = Math.max(1, Math.floor(200 / binSize));
    const maxLowBin = Math.min(totalBins - 1, Math.floor(1100 / binSize));

    // Korkea suhina (1500 Hz - 4500 Hz)
    const minHighBin = Math.max(1, Math.floor(1500 / binSize));
    const maxHighBin = Math.min(totalBins - 1, Math.floor(4500 / binSize));

    let lowEnergy = 0;
    for (let i = minLowBin; i <= maxLowBin; i++) {
      lowEnergy += freqBuffer[i];
    }

    let highEnergy = 0;
    for (let i = minHighBin; i <= maxHighBin; i++) {
      highEnergy += freqBuffer[i];
    }

    // Spektrinen painopiste
    let weightedSum = 0;
    let totalMag = 0;
    for (let i = 1; i < totalBins; i++) {
      const mag = freqBuffer[i];
      weightedSum += (i * binSize) * mag;
      totalMag += mag;
    }
    const centroid = totalMag > 0 ? (weightedSum / totalMag) : 1000;
    const spectralRatio = highEnergy / (lowEnergy + 1.0);

    return { lowEnergy, highEnergy, spectralRatio, centroid };
  }

  // Luokittelee hengitysäänen muotoprofiilin ja taajuusspektrin perusteella
  classifyBreath(peakRms, duration, peakRatio, spectralRatio = null, centroid = null) {
    if (this.sampleInhale && this.sampleExhale) {
      let distInhale = Math.abs(peakRatio - this.sampleInhale.peakRatio) * 2.5 +
        Math.abs(peakRms - this.sampleInhale.peakRms) / (this.sampleInhale.peakRms || 0.05);
      let distExhale = Math.abs(peakRatio - this.sampleExhale.peakRatio) * 2.5 +
        Math.abs(peakRms - this.sampleExhale.peakRms) / (this.sampleExhale.peakRms || 0.05);

      if (spectralRatio !== null && this.sampleInhale.spectralRatio && this.sampleExhale.spectralRatio) {
        // Taajuussuhteen painotus (korkea suhina vs matala puhallus)
        const normInhale = Math.abs(spectralRatio - this.sampleInhale.spectralRatio) /
          (this.sampleInhale.spectralRatio || 0.5);
        const normExhale = Math.abs(spectralRatio - this.sampleExhale.spectralRatio) /
          (this.sampleExhale.spectralRatio || 0.5);
        distInhale += normInhale * 3.5;
        distExhale += normExhale * 3.5;
      }

      return distInhale <= distExhale ? 'inhale' : 'exhale';
    }

    // Oletus ilman näytteitä
    if (spectralRatio !== null) {
      return spectralRatio > 1.1 ? 'inhale' : (peakRatio >= 0.45 ? 'inhale' : 'exhale');
    }
    return peakRatio >= 0.45 ? 'inhale' : 'exhale';
  }

  // Estää mikrofonia kuuntelemasta oman kaiuttimen ääniä / puhetta
  suppressAudio(durationMs) {
    this.ignoreAudioUntil = Math.max(this.ignoreAudioUntil, performance.now() + durationMs);
    this.currentPhase = 'idle';
    this.smoothedEnergy = 0;
    this.belowThresholdStartTime = 0;
  }

  async start() {
    try {
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        throw new Error('NOT_SECURE_CONTEXT');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('NO_MEDIA_DEVICES');
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      this.source = this.audioCtx.createMediaStreamSource(this.stream);

      // Esivahvistin
      this.preamp = this.audioCtx.createGain();
      this.preamp.gain.setValueAtTime(2.8, this.audioCtx.currentTime);

      // Ylipäästösuodatin (180 Hz) - leikkaa pois matalat huminat ja käsittelyäänet
      this.filter = this.audioCtx.createBiquadFilter();
      this.filter.type = 'highpass';
      this.filter.frequency.setValueAtTime(180, this.audioCtx.currentTime);
      this.filter.Q.setValueAtTime(0.7, this.audioCtx.currentTime);

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.55;

      this.source.connect(this.preamp);
      this.preamp.connect(this.filter);
      this.filter.connect(this.analyser);

      this.isRunning = true;
    } catch (err) {
      console.error('Mikrofonin käynnistys epäonnistui:', err);
      this.onError(err);
      this.stop();
    }
  }

  // 1. Huoneen taustamelun kalibrointi
  measureNoiseFloor(durationMs = 2000) {
    return new Promise((resolve) => {
      this.isCalibrating = true;
      const start = performance.now();
      const samples = [];
      const buffer = new Float32Array(this.analyser.fftSize);

      const loop = () => {
        if (!this.isRunning) return resolve({ noiseFloor: this.noiseFloor });

        this.analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sum / buffer.length);
        samples.push(rms);

        const elapsed = performance.now() - start;
        const progress = Math.min(1, elapsed / durationMs);
        this.onLevelUpdate(rms, progress, true);

        if (elapsed < durationMs) {
          this.rafId = requestAnimationFrame(loop);
        } else {
          this.isCalibrating = false;
          samples.sort((a, b) => a - b);
          const trimmed = samples.slice(
            Math.floor(samples.length * 0.15),
            Math.floor(samples.length * 0.85)
          );
          const avg = trimmed.reduce((a, b) => a + b, 0) / (trimmed.length || 1);
          this.noiseFloor = avg || 0.005;
          this.updateThresholds();
          resolve({ noiseFloor: this.noiseFloor });
        }
      };

      loop();
    });
  }

  // 2. Näytehengityksen mittaus (Sisään tai Ulos) - tallentaa amplitudin, muodon ja spektrin
  recordSample(durationMs = 2200, type = 'inhale') {
    return new Promise((resolve) => {
      this.isCalibrating = true;
      const start = performance.now();
      const timeBuffer = new Float32Array(this.analyser.fftSize);
      const freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
      let peakRms = 0;
      let peakTime = start;
      let activeFrames = 0;
      let spectralRatioSum = 0;
      let centroidSum = 0;

      const loop = () => {
        if (!this.isRunning) {
          return resolve({ peakRms: 0.03, duration: durationMs, peakRatio: 0.5, spectralRatio: 1.0, centroid: 1500 });
        }

        this.analyser.getFloatTimeDomainData(timeBuffer);
        this.analyser.getByteFrequencyData(freqBuffer);

        let sum = 0;
        for (let i = 0; i < timeBuffer.length; i++) {
          sum += timeBuffer[i] * timeBuffer[i];
        }
        const rms = Math.sqrt(sum / timeBuffer.length);

        const now = performance.now();
        if (rms > peakRms) {
          peakRms = rms;
          peakTime = now;
        }

        // Jos ääni on aktiivinen (> 40% yli taustakohinan), tallennetaan spektriä
        if (rms > this.noiseFloor * 1.3) {
          const sampleRate = (this.audioCtx && this.audioCtx.sampleRate) || 48000;
          const spectral = this.computeSpectralFeatures(freqBuffer, sampleRate);
          spectralRatioSum += spectral.spectralRatio;
          centroidSum += spectral.centroid;
          activeFrames++;
        }

        const elapsed = now - start;
        const progress = Math.min(1, elapsed / durationMs);
        this.onLevelUpdate(rms, progress, true);

        if (elapsed < durationMs) {
          this.rafId = requestAnimationFrame(loop);
        } else {
          this.isCalibrating = false;
          const peakRatio = Math.max(0.05, Math.min(0.95, (peakTime - start) / durationMs));
          const avgSpectralRatio = activeFrames > 0 ? (spectralRatioSum / activeFrames) : (type === 'inhale' ? 1.4 : 0.7);
          const avgCentroid = activeFrames > 0 ? (centroidSum / activeFrames) : (type === 'inhale' ? 2200 : 1200);

          const sampleData = {
            peakRms,
            duration: durationMs,
            peakRatio,
            spectralRatio: avgSpectralRatio,
            centroid: avgCentroid
          };

          if (type === 'inhale') {
            this.sampleInhale = sampleData;
          } else {
            this.sampleExhale = sampleData;
          }

          resolve(sampleData);
        }
      };

      loop();
    });
  }

  // Asettaa kynnykset näytteiden perusteella
  applyCalibration(noiseFloor, sampleInhale, sampleExhale) {
    if (noiseFloor) this.noiseFloor = noiseFloor;
    if (sampleInhale) this.sampleInhale = sampleInhale;
    if (sampleExhale) this.sampleExhale = sampleExhale;

    const samplePeak = Math.max(
      sampleInhale ? sampleInhale.peakRms : 0,
      sampleExhale ? sampleExhale.peakRms : 0
    );

    if (samplePeak > this.noiseFloor * 1.35) {
      // Käytetään käyttäjän omaa mitattua hengitysäänen tasoa
      this.triggerThreshold = Math.max(0.012, this.noiseFloor + (samplePeak - this.noiseFloor) * 0.35);
      this.releaseThreshold = Math.max(0.006, this.triggerThreshold * 0.55);
    } else {
      this.updateThresholds();
    }
  }

  startCalibration(durationMs = 2000) {
    this.measureNoiseFloor(durationMs).then((res) => {
      this.onCalibrationComplete({
        noiseFloor: res.noiseFloor,
        threshold: this.triggerThreshold
      });
      this.startListening();
    });
  }

  startListening() {
    this.isRunning = true;
    this.isCalibrating = false;
    this.currentPhase = 'idle';
    this.smoothedEnergy = 0;
    this.subCycle = 0;
    this.belowThresholdStartTime = 0;
    this.listenLoop();
  }

  listenLoop() {
    if (!this.isRunning || this.isCalibrating) return;

    const now = performance.now();

    // Jos vaimennus on aktiivinen (esim. puhe tai merkkiääni soi)
    if (now < this.ignoreAudioUntil) {
      this.currentPhase = 'idle';
      this.smoothedEnergy = 0;
      this.belowThresholdStartTime = 0;
      this.onLevelUpdate(0, this.triggerThreshold, false);
      this.rafId = requestAnimationFrame(() => this.listenLoop());
      return;
    }

    const timeBuffer = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(timeBuffer);

    let sum = 0;
    for (let i = 0; i < timeBuffer.length; i++) {
      sum += timeBuffer[i] * timeBuffer[i];
    }
    const currentRms = Math.sqrt(sum / timeBuffer.length);

    // Responsiivinen pehmennys
    this.smoothedEnergy = (this.smoothedEnergy * 0.6) + (currentRms * 0.4);

    this.onLevelUpdate(this.smoothedEnergy, this.triggerThreshold, false);

    // Jos sisäänhengityksestä on kulunut yli 7s ilman uloshengitystä, nollataan tila
    if (this.subCycle === 1 && (now - this.lastHalfBreathTime) > 7000) {
      this.subCycle = 0;
      this.onSubCycleChange('reset');
    }

    // Äänen tilakone
    if (this.currentPhase === 'idle') {
      if (this.smoothedEnergy > this.triggerThreshold) {
        this.currentPhase = 'active';
        this.phaseStartTime = now;
        this.peakTime = now;
        this.peakEnergyInCycle = this.smoothedEnergy;
        this.belowThresholdStartTime = 0;
        this.activeFrames = 0;
        this.activeSpectralRatioSum = 0;
        this.activeCentroidSum = 0;
        this.onPhaseChange('active', this.smoothedEnergy);
      }
    } else if (this.currentPhase === 'active') {
      if (this.smoothedEnergy > this.peakEnergyInCycle) {
        this.peakEnergyInCycle = this.smoothedEnergy;
        this.peakTime = now;
      }

      // Spektridatan keruu aktiivisen hengitysäänen aikana
      const freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(freqBuffer);
      const sampleRate = (this.audioCtx && this.audioCtx.sampleRate) || 48000;
      const spectral = this.computeSpectralFeatures(freqBuffer, sampleRate);
      this.activeSpectralRatioSum += spectral.spectralRatio;
      this.activeCentroidSum += spectral.centroid;
      this.activeFrames++;

      const breathDuration = now - this.phaseStartTime;

      if (this.smoothedEnergy < this.releaseThreshold) {
        // Päästöviive (release hang-time): ei katkaista ääntä heti, jos kyseessä on vain mikropaussi
        if (!this.belowThresholdStartTime) {
          this.belowThresholdStartTime = now;
        }

        // Vasta kun ääni on ollut kynnyksen alla yhtäjaksoisesti 160ms, hyväksytään se päättyneeksi
        if (now - this.belowThresholdStartTime >= 160) {
          const actualDuration = this.belowThresholdStartTime - this.phaseStartTime;
          this.belowThresholdStartTime = 0;

          const minDuration = (this.cycleMode === 'single' || this.cycleMode === 'fire') ? 140 : 300;

          // Vaaditaan vähintään minDuration kokonaiskesto (hylkää pienet napsahdukset)
          if (actualDuration >= minDuration) {
            const peakRatio = Math.max(0.05, Math.min(0.95, (this.peakTime - this.phaseStartTime) / actualDuration));
            const avgSpectralRatio = this.activeFrames > 0 ? (this.activeSpectralRatioSum / this.activeFrames) : null;
            const avgCentroid = this.activeFrames > 0 ? (this.activeCentroidSum / this.activeFrames) : null;
            const classified = this.classifyBreath(this.peakEnergyInCycle, actualDuration, peakRatio, avgSpectralRatio, avgCentroid);

            const breathData = {
              peakRms: this.peakEnergyInCycle,
              duration: actualDuration,
              peakRatio,
              spectralRatio: avgSpectralRatio,
              centroid: avgCentroid,
              classified
            };

            if (this.cycleMode === 'cycle') {
              if (this.subCycle === 0) {
                // 1. Sisäänhengitys (Laskuri EI vielä nouse)
                if (now - this.lastCountTime >= 300) {
                  this.subCycle = 1;
                  this.lastHalfBreathTime = now;
                  this.suppressAudio(200);
                  this.onSubCycleChange('inhale_done', breathData);
                }
              } else {
                // 2. Uloshengitys (subCycle === 1) -> laskuri nousee (+1)
                // Vaaditaan vähintään 220ms sisäänhengityksen päättymisestä
                if (now - this.lastHalfBreathTime >= 220) {
                  this.subCycle = 0;
                  this.breathCount++;
                  this.lastCountTime = now;
                  this.suppressAudio(300);
                  this.onSubCycleChange('exhale_done', breathData);
                  this.onBreathCounted(this.breathCount, actualDuration);
                }
              }
            } else {
              // Tulipuhallus (Fire Breath) tai yksittäinen ääni = 1 toisto
              // Sallii nopeat ja terävät puhallukset (minimi-intervalli 200ms)
              if (now - this.lastCountTime >= 200) {
                this.breathCount++;
                this.lastCountTime = now;
                this.suppressAudio(160);
                this.onBreathCounted(this.breathCount, actualDuration);
              }
            }
          }

          this.currentPhase = 'idle';
          this.onPhaseChange('idle', this.smoothedEnergy);
        }
      } else {
        // Ääni pysyi/nousi takaisin kynnyksen yli -> nollataan päästöviive, hengitys jatkuu yhtenäisenä
        this.belowThresholdStartTime = 0;

        if (breathDuration > 4500) {
          this.currentPhase = 'idle';
          this.onPhaseChange('idle', this.smoothedEnergy);
        }
      }
    }

    this.rafId = requestAnimationFrame(() => this.listenLoop());
  }

  // Manuaalinen lisäys: lisää aina täyden toiston (+1)
  registerManualBreath() {
    const now = performance.now();
    if (now - this.lastCountTime > 300) {
      this.breathCount++;
      this.subCycle = 0;
      this.lastCountTime = now;
      this.belowThresholdStartTime = 0;
      this.suppressAudio(350);
      this.onSubCycleChange('exhale_done', { peakRms: 0.05, duration: 1000, peakRatio: 0.3, classified: 'exhale' });
      this.onBreathCounted(this.breathCount, 1000);
      return this.breathCount;
    }
    return this.breathCount;
  }

  stop() {
    this.isRunning = false;
    this.isCalibrating = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    this.smoothedEnergy = 0;
    this.currentPhase = 'idle';
    this.subCycle = 0;
    this.belowThresholdStartTime = 0;
  }
}
