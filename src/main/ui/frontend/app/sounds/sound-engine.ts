const WOLF_BARK_SOUND = new URL('./assets/wolf-bark.mp3', import.meta.url);

type SoundType = 'bark';

// Type declaration for webkit prefixed AudioContext
interface WebKitAudioContextConstructor {
  new (): AudioContext;
}

declare global {
  interface Window {
    webkitAudioContext: WebKitAudioContextConstructor;
  }
}

/**
 * Sound engine using Web Audio API for optimal performance and control
 */
export class SoundEngine {
  private context: AudioContext;
  private bufferCache: Map<SoundType, AudioBuffer> = new Map();
  private initialized = false;
  private currentSources: AudioBufferSourceNode[] = [];

  constructor() {
    // Initialize AudioContext with browser compatibility
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    this.initSounds();
  }

  /**
   * Initialize sounds by loading and caching audio buffers
   */
  private async initSounds() {
    if (this.initialized) return;

    try {
      // Load and cache the bark sound
      const barkBuffer = await this.loadAudioBuffer(WOLF_BARK_SOUND.href);
      this.bufferCache.set('bark', barkBuffer);
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize sounds:', error);
    }
  }

  /**
   * Load and decode audio file into an AudioBuffer
   */
  private async loadAudioBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return await this.context.decodeAudioData(arrayBuffer);
  }

  /**
   * Play a sound with specified volume
   */
  async play(sound: SoundType, volume = 0.5) {
    if (!this.initialized) {
      await this.initSounds();
    }

    const buffer = this.bufferCache.get(sound);
    if (!buffer) {
      console.warn(`Sound "${sound}" not found in cache`);
      return;
    }

    try {
      // Resume context if it's suspended (browsers require user interaction)
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      // Create and configure source
      const source = this.context.createBufferSource();
      source.buffer = buffer;

      // Create and configure gain node for volume control
      const gainNode = this.context.createGain();
      gainNode.gain.value = Math.max(0, Math.min(1, volume));

      // Connect nodes: source -> gain -> destination
      source.connect(gainNode);
      gainNode.connect(this.context.destination);

      // Start playback
      source.start(0);

      this.currentSources.push(source);
    } catch (error) {
      console.error(`Failed to play sound "${sound}":`, error);
    }
  }

  /**
   * Play bark sound
   */
  async playBark(volume = 0.5) {
    return this.play('bark', volume);
  }

  stop() {
    this.currentSources.forEach((source) => source.stop());
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.context.close();
    this.bufferCache.clear();
    this.initialized = false;
  }
}

// Export a singleton instance
export const soundEngine = new SoundEngine();
