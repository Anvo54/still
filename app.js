// app.js - Still: Hengitys & Suorituskyky
import { sound } from './audio.js';
import { voice } from './speech.js';
import { BreathDetector } from './breathDetector.js';
import { HeartRateMonitor } from './heartRate.js';
import { TECHNIQUES, getTechniqueById } from './techniques.js';
import { saveSession, getHistorySummary, clearHistory } from './history.js';

const HR_DROP_RHYTHMS = {
  coherent: { name: 'Koherentti 5–5', inhale: 5, holdIn: 0, exhale: 5 },
  calm48: { name: 'Rauhoittava 4–8', inhale: 4, holdIn: 0, exhale: 8 },
  sigh428: { name: 'Pitkä ulos 4–2–8', inhale: 4, holdIn: 2, exhale: 8 }
};

// Konfiguraatio ja vauhdit
const PACES = {
  slow: {
    name: 'Hidas',
    inhale: 2.4,
    exhale: 2.4,
    total: 4.8,
    desc: '~4.8 s / sykli'
  },
  medium: {
    name: 'Keskivauhti',
    inhale: 1.7,
    exhale: 1.7,
    total: 3.4,
    desc: '~3.4 s / sykli'
  },
  fast: {
    name: 'Nopea',
    inhale: 1.2,
    exhale: 1.2,
    total: 2.4,
    desc: '~2.4 s / sykli'
  }
};

class BreathingApp {
  constructor() {
    // Harjoitusasetukset
    this.exerciseMode = 'timed'; // 'timed' | 'listening'
    this.cycleMode = 'cycle'; // 'cycle' (Sisään + Ulos = 1) | 'single' (jokainen = 1)
    this.selectedPace = 'medium';
    this.micSensitivity = 'normal';
    this.customInhale = 2; // sekuntia (1-15s)
    this.customExhale = 40; // sekuntia (2-60s)
    this.breathsPerRound = 30;
    this.totalRounds = 3;
    this.includeRecovery = true;
    this.voiceEnabled = true;
    this.headphonesMode = false;
    this.isMuted = false;

    // Säiliöanimaation tila
    this.tankAnimId = null;
    this.tankStartTime = 0;

    // Harjoituksen tila
    this.state = 'setup'; // 'setup' | 'countdown' | 'calibrating' | 'breathing' | 'retention' | 'recovery' | 'summary'
    this.currentRound = 1;
    this.currentBreath = 0;
    this.retentionTimes = []; // ms per kierros
    this.retentionStartTime = 0;
    this.retentionTimerId = null;
    this.activeTimeouts = [];
    this.wakeLock = null;
    this.sessionStartTime = null;

    // Mikrofoni-tunnistin
    this.detector = null;

    // Sykesensori (Polar Verity Sense / BLE)
    this.hrMonitor = null;

    // Tekniikkakirjaston tila
    this.selectedTechniqueId = 'box';
    this.techniqueCycles = 6;

    // Sykkeenlasku / Biofeedback-tila
    this.hrDropRhythm = 'coherent';
    this.hrDropTargetBpm = 5;
    this.hrDropMinutes = 3;
    this.hrBaselineBpm = null;
    this.hrLowestBpm = null;
    this.hrLastBpm = null;
    this.hrTargetReached = false;

    // DOM-elementit
    this.initElements();
    this.initHeartRateMonitor();
    this.attachEventListeners();
    this.updatePaceVisuals();
    this.updateLadderDisplay();
    this.updateTechniqueDisplay();
    this.renderHistoryUI();
    this.updateWakeLockHint();
  }

  initElements() {
    // Näytöt
    this.screens = {
      setup: document.getElementById('setupScreen'),
      exercise: document.getElementById('exerciseScreen'),
      summary: document.getElementById('summaryScreen')
    };

    // Moodin ja asetusten kontrollit
    this.modeTimedBtn = document.getElementById('modeTimedBtn');
    this.modeTechniqueBtn = document.getElementById('modeTechniqueBtn');
    this.modeHrDropBtn = document.getElementById('modeHrDropBtn');
    this.modeCustomBtn = document.getElementById('modeCustomBtn');
    this.modeLadderBtn = document.getElementById('modeLadderBtn');
    this.modeListeningBtn = document.getElementById('modeListeningBtn');
    this.paceSettingGroup = document.getElementById('paceSettingGroup');
    this.techniqueSettingGroup = document.getElementById('techniqueSettingGroup');
    this.hrDropSettingGroup = document.getElementById('hrDropSettingGroup');
    this.customSettingGroup = document.getElementById('customSettingGroup');

    // Sykkeenlaskun asetukset ja live-biofeedback
    this.hrTargetPills = document.getElementById('hrTargetPills');
    this.decHrDropMinBtn = document.getElementById('decHrDropMinBtn');
    this.incHrDropMinBtn = document.getElementById('incHrDropMinBtn');
    this.hrDropMinutesDisplay = document.getElementById('hrDropMinutesDisplay');
    this.hrBiofeedbackCard = document.getElementById('hrBiofeedbackCard');
    this.hrBfBaseline = document.getElementById('hrBfBaseline');
    this.hrBfCurrent = document.getElementById('hrBfCurrent');
    this.hrBfDelta = document.getElementById('hrBfDelta');
    this.hrBfTarget = document.getElementById('hrBfTarget');
    this.ladderSettingGroup = document.getElementById('ladderSettingGroup');
    this.micSettingGroup = document.getElementById('micSettingGroup');
    this.breathsSettingGroup = document.getElementById('breathsSettingGroup');
    this.roundsSettingGroup = document.getElementById('roundsSettingGroup');
    this.recoveryToggleRow = document.getElementById('recoveryToggleRow');

    // Tekniikkakirjasto
    this.techniqueGrid = document.getElementById('techniqueGrid');
    this.techniqueRhythmBadge = document.getElementById('techniqueRhythmBadge');
    this.techniqueInfoCard = document.getElementById('techniqueInfoCard');
    this.decTechCyclesBtn = document.getElementById('decTechCyclesBtn');
    this.incTechCyclesBtn = document.getElementById('incTechCyclesBtn');
    this.techCyclesDisplay = document.getElementById('techCyclesDisplay');

    // Paikallinen historia
    this.historyBar = document.getElementById('historyBar');
    this.historyStreakBadge = document.getElementById('historyStreakBadge');
    this.historyCountBadge = document.getElementById('historyCountBadge');
    this.toggleHistoryBtn = document.getElementById('toggleHistoryBtn');
    this.historyPanel = document.getElementById('historyPanel');
    this.historyList = document.getElementById('historyList');
    this.clearHistoryBtn = document.getElementById('clearHistoryBtn');

    // Keskeytysmodaali & yhteenvedon otsikot
    this.earlyExitOverlay = document.getElementById('earlyExitOverlay');
    this.earlyExitDurationText = document.getElementById('earlyExitDurationText');
    this.earlySaveReportBtn = document.getElementById('earlySaveReportBtn');
    this.earlyViewOnlyBtn = document.getElementById('earlyViewOnlyBtn');
    this.earlyDiscardBtn = document.getElementById('earlyDiscardBtn');
    this.summaryTrophy = document.getElementById('summaryTrophy');
    this.summaryTitle = document.getElementById('summaryTitle');
    this.summarySubtitle = document.getElementById('summarySubtitle');

    // Mukautetun tilan sliderit
    this.inhaleSlider = document.getElementById('inhaleSlider');
    this.exhaleSlider = document.getElementById('exhaleSlider');
    this.inhaleTimeDisplay = document.getElementById('inhaleTimeDisplay');
    this.exhaleTimeDisplay = document.getElementById('exhaleTimeDisplay');
    this.customTotalCycleTime = document.getElementById('customTotalCycleTime');
    this.customRatioHint = document.getElementById('customRatioHint');

    // Porras-/Pyramidihengitys
    this.ladderTargetButtons = document.querySelectorAll('.segment-btn[data-laddertarget]');
    this.ladderPatternButtons = document.querySelectorAll('.segment-btn[data-ladderpattern]');
    this.ladderTargetDesc = document.getElementById('ladderTargetDesc');
    this.ladderPatternDesc = document.getElementById('ladderPatternDesc');

    this.ladderStartSlider = document.getElementById('ladderStartSlider');
    this.ladderStepSlider = document.getElementById('ladderStepSlider');
    this.ladderMaxSlider = document.getElementById('ladderMaxSlider');
    this.ladderFixedSlider = document.getElementById('ladderFixedSlider');

    this.ladderStartDisplay = document.getElementById('ladderStartDisplay');
    this.ladderStepDisplay = document.getElementById('ladderStepDisplay');
    this.ladderMaxDisplay = document.getElementById('ladderMaxDisplay');
    this.ladderFixedDisplay = document.getElementById('ladderFixedDisplay');
    this.ladderFixedLabel = document.getElementById('ladderFixedLabel');
    this.ladderFixedBlock = document.getElementById('ladderFixedBlock');

    this.ladderTotalStepsText = document.getElementById('ladderTotalStepsText');
    this.ladderTotalDurationText = document.getElementById('ladderTotalDurationText');
    this.ladderSequencePreview = document.getElementById('ladderSequencePreview');

    this.ladderTarget = 'exhale';
    this.ladderPattern = 'pyramid';
    this.ladderStart = 5;
    this.ladderStep = 5;
    this.ladderMax = 40;
    this.ladderFixed = 5;
    this.ladderSequence = [];
    this.ladderCurrentStepIndex = 0;

    this.sensitivityButtons = document.querySelectorAll('.segment-btn[data-sensitivity]');
    this.cycleModeButtons = document.querySelectorAll('.segment-btn[data-cyclemode]');
    this.paceDescription = document.getElementById('paceDescription');
    this.paceButtons = document.querySelectorAll('.segment-btn[data-pace]');
    this.breathPillButtons = document.querySelectorAll('.pill-btn[data-breaths]');
    this.roundPillButtons = document.querySelectorAll('.pill-btn[data-rounds]');
    this.breathsCountDisplay = document.getElementById('breathsCountDisplay');
    this.roundsCountDisplay = document.getElementById('roundsCountDisplay');
    this.decBreathsBtn = document.getElementById('decBreathsBtn');
    this.incBreathsBtn = document.getElementById('incBreathsBtn');
    this.decRoundsBtn = document.getElementById('decRoundsBtn');
    this.incRoundsBtn = document.getElementById('incRoundsBtn');
    this.recoveryToggle = document.getElementById('recoveryToggle');
    this.voiceToggle = document.getElementById('voiceToggle');
    this.keepScreenOnToggle = document.getElementById('keepScreenOnToggle');
    this.wakeLockHttpsHint = document.getElementById('wakeLockHttpsHint');
    this.httpsSwitchLink = document.getElementById('httpsSwitchLink');
    this.wakeLockStatusBadge = document.getElementById('wakeLockStatusBadge');
    this.keepScreenOn = true;
    this.wakeLockDesired = false;
    this.headphonesToggle = document.getElementById('headphonesToggle');
    this.startExerciseBtn = document.getElementById('startExerciseBtn');

    // Harjoitusnäytön elementit
    this.exerciseRoundBadge = document.getElementById('exerciseRoundBadge');
    this.micStatusBadge = document.getElementById('micStatusBadge');
    this.exercisePhaseTitle = document.getElementById('exercisePhaseTitle');
    this.visualizerWrapper = document.getElementById('visualizerWrapper');
    this.audioReactiveRing = document.getElementById('audioReactiveRing');
    this.breathingCircleOuter = document.getElementById('breathingCircleOuter');
    this.breathingCircleInner = document.getElementById('breathingCircleInner');
    this.circleMainText = document.getElementById('circleMainText');
    this.circleSubText = document.getElementById('circleSubText');

    // Säiliöindikaattori (Mukautettu tila)
    this.tankVisualizer = document.getElementById('tankVisualizer');
    this.tankLiquid = document.getElementById('tankLiquid');
    this.tankTimeText = document.getElementById('tankTimeText');
    this.tankPhaseText = document.getElementById('tankPhaseText');
    this.tankCycleCount = document.getElementById('tankCycleCount');
    this.tankPercentText = document.getElementById('tankPercentText');

    this.instructionMain = document.getElementById('instructionMain');
    this.instructionSub = document.getElementById('instructionSub');
    this.calibrationBarContainer = document.getElementById('calibrationBarContainer');
    this.calibrationBarFill = document.getElementById('calibrationBarFill');
    this.earlyRetentionBtn = document.getElementById('earlyRetentionBtn');
    this.retentionReadyBtn = document.getElementById('retentionReadyBtn');
    this.skipRecoveryBtn = document.getElementById('skipRecoveryBtn');
    this.exitExerciseBtn = document.getElementById('exitExerciseBtn');

    // Reaaliaikainen mikrofonimittari
    this.micMeterContainer = document.getElementById('micMeterContainer');
    this.micMeterFill = document.getElementById('micMeterFill');
    this.micMeterThresholdMarker = document.getElementById('micMeterThresholdMarker');
    this.micMeterStatus = document.getElementById('micMeterStatus');
    this.liveSensDisplay = document.getElementById('liveSensDisplay');
    this.decSensBtn = document.getElementById('decSensBtn');
    this.incSensBtn = document.getElementById('incSensBtn');
    this.tapBreathBtn = document.getElementById('tapBreathBtn');

    // Yhteenveto
    this.summaryRoundsList = document.getElementById('summaryRoundsList');
    this.summaryTotalStats = document.getElementById('summaryTotalStats');
    this.restartExerciseBtn = document.getElementById('restartExerciseBtn');

    // Ääni
    this.soundToggleBtn = document.getElementById('soundToggleBtn');
    this.soundIconOn = document.getElementById('soundIconOn');
    this.soundIconOff = document.getElementById('soundIconOff');

    // Sykesensori
    this.hrConnectBtn = document.getElementById('hrConnectBtn');
    this.hrConnectLabel = document.getElementById('hrConnectLabel');
    this.hrLiveBadge = document.getElementById('hrLiveBadge');
    this.hrLiveValue = document.getElementById('hrLiveValue');
    this.hrLiveHrv = document.getElementById('hrLiveHrv');
    this.hrSummarySection = document.getElementById('hrSummarySection');
  }

  attachEventListeners() {
    // Äänen mykistys
    this.soundToggleBtn.addEventListener('click', () => this.toggleSound());

    // Sykesensorin yhdistäminen / katkaisu
    if (this.hrConnectBtn) {
      this.hrConnectBtn.addEventListener('click', () => this.handleHeartRateToggle());
    }

    // Moodin valinta (Ajastettu vs. Mukautettu vs. Porras vs. Kuuntelu)
    const modeSelector = document.querySelector('.mode-selector');
    if (modeSelector) {
      modeSelector.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-btn');
        if (btn) {
          const mode = btn.dataset.mode || btn.getAttribute('data-mode');
          if (mode) {
            this.setMode(mode);
          }
        }
      });
    }

    if (this.modeTimedBtn) this.modeTimedBtn.addEventListener('click', () => this.setMode('timed'));
    if (this.modeTechniqueBtn) this.modeTechniqueBtn.addEventListener('click', () => this.setMode('technique'));
    if (this.modeHrDropBtn) this.modeHrDropBtn.addEventListener('click', () => this.setMode('hrdrop'));

    // Sykkeenlaskun asetukset
    if (this.hrDropSettingGroup) {
      this.hrDropSettingGroup.querySelectorAll('[data-hrrhythm]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.hrDropRhythm = btn.dataset.hrrhythm;
          this.hrDropSettingGroup.querySelectorAll('[data-hrrhythm]').forEach(b => {
            b.classList.toggle('active', b === btn);
          });
        });
      });
    }
    if (this.hrTargetPills) {
      this.hrTargetPills.addEventListener('click', (e) => {
        const pill = e.target.closest('[data-hrtarget]');
        if (!pill) return;
        this.hrDropTargetBpm = parseInt(pill.dataset.hrtarget, 10) || 0;
        this.hrTargetPills.querySelectorAll('[data-hrtarget]').forEach(p => {
          p.classList.toggle('active', p === pill);
        });
      });
    }
    if (this.decHrDropMinBtn && this.incHrDropMinBtn) {
      this.decHrDropMinBtn.addEventListener('click', () => {
        this.hrDropMinutes = Math.max(1, this.hrDropMinutes - 1);
        if (this.hrDropMinutesDisplay) this.hrDropMinutesDisplay.textContent = `${this.hrDropMinutes} min`;
      });
      this.incHrDropMinBtn.addEventListener('click', () => {
        this.hrDropMinutes = Math.min(20, this.hrDropMinutes + 1);
        if (this.hrDropMinutesDisplay) this.hrDropMinutesDisplay.textContent = `${this.hrDropMinutes} min`;
      });
    }
    if (this.modeCustomBtn) {
      this.modeCustomBtn.addEventListener('click', () => this.setMode('custom'));
    }

    // Tekniikkakirjaston napit
    if (this.techniqueGrid) {
      this.techniqueGrid.addEventListener('click', (e) => {
        const pill = e.target.closest('.technique-pill');
        if (pill && pill.dataset.technique) {
          this.selectedTechniqueId = pill.dataset.technique;
          const tech = getTechniqueById(this.selectedTechniqueId);
          this.techniqueCycles = tech.defaultRounds;
          this.updateTechniqueDisplay();
        }
      });
    }

    if (this.decTechCyclesBtn && this.incTechCyclesBtn) {
      this.decTechCyclesBtn.addEventListener('click', () => {
        this.techniqueCycles = Math.max(1, this.techniqueCycles - 1);
        this.updateTechniqueDisplay();
      });
      this.incTechCyclesBtn.addEventListener('click', () => {
        this.techniqueCycles = Math.min(30, this.techniqueCycles + 1);
        this.updateTechniqueDisplay();
      });
    }

    // Paikallinen historia
    if (this.toggleHistoryBtn && this.historyPanel) {
      this.toggleHistoryBtn.addEventListener('click', () => {
        const isOpen = this.historyPanel.style.display !== 'none';
        this.historyPanel.style.display = isOpen ? 'none' : 'block';
        this.toggleHistoryBtn.textContent = isOpen ? 'Historia ▾' : 'Historia ▴';
      });
    }
    if (this.clearHistoryBtn) {
      this.clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Tyhjennetäänkö paikallinen harjoitushistoria?')) {
          clearHistory();
          this.renderHistoryUI();
          if (this.historyPanel) this.historyPanel.style.display = 'none';
        }
      });
    }
    if (this.modeLadderBtn) {
      this.modeLadderBtn.addEventListener('click', () => this.setMode('ladder'));
    }
    if (this.modeListeningBtn) {
      this.modeListeningBtn.addEventListener('click', () => this.setMode('listening'));
    }

    // Mukautetun tilan sliderit
    if (this.inhaleSlider && this.exhaleSlider) {
      this.inhaleSlider.addEventListener('input', (e) => {
        this.customInhale = parseFloat(e.target.value);
        this.updateCustomSliderDisplay();
      });

      this.exhaleSlider.addEventListener('input', (e) => {
        this.customExhale = parseFloat(e.target.value);
        this.updateCustomSliderDisplay();
      });
    }

    // Porrastilan kohde (ulos / sisään / molemmat)
    this.ladderTargetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.ladderTargetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.ladderTarget = btn.dataset.laddertarget;
        this.updateLadderDisplay();
      });
    });

    // Porrastilan kuvio (pyramidi / pelkkä nousu)
    this.ladderPatternButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.ladderPatternButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.ladderPattern = btn.dataset.ladderpattern;
        this.updateLadderDisplay();
      });
    });

    // Porrastilan sliderit
    if (this.ladderStartSlider) {
      this.ladderStartSlider.addEventListener('input', (e) => {
        this.ladderStart = parseInt(e.target.value, 10);
        if (this.ladderStart > this.ladderMax) {
          this.ladderMax = this.ladderStart;
          if (this.ladderMaxSlider) this.ladderMaxSlider.value = this.ladderMax;
        }
        this.updateLadderDisplay();
      });
    }

    if (this.ladderStepSlider) {
      this.ladderStepSlider.addEventListener('input', (e) => {
        this.ladderStep = parseInt(e.target.value, 10);
        this.updateLadderDisplay();
      });
    }

    if (this.ladderMaxSlider) {
      this.ladderMaxSlider.addEventListener('input', (e) => {
        this.ladderMax = parseInt(e.target.value, 10);
        if (this.ladderMax < this.ladderStart) {
          this.ladderStart = this.ladderMax;
          if (this.ladderStartSlider) this.ladderStartSlider.value = this.ladderStart;
        }
        this.updateLadderDisplay();
      });
    }

    if (this.ladderFixedSlider) {
      this.ladderFixedSlider.addEventListener('input', (e) => {
        this.ladderFixed = parseInt(e.target.value, 10);
        this.updateLadderDisplay();
      });
    }

    // Vauhdin valinta
    this.paceButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.paceButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedPace = btn.dataset.pace;
        this.updatePaceVisuals();
      });
    });

    // Mikrofonin herkkyys
    this.sensitivityButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.sensitivityButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.micSensitivity = btn.dataset.sensitivity;
        if (this.detector) {
          this.detector.setSensitivity(this.micSensitivity);
        }
      });
    });

    // Laskentatapa (Sykli vs. Yksittäinen)
    this.cycleModeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.cycleModeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.cycleMode = btn.dataset.cyclemode;
        if (this.detector) {
          this.detector.setCycleMode(this.cycleMode);
        }
      });
    });

    // Hengitysten pikanapit
    this.breathPillButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.setBreaths(parseInt(btn.dataset.breaths, 10));
      });
    });

    // Hengitysten +/-
    this.decBreathsBtn.addEventListener('click', () => this.setBreaths(this.breathsPerRound - 5));
    this.incBreathsBtn.addEventListener('click', () => this.setBreaths(this.breathsPerRound + 5));

    // Kierrosten pikanapit
    this.roundPillButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.setRounds(parseInt(btn.dataset.rounds, 10));
      });
    });

    // Kierrosten +/-
    this.decRoundsBtn.addEventListener('click', () => this.setRounds(this.totalRounds - 1));
    this.incRoundsBtn.addEventListener('click', () => this.setRounds(this.totalRounds + 1));

    // Palautushengitys-toggle
    this.recoveryToggle.addEventListener('change', (e) => {
      this.includeRecovery = e.target.checked;
    });

    // Puheohjaus-toggle
    this.voiceToggle.addEventListener('change', (e) => {
      this.voiceEnabled = e.target.checked;
      voice.setEnabled(this.voiceEnabled && !this.isMuted);
    });

    // Pidä näyttö päällä -toggle
    if (this.keepScreenOnToggle) {
      this.keepScreenOnToggle.addEventListener('change', (e) => {
        this.keepScreenOn = e.target.checked;
        this.updateWakeLockHint();
        if (!this.keepScreenOn) {
          this.releaseWakeLock();
        } else if (this.state !== 'setup' && this.state !== 'summary') {
          this.requestWakeLock();
        }
      });
    }

    // Kuulokkeet-toggle
    if (this.headphonesToggle) {
      this.headphonesToggle.addEventListener('change', (e) => {
        this.headphonesMode = e.target.checked;
      });
    }

    // Aloita harjoitus
    this.startExerciseBtn.addEventListener('click', () => this.startExercise());

    // Kuuntelutilan herkkyyden pikasäädöt kesken harjoituksen
    this.decSensBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.detector) {
        const newSens = this.detector.decreaseSensitivity();
        this.updateLiveSensDisplay(newSens);
      }
    });

    this.incSensBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.detector) {
        const newSens = this.detector.increaseSensitivity();
        this.updateLiveSensDisplay(newSens);
      }
    });

    // Napautushengitys (+1) painikkeesta tai ympyrästä
    this.tapBreathBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleManualBreathTap();
    });

    this.visualizerWrapper.addEventListener('click', () => {
      if (this.state === 'breathing' && this.exerciseMode === 'listening') {
        this.handleManualBreathTap();
      }
    });

    // Kuuntelutilan manuaalinen siirtymä retentioon
    this.earlyRetentionBtn.addEventListener('click', () => {
      if (this.detector) this.detector.stop();
      this.startRetentionPhase();
    });

    // Retentio valmis -painike
    this.retentionReadyBtn.addEventListener('click', () => this.finishRetention());

    // Ohita palautushengitys
    this.skipRecoveryBtn.addEventListener('click', () => this.finishRecovery());

    // Keskeytä harjoitus
    this.exitExerciseBtn.addEventListener('click', () => this.exitExercise());

    if (this.earlySaveReportBtn) {
      this.earlySaveReportBtn.addEventListener('click', () => {
        if (this.earlyExitOverlay) this.earlyExitOverlay.style.display = 'none';
        this.finishAllRounds({ isPartial: true, saveToHistory: true });
      });
    }
    if (this.earlyViewOnlyBtn) {
      this.earlyViewOnlyBtn.addEventListener('click', () => {
        if (this.earlyExitOverlay) this.earlyExitOverlay.style.display = 'none';
        this.finishAllRounds({ isPartial: true, saveToHistory: false });
      });
    }
    if (this.earlyDiscardBtn) {
      this.earlyDiscardBtn.addEventListener('click', () => {
        if (this.earlyExitOverlay) this.earlyExitOverlay.style.display = 'none';
        if (this.hrMonitor) this.hrMonitor.stopRecording();
        this.resetVisualizerClasses();
        this.showScreen('setup');
      });
    }

    // Aloita uusi harjoitus yhteenvedosta
    this.restartExerciseBtn.addEventListener('click', () => this.showScreen('setup'));

    // Näppäimistötuki (Välilyönti)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.handleSpaceKey();
      }
    });

    // Näytön herätystilan palautus taustalta palatessa
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wakeLockDesired && this.keepScreenOn) {
        this.requestWakeLock();
      }
    });
  }

  setMode(mode) {
    this.exerciseMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const isBreathRetentionMode = (mode === 'timed' || mode === 'listening' || mode === 'custom');
    if (this.breathsSettingGroup) this.breathsSettingGroup.style.display = isBreathRetentionMode ? 'flex' : 'none';
    if (this.roundsSettingGroup) this.roundsSettingGroup.style.display = isBreathRetentionMode ? 'flex' : 'none';
    if (this.recoveryToggleRow) this.recoveryToggleRow.style.display = isBreathRetentionMode ? 'flex' : 'none';

    if (this.techniqueSettingGroup) this.techniqueSettingGroup.style.display = mode === 'technique' ? 'flex' : 'none';
    if (this.hrDropSettingGroup) this.hrDropSettingGroup.style.display = mode === 'hrdrop' ? 'flex' : 'none';

    if (mode === 'listening') {
      this.paceSettingGroup.style.display = 'none';
      if (this.customSettingGroup) this.customSettingGroup.style.display = 'none';
      if (this.ladderSettingGroup) this.ladderSettingGroup.style.display = 'none';
      this.micSettingGroup.style.display = 'flex';
    } else if (mode === 'custom') {
      this.paceSettingGroup.style.display = 'none';
      if (this.customSettingGroup) this.customSettingGroup.style.display = 'flex';
      if (this.ladderSettingGroup) this.ladderSettingGroup.style.display = 'none';
      this.micSettingGroup.style.display = 'none';
      this.updateCustomSliderDisplay();
    } else if (mode === 'ladder') {
      this.paceSettingGroup.style.display = 'none';
      if (this.customSettingGroup) this.customSettingGroup.style.display = 'none';
      if (this.ladderSettingGroup) this.ladderSettingGroup.style.display = 'flex';
      this.micSettingGroup.style.display = 'none';
      this.updateLadderDisplay();
    } else if (mode === 'technique') {
      this.paceSettingGroup.style.display = 'none';
      if (this.customSettingGroup) this.customSettingGroup.style.display = 'none';
      if (this.ladderSettingGroup) this.ladderSettingGroup.style.display = 'none';
      this.micSettingGroup.style.display = 'none';
      this.updateTechniqueDisplay();
    } else if (mode === 'hrdrop') {
      this.paceSettingGroup.style.display = 'none';
      if (this.customSettingGroup) this.customSettingGroup.style.display = 'none';
      if (this.ladderSettingGroup) this.ladderSettingGroup.style.display = 'none';
      this.micSettingGroup.style.display = 'none';
    } else {
      this.paceSettingGroup.style.display = 'flex';
      if (this.customSettingGroup) this.customSettingGroup.style.display = 'none';
      if (this.ladderSettingGroup) this.ladderSettingGroup.style.display = 'none';
      this.micSettingGroup.style.display = 'none';
    }
  }

  generateLadderSequence(start, step, max, isPyramid = true) {
    const s = Math.max(1, start);
    const st = Math.max(1, step);
    const m = Math.max(s, max);

    const seq = [];
    for (let val = s; val <= m; val += st) {
      seq.push(val);
    }
    if (seq[seq.length - 1] !== m) {
      seq.push(m);
    }

    if (isPyramid && seq.length > 1) {
      for (let i = seq.length - 2; i >= 0; i--) {
        seq.push(seq[i]);
      }
    }
    return seq;
  }

  updateLadderDisplay() {
    if (!this.ladderStartSlider) return;

    if (this.ladderStartDisplay) this.ladderStartDisplay.textContent = this.ladderStart;
    if (this.ladderStepDisplay) this.ladderStepDisplay.textContent = this.ladderStep;
    if (this.ladderMaxDisplay) this.ladderMaxDisplay.textContent = this.ladderMax;
    if (this.ladderFixedDisplay) this.ladderFixedDisplay.textContent = this.ladderFixed;

    if (this.ladderFixedBlock && this.ladderFixedLabel) {
      if (this.ladderTarget === 'both') {
        this.ladderFixedBlock.style.display = 'none';
      } else {
        this.ladderFixedBlock.style.display = 'block';
        if (this.ladderTarget === 'exhale') {
          this.ladderFixedLabel.textContent = 'Sisäänhengitys (vakio)';
        } else {
          this.ladderFixedLabel.textContent = 'Uloshengitys (vakio)';
        }
      }
    }

    if (this.ladderTargetDesc) {
      if (this.ladderTarget === 'exhale') {
        this.ladderTargetDesc.textContent = 'Uloshengitys pitenee askelittain';
      } else if (this.ladderTarget === 'inhale') {
        this.ladderTargetDesc.textContent = 'Sisäänhengitys pitenee askelittain';
      } else {
        this.ladderTargetDesc.textContent = 'Sekä sisään että ulos pitenevät';
      }
    }

    if (this.ladderPatternDesc) {
      this.ladderPatternDesc.textContent = this.ladderPattern === 'pyramid'
        ? 'Nousu huipulle ja lasku takaisin'
        : 'Nousu alhaalta huipulle';
    }

    this.ladderSequence = this.generateLadderSequence(
      this.ladderStart,
      this.ladderStep,
      this.ladderMax,
      this.ladderPattern === 'pyramid'
    );

    const totalSteps = this.ladderSequence.length;
    if (this.ladderTotalStepsText) {
      this.ladderTotalStepsText.textContent = `${totalSteps} toistoa`;
    }

    let totalSec = 0;
    this.ladderSequence.forEach(stepVal => {
      if (this.ladderTarget === 'exhale') {
        totalSec += this.ladderFixed + stepVal;
      } else if (this.ladderTarget === 'inhale') {
        totalSec += stepVal + this.ladderFixed;
      } else {
        totalSec += stepVal * 2;
      }
    });

    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const durStr = mins > 0 ? `~${mins} min ${secs > 0 ? secs + ' s' : ''}` : `~${secs} s`;
    if (this.ladderTotalDurationText) {
      this.ladderTotalDurationText.textContent = durStr;
    }

    if (this.ladderSequencePreview) {
      if (this.ladderSequence.length <= 16) {
        this.ladderSequencePreview.textContent = this.ladderSequence.map(v => `${v}s`).join(' → ');
      } else {
        const firstFew = this.ladderSequence.slice(0, 4).map(v => `${v}s`).join(' → ');
        const lastFew = this.ladderSequence.slice(-3).map(v => `${v}s`).join(' → ');
        this.ladderSequencePreview.textContent = `${firstFew} → ... → ${this.ladderMax}s (huippu) → ... → ${lastFew}`;
      }
    }
  }

  updateCustomSliderDisplay() {
    if (!this.inhaleTimeDisplay || !this.exhaleTimeDisplay) return;
    this.inhaleTimeDisplay.textContent = this.customInhale;
    this.exhaleTimeDisplay.textContent = this.customExhale;

    const total = this.customInhale + this.customExhale;
    if (this.customTotalCycleTime) {
      this.customTotalCycleTime.textContent = `${total} s`;
    }

    if (this.customRatioHint) {
      const ratio = (this.customExhale / this.customInhale).toFixed(1).replace('.0', '');
      let desc = 'Tasainen rytmi';
      if (this.customExhale >= this.customInhale * 4) {
        desc = 'Pitkä rauhoittava tyhjennys';
      } else if (this.customExhale >= this.customInhale * 2) {
        desc = 'Rauhoittava uloshengityspainotus';
      } else if (this.customInhale > this.customExhale) {
        desc = 'Energisoiva sisäänhengityspainotus';
      }
      this.customRatioHint.textContent = `Suhde 1:${ratio} (${desc})`;
    }
  }

  handleSpaceKey() {
    if (this.state === 'retention') {
      this.finishRetention();
    } else if (this.state === 'recovery') {
      this.finishRecovery();
    } else if (this.state === 'breathing' && this.exerciseMode === 'listening') {
      // Kuuntelutilassa välilyönnillä voi hypätä retentioon
      if (this.detector) this.detector.stop();
      this.startRetentionPhase();
    } else if (this.state === 'setup') {
      this.startExercise();
    } else if (this.state === 'summary') {
      this.showScreen('setup');
    }
  }

  toggleSound() {
    this.isMuted = !this.isMuted;
    sound.setMuted(this.isMuted);
    
    // Kun mykistetään pää-äänet (Mute), hiljennetään samalla myös puhesynteesi
    if (this.isMuted) {
      voice.setEnabled(false);
      this.soundIconOn.style.display = 'none';
      this.soundIconOff.style.display = 'block';
      if (this.soundToggleBtn) {
        this.soundToggleBtn.setAttribute('title', 'Äänet mykistetty');
        this.soundToggleBtn.setAttribute('aria-label', 'Äänet mykistetty, klikkaa kytkeäksesi päälle');
      }
    } else {
      voice.setEnabled(this.voiceEnabled);
      this.soundIconOn.style.display = 'block';
      this.soundIconOff.style.display = 'none';
      if (this.soundToggleBtn) {
        this.soundToggleBtn.setAttribute('title', 'Äänet päällä');
        this.soundToggleBtn.setAttribute('aria-label', 'Äänet päällä, klikkaa mykistääksesi');
      }
      sound.playBeep();
    }
  }

  setBreaths(val) {
    const clamped = Math.max(10, Math.min(60, val));
    this.breathsPerRound = clamped;
    this.breathsCountDisplay.textContent = clamped;
    this.breathPillButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.breaths, 10) === clamped);
    });
  }

  setRounds(val) {
    const clamped = Math.max(1, Math.min(10, val));
    this.totalRounds = clamped;
    this.roundsCountDisplay.textContent = clamped;
    this.roundPillButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.rounds, 10) === clamped);
    });
  }

  updatePaceVisuals() {
    const paceInfo = PACES[this.selectedPace];
    this.paceDescription.textContent = paceInfo.desc;
    document.documentElement.style.setProperty('--breath-duration', `${paceInfo.inhale}s`);
  }

  showScreen(screenName) {
    this.state = screenName;
    Object.keys(this.screens).forEach(name => {
      this.screens[name].classList.toggle('active', name === screenName);
    });
  }

  clearTimeouts() {
    this.activeTimeouts.forEach(id => clearTimeout(id));
    this.activeTimeouts = [];
    if (this.retentionTimerId) {
      cancelAnimationFrame(this.retentionTimerId);
      this.retentionTimerId = null;
    }
    if (this.tankAnimId) {
      cancelAnimationFrame(this.tankAnimId);
      this.tankAnimId = null;
    }
  }

  scheduleTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    this.activeTimeouts.push(id);
    return id;
  }

  updateWakeLockHint() {
    if (typeof window === 'undefined' || !this.wakeLockHttpsHint) return;
    if (!window.isSecureContext && this.keepScreenOn) {
      if (this.httpsSwitchLink) {
        this.httpsSwitchLink.href = `https://${window.location.hostname}${window.location.pathname}`;
      }
      this.wakeLockHttpsHint.style.display = 'flex';
    } else {
      this.wakeLockHttpsHint.style.display = 'none';
    }
  }

  updateWakeLockBadge(active, isInsecure = false) {
    if (!this.wakeLockStatusBadge) return;
    if (!this.keepScreenOn) {
      this.wakeLockStatusBadge.style.display = 'none';
      return;
    }
    this.wakeLockStatusBadge.style.display = 'inline-flex';
    if (active) {
      this.wakeLockStatusBadge.textContent = '☀️ Näyttö lukittu';
      this.wakeLockStatusBadge.style.background = 'rgba(45, 212, 191, 0.12)';
      this.wakeLockStatusBadge.style.color = '#2dd4bf';
      this.wakeLockStatusBadge.style.borderColor = 'rgba(45, 212, 191, 0.25)';
    } else if (isInsecure) {
      this.wakeLockStatusBadge.textContent = '⚠️ HTTP (avaa HTTPS)';
      this.wakeLockStatusBadge.style.background = 'rgba(251, 191, 36, 0.12)';
      this.wakeLockStatusBadge.style.color = '#fcd34d';
      this.wakeLockStatusBadge.style.borderColor = 'rgba(251, 191, 36, 0.3)';
    } else {
      this.wakeLockStatusBadge.style.display = 'none';
    }
  }

  async requestWakeLock() {
    if (!this.keepScreenOn) return;
    this.wakeLockDesired = true;

    let wakeLockAcquired = false;
    const isSecure = typeof window !== 'undefined' ? window.isSecureContext : true;

    // 1. Ensisijainen: moderni Screen Wake Lock API (vaatii HTTPS-yhteyden)
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        if (!this.wakeLock || this.wakeLock.released) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          this.wakeLock.addEventListener('release', () => {
            this.updateWakeLockBadge(false, !isSecure);
            // Jos harjoitus on edelleen aktiivinen, pyydetään herätystila uudelleen
            if (this.wakeLockDesired && this.keepScreenOn && typeof document !== 'undefined' && document.visibilityState === 'visible') {
              this.requestWakeLock();
            }
          });
        }
        wakeLockAcquired = Boolean(this.wakeLock && !this.wakeLock.released);
      } catch (err) {
        console.warn('Screen Wake Lock API ei ole käytettävissä:', err);
      }
    }

    this.updateWakeLockBadge(wakeLockAcquired, !isSecure);
  }

  releaseWakeLock() {
    this.wakeLockDesired = false;
    if (this.wakeLock) {
      try {
        this.wakeLock.release().catch(() => {});
      } catch (e) {}
      this.wakeLock = null;
    }
    this.updateWakeLockBadge(false, false);
  }

  // --- HARJOITUKSEN KULKU ---

  async startExercise() {
    sound.init();
    this.requestWakeLock();
    if (this.hrMonitor && this.hrMonitor.isConnected) {
      this.hrMonitor.startRecording();
    }
    if (this.hrSummarySection) {
      this.hrSummarySection.style.display = 'none';
    }
    this.currentRound = 1;
    this.retentionTimes = [];
    this.completedTechniqueCycles = 0;
    this.completedLadderSteps = 0;
    this.hrBaselineBpm = null;
    this.hrLowestBpm = null;
    this.hrLastBpm = null;
    this.hrTargetReached = false;
    if (this.hrBiofeedbackCard) {
      this.hrBiofeedbackCard.style.display = 'none';
      this.hrBiofeedbackCard.classList.remove('target-reached');
    }
    this.sessionStartTime = Date.now();
    if (this.earlyExitOverlay) this.earlyExitOverlay.style.display = 'none';
    this.showScreen('exercise');

    if (this.exerciseMode === 'listening') {
      await this.startListeningPreparation();
    } else {
      this.startCountdown();
    }
  }

  // Kuuntelutilan käynnistys ja taustamelun kalibrointi
  async startListeningPreparation() {
    this.state = 'calibrating';
    this.clearTimeouts();
    this.resetVisualizerClasses();

    this.micStatusBadge.style.display = 'inline-flex';
    this.calibrationBarContainer.style.display = 'block';
    this.calibrationBarFill.style.width = '0%';
    this.micMeterContainer.style.display = 'none';
    this.tapBreathBtn.style.display = 'none';
    this.earlyRetentionBtn.style.display = 'none';
    this.retentionReadyBtn.style.display = 'none';
    this.skipRecoveryBtn.style.display = 'none';

    if (this.exerciseMode === 'technique') {
      const tech = getTechniqueById(this.selectedTechniqueId);
      this.exerciseRoundBadge.textContent = `${tech.icon} ${tech.name}`;
    } else {
      this.exerciseRoundBadge.textContent = `Kierros ${this.currentRound} / ${this.totalRounds}`;
    }
    this.exercisePhaseTitle.textContent = 'Kalibroidaan mikrofonia';
    this.instructionMain.textContent = 'Ole hetki aivan hiljaa';
    this.instructionSub.textContent = 'Mitataan huoneen taustamelua...';
    this.circleMainText.textContent = '🤫';
    this.circleSubText.textContent = 'hiljaisuus';

    // 1. Alustetaan tunnistin
    this.detector = new BreathDetector({
      onLevelUpdate: (rms, thresholdOrProgress, isCalibrating) => {
        if (isCalibrating) {
          this.calibrationBarFill.style.width = `${Math.round(thresholdOrProgress * 100)}%`;
        } else {
          // 1. Ympyrän orgaaninen reagointi ääneen
          const scale = 1 + Math.min(0.45, rms * 8);
          this.audioReactiveRing.style.transform = `scale(${scale})`;
          this.breathingCircleOuter.style.transform = `scale(${scale * 0.95})`;

          // 2. Reaaliaikainen tasomittari
          const threshold = thresholdOrProgress;
          const maxExpected = Math.max(0.04, threshold * 2.2);
          const fillPercent = Math.min(100, Math.round((rms / maxExpected) * 100));
          const markerPercent = Math.min(95, Math.max(5, Math.round((threshold / maxExpected) * 100)));

          this.micMeterFill.style.width = `${fillPercent}%`;
          this.micMeterThresholdMarker.style.left = `${markerPercent}%`;

          if (rms > threshold) {
            this.micMeterFill.classList.add('crossed');
            this.micMeterStatus.textContent = 'Hengitys! 🌬️';
            this.micMeterStatus.classList.add('active-detected');
          } else {
            this.micMeterFill.classList.remove('crossed');
            this.micMeterStatus.textContent = 'Kuunnellaan...';
            this.micMeterStatus.classList.remove('active-detected');
          }
        }
      },
      onSubCycleChange: (phase, breathData) => {
        if (this.state !== 'breathing') return;
        if (phase === 'inhale_done') {
          this.visualizerWrapper.classList.remove('exhale');
          this.visualizerWrapper.classList.add('inhale');
          this.instructionMain.textContent = 'Sisäänhengitys ↗';
          this.instructionSub.textContent = 'Puhalla nyt rennosti ulos ↘';
          this.circleSubText.textContent = `/ ${this.breathsPerRound}`;
          if (navigator.vibrate) {
            try { navigator.vibrate(35); } catch (e) {}
          }
        } else if (phase === 'exhale_done') {
          this.visualizerWrapper.classList.remove('inhale');
          this.visualizerWrapper.classList.add('exhale');
          this.instructionMain.textContent = 'Uloshengitys ↘';
          this.instructionSub.textContent = 'Hengitä taas syvään sisään ↗';
          this.circleSubText.textContent = `/ ${this.breathsPerRound}`;
          if (navigator.vibrate) {
            try { navigator.vibrate([30, 40, 30]); } catch (e) {}
          }
        } else if (phase === 'reset') {
          this.visualizerWrapper.classList.remove('inhale', 'exhale');
          this.instructionMain.textContent = 'Hengitä syvään sisään ↗';
          this.instructionSub.textContent = 'Täytä vatsa ja rintakehä';
        }
      },
      onPhaseChange: (phase) => {
        if (this.state !== 'breathing') return;
        if (phase === 'active') {
          this.breathingCircleInner.style.transform = 'scale(1.22)';
        } else {
          this.breathingCircleInner.style.transform = 'scale(1.0)';
        }
      },
      onBreathCounted: (count, duration) => {
        if (this.state !== 'breathing') return;

        this.currentBreath = count;
        this.circleMainText.textContent = `${this.currentBreath}`;
        this.circleSubText.textContent = `/ ${this.breathsPerRound}`;

        // Pulssiefekti ympyrään ilman kaiutinääntä
        this.breathingCircleInner.style.transform = 'scale(1.28)';
        setTimeout(() => {
          if (this.state === 'breathing') {
            this.breathingCircleInner.style.transform = 'scale(1.0)';
          }
        }, 220);

        const remaining = this.breathsPerRound - this.currentBreath;

        if (this.voiceEnabled) {
          // Tulipuhalluksessa (Fire Breath) ei puhuta väli-ilmoituksia kesken nopean tahdin
          if (this.cycleMode !== 'fire') {
            const suppressionMs = this.headphonesMode ? 0 : 1100;
            if (remaining === 5) {
              if (suppressionMs && this.detector) this.detector.suppressAudio(suppressionMs);
              voice.speak('Viisi jäljellä');
            } else if (remaining === 1) {
              if (suppressionMs && this.detector) this.detector.suppressAudio(suppressionMs);
              voice.speak('Viimeinen hengitys');
            }
          }
        }

        // Tavoite saavutettu!
        if (this.currentBreath >= this.breathsPerRound) {
          if (this.detector) this.detector.stop();

          if (this.voiceEnabled) {
            if (this.cycleMode === 'fire') {
              voice.announceFireHold(this.breathsPerRound);
            } else {
              voice.announceHold(this.breathsPerRound);
            }
          }

          this.scheduleTimeout(() => {
            this.startRetentionPhase();
          }, 800);
        }
      },
      onError: (err) => {
        let msg = 'Mikrofonin käyttö estettiin tai se ei ole saatavilla.';
        const isSecure = typeof window !== 'undefined' ? window.isSecureContext : true;
        if (!isSecure || err.message === 'NOT_SECURE_CONTEXT' || err.message === 'NO_MEDIA_DEVICES') {
          const host = window.location.hostname;
          msg = `🔒 Puhelimen selain vaatii suojatun HTTPS-yhteyden mikrofonin käyttöön lähiverkossa.\n\nAvaa sivu puhelimella osoitteessa:\nhttps://${host}:3002\n\n(Valitse selaimessa kerran "Lisäasetukset -> Jatka sivustolle" kehityssertifikaatin vuoksi).`;
        }
        alert(msg);
        this.setMode('timed');
        this.startCountdown();
      }
    });

    this.detector.setSensitivity(this.micSensitivity);
    this.detector.setCycleMode(this.cycleMode);

    await this.detector.start();
    if (!this.detector.isRunning) return;

    // VAIHE 1: Taustamelun mittaus hiljaisuudessa (2.0s)
    if (this.voiceEnabled) {
      await voice.announceCalibrationAsync();
      await new Promise(r => setTimeout(r, 350));
    }
    if (this.state !== 'calibrating') return;

    this.exercisePhaseTitle.textContent = '1/2 Taustamelu';
    this.instructionMain.textContent = 'Täysi hiljaisuus...';
    this.instructionSub.textContent = 'Mitataan huoneen peruskohinaa (2.0 s)';
    this.circleMainText.textContent = '🤫';
    this.circleSubText.textContent = 'hiljaisuus';

    const noiseResult = await this.detector.measureNoiseFloor(2000);
    if (this.state !== 'calibrating') return;

    // VAIHE 2: Näytehengitys (Sisään + Ulos)
    // Sisäänhengitys-näyte
    this.exercisePhaseTitle.textContent = '2/2 Näytehengitys';
    this.instructionMain.textContent = 'Hengitä syvään sisään ↗';
    this.instructionSub.textContent = 'Anna laitteen kuulla sisäänhengityksesi';
    this.circleMainText.textContent = '↗';
    this.circleSubText.textContent = 'sisään';
    this.visualizerWrapper.classList.add('inhale');

    if (this.voiceEnabled) {
      await voice.announceSampleInhaleAsync();
      await new Promise(r => setTimeout(r, 200));
    }
    if (this.state !== 'calibrating') return;

    const sampleInhale = await this.detector.recordSample(2200, 'inhale');
    if (this.state !== 'calibrating') return;

    // Uloshengitys-näyte
    this.visualizerWrapper.classList.remove('inhale');
    this.visualizerWrapper.classList.add('exhale');
    this.instructionMain.textContent = 'Puhalla ilma ulos ↘';
    this.instructionSub.textContent = 'Anna laitteen kuulla uloshengityksesi';
    this.circleMainText.textContent = '↘';
    this.circleSubText.textContent = 'ulos';

    if (this.voiceEnabled) {
      await voice.announceSampleExhaleAsync();
      await new Promise(r => setTimeout(r, 200));
    }
    if (this.state !== 'calibrating') return;

    const sampleExhale = await this.detector.recordSample(2200, 'exhale');
    if (this.state !== 'calibrating') return;

    this.visualizerWrapper.classList.remove('exhale');

    // Asetetaan kynnykset ja profiilit näytteiden pohjalta
    this.detector.applyCalibration(noiseResult.noiseFloor, sampleInhale, sampleExhale);

    // Valmis!
    this.exercisePhaseTitle.textContent = 'Kalibrointi valmis!';
    this.instructionMain.textContent = 'Hienoa!';
    this.instructionSub.textContent = 'Tunnistus kalibroitu omaan hengitykseesi';
    this.circleMainText.textContent = '✨';
    this.circleSubText.textContent = 'valmis';

    if (this.voiceEnabled) {
      await voice.announceSampleCompleteAsync();
      await new Promise(r => setTimeout(r, 300));
    }

    if (this.state !== 'calibrating') return;

    this.calibrationBarContainer.style.display = 'none';
    this.startListeningBreathingPhase();
  }

  startListeningBreathingPhase() {
    this.state = 'breathing';
    this.currentBreath = 0;
    this.visualizerWrapper.classList.add('listening-mode');
    document.documentElement.style.setProperty('--breath-duration', this.cycleMode === 'fire' ? '0.6s' : '1.3s');

    if (this.cycleMode === 'fire') {
      this.exercisePhaseTitle.textContent = 'Tulipuhallus (Fire Breath)';
      this.instructionMain.textContent = 'Puhalla terävästi nenästä! 🔥';
      this.instructionSub.textContent = 'Pumppaa vatsalla, jokainen terävä puhallus lasketaan';
    } else {
      this.exercisePhaseTitle.textContent = 'Hengitysvaihe (Kuuntelu)';
      this.instructionMain.textContent = 'Hengitä syvään omaan tahtiin!';
      this.instructionSub.textContent = 'Laite kuuntelee hengitystäsi ja laskee toistot';
    }

    this.circleMainText.textContent = '0';
    this.circleSubText.textContent = `/ ${this.breathsPerRound}`;

    this.micMeterContainer.style.display = 'flex';
    this.tapBreathBtn.style.display = 'block';
    this.earlyRetentionBtn.style.display = 'block';
    this.updateLiveSensDisplay(this.micSensitivity);

    // Aloitetaan aktiivinen kuuntelu (ilman ylimääräistä puhetta taustalla)
    this.detector.startListening();
  }

  handleManualBreathTap() {
    if (this.detector) {
      this.detector.registerManualBreath();
    }
  }

  updateLiveSensDisplay(sens) {
    const labels = {
      low: 'Matala',
      normal: 'Normaali',
      high: 'Korkea',
      max: 'Maksimi'
    };
    this.micSensitivity = sens;
    if (this.liveSensDisplay) {
      this.liveSensDisplay.textContent = labels[sens] || sens;
    }
  }

  // Ajastettu tila: 3-2-1 laskenta
  startCountdown() {
    this.state = 'countdown';
    this.clearTimeouts();
    this.resetVisualizerClasses();

    this.micStatusBadge.style.display = 'none';
    this.calibrationBarContainer.style.display = 'none';
    this.earlyRetentionBtn.style.display = 'none';
    if (this.exerciseMode === 'technique') {
      const tech = getTechniqueById(this.selectedTechniqueId);
      this.exerciseRoundBadge.textContent = `${tech.icon} ${tech.name}`;
    } else {
      this.exerciseRoundBadge.textContent = `Kierros ${this.currentRound} / ${this.totalRounds}`;
    }
    this.exercisePhaseTitle.textContent = 'Valmistaudu...';
    this.instructionMain.textContent = 'Ota mukava asento ja rentoudu';
    this.instructionSub.textContent = 'Hengitysvaihe alkaa pian';
    this.retentionReadyBtn.style.display = 'none';
    this.skipRecoveryBtn.style.display = 'none';
    this.circleSubText.textContent = '';

    let count = 3;
    this.circleMainText.textContent = count;
    sound.playBeep(false);

    const step = () => {
      count--;
      if (count > 0) {
        this.circleMainText.textContent = count;
        sound.playBeep(false);
        this.scheduleTimeout(step, 1000);
      } else {
        this.circleMainText.textContent = 'Aloita';
        sound.playBeep(true);
        this.scheduleTimeout(() => this.startTimedBreathingPhase(), 800);
      }
    };

    this.scheduleTimeout(step, 1000);
  }

  startTimedBreathingPhase() {
    this.state = 'breathing';
    this.currentBreath = 0;
    this.retentionReadyBtn.style.display = 'none';
    this.skipRecoveryBtn.style.display = 'none';

    if (this.exerciseMode === 'custom') {
      this.startCustomBreathingPhase();
    } else if (this.exerciseMode === 'ladder') {
      this.startLadderBreathingPhase();
    } else if (this.exerciseMode === 'technique') {
      this.startTechniquePhase();
    } else if (this.exerciseMode === 'hrdrop') {
      this.startHrDropPhase();
    } else {
      const pace = PACES[this.selectedPace];
      document.documentElement.style.setProperty('--breath-duration', `${pace.inhale}s`);
      this.exercisePhaseTitle.textContent = 'Hengitysvaihe';
      this.nextTimedBreathCycle();
    }
  }

  // --- PORRAS- / PYRAMIDIHENGITYS ---

  startLadderBreathingPhase() {
    this.exercisePhaseTitle.textContent = this.ladderPattern === 'pyramid'
      ? 'Pyramidihengitys'
      : 'Porrashengitys';

    // Piilota perinteinen ympyrä ja tuo säiliö esille
    if (this.breathingCircleOuter) this.breathingCircleOuter.style.display = 'none';
    if (this.breathingCircleInner) this.breathingCircleInner.style.display = 'none';
    if (this.audioReactiveRing) this.audioReactiveRing.style.display = 'none';
    if (this.tankVisualizer) {
      this.tankVisualizer.style.display = 'flex';
      this.tankVisualizer.classList.remove('exhaling');
    }

    // Varmistetaan sekvenssi
    this.ladderSequence = this.generateLadderSequence(
      this.ladderStart,
      this.ladderStep,
      this.ladderMax,
      this.ladderPattern === 'pyramid'
    );
    this.ladderCurrentStepIndex = 0;

    this.nextLadderBreathCycle();
  }

  nextLadderBreathCycle() {
    if (this.state !== 'breathing') return;
    this.requestWakeLock();

    const totalSteps = this.ladderSequence.length;
    const currentStepVal = this.ladderSequence[this.ladderCurrentStepIndex];
    const stepNum = this.ladderCurrentStepIndex + 1;

    // Määritä sisään- ja uloshengityksen pituudet
    let inhaleSec, exhaleSec;
    if (this.ladderTarget === 'exhale') {
      inhaleSec = this.ladderFixed;
      exhaleSec = currentStepVal;
    } else if (this.ladderTarget === 'inhale') {
      inhaleSec = currentStepVal;
      exhaleSec = this.ladderFixed;
    } else {
      // Molemmat kasvavat
      inhaleSec = currentStepVal;
      exhaleSec = currentStepVal;
    }

    // Suuntatunniste (Nouseva / Huippu / Laskeva)
    let directionSymbol = '↗';
    let directionText = 'Nouseva';
    const peakIndex = this.ladderSequence.indexOf(this.ladderMax);
    if (currentStepVal === this.ladderMax) {
      directionSymbol = '⛰️';
      directionText = 'Huippu';
    } else if (this.ladderPattern === 'pyramid' && this.ladderCurrentStepIndex > peakIndex) {
      directionSymbol = '↘';
      directionText = 'Laskeva';
    }

    // Päivitä otsikot ja säiliön tekstit
    this.exerciseRoundBadge.textContent = `Porras ${stepNum} / ${totalSteps}`;
    if (this.tankCycleCount) {
      this.tankCycleCount.textContent = `Askel ${stepNum} / ${totalSteps} ${directionSymbol} (${directionText})`;
    }

    // Puheilmoitukset
    if (this.voiceEnabled) {
      if (currentStepVal === this.ladderMax && this.ladderCurrentStepIndex === peakIndex) {
        voice.speak(`Huippu: ${this.ladderMax} sekuntia`);
      } else if (stepNum === totalSteps) {
        voice.speak('Viimeinen porras');
      }
    }

    // 1. SISÄÄNHENGITYS -> Säiliö täyttyy (0% -> 100%)
    if (this.tankVisualizer) {
      this.tankVisualizer.classList.remove('exhaling');
    }
    this.instructionMain.textContent = `Hengitä sisään (${inhaleSec} s) ↗`;
    this.instructionSub.textContent = `Askel ${stepNum}/${totalSteps} • ${directionText} (${currentStepVal} s)`;
    sound.playInhale(inhaleSec);

    this.animateTankLevel(0, 100, inhaleSec * 1000, 'Sisään', () => {
      if (this.state !== 'breathing') return;

      // 2. ULOSHENGITYS -> Säiliö tyhjenee (100% -> 0%)
      if (this.tankVisualizer) {
        this.tankVisualizer.classList.add('exhaling');
      }
      this.instructionMain.textContent = `Päästä ulos (${exhaleSec} s) ↘`;
      this.instructionSub.textContent = `Rauhallinen purkaus (${exhaleSec} s)`;
      sound.playExhale(exhaleSec);

      this.animateTankLevel(100, 0, exhaleSec * 1000, 'Ulos', () => {
        if (this.state !== 'breathing') return;

        if (this.ladderCurrentStepIndex + 1 >= totalSteps) {
          // Harjoituksen kaikki askeleet suoritettu!
          if (this.includeRecovery) {
            this.startRecoveryPhase();
          } else {
            this.finishAllRounds();
          }
        } else {
          this.ladderCurrentStepIndex++;
          this.nextLadderBreathCycle();
        }
      });
    });
  }

  // --- MUKAUTETTU TILA & SÄILIÖINDIKAATTORI ---

  startCustomBreathingPhase() {
    this.exercisePhaseTitle.textContent = 'Mukautettu harjoitus';
    
    // Piilota perinteinen ympyrä ja tuo säiliö esille
    if (this.breathingCircleOuter) this.breathingCircleOuter.style.display = 'none';
    if (this.breathingCircleInner) this.breathingCircleInner.style.display = 'none';
    if (this.audioReactiveRing) this.audioReactiveRing.style.display = 'none';
    if (this.tankVisualizer) {
      this.tankVisualizer.style.display = 'flex';
      this.tankVisualizer.classList.remove('exhaling');
    }

    this.nextCustomBreathCycle();
  }

  nextCustomBreathCycle() {
    if (this.state !== 'breathing') return;
    this.requestWakeLock();

    this.currentBreath++;
    const totalBreaths = this.breathsPerRound;
    const inhaleSec = this.customInhale;
    const exhaleSec = this.customExhale;

    // Päivitä tekstit
    if (this.tankCycleCount) {
      this.tankCycleCount.textContent = `Toisto ${this.currentBreath} / ${totalBreaths}`;
    }
    if (this.exerciseMode === 'technique') {
      const tech = getTechniqueById(this.selectedTechniqueId);
      this.exerciseRoundBadge.textContent = `${tech.icon} ${tech.name}`;
    } else {
      this.exerciseRoundBadge.textContent = `Kierros ${this.currentRound} / ${this.totalRounds}`;
    }

    // 1. SISÄÄNHENGITYS -> Säiliö täyttyy (0% -> 100%)
    if (this.tankVisualizer) {
      this.tankVisualizer.classList.remove('exhaling');
    }
    this.instructionMain.textContent = 'Täytä säiliö ↗';
    this.instructionSub.textContent = `Syvä ja rauhallinen sisäänhengitys (${inhaleSec} s)`;
    sound.playInhale(inhaleSec);

    this.animateTankLevel(0, 100, inhaleSec * 1000, 'Sisään', () => {
      if (this.state !== 'breathing') return;

      // 2. ULOSHENGITYS -> Säiliö tyhjenee (100% -> 0%)
      if (this.tankVisualizer) {
        this.tankVisualizer.classList.add('exhaling');
      }
      this.instructionMain.textContent = 'Tyhjennä säiliö ↘';
      this.instructionSub.textContent = `Tasainen ja hidas purkautuminen (${exhaleSec} s)`;
      sound.playExhale(exhaleSec);

      this.animateTankLevel(100, 0, exhaleSec * 1000, 'Ulos', () => {
        if (this.state !== 'breathing') return;

        if (this.currentBreath >= totalBreaths) {
          this.startRetentionPhase();
        } else {
          this.nextCustomBreathCycle();
        }
      });
    });
  }

  // Säiliön tasainen liukuma ja reaaliaikainen sekuntilaskuri
  animateTankLevel(fromPercent, toPercent, durationMs, phaseLabel, onComplete) {
    if (this.tankAnimId) {
      cancelAnimationFrame(this.tankAnimId);
      this.tankAnimId = null;
    }

    const startTime = performance.now();
    const durationSec = durationMs / 1000;

    const frame = (now) => {
      if (this.state !== 'breathing') return;

      const elapsedMs = Math.min(durationMs, now - startTime);
      const progress = durationMs > 0 ? (elapsedMs / durationMs) : 1;
      const currentPercent = fromPercent + (toPercent - fromPercent) * progress;

      // Päivitä säiliön nesteen korkeus
      if (this.tankLiquid) {
        this.tankLiquid.style.height = `${currentPercent.toFixed(1)}%`;
      }
      if (this.tankPercentText) {
        this.tankPercentText.textContent = `${Math.round(currentPercent)}%`;
      }

      // Reaaliaikainen laskuri sekunteina
      const remainingSec = Math.max(0, durationSec - (elapsedMs / 1000));
      if (this.tankTimeText) {
        this.tankTimeText.textContent = `${remainingSec.toFixed(1)}s`;
      }
      if (this.tankPhaseText) {
        this.tankPhaseText.textContent = phaseLabel;
      }

      if (progress < 1) {
        this.tankAnimId = requestAnimationFrame(frame);
      } else {
        this.tankAnimId = null;
        if (onComplete) onComplete();
      }
    };

    this.tankAnimId = requestAnimationFrame(frame);
  }

  nextTimedBreathCycle() {
    if (this.state !== 'breathing') return;
    this.requestWakeLock();

    this.currentBreath++;
    const totalBreaths = this.breathsPerRound;
    const pace = PACES[this.selectedPace];
    const inhaleMs = pace.inhale * 1000;
    const exhaleMs = pace.exhale * 1000;

    // Päivitä tekstit ja laskuri
    this.circleMainText.textContent = `${this.currentBreath}`;
    this.circleSubText.textContent = `/ ${totalBreaths}`;
    if (this.exerciseMode === 'technique') {
      const tech = getTechniqueById(this.selectedTechniqueId);
      this.exerciseRoundBadge.textContent = `${tech.icon} ${tech.name}`;
    } else {
      this.exerciseRoundBadge.textContent = `Kierros ${this.currentRound} / ${this.totalRounds}`;
    }

    // 1. Sisäänhengitys (Inhale)
    this.visualizerWrapper.classList.remove('exhale');
    this.visualizerWrapper.classList.add('inhale');
    this.instructionMain.textContent = 'Hengitä syvään sisään';
    this.instructionSub.textContent = this.currentBreath === totalBreaths ? 'Viimeinen syvä sisäänhengitys!' : 'Täytä vatsa ja rintakehä';
    sound.playInhale(pace.inhale);

    // 2. Uloshengitys (Exhale)
    this.scheduleTimeout(() => {
      if (this.state !== 'breathing') return;

      this.visualizerWrapper.classList.remove('inhale');
      this.visualizerWrapper.classList.add('exhale');
      this.instructionMain.textContent = 'Päästä irti';
      this.instructionSub.textContent = 'Älä pakota ilmaa, anna vain virrata ulos';
      sound.playExhale(pace.exhale);

      // Kun uloshengitys päättyy
      this.scheduleTimeout(() => {
        if (this.state !== 'breathing') return;

        if (this.currentBreath >= totalBreaths) {
          this.startRetentionPhase();
        } else {
          this.nextTimedBreathCycle();
        }
      }, exhaleMs);
    }, inhaleMs);
  }

  startRetentionPhase() {
    this.state = 'retention';
    this.requestWakeLock();
    this.resetVisualizerClasses();
    this.visualizerWrapper.classList.add('retention-mode');

    if (this.detector) {
      this.detector.stop();
    }

    this.micStatusBadge.style.display = 'none';
    this.earlyRetentionBtn.style.display = 'none';
    this.micMeterContainer.style.display = 'none';
    this.tapBreathBtn.style.display = 'none';
    this.retentionReadyBtn.style.display = 'flex';
    this.skipRecoveryBtn.style.display = 'none';

    if (this.cycleMode === 'fire') {
      this.exercisePhaseTitle.textContent = 'Pidätys & Vatsalukko';
      this.instructionMain.textContent = 'Ime vatsa sisään ja pidätä';
      this.instructionSub.textContent = 'Leuka rintaan, vatsa tiiviinä sisään (Uddiyana bandha)';
    } else {
      this.exercisePhaseTitle.textContent = 'Retentio (Pidätys)';
      this.instructionMain.textContent = 'Puhalla ilma rennosti ulos ja pidätä';
      this.instructionSub.textContent = 'Paina nappia tai välilyöntiä kun haluat ottaa henkeä';
    }

    // Äänimerkki retentiolle (syvä gongi)
    sound.playGong();

    if (this.voiceEnabled && (this.exerciseMode === 'timed' || this.exerciseMode === 'custom')) {
      voice.announceHold();
    }

    // Käynnistä sekuntikello
    this.retentionStartTime = performance.now();
    this.circleSubText.textContent = 'retentio';

    const updateTimer = () => {
      if (this.state !== 'retention') return;

      const elapsedMs = performance.now() - this.retentionStartTime;
      this.circleMainText.textContent = this.formatTime(elapsedMs);

      this.retentionTimerId = requestAnimationFrame(updateTimer);
    };

    updateTimer();
  }

  finishRetention() {
    if (this.state !== 'retention') return;

    if (this.retentionTimerId) {
      cancelAnimationFrame(this.retentionTimerId);
      this.retentionTimerId = null;
    }

    const elapsedMs = performance.now() - this.retentionStartTime;
    this.retentionTimes.push(elapsedMs);

    this.retentionReadyBtn.style.display = 'none';

    if (this.includeRecovery) {
      this.startRecoveryPhase();
    } else {
      this.handleRoundCompletion();
    }
  }

  startRecoveryPhase() {
    this.state = 'recovery';
    this.requestWakeLock();
    this.resetVisualizerClasses();
    this.visualizerWrapper.classList.add('recovery-mode');

    this.exercisePhaseTitle.textContent = 'Palautushengitys';
    this.instructionMain.textContent = 'Ota syvä henki sisään ja pidätä!';
    this.instructionSub.textContent = 'Täytä keuhkot ja rentoudu 15 sekuntia';

    this.skipRecoveryBtn.style.display = 'block';
    this.circleSubText.textContent = 'sekuntia';

    sound.playChime();
    if (this.voiceEnabled) {
      voice.announceRecovery();
    }

    let timeLeft = 15;
    this.circleMainText.textContent = timeLeft;

    const tick = () => {
      if (this.state !== 'recovery') return;

      timeLeft--;
      if (timeLeft > 0) {
        this.circleMainText.textContent = timeLeft;
        if (timeLeft <= 3) {
          sound.playBeep(false);
        }
        this.scheduleTimeout(tick, 1000);
      } else {
        this.finishRecovery();
      }
    };

    this.scheduleTimeout(tick, 1000);
  }

  finishRecovery() {
    if (this.state !== 'recovery') return;

    this.clearTimeouts();
    this.skipRecoveryBtn.style.display = 'none';

    // Äänimerkki ja vapautus
    sound.playChime();
    if (this.voiceEnabled) {
      voice.announceRecoveryDone();
    }

    this.instructionMain.textContent = 'Päästä ilma ulos ja rentoudu';
    this.instructionSub.textContent = '';
    this.circleMainText.textContent = '✓';
    this.circleSubText.textContent = '';

    this.scheduleTimeout(() => {
      this.handleRoundCompletion();
    }, 2000);
  }

  handleRoundCompletion() {
    if (this.currentRound < this.totalRounds) {
      this.currentRound++;
      if (this.exerciseMode === 'listening') {
        this.startListeningPreparation();
      } else {
        this.startCountdown();
      }
    } else {
      this.finishAllRounds();
    }
  }

  finishAllRounds({ isPartial = false, saveToHistory = true } = {}) {
    this.releaseWakeLock();
    if (this.detector) {
      this.detector.stop();
    }
    const hrStats = this.hrMonitor ? this.hrMonitor.stopRecording() : null;
    this.renderHeartRateSummary(hrStats);
    this.showScreen('summary');

    if (!isPartial) {
      sound.playChime();
      if (this.voiceEnabled) {
        voice.speak('Harjoitus suoritettu. Hienoa työtä!');
      }
    }

    if (this.summaryTrophy && this.summaryTitle && this.summarySubtitle) {
      if (isPartial) {
        this.summaryTrophy.textContent = saveToHistory ? '📊' : '👁️';
        this.summaryTitle.textContent = saveToHistory ? 'Osittainen suoritus tallennettu' : 'Harjoituksen raportti';
        this.summarySubtitle.textContent = saveToHistory
          ? 'Keskeytetty harjoitus tallennettiin paikalliseen historiaan.'
          : 'Raporttia ei tallennettu historiaan.';
      } else {
        this.summaryTrophy.textContent = '✨';
        this.summaryTitle.textContent = 'Upeaa työtä!';
        this.summarySubtitle.textContent = 'Harjoitus on suoritettu onnistuneesti.';
      }
    }

    const durationSec = Math.max(1, Math.round((Date.now() - this.sessionStartTime) / 1000));
    const maxRetentionMs = this.retentionTimes.length > 0 ? Math.max(...this.retentionTimes) : null;
    const tech = this.exerciseMode === 'technique' ? getTechniqueById(this.selectedTechniqueId) : null;
    const sessionTitle = this.exerciseMode === 'technique'
      ? `${tech.icon} ${tech.name}`
      : this.exerciseMode === 'hrdrop'
        ? `💓 Sykkeenlasku (${HR_DROP_RHYTHMS[this.hrDropRhythm].name})`
        : this.exerciseMode === 'ladder'
          ? `🪜 ${this.ladderPattern === 'pyramid' ? 'Pyramidi' : 'Porrasharjoitus'}`
          : this.exerciseMode === 'listening'
            ? '🎤 Kuuntelutila'
            : this.exerciseMode === 'custom'
              ? '🎛️ Mukautettu'
              : '⏱️ Syvähengitys';

    if (saveToHistory) {
      saveSession({
        mode: this.exerciseMode,
        title: sessionTitle,
        durationSec,
        rounds: this.exerciseMode === 'technique'
          ? (isPartial ? this.completedTechniqueCycles : this.techniqueCycles)
          : Math.max(1, this.retentionTimes.length || this.currentRound),
        maxRetentionMs,
        avgBpm: hrStats ? hrStats.avg : null,
        avgHrv: hrStats ? hrStats.avgHrv : null
      });
      this.renderHistoryUI();
    }

    // Jos suoritettiin sykkeenlaskuharjoitus, näytetään sykemuutos-yhteenveto
    if (this.exerciseMode === 'hrdrop') {
      const rhythm = HR_DROP_RHYTHMS[this.hrDropRhythm] || HR_DROP_RHYTHMS.coherent;
      const sessionDurationMin = Math.round(durationSec / 60) || 1;
      const delta = (this.hrBaselineBpm !== null && this.hrLastBpm !== null)
        ? (this.hrLastBpm - this.hrBaselineBpm)
        : null;
      const deltaText = delta === null ? 'Ei sensoridataa' : (delta <= 0 ? `${delta} bpm 📉` : `+${delta} bpm`);

      this.summaryRoundsList.innerHTML = `
        <div class="round-stat-item best-round">
          <span class="stat-round-label">💓 ${rhythm.name}</span>
          <span class="stat-time-value">${deltaText}</span>
        </div>
        ${this.hrBaselineBpm !== null ? `
          <div class="round-stat-item">
            <span class="stat-round-label">Lähtö → Loppu (Alin)</span>
            <span class="stat-time-value">${this.hrBaselineBpm} → ${this.hrLastBpm} (${this.hrLowestBpm} bpm)</span>
          </div>
        ` : ''}
      `;
      this.summaryTotalStats.innerHTML = `
        <div><strong>Kokonaisaika:</strong> ${this.formatTime(durationSec * 1000)} (~${sessionDurationMin} min)</div>
        <div><strong>Tavoite:</strong> ${this.hrDropTargetBpm > 0 ? `−${this.hrDropTargetBpm} bpm (${this.hrTargetReached ? '✓ Saavutettu' : 'Kesken'})` : 'Vapaa rauhoittuminen'}</div>
      `;
      return;
    }

    // Jos suoritettiin tekniikkaharjoitus, näytetään tekniikan yhteenveto
    if (this.exerciseMode === 'technique') {
      const doneCycles = isPartial ? this.completedTechniqueCycles : this.techniqueCycles;
      const sessionDurationMin = Math.round(durationSec / 60) || 1;
      this.summaryRoundsList.innerHTML = `
        <div class="round-stat-item best-round">
          <span class="stat-round-label">${tech.icon} ${tech.name}</span>
          <span class="stat-time-value">${doneCycles} / ${this.techniqueCycles} sykliä</span>
        </div>
        <div class="round-stat-item">
          <span class="stat-round-label">Rytmi</span>
          <span class="stat-time-value">${tech.rhythmLabel}</span>
        </div>
      `;
      this.summaryTotalStats.innerHTML = `
        <div><strong>Kokonaisaika:</strong> ${this.formatTime(durationSec * 1000)} (~${sessionDurationMin} min)</div>
        <div><strong>Suoritetut syklit:</strong> ${doneCycles} kpl</div>
      `;
      return;
    }

    // Jos suoritettiin porrasharjoitus, näytetään porrastilastot
    if (this.exerciseMode === 'ladder') {
      const totalSteps = this.ladderSequence.length;
      const doneSteps = isPartial ? (this.ladderStepIndex || 0) : totalSteps;
      const sessionDurationMin = Math.round(durationSec / 60) || 1;
      this.summaryRoundsList.innerHTML = `
        <div class="round-stat-item best-round">
          <span class="stat-round-label">🪜 ${this.ladderPattern === 'pyramid' ? 'Pyramidi' : 'Porrasharjoitus'}</span>
          <span class="stat-time-value">${doneSteps} / ${totalSteps} porrasta</span>
        </div>
        <div class="round-stat-item">
          <span class="stat-round-label">Huippukesto</span>
          <span class="stat-time-value">${this.ladderMax} s</span>
        </div>
      `;
      this.summaryTotalStats.innerHTML = `
        <div><strong>Kokonaisaika:</strong> ${this.formatTime(durationSec * 1000)} (~${sessionDurationMin} min)</div>
        <div><strong>Askeleet:</strong> ${doneSteps} toistoa</div>
        <div><strong>Alku → Huippu:</strong> ${this.ladderStart}s → ${this.ladderMax}s</div>
      `;
      return;
    }

    // Renderöi kierrostilastot
    this.summaryRoundsList.innerHTML = '';
    if (this.retentionTimes.length === 0) {
      this.summaryRoundsList.innerHTML = `
        <div class="round-stat-item">
          <span class="stat-round-label">Retentiot</span>
          <span class="stat-time-value">Ei täysiä retentiokierroksia</span>
        </div>
      `;
    } else {
      const maxTime = Math.max(...this.retentionTimes);

      this.retentionTimes.forEach((timeMs, idx) => {
        const item = document.createElement('div');
        item.className = 'round-stat-item';
        const isBest = timeMs === maxTime && this.retentionTimes.length > 1;
        if (isBest) {
          item.classList.add('best-round');
        }

        item.innerHTML = `
          <span class="stat-round-label">
            Kierros ${idx + 1}
            ${isBest ? '<span class="best-badge">Paras</span>' : ''}
          </span>
          <span class="stat-time-value">${this.formatTime(timeMs)}</span>
        `;
        this.summaryRoundsList.appendChild(item);
      });
    }

    // Kokonaistilastot
    const totalRetentionSec = Math.round(this.retentionTimes.reduce((a, b) => a + b, 0) / 1000);
    const totalBreathsTaken = isPartial
      ? Math.max(0, (this.retentionTimes.length * this.breathsPerRound) + (this.currentBreath || 0))
      : this.totalRounds * this.breathsPerRound;
    const sessionDurationMin = Math.round(durationSec / 60) || 1;

    this.summaryTotalStats.innerHTML = `
      <div><strong>Kokonaisaika:</strong> ${this.formatTime(durationSec * 1000)} (~${sessionDurationMin} min)</div>
      <div><strong>Hengityksiä:</strong> ${totalBreathsTaken} kpl</div>
      <div><strong>Retentiot yht.:</strong> ${Math.floor(totalRetentionSec / 60)}m ${totalRetentionSec % 60}s</div>
    `;
  }

  exitExercise() {
    this.clearTimeouts();
    this.releaseWakeLock();
    if (this.detector) {
      this.detector.stop();
    }
    this.state = 'idle';

    const elapsedMs = this.sessionStartTime ? (Date.now() - this.sessionStartTime) : 0;
    const hasData = elapsedMs >= 3000 || this.retentionTimes.length > 0;

    if (!hasData || !this.earlyExitOverlay) {
      if (this.hrMonitor) {
        this.hrMonitor.stopRecording();
      }
      this.resetVisualizerClasses();
      this.showScreen('setup');
      return;
    }

    if (this.earlyExitDurationText) {
      this.earlyExitDurationText.textContent =
        `Harjoituksen kesto: ${this.formatTime(elapsedMs)}. Haluatko tallentaa tämän suorituksen ja nähdä raportin?`;
    }
    this.earlyExitOverlay.style.display = 'flex';
  }

  resetVisualizerClasses() {
    this.visualizerWrapper.className = 'visualizer-wrapper';
    this.audioReactiveRing.style.transform = 'scale(1)';
    this.breathingCircleOuter.style.transform = '';
    this.breathingCircleInner.style.transform = '';
    this.breathingCircleOuter.style.transition = '';
    this.breathingCircleInner.style.transition = '';
    this.breathingCircleOuter.style.display = '';
    this.breathingCircleInner.style.display = '';
    this.audioReactiveRing.style.display = '';
    if (this.tankVisualizer) {
      this.tankVisualizer.style.display = 'none';
      this.tankVisualizer.classList.remove('exhaling');
    }
    if (this.tankLiquid) {
      this.tankLiquid.style.height = '0%';
    }
    if (this.micMeterContainer) this.micMeterContainer.style.display = 'none';
    if (this.tapBreathBtn) this.tapBreathBtn.style.display = 'none';
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => (n < 10 ? '0' + n : n);
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  // --- SYKESENSORI (POLAR VERITY SENSE / BLE) ---

  initHeartRateMonitor() {
    this.hrMonitor = new HeartRateMonitor({
      onHeartRate: ({ bpm, hrv }) => {
        if (this.hrLiveValue) {
          this.hrLiveValue.textContent = String(bpm);
        }
        if (this.hrLiveHrv) {
          if (hrv !== null && hrv !== undefined) {
            this.hrLiveHrv.textContent = `HRV ${hrv} ms`;
            this.hrLiveHrv.style.display = 'inline';
          } else {
            this.hrLiveHrv.style.display = 'none';
          }
        }
        if (this.hrConnectLabel && this.hrMonitor && this.hrMonitor.isConnected) {
          this.hrConnectLabel.textContent = `${bpm} bpm`;
        }
        if (this.exerciseMode === 'hrdrop' && this.state === 'breathing') {
          this.updateHrBiofeedback(bpm);
        }
      },
      onStatusChange: (status, deviceName) => {
        if (!this.hrConnectBtn || !this.hrConnectLabel) return;
        this.hrConnectBtn.classList.remove('connecting', 'connected');

        if (status === 'connecting') {
          this.hrConnectBtn.classList.add('connecting');
          this.hrConnectLabel.textContent = 'Yhdistetään...';
        } else if (status === 'connected') {
          this.hrConnectBtn.classList.add('connected');
          this.hrConnectLabel.textContent = deviceName ? `${deviceName}` : 'Yhdistetty';
          if (this.hrLiveBadge) this.hrLiveBadge.style.display = 'inline-flex';
        } else {
          this.hrConnectLabel.textContent = 'Yhdistä syke';
          if (this.hrLiveBadge) this.hrLiveBadge.style.display = 'none';
          if (this.hrLiveValue) this.hrLiveValue.textContent = '--';
          if (this.hrLiveHrv) this.hrLiveHrv.style.display = 'none';
        }
      }
    });
  }

  async handleHeartRateToggle() {
    if (!this.hrMonitor) return;

    if (this.hrMonitor.isConnected) {
      this.hrMonitor.disconnect();
      return;
    }

    try {
      await this.hrMonitor.connect();
    } catch (err) {
      if (err && err.message === 'BLUETOOTH_NOT_SUPPORTED') {
        alert(
          'Web Bluetooth ei ole käytettävissä tässä selaimessa.\n\n' +
          'Käytä Polar Verity Sense -sykemittaria Androidin tai tietokoneen Chrome/Edge-selaimella (HTTPS-yhteydellä). ' +
          'iOS-laitteilla voit käyttää maksutonta Bluefy-selainta.'
        );
      } else {
        console.warn('Sykesensorin yhdistys epäonnistui:', err);
      }
    }
  }

  renderHeartRateSummary(hrStats) {
    if (!this.hrSummarySection) return;
    if (!hrStats || !hrStats.points || hrStats.points.length === 0) {
      this.hrSummarySection.style.display = 'none';
      this.hrSummarySection.innerHTML = '';
      return;
    }

    const { min, max, avg, avgHrv, points } = hrStats;
    const width = 300;
    const height = 76;
    const padY = 8;
    const span = Math.max(10, max - min);

    const coords = points.map((pt, idx) => {
      const x = points.length === 1 ? width / 2 : (idx / (points.length - 1)) * width;
      const y = height - padY - ((pt.bpm - min) / span) * (height - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const polylinePoints = coords.join(' ');
    const areaPoints = `0,${height} ${polylinePoints} ${width},${height}`;

    this.hrSummarySection.innerHTML = `
      <div class="hr-summary-title">
        <span>❤️ Syke harjoituksen aikana</span>
        ${avgHrv !== null ? `<span style="font-size: 0.76rem; color: #bae6fd;">HRV ka. ${avgHrv} ms</span>` : ''}
      </div>
      <div class="hr-summary-metrics">
        <div class="hr-metric-box">
          <div class="hr-metric-val">${min}</div>
          <div class="hr-metric-lbl">Alin (bpm)</div>
        </div>
        <div class="hr-metric-box">
          <div class="hr-metric-val">${avg}</div>
          <div class="hr-metric-lbl">Keskisyke</div>
        </div>
        <div class="hr-metric-box">
          <div class="hr-metric-val">${max}</div>
          <div class="hr-metric-lbl">Ylin (bpm)</div>
        </div>
      </div>
      ${points.length > 1 ? `
        <svg class="hr-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Syke-käyrä">
          <defs>
            <linearGradient id="hrAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.38" />
              <stop offset="100%" stop-color="#f43f5e" stop-opacity="0.0" />
            </linearGradient>
          </defs>
          <polygon points="${areaPoints}" fill="url(#hrAreaGrad)" />
          <polyline fill="none" stroke="#fb7185" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${polylinePoints}" />
        </svg>
      ` : ''}
    `;
    this.hrSummarySection.style.display = 'block';
  }

  // --- TEKNIIKKAKIRJASTO & 4-VAIHEINEN MOOTTORI ---

  updateTechniqueDisplay() {
    const tech = getTechniqueById(this.selectedTechniqueId);
    if (this.techniqueGrid) {
      this.techniqueGrid.querySelectorAll('.technique-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.technique === tech.id);
      });
    }
    if (this.techniqueRhythmBadge) {
      this.techniqueRhythmBadge.textContent = tech.rhythmLabel;
    }
    if (this.techCyclesDisplay) {
      this.techCyclesDisplay.textContent = String(this.techniqueCycles);
    }
    if (this.techniqueInfoCard) {
      this.techniqueInfoCard.innerHTML = `
        <div><strong>${tech.icon} ${tech.name}:</strong> ${tech.instructions.short}</div>
        <div><strong>Hyödyt:</strong> ${tech.instructions.benefits}</div>
        <div><strong>Ohje:</strong> ${tech.instructions.howTo}</div>
        <div class="technique-info-warn">⚠️ ${tech.instructions.avoid}</div>
      `;
    }
  }

  startTechniquePhase() {
    const tech = getTechniqueById(this.selectedTechniqueId);
    const steps = [];
    if (tech.phases.inhale > 0) steps.push({ type: 'inhale', label: 'Hengitä sisään', voice: 'Sisään', duration: tech.phases.inhale });
    if (tech.phases.holdIn > 0) steps.push({ type: 'holdIn', label: 'Pidätä', voice: 'Pidätä', duration: tech.phases.holdIn });
    if (tech.phases.exhale > 0) steps.push({ type: 'exhale', label: 'Hengitä ulos', voice: 'Ulos', duration: tech.phases.exhale });
    if (tech.phases.holdOut > 0) steps.push({ type: 'holdOut', label: 'Pidätä', voice: 'Pidätä', duration: tech.phases.holdOut });

    this.exercisePhaseTitle.textContent = `${tech.icon} ${tech.name}`;
    this.runTechniqueCycle(1, steps, 0);
  }

  runTechniqueCycle(cycleIndex, steps, stepIndex) {
    if (this.state !== 'breathing') return;
    if (cycleIndex > this.techniqueCycles) {
      this.completedTechniqueCycles = this.techniqueCycles;
      this.finishAllRounds();
      return;
    }
    this.completedTechniqueCycles = Math.max(this.completedTechniqueCycles || 0, cycleIndex - 1);

    const step = steps[stepIndex];
    const tech = getTechniqueById(this.selectedTechniqueId);
    this.exerciseRoundBadge.textContent = `${tech.icon} Sykli ${cycleIndex} / ${this.techniqueCycles}`;
    this.instructionMain.textContent = step.label;
    this.instructionSub.textContent = `${tech.name} • ${tech.rhythmLabel}`;

    this.resetVisualizerClasses();
    document.documentElement.style.setProperty('--breath-duration', `${step.duration}s`);

    if (step.type === 'inhale') {
      this.visualizerWrapper.classList.add('inhale');
      sound.playInhale(step.duration);
    } else if (step.type === 'exhale') {
      this.visualizerWrapper.classList.add('exhale');
      sound.playExhale(step.duration);
    } else if (step.type === 'holdIn') {
      this.visualizerWrapper.classList.add('inhale');
      sound.playBeep(false);
    } else {
      this.visualizerWrapper.classList.add('exhale');
      sound.playBeep(false);
    }

    if (this.voiceEnabled) {
      voice.speak(step.voice);
    }

    let remaining = step.duration;
    this.circleMainText.textContent = String(remaining);
    this.circleSubText.textContent = step.label;

    const tick = () => {
      if (this.state !== 'breathing') return;
      remaining--;
      if (remaining > 0) {
        this.circleMainText.textContent = String(remaining);
        this.scheduleTimeout(tick, 1000);
      } else {
        const nextStep = stepIndex + 1;
        if (nextStep < steps.length) {
          this.runTechniqueCycle(cycleIndex, steps, nextStep);
        } else {
          this.runTechniqueCycle(cycleIndex + 1, steps, 0);
        }
      }
    };

    this.scheduleTimeout(tick, 1000);
  }

  // --- PAIKALLINEN HISTORIA & PUTKI ---

  renderHistoryUI() {
    if (!this.historyBar) return;
    const summary = getHistorySummary();
    if (summary.totalSessions === 0) {
      this.historyBar.style.display = 'none';
      if (this.historyPanel) this.historyPanel.style.display = 'none';
      return;
    }

    this.historyBar.style.display = 'flex';
    if (this.historyStreakBadge) {
      this.historyStreakBadge.textContent = `🔥 ${summary.streakDays} pv putki`;
    }
    if (this.historyCountBadge) {
      this.historyCountBadge.textContent = `✓ ${summary.totalSessions} harjoitusta (${summary.totalMinutes} min)`;
    }

    if (this.historyList) {
      this.historyList.innerHTML = summary.sessions.slice(0, 10).map(item => {
        const dateStr = new Date(item.dateIso).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' });
        const metaParts = [`${Math.max(1, Math.round(item.durationSec / 60))} min`];
        if (item.maxRetentionMs) metaParts.push(`Paras ${this.formatTime(item.maxRetentionMs)}`);
        if (item.avgBpm) metaParts.push(`❤️ ${item.avgBpm} bpm`);
        return `
          <div class="history-item">
            <span class="history-item-title">${item.title}</span>
            <span class="history-item-meta">${dateStr} • ${metaParts.join(' • ')}</span>
          </div>
        `;
      }).join('');
    }
  }

  // --- SYKKEENLASKU / BIOFEEDBACK ---

  updateHrBiofeedback(bpm) {
    if (!bpm || bpm <= 0) return;
    if (this.hrBaselineBpm === null) {
      this.hrBaselineBpm = bpm;
    }
    this.hrLastBpm = bpm;
    if (this.hrLowestBpm === null || bpm < this.hrLowestBpm) {
      this.hrLowestBpm = bpm;
    }

    const delta = bpm - this.hrBaselineBpm;
    if (this.hrBfBaseline) this.hrBfBaseline.textContent = `${this.hrBaselineBpm}`;
    if (this.hrBfCurrent) this.hrBfCurrent.textContent = `${bpm}`;
    if (this.hrBfDelta) {
      this.hrBfDelta.textContent = delta <= 0 ? `${delta} bpm` : `+${delta} bpm`;
      this.hrBfDelta.classList.toggle('positive-drop', delta < 0);
    }

    if (this.hrDropTargetBpm > 0 && delta <= -this.hrDropTargetBpm && !this.hrTargetReached) {
      this.hrTargetReached = true;
      if (this.hrBiofeedbackCard) this.hrBiofeedbackCard.classList.add('target-reached');
      if (this.hrBfTarget) this.hrBfTarget.textContent = '✓ Saavutettu!';
      sound.playChime();
    }
  }

  startHrDropPhase() {
    const rhythm = HR_DROP_RHYTHMS[this.hrDropRhythm] || HR_DROP_RHYTHMS.coherent;
    const totalMs = this.hrDropMinutes * 60 * 1000;
    const endTime = Date.now() + totalMs;

    this.exercisePhaseTitle.textContent = `💓 Sykkeenlasku`;
    if (this.hrBiofeedbackCard) {
      this.hrBiofeedbackCard.style.display = 'grid';
      this.hrBiofeedbackCard.classList.remove('target-reached');
      if (this.hrBfTarget) {
        this.hrBfTarget.textContent = this.hrDropTargetBpm > 0 ? `-${this.hrDropTargetBpm} bpm` : 'Vapaa';
      }
      if (this.hrMonitor && this.hrMonitor.isConnected && this.hrMonitor.currentBpm) {
        this.updateHrBiofeedback(this.hrMonitor.currentBpm);
      } else {
        if (this.hrBfBaseline) this.hrBfBaseline.textContent = '--';
        if (this.hrBfCurrent) this.hrBfCurrent.textContent = '--';
        if (this.hrBfDelta) this.hrBfDelta.textContent = '--';
      }
    }

    const steps = [{ type: 'inhale', label: 'Hengitä sisään', voice: 'Sisään', duration: rhythm.inhale }];
    if (rhythm.holdIn > 0) {
      steps.push({ type: 'holdIn', label: 'Kevyt pito', voice: 'Pidätä', duration: rhythm.holdIn });
    }
    steps.push({ type: 'exhale', label: 'Pitkä uloshengitys', voice: 'Ulos', duration: rhythm.exhale });

    this.runHrDropCycle(steps, 0, endTime);
  }

  runHrDropCycle(steps, stepIndex, endTime) {
    if (this.state !== 'breathing') return;
    const now = Date.now();
    if (now >= endTime) {
      this.finishAllRounds();
      return;
    }

    const step = steps[stepIndex];
    const rhythm = HR_DROP_RHYTHMS[this.hrDropRhythm] || HR_DROP_RHYTHMS.coherent;
    const remTotal = Math.max(0, endTime - now);
    this.exerciseRoundBadge.textContent = `💓 Jäljellä ${this.formatTime(remTotal)}`;
    this.instructionMain.textContent = step.label;
    this.instructionSub.textContent = `${rhythm.name} • Rauhoita syke`;

    this.resetVisualizerClasses();
    document.documentElement.style.setProperty('--breath-duration', `${step.duration}s`);

    if (step.type === 'inhale') {
      this.visualizerWrapper.classList.add('inhale');
      sound.playInhale(step.duration);
    } else if (step.type === 'holdIn') {
      this.visualizerWrapper.classList.add('inhale');
      sound.playBeep(false);
    } else {
      this.visualizerWrapper.classList.add('exhale');
      sound.playExhale(step.duration);
    }

    if (this.voiceEnabled) {
      voice.speak(step.voice);
    }

    let remaining = step.duration;
    this.circleMainText.textContent = String(remaining);
    this.circleSubText.textContent = step.label;

    const tick = () => {
      if (this.state !== 'breathing') return;
      if (Date.now() >= endTime) {
        this.finishAllRounds();
        return;
      }
      remaining--;
      if (remaining > 0) {
        this.circleMainText.textContent = String(remaining);
        this.exerciseRoundBadge.textContent = `💓 Jäljellä ${this.formatTime(Math.max(0, endTime - Date.now()))}`;
        this.scheduleTimeout(tick, 1000);
      } else {
        const nextStep = (stepIndex + 1) % steps.length;
        this.runHrDropCycle(steps, nextStep, endTime);
      }
    };

    this.scheduleTimeout(tick, 1000);
  }
}

export { PACES, HR_DROP_RHYTHMS, BreathingApp };

// Käynnistetään sovellus heti selaimessa
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new BreathingApp();
    });
  } else {
    new BreathingApp();
  }
}
