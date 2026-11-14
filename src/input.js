import { setInput, shiftBand } from './engine.js';

// 键位映射（双人同屏，共用同一物理键盘）
const KEY_MAP = {
  KeyA: 'azLeft',
  KeyD: 'azRight',
  KeyW: 'gainUp',
  KeyS: 'gainDown',
  ArrowUp: 'elUp',
  ArrowDown: 'elDown',
};

export class InputController {
  constructor(state, { onBand, onStart } = {}) {
    this.state = state;
    this.onBand = onBand;
    this.onStart = onStart;
    this.activeKeys = new Set();
    this._down = this._down.bind(this);
    this._up = this._up.bind(this);
    this._blur = this._blur.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
  }

  detach() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }

  // 单人调试开关启用时，允许脚本直接驱动同一套输入通道
  setVirtual(key, pressed) {
    if (pressed) this.activeKeys.add(key);
    else this.activeKeys.delete(key);
    setInput(this.state, key, pressed);
  }

  _down(e) {
    if (e.code === 'Enter' && this.onStart) {
      this.onStart();
      return;
    }
    if (e.code === 'Comma') {
      if (!e.repeat) {
        shiftBand(this.state, -1);
        this.onBand?.();
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'Period') {
      if (!e.repeat) {
        shiftBand(this.state, 1);
        this.onBand?.();
      }
      e.preventDefault();
      return;
    }
    const action = KEY_MAP[e.code];
    if (action) {
      e.preventDefault(); // 阻止方向键滚动
      if (!e.repeat) {
        this.activeKeys.add(action);
        setInput(this.state, action, true);
      }
    }
  }

  _up(e) {
    const action = KEY_MAP[e.code];
    if (action) {
      this.activeKeys.delete(action);
      setInput(this.state, action, false);
    }
  }

  _blur() {
    // 窗口失焦自动松键，防止“卡键”
    for (const key of this.activeKeys) setInput(this.state, key, false);
    this.activeKeys.clear();
  }
}
