// audio.js - Web Audio API synthesizer for soothing breath guidance sounds
class SoundEffects {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.activeNodes = new Set();
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 1, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 1, this.ctx.currentTime);
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
      } catch (e) {
        // Fallback if audio context timing error
        this.masterGain.gain.value = muted ? 0 : 1;
      }
    }
    if (muted) {
      this.stopAllActive();
    }
  }

  registerActiveNode(node) {
    if (!node) return;
    this.activeNodes.add(node);
    node.onended = () => {
      this.activeNodes.delete(node);
    };
  }

  stopAllActive() {
    for (const node of this.activeNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // Node might already be stopped
      }
    }
    this.activeNodes.clear();
  }

  // Lempeä nouseva ääni sisäänhengitykselle
  playInhale(durationSeconds = 1.7) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      // Mieto nousu 160Hz -> 260Hz
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + durationSeconds);

      // Pehmeä envelope
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + durationSeconds * 0.4);
      gain.gain.linearRampToValueAtTime(0.001, now + durationSeconds);

      osc.connect(gain);
      gain.connect(this.masterGain);

      this.registerActiveNode(osc);

      osc.start(now);
      osc.stop(now + durationSeconds);
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }

  // Rauhallinen laskeva ääni uloshengitykselle
  playExhale(durationSeconds = 1.7) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      // Mieto lasku 240Hz -> 140Hz
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + durationSeconds);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.07, now + durationSeconds * 0.3);
      gain.gain.linearRampToValueAtTime(0.001, now + durationSeconds);

      osc.connect(gain);
      gain.connect(this.masterGain);

      this.registerActiveNode(osc);

      osc.start(now);
      osc.stop(now + durationSeconds);
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }

  // Syvä, rauhoittava gongi/kulhoääni retentiovaiheen alkuun
  playGong() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      // Perustaajuus ja harmoniset yläsävelet (tiibetiläinen kulho / gongi)
      const freqs = [108, 216, 324, 432];
      const gains = [0.18, 0.08, 0.04, 0.02];

      freqs.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(gains[idx], now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);

        osc.connect(gain);
        gain.connect(this.masterGain);

        this.registerActiveNode(osc);

        osc.start(now);
        osc.stop(now + 3.6);
      });
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }

  // Kirkas, positiivinen kellonsointi palautusvaiheelle ja harjoituksen valmistumiselle
  playChime() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const freqs = [528, 660, 792]; // C5, E5, G5 sointu

      freqs.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        const startTime = now + idx * 0.08;
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 2.0);

        osc.connect(gain);
        gain.connect(this.masterGain);

        this.registerActiveNode(osc);

        osc.start(startTime);
        osc.stop(startTime + 2.1);
      });
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }

  // Lyhyt pehmeä klikkaus/napautus (esim. 3-2-1 laskuriin)
  playBeep(isFinal = false) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isFinal ? 587.33 : 440, now); // D5 vs A4

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);

      this.registerActiveNode(osc);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }
}

export const sound = new SoundEffects();
