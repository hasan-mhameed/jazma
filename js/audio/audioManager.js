// 📄 audioManager.js
// إدارة الأصوات والمؤثرات الصوتية
// Manages game sounds and audio effects

class AudioManager {
  constructor() {
    this.enabled      = true;
    this.volume       = 0.5;
    this.musicEnabled = true;
    this.musicVolume  = 0.3;
    this.audioContext = null;
    this.egyptianMusic = null;
    this._initialized = false;

    // نهيّئ الصوت بعد أول تفاعل فقط
    const initOnGesture = () => {
      this._initAudio();
      document.removeEventListener("click",      initOnGesture);
      document.removeEventListener("keydown",    initOnGesture);
      document.removeEventListener("touchstart", initOnGesture);
    };
    document.addEventListener("click",      initOnGesture);
    document.addEventListener("keydown",    initOnGesture);
    document.addEventListener("touchstart", initOnGesture);
  }

  _initAudio() {
    if (this._initialized) return;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // resume بشكل صامت — نتجاهل التحذير
      this.audioContext.resume().catch(() => {});
      this._initialized = true;
    } catch(e) {
      this.enabled = false;
    }
  }

  initAudioContext() {
    this._initAudio();
    return this.audioContext;
  }
  
  // تشغيل صوت باستخدام frequency
  playTone(frequency, duration, type = 'sine', volume = null) {
    if (!this.enabled || !this.audioContext) return;

    const play = () => {
      const oscillator = this.audioContext.createOscillator();
      const gainNode   = this.audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      oscillator.frequency.value = frequency;
      oscillator.type = type;
      const vol = volume !== null ? volume : this.volume;
      gainNode.gain.setValueAtTime(vol, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration);
    };

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(play);
    } else {
      play();
    }
  }
  
  // 🎵 بدء الموسيقى المصرية الخلفية
  startBackgroundMusic() {
    if (!this.musicEnabled) return;
    
    // إيقاف الموسيقى القديمة
    this.stopBackgroundMusic();
    
    // تشغيل الموسيقى المصرية
    this.egyptianMusic = new Audio('sounds/egypt-music.mp3');
    this.egyptianMusic.volume = this.musicVolume;
    this.egyptianMusic.loop = true; // 🔁 تكرار تلقائي!
    
    // تشغيل الموسيقى
    this.egyptianMusic.play().catch(err => {
      console.warn('Could not play Egyptian music:', err);
    });
  }
  
  // إيقاف الموسيقى الخلفية
  stopBackgroundMusic() {
    if (this.egyptianMusic) {
      this.egyptianMusic.pause();
      this.egyptianMusic.currentTime = 0;
      this.egyptianMusic = null;
    }
  }
  
  // تفعيل/تعطيل الموسيقى
  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    
    if (this.musicEnabled) {
      this.startBackgroundMusic();
    } else {
      this.stopBackgroundMusic();
    }
    
    return this.musicEnabled;
  }
  
  // صوت رسم الخط
  playLineDraw() {
    if (!this.enabled) return;
    
    // نغمة قصيرة وناعمة
    this.playTone(600, 0.1, 'sine');
    
    // نغمة ثانية للتأثير
    setTimeout(() => {
      this.playTone(800, 0.08, 'sine');
    }, 50);
  }
  
  // صوت إكمال مربع
  playSquareComplete() {
    if (!this.enabled) return;
    
    // سلسلة نغمات تصاعدية
    const notes = [523, 659, 784]; // C, E, G
    notes.forEach((freq, index) => {
      setTimeout(() => {
        this.playTone(freq, 0.15, 'triangle');
      }, index * 80);
    });
  }

  // صوت خطأ (رصيد غير كافٍ مثلاً)
  playError() {
    if (!this.enabled) return;
    this.playTone(200, 0.15, 'square');
    setTimeout(() => this.playTone(150, 0.2, 'square'), 100);
  }

  // صوت تيك المؤقّت (آخر ثوان)
  playTick() {
    if (!this.enabled) return;
    this.playTone(880, 0.06, 'square', (this.volume || 0.3) * 0.5);
  }

  // صوت انتهاء الوقت
  playTimeout() {
    if (!this.enabled) return;
    this.playTone(300, 0.18, 'sawtooth');
    setTimeout(() => this.playTone(220, 0.25, 'sawtooth'), 120);
  }
  
  // صوت الفوز
  playWin() {
    if (!this.enabled) return;
    
    // لحن فوز بسيط
    const melody = [
      { freq: 523, time: 0 },    // C
      { freq: 659, time: 150 },  // E
      { freq: 784, time: 300 },  // G
      { freq: 1047, time: 450 }, // C (أوكتاف أعلى)
    ];
    
    melody.forEach(note => {
      setTimeout(() => {
        this.playTone(note.freq, 0.3, 'triangle');
      }, note.time);
    });
  }
  
  // صوت زر
  playButtonClick() {
    if (!this.enabled) return;
    this.playTone(800, 0.05, 'square');
  }
  
  // تفعيل/تعطيل المؤثرات الصوتية
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  
  // تغيير مستوى صوت المؤثرات
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
  }
  
  // تغيير مستوى صوت الموسيقى
  setMusicVolume(value) {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (this.egyptianMusic) {
      this.egyptianMusic.volume = this.musicVolume;
    }
  }
}

// إنشاء instance واحد
export const audioManager = new AudioManager();
