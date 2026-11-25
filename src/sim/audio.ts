// Procedural Web Audio API Aviation Soundscape
// Zero external asset dependencies.

export class AviationAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Engine continuous nodes
  private turbineOsc: OscillatorNode | null = null;
  private turbineSubOsc: OscillatorNode | null = null;
  private turbineGain: GainNode | null = null;
  private jetNoiseNode: AudioBufferSourceNode | null = null;
  private jetNoiseFilter: BiquadFilterNode | null = null;
  private jetNoiseGain: GainNode | null = null;
  private abNoiseFilter: BiquadFilterNode | null = null;
  private abNoiseGain: GainNode | null = null;

  // Seeker & RWR tones
  private seekerOsc: OscillatorNode | null = null;
  private seekerGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private initialized = false;
  private lastRwrTime = 0;
  private lastTerrainTime = 0;
  private lastCannonTime = 0;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.42, this.ctx.currentTime, 0.04);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.42;
    master.connect(ctx.destination);
    this.masterGain = master;

    // Generate 2-second pink/white noise buffer
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.1848) * 0.2));
    }
    this.noiseBuffer = buffer;

    // 1. Turbofan compressor whine
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 110;
    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.value = 520;
    const tGain = ctx.createGain();
    tGain.gain.value = 0.0;
    osc.connect(oscFilter);
    oscFilter.connect(tGain);
    tGain.connect(master);
    osc.start();
    this.turbineOsc = osc;
    this.turbineGain = tGain;

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = 55;
    sub.connect(tGain);
    sub.start();
    this.turbineSubOsc = sub;

    // 2. Jet exhaust roar + afterburner rumble (looping noise)
    const jetSrc = ctx.createBufferSource();
    jetSrc.buffer = buffer;
    jetSrc.loop = true;
    const jetFilter = ctx.createBiquadFilter();
    jetFilter.type = 'bandpass';
    jetFilter.frequency.value = 260;
    jetFilter.Q.value = 0.7;
    const jGain = ctx.createGain();
    jGain.gain.value = 0.0;
    jetSrc.connect(jetFilter);
    jetFilter.connect(jGain);
    jGain.connect(master);

    const abFilter = ctx.createBiquadFilter();
    abFilter.type = 'lowpass';
    abFilter.frequency.value = 140;
    const abGain = ctx.createGain();
    abGain.gain.value = 0.0;
    jetSrc.connect(abFilter);
    abFilter.connect(abGain);
    abGain.connect(master);

    jetSrc.start();
    this.jetNoiseNode = jetSrc;
    this.jetNoiseFilter = jetFilter;
    this.jetNoiseGain = jGain;
    this.abNoiseFilter = abFilter;
    this.abNoiseGain = abGain;

    // 3. IR Seeker tone oscillator
    const seeker = ctx.createOscillator();
    seeker.type = 'square';
    seeker.frequency.value = 420;
    const seekerFilter = ctx.createBiquadFilter();
    seekerFilter.type = 'lowpass';
    seekerFilter.frequency.value = 1800;
    const sGain = ctx.createGain();
    sGain.gain.value = 0;
    seeker.connect(seekerFilter);
    seekerFilter.connect(sGain);
    sGain.connect(master);
    seeker.start();
    this.seekerOsc = seeker;
    this.seekerGain = sGain;

    this.initialized = true;
  }

  public updateContinuous(
    active: boolean,
    throttle01: number,
    afterburner: boolean,
    mach: number,
    aoaDeg: number,
    lockProgress: number,
    isLocked: boolean,
    rwrWarning: boolean,
    missileIncoming: boolean,
    terrainWarning: boolean,
    isCockpit: boolean,
    gLocIntensity = 0,
    windTurbulence = 0
  ): void {
    if (!this.initialized || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    if (!active) {
      this.turbineGain?.gain.setTargetAtTime(0, now, 0.08);
      this.jetNoiseGain?.gain.setTargetAtTime(0, now, 0.08);
      this.abNoiseGain?.gain.setTargetAtTime(0, now, 0.08);
      this.seekerGain?.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const gLocDamp = 1 - Math.min(0.75, gLocIntensity * 0.78);
    const cockpitDamp = (isCockpit ? 0.55 : 1.0) * gLocDamp;

    // Engine RPM pitch and roar
    const rpmNorm = 0.3 + throttle01 * 0.7;
    if (this.turbineOsc && this.turbineSubOsc && this.turbineGain) {
      this.turbineOsc.frequency.setTargetAtTime(85 + rpmNorm * 145, now, 0.06);
      this.turbineSubOsc.frequency.setTargetAtTime(42 + rpmNorm * 65, now, 0.06);
      this.turbineGain.gain.setTargetAtTime((0.04 + throttle01 * 0.07) * cockpitDamp, now, 0.08);
    }

    const aoaBuffet = Math.max(0, (Math.abs(aoaDeg) - 11) / 14);
    const windBuffet = Math.min(1, windTurbulence) * 0.06;
    if (this.jetNoiseFilter && this.jetNoiseGain) {
      this.jetNoiseFilter.frequency.setTargetAtTime(180 + throttle01 * 480 + mach * 220 + aoaBuffet * 300 + windTurbulence * 180, now, 0.08);
      this.jetNoiseGain.gain.setTargetAtTime((0.07 + throttle01 * 0.14 + aoaBuffet * 0.08 + windBuffet) * cockpitDamp, now, 0.08);
    }

    if (this.abNoiseFilter && this.abNoiseGain) {
      this.abNoiseFilter.frequency.setTargetAtTime(afterburner ? 260 : 110, now, 0.08);
      this.abNoiseGain.gain.setTargetAtTime((afterburner ? 0.28 : 0.02) * cockpitDamp, now, 0.08);
    }

    // Seeker Tone (Sidewinder growl -> high solid tone on lock)
    if (this.seekerOsc && this.seekerGain) {
      if (isLocked) {
        this.seekerOsc.frequency.setTargetAtTime(1040, now, 0.02);
        this.seekerGain.gain.setTargetAtTime(0.055, now, 0.03);
      } else if (lockProgress > 0.12) {
        const wobble = Math.sin(now * 28) * 35;
        this.seekerOsc.frequency.setTargetAtTime(340 + lockProgress * 460 + wobble, now, 0.03);
        this.seekerGain.gain.setTargetAtTime(0.025 + lockProgress * 0.02, now, 0.04);
      } else {
        this.seekerGain.gain.setTargetAtTime(0, now, 0.04);
      }
    }

    // RWR Missile / Lock alert chirps
    const rwrPeriod = missileIncoming ? 0.22 : 0.55;
    if ((missileIncoming || rwrWarning) && now - this.lastRwrTime > rwrPeriod) {
      this.lastRwrTime = now;
      this.playBeep(missileIncoming ? 1480 : 980, missileIncoming ? 0.09 : 0.07, 0.09);
    }

    // GPWS Terrain Pull Up warning
    if (terrainWarning && now - this.lastTerrainTime > 0.65) {
      this.lastTerrainTime = now;
      this.playBeep(680, 0.14, 0.12);
      setTimeout(() => this.playBeep(520, 0.14, 0.12), 160);
    }
  }

  private playBeep(freq: number, duration: number, vol: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  public playCannonShot(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastCannonTime < 0.045) return;
    this.lastCannonTime = now;

    // Rotary M61 mechanical punch
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(165 + Math.random() * 25, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.055);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.065);

    const nSrc = this.ctx.createBufferSource();
    nSrc.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1150;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.16, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.048);
    nSrc.connect(nf);
    nf.connect(ng);
    ng.connect(this.masterGain);
    nSrc.start(now, Math.random() * 1.2, 0.05);
  }

  public playMissileLaunch(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    const nSrc = this.ctx.createBufferSource();
    nSrc.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.65);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.01, now);
    g.gain.linearRampToValueAtTime(0.36, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    nSrc.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    nSrc.start(now, 0, 0.75);
  }

  public playFlarePop(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playSonicBoom(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.55);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.5, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.62);

    const nSrc = this.ctx.createBufferSource();
    nSrc.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(800, now);
    nf.frequency.exponentialRampToValueAtTime(110, now + 0.45);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.32, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    nSrc.connect(nf);
    nf.connect(ng);
    ng.connect(this.masterGain);
    nSrc.start(now, 0, 0.52);
  }

  public playExplosion(intensity = 1.0): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.9 * intensity);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.45 * intensity, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.95 * intensity);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.0 * intensity);

    const nSrc = this.ctx.createBufferSource();
    nSrc.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(950, now);
    nf.frequency.exponentialRampToValueAtTime(120, now + 0.9 * intensity);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.38 * intensity, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.95 * intensity);
    nSrc.connect(nf);
    nf.connect(ng);
    ng.connect(this.masterGain);
    nSrc.start(now, 0, 1.0 * intensity);
  }

  public playHitImpact(): void {
    this.playBeep(1260, 0.055, 0.12);
  }

  public playTouchdown(smoothness = 1.0): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    // Rubber tire chirp on asphalt
    const nSrc = this.ctx.createBufferSource();
    nSrc.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1850, now);
    bp.frequency.exponentialRampToValueAtTime(720, now + 0.22);
    bp.Q.value = 3.2;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.01, now);
    ng.gain.linearRampToValueAtTime(0.24 * Math.min(1.4, 2 - smoothness * 0.6), now + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    nSrc.connect(bp);
    bp.connect(ng);
    ng.connect(this.masterGain);
    nSrc.start(now, Math.random() * 0.8, 0.28);

    // Oleo suspension thump
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(78, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.18);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.26, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
