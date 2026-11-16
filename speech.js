// speech.js - Suomenkielinen selaimen puhesynteesi ilman ulkoisia API-kutsuja

class VoiceAnnouncer {
  constructor() {
    this.isEnabled = true;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.finnishVoice = null;

    if (this.synth) {
      this.loadVoices();
      if (typeof this.synth.onvoiceschanged !== 'undefined') {
        this.synth.onvoiceschanged = () => this.loadVoices();
      }
    }
  }

  loadVoices() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    this.finnishVoice = voices.find(v => v.lang.startsWith('fi')) || null;
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled && this.synth) {
      this.synth.cancel();
    }
  }

  speak(text, priority = false) {
    if (!this.isEnabled || !this.synth) return;

    try {
      if (priority) {
        this.synth.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fi-FI';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      if (this.finnishVoice) {
        utterance.voice = this.finnishVoice;
      }

      this.synth.speak(utterance);
    } catch (e) {
      console.warn('Puhesynteesi ei käytettävissä:', e);
    }
  }

  speakAsync(text, priority = false) {
    return new Promise((resolve) => {
      if (!this.isEnabled || !this.synth) {
        resolve();
        return;
      }

      try {
        if (priority) {
          this.synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fi-FI';
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        if (this.finnishVoice) {
          utterance.voice = this.finnishVoice;
        }

        let finished = false;
        const done = () => {
          if (!finished) {
            finished = true;
            resolve();
          }
        };

        utterance.onend = done;
        utterance.onerror = done;

        // Varmistusturva-aikakatkaisu (max 3.5s)
        setTimeout(done, 3500);

        this.synth.speak(utterance);
      } catch (e) {
        console.warn('Puhesynteesi ei käytettävissä:', e);
        resolve();
      }
    });
  }

  announceHold(count) {
    const text = count ? `${count} täynnä. Päästä ilma ulos ja pidätä.` : 'Päästä ilma ulos ja pidätä.';
    this.speak(text, true);
  }

  announceFireHold(count) {
    const text = count ? `${count} täynnä. Ota syvä henki sisään, pidätä ja ime vatsa sisään.` : 'Ota syvä henki sisään, pidätä ja ime vatsa sisään.';
    this.speak(text, true);
  }

  announceRecovery() {
    this.speak('Ota syvä henki sisään ja pidätä viisitoista sekuntia.', true);
  }

  announceRecoveryDone() {
    this.speak('Päästä ilma ulos ja rentoudu.', true);
  }

  async announceCalibrationAsync() {
    await this.speakAsync('Ole hetki aivan hiljaa.', true);
  }

  async announceSampleInhaleAsync() {
    await this.speakAsync('Hengitä kerran syvään sisään.', true);
  }

  async announceSampleExhaleAsync() {
    await this.speakAsync('Ja päästä ilma ulos.', true);
  }

  async announceSampleCompleteAsync() {
    await this.speakAsync('Kalibrointi valmis! Aloitetaan.', true);
  }

  announceStart() {
    this.speak('Aloita hengitys omaan tahtiin.', true);
  }
}

export const voice = new VoiceAnnouncer();
