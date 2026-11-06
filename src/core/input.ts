/** Keyboard + touch input. Movement is a vector; action is held; one-shot presses are queued. */
export class Input {
  ax = 0;
  ay = 0;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private touchAction = false;
  private joy = { active: false, id: -1, cx: 0, cy: 0, x: 0, y: 0 };
  /** Clicks/taps on the canvas in logical coordinates. */
  clicks: { x: number; y: number }[] = [];
  touchMode = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly toLogical: (cx: number, cy: number) => { x: number; y: number }) {
    window.addEventListener('keydown', (e) => {
      const k = norm(e.key);
      if (['up', 'down', 'left', 'right', 'action'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(norm(e.key)));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return; // touches handled by the touch layer
      this.clicks.push(this.toLogical(e.clientX, e.clientY));
    });
    this.setupTouch();
  }

  private setupTouch() {
    const layer = document.getElementById('touch')!;
    const stick = document.getElementById('stick')!;
    const knob = document.getElementById('knob')!;
    const btn = document.getElementById('act')!;
    const enable = () => {
      if (this.touchMode) return;
      this.touchMode = true;
      layer.classList.add('on');
    };
    window.addEventListener('touchstart', enable, { passive: true });

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.touchAction = true;
      this.pressed.add('action');
      btn.classList.add('down');
    });
    const up = () => {
      this.touchAction = false;
      btn.classList.remove('down');
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);

    const R = 46;
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = stick.getBoundingClientRect();
      this.joy = { active: true, id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: 0, y: 0 };
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    const move = (e: PointerEvent) => {
      if (!this.joy.active || e.pointerId !== this.joy.id) return;
      let dx = e.clientX - this.joy.cx, dy = e.clientY - this.joy.cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.joy.x = dx / R;
      this.joy.y = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('pointermove', move);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    // taps on the canvas itself (menus, car-check buttons)
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      enable();
      this.clicks.push(this.toLogical(e.clientX, e.clientY));
    });
  }

  update() {
    let x = 0, y = 0;
    if (this.keys.has('left')) x -= 1;
    if (this.keys.has('right')) x += 1;
    if (this.keys.has('up')) y -= 1;
    if (this.keys.has('down')) y += 1;
    if (this.joy.active && Math.hypot(this.joy.x, this.joy.y) > 0.25) { x = this.joy.x; y = this.joy.y; }
    const d = Math.hypot(x, y);
    this.ax = d > 1 ? x / d : x;
    this.ay = d > 1 ? y / d : y;
  }

  get action(): boolean {
    return this.keys.has('action') || this.touchAction;
  }

  /** True once per key press. */
  took(k: string): boolean {
    const had = this.pressed.has(k);
    this.pressed.delete(k);
    return had;
  }

  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
  }
}

function norm(key: string): string {
  switch (key) {
    case 'ArrowUp': case 'w': case 'W': return 'up';
    case 'ArrowDown': case 's': case 'S': return 'down';
    case 'ArrowLeft': case 'a': case 'A': return 'left';
    case 'ArrowRight': case 'd': case 'D': return 'right';
    case ' ': case 'e': case 'E': case 'Enter': return 'action';
    case 'm': case 'M': return 'mute';
    case 'p': case 'P': case 'Escape': return 'pause';
    case '1': return 'allow';
    case '2': return 'deny';
    default: return key.toLowerCase();
  }
}
