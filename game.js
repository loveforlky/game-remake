/* =============================================================
 *  合成大作战 · 游戏逻辑
 *  纯原生 Canvas + JS，无依赖。
 *
 *  物理：PBD（位置约束求解），3 子步 × 6 次迭代；
 *        相同的方块接触即合成高一级；顶到警戒线超时判负。
 *  换图：见 assets/items/manifest.js（只改那一个文件即可）
 * ============================================================= */
(function () {
  'use strict';

  /* ===========================================================
   *  可调文案 / 主题
   * ========================================================= */
  const CONFIG = {
    title:    '合成大作战',
    subtitle: '相同的撞在一起，越合越大',
    emoji:    '✨'
  };

  /* ===========================================================
   *  常量
   * ========================================================= */
  const W = 420;              // 逻辑宽
  const H = 700;              // 逻辑高
  const WALL = 10;            // 墙厚
  const DROP_Y = 72;          // 投放高度
  const DANGER_Y = 140;       // 警戒线

  const GRAVITY      = 2600;
  const SUBSTEPS     = 3;
  const ITER         = 6;
  const DROP_MS      = 360;
  const OVER_LIMIT   = 1.5;   // 越线持续秒数
  const REST_SPEED   = 140;   // 低于它才算停住
  const REST_SPEED2  = REST_SPEED * REST_SPEED;

  const MAX_BONUS    = 500;   // 两个最大块互撞
  const FREEZE_MS    = 130;
  const REVIVE_STEP  = 2000;  // 每累计多少分发一枚复活币
  const MERGE_PAD    = 0.8;

  const RESTITUTION      = 0.38;
  const WALL_RESTITUTION = 0.45;
  const REST_THRESHOLD   = 55;
  const FRICTION         = 0.955;
  const SQUASH_DECAY     = 9;
  const SQUASH_MAX       = 0.30;

  const TAU = Math.PI * 2;
  const BUILD = '20261106e';
  const WEBP_OK = (function () {
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) {
      return false;
    }
  })();
  const BEST_KEY = 'hecheng.best.v1';
  const MUTE_KEY = 'hecheng.mute.v1';
  const LB_KEY   = 'hecheng.board.v1';
  const NAME_KEY = 'hecheng.name.v1';

  /* 11 级默认半径（原版手感），换图数量不同时自动等比重算 */
  const BASE_R   = [17, 23, 31, 39, 48, 58, 69, 81, 94, 108, 124];
  const BASE_NAME = ['星尘', '青提', '蜜桃', '柠檬', '薄荷', '晴空',
                     '葡萄', '草莓', '蜜橙', '珊瑚', '极光'];
  const PALETTE = [
    ['#c3ccff', '#5a67e8'],
    ['#c8f19a', '#6aa81f'],
    ['#ffd2c4', '#ff7d88'],
    ['#fff0a6', '#ddb200'],
    ['#a6f3da', '#20b189'],
    ['#a8dbff', '#2f88e0'],
    ['#dcc2ff', '#8a5cf0'],
    ['#ffb9cb', '#e53e63'],
    ['#ffca96', '#ee7f24'],
    ['#ffb6a0', '#d84a34'],
    ['#aef3c9', '#159a58']
  ];
  const SPAWN_WEIGHTS = [0.28, 0.24, 0.20, 0.16, 0.12];

  /* ===========================================================
   *  形象清单 -> 合成链
   * =========================================================== */
  const ASSETS = (Array.isArray(window.ITEM_ASSETS) ? window.ITEM_ASSETS : [])
    .filter((a) => a && a.file);

  let TIERS = [];

  function buildTiers() {
    const n = ASSETS.length;

    if (n === 0) {
      TIERS = BASE_R.map((r, i) => {
        const p = PALETTE[i % PALETTE.length];
        return { name: BASE_NAME[i], r, c1: p[0], c2: p[1], file: null, crop: null };
      });
      return;
    }

    if (n === BASE_R.length) {
      TIERS = BASE_R.map((r, i) => {
        const p = PALETTE[i % PALETTE.length];
        const a = ASSETS[i];
        return {
          name: (a && a.name) || BASE_NAME[i],
          r,
          c1: (a && a.c1) || p[0],
          c2: (a && a.c2) || p[1],
          file: a.file,
          fallback: (a && a.fallback) || null,
          crop: a.crop || null
        };
      });
      return;
    }

    const count = Math.max(2, n);
    const minR = BASE_R[0], maxR = BASE_R[BASE_R.length - 1];
    TIERS = [];
    for (let i = 0; i < count; i++) {
      const f = i / (count - 1);
      const r = Math.round(minR * Math.pow(maxR / minR, f));
      const p = PALETTE[i % PALETTE.length];
      const a = ASSETS[i] || ASSETS[ASSETS.length - 1] || {};
      TIERS.push({
        name: a.name || (i < BASE_NAME.length ? BASE_NAME[i] : '第 ' + (i + 1) + ' 阶'),
        r,
        c1: a.c1 || p[0],
        c2: a.c2 || p[1],
        file: a.file || null,
        fallback: a.fallback || null,
        crop: a.crop || null
      });
    }
  }

  buildTiers();

  const MAX_TIER = TIERS.length - 1;

  /* ===========================================================
   *  工具
   * ========================================================= */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function hexRgb(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }
  function shade(hex, f) {
    const [r, g, b] = hexRgb(hex);
    const m = (v) => Math.round(clamp(v * f, 0, 255));
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  }

  /* ===========================================================
   *  DOM
   * ========================================================= */
  const $ = (id) => document.getElementById(id);

  const canvas      = $('game');
  const ctx         = canvas.getContext('2d');
  const stage       = $('stage');
  const nextCanvas  = $('next');
  const nextCtx     = nextCanvas.getContext('2d');
  const chainCanvas = $('chain');
  const chainCtx    = chainCanvas.getContext('2d');

  const scoreEl     = $('score');
  const bestEl      = $('best');
  const finalScoreEl = $('finalScore');
  const finalBestEl  = $('finalBest');
  const overlayEl    = $('overlay');
  const revivePanel  = $('revivePanel');
  const overPanel    = $('overPanel');
  const reviveScoreEl = $('reviveScore');
  const reviveLeftEl  = $('reviveLeft');
  const coinChip     = $('coinChip');
  const coinCountEl  = $('coinCount');
  const resultRankEl = $('resultRank');
  const myNameLabel  = $('myNameLabel');
  const overEmojiEl  = $('overEmoji');
  const reviveEmojiEl = $('reviveEmoji');

  /* ===========================================================
   *  音效
   * =========================================================== */
  const Sound = {
    ctx: null,
    muted: lsGet(MUTE_KEY) === '1',

    ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
      return this.ctx;
    },

    tone(freq, freq2, dur, vol, type) {
      if (this.muted) return;
      const c = this.ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (freq2 && freq2 !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
      }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    merge(tier) {
      const base = 230 * Math.pow(1.118, tier * 2);
      this.tone(base, base * 1.7, 0.2, 0.15, 'sine');
      this.tone(base * 2, base * 3, 0.12, 0.055, 'triangle');
    },
    drop()  { this.tone(180, 120, 0.08, 0.05, 'sine'); },
    over()  { this.tone(420, 90, 0.7, 0.15, 'sawtooth'); },
    revive(){ this.tone(320, 640, 0.25, 0.12, 'triangle'); },
    bonus() {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => this.tone(f, f, 0.22, 0.12, 'triangle'), i * 90);
      });
    }
  };

  function haptic(ms) {
    if (Sound.muted) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
    }
  }

  /* ===========================================================
   *  画布尺寸
   * ========================================================= */
  const view = { scale: 1, dpr: 1 };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    view.dpr = dpr;
    view.scale = (rect.width * dpr) / W;
    render(0);
  }

  /* ===========================================================
   *  状态
   * ========================================================= */
  const state = {
    balls: [],
    particles: [],
    floats: [],
    score: 0,
    best: Number(lsGet(BEST_KEY) || 0) || 0,
    pending: 0,
    next: 0,
    ready: true,
    cooldown: 0,
    aimX: W / 2,
    over: false,
    danger: false,
    flash: 0,
    freeze: 0,
    revives: 0,
    reviveGiven: 0,
    recorded: false,
    lastRank: 0
  };

  /* ===========================================================
   *  物理
   * ========================================================= */
  function makeBall(x, y, tier, vx, vy) {
    const r = TIERS[tier].r;
    const m = r * r;
    return {
      x, y,
      px: x, py: y,
      vx: vx || 0, vy: vy || 0,
      pvx: 0, pvy: 0,
      r, tier,
      mass: m, invMass: 1 / m,
      angle: 0,
      bornAt: performance.now(),
      landed: false,
      overTime: 0,
      contacts: 0,
      dead: false,
      sq: 0, sqA: 0,
      popAt: 0
    };
  }

  function squash(b, nx, ny, speed) {
    const k = Math.min(SQUASH_MAX, speed / 1500);
    if (k <= b.sq) return;
    b.sq = k;
    b.sqA = Math.atan2(ny, nx);
  }

  function stepPhysics(dt) {
    const balls = state.balls;
    if (!balls.length) return;

    const merges = [];
    const contacts = [];
    const wallContacts = [];

    /* --- 积分 --- */
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;
      b.px = b.x;
      b.py = b.y;
      b.pvx = b.vx;
      b.pvy = b.vy;
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.contacts = 0;
    }

    /* --- 约束迭代 --- */
    for (let it = 0; it < ITER; it++) {

      /* 墙 / 地面 */
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (b.dead) continue;
        let hit = false;
        if (b.x - b.r < WALL) {
          b.x = WALL + b.r;
          if (it === 0) wallContacts.push([b, 1, 0]);
          hit = true;
        }
        if (b.x + b.r > W - WALL) {
          b.x = W - WALL - b.r;
          if (it === 0) wallContacts.push([b, -1, 0]);
          hit = true;
        }
        if (b.y + b.r > H - WALL) {
          b.y = H - WALL - b.r;
          if (it === 0) wallContacts.push([b, 0, -1]);
          hit = true;
        }
        if (b.y - b.r < 0) {
          b.y = b.r;
          if (it === 0) wallContacts.push([b, 0, 1]);
          hit = true;
        }
        if (hit) b.contacts++;
      }

      /* 球球 */
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.dead) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.dead || a.dead) continue;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const sum = a.r + b.r;
          const lim = sum + MERGE_PAD;
          const d2 = dx * dx + dy * dy;
          if (d2 > lim * lim) continue;

          const d = Math.sqrt(d2);

          if (a.tier === b.tier && it === 0) {
            a.dead = true;
            b.dead = true;
            merges.push([a, b]);
            continue;
          }

          if (d >= sum) continue;

          let nx, ny;
          if (d < 1e-6) { nx = 1; ny = 0; }
          else { nx = dx / d; ny = dy / d; }

          const corr = Math.min(sum - d, 8) * 0.85;
          const invSum = a.invMass + b.invMass;
          const wa = a.invMass / invSum;
          const wb = b.invMass / invSum;

          a.x -= nx * corr * wa;
          a.y -= ny * corr * wa;
          b.x += nx * corr * wb;
          b.y += ny * corr * wb;

          a.contacts++;
          b.contacts++;

          if (it === 0) contacts.push([a, b, nx, ny]);
        }
      }
    }

    /* --- 收尾墙约束：球球分离可能把方块顶出墙外，最后再夹一次 --- */
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;
      if (b.x - b.r < WALL) b.x = WALL + b.r;
      if (b.x + b.r > W - WALL) b.x = W - WALL - b.r;
      if (b.y + b.r > H - WALL) b.y = H - WALL - b.r;
      if (b.y - b.r < 0) b.y = b.r;
    }

    /* --- 由位移反推速度（PBD） --- */
    const invDt = 1 / dt;
    const now = performance.now();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;

      let vx = (b.x - b.px) * invDt;
      let vy = (b.y - b.py) * invDt;

      if (b.contacts > 0) vx *= FRICTION;   // 接触时的切向摩擦
      if (b.sq > 0) b.sq = Math.max(0, b.sq - b.sq * SQUASH_DECAY * dt);

      b.vx = vx;
      b.vy = vy;
      b.angle += (vx / b.r) * dt * 0.85;

      if (!b.landed && (b.contacts > 0 || now - b.bornAt > 900)) b.landed = true;
    }

    /* --- 弹性冲量 --- */
    for (let k = 0; k < wallContacts.length; k++) {
      const wc = wallContacts[k];
      const b = wc[0], nx = wc[1], ny = wc[2];
      if (b.dead) continue;
      const vnPre = b.pvx * nx + b.pvy * ny;
      if (vnPre < -REST_THRESHOLD) {
        const vnPost = b.vx * nx + b.vy * ny;
        const j = -WALL_RESTITUTION * vnPre - vnPost;
        if (j > 0) {
          b.vx += j * nx;
          b.vy += j * ny;
          squash(b, nx, ny, -vnPre);
        }
      }
    }

    for (let k = 0; k < contacts.length; k++) {
      const ct = contacts[k];
      const a = ct[0], b = ct[1], nx = ct[2], ny = ct[3];
      if (a.dead || b.dead) continue;

      const vnPre = (a.pvx - b.pvx) * nx + (a.pvy - b.pvy) * ny;
      if (vnPre > REST_THRESHOLD) {
        const vnPost = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const target = -RESTITUTION * vnPre;
        const j = (vnPost - target) / (a.invMass + b.invMass);
        if (j > 0) {
          a.vx -= j * a.invMass * nx;
          a.vy -= j * a.invMass * ny;
          b.vx += j * b.invMass * nx;
          b.vy += j * b.invMass * ny;
          squash(a, -nx, -ny, vnPre);
          squash(b, nx, ny, vnPre);
        }
      }
    }

    if (merges.length) processMerges(merges);
  }

  /* ===========================================================
   *  合成 / 计分
   * ========================================================= */
  function mergeScore(tier) {
    return (tier * (tier + 1)) / 2;
  }

  function processMerges(merges) {
    for (let k = 0; k < merges.length; k++) {
      const a = merges[k][0];
      const b = merges[k][1];
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const tier = a.tier;

      if (tier >= MAX_TIER) {
        /* 两个最大块 -> 一起炸掉，拿奖励分 + 复活币 */
        addScore(MAX_BONUS);
        burst(mx, my, MAX_TIER, 90, 560);
        burst(mx, my, Math.max(0, MAX_TIER - 2), 42, 340);
        Sound.bonus();
        haptic(70);
        state.flash = 1.4;
        state.freeze = FREEZE_MS / 1000;
        state.floats.push({ x: mx, y: my - 74, text: '两个' + TIERS[MAX_TIER].name + '一起炸了', life: 1.7 });
        state.floats.push({ x: mx, y: my - 16, text: '+' + MAX_BONUS, life: 2.2, big: true });
        state.revives++;
        paintCoins(true);
      } else {
        const nt = tier + 1;
        const nb = makeBall(mx, my, nt, (a.vx + b.vx) * 0.5, (a.vy + b.vy) * 0.5 - 60);
        nb.x = clamp(nb.x, WALL + nb.r, W - WALL - nb.r);
        nb.y = Math.min(nb.y, H - WALL - nb.r);
        nb.px = nb.x;
        nb.py = nb.y;
        nb.landed = true;
        nb.popAt = performance.now();
        state.balls.push(nb);

        const gain = mergeScore(nt);
        addScore(gain, mx, my, '+' + gain);
        burst(mx, my, nt, 8 + nt * 2, 140 + nt * 22);
        Sound.merge(nt);
        haptic(6 + nt);
        if (nt === MAX_TIER) state.flash = 1;
      }
    }

    const alive = [];
    for (let i = 0; i < state.balls.length; i++) {
      if (!state.balls[i].dead) alive.push(state.balls[i]);
    }
    state.balls = alive;
  }

  function burst(x, y, tier, n, speed) {
    const f = TIERS[clamp(tier, 0, MAX_TIER)];
    const c1 = f.c1, c2 = f.c2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = rand(speed * 0.25, speed);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 70,
        r: rand(2, 5.5),
        life: 1,
        decay: rand(1.3, 2.4),
        color: Math.random() < 0.5 ? c1 : c2
      });
    }
    if (state.particles.length > 420) {
      state.particles.splice(0, state.particles.length - 420);
    }
  }

  function addScore(n, x, y, text) {
    state.score += n;
    if (state.score > state.best) {
      state.best = state.score;
      try { localStorage.setItem(BEST_KEY, String(state.best)); } catch (e) { /* ignore */ }
      bestEl.textContent = state.best;
    }
    scoreEl.textContent = state.score;
    bump(scoreEl);
    if (x !== undefined) {
      state.floats.push({ x, y, text: text || ('+' + n), life: 1 });
    }
    grantRevives();
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function paintCoins(pop) {
    coinCountEl.textContent = '×' + state.revives;
    if (state.revives > 0) {
      coinChip.hidden = false;
      if (pop) {
        coinChip.classList.remove('pop');
        void coinChip.offsetWidth;
        coinChip.classList.add('pop');
      }
    } else {
      coinChip.hidden = true;
      coinChip.classList.remove('pop');
    }
  }

  function grantRevives() {
    let got = 0;
    while (state.reviveGiven < Math.floor(state.score / REVIVE_STEP)) {
      state.reviveGiven++;
      state.revives++;
      got++;
    }
    if (!got) return;
    paintCoins(true);
    state.floats.push({ x: W / 2, y: 210, text: '+1 复活币', life: 1.5, big: true });
    Sound.merge(6);
  }

  /* ===========================================================
   *  投放 / 判负 / 复活 / 重开
   * =========================================================== */
  function spawnAllowed() {
    const n = Math.max(1, Math.min(5, TIERS.length - 1));
    const w = SPAWN_WEIGHTS.slice(0, n);
    const sum = w.reduce((a, b) => a + b, 0);
    return { n, w: w.map((v) => v / sum) };
  }

  function rollSpawn() {
    const { n, w } = spawnAllowed();
    let r = Math.random(), acc = 0;
    for (let i = 0; i < n; i++) {
      acc += w[i];
      if (r <= acc) return i;
    }
    return 0;
  }

  function pickSpawn(avoid) {
    for (let i = 0; i < 6; i++) {
      const t = rollSpawn();
      if (t !== avoid) return t;
    }
    return rollSpawn();
  }

  function aimLimit(tier) {
    const r = TIERS[tier].r;
    return [WALL + r + 0.5, W - WALL - r - 0.5];
  }

  function moveAim(x) {
    const lim = aimLimit(state.pending);
    state.aimX = clamp(x, lim[0], lim[1]);
  }

  function tryDrop() {
    if (state.over || !state.ready) return;
    const tier = state.pending;
    const x = clamp(state.aimX, ...aimLimit(tier));

    state.balls.push(makeBall(x, DROP_Y, tier, 0, 130));

    state.ready = false;
    state.cooldown = DROP_MS / 1000;
    state.pending = state.next;
    state.next = pickSpawn(state.pending);

    Sound.drop();
    drawNext();

    if (state.balls.length > 90) {
      state.balls = state.balls.filter((b) => !b.dead);
    }
  }

  function checkGameOver(dt) {
    let danger = false;
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      if (b.dead || !b.landed) continue;
      const top = b.y - b.r;

      if (top < DANGER_Y) {
        danger = true;
        if (b.vx * b.vx + b.vy * b.vy < REST_SPEED2) {
          b.overTime += dt;
          if (b.overTime > OVER_LIMIT) { gameOver(); return; }
        } else {
          b.overTime = Math.max(0, b.overTime - dt * 2);
        }
      } else {
        b.overTime = Math.max(0, b.overTime - dt * 2);
        if (b.overTime > 0) danger = true;
      }
    }
    state.danger = danger;
  }

  function gameOver() {
    if (state.over) return;
    state.over = true;
    state.danger = true;
    finalScoreEl.textContent = state.score;
    finalBestEl.textContent = state.best;
    Sound.over();
    if (state.revives > 0) {
      askRevive();
    } else {
      settle();
    }
  }

  function askRevive() {
    reviveScoreEl.textContent = state.score;
    reviveLeftEl.textContent = '还剩 ' + state.revives + ' 枚';
    revivePanel.hidden = false;
    overPanel.hidden = true;
    overlayEl.classList.add('show');
  }

  function revive() {
    if (!state.over || state.revives <= 0) return false;

    let top = -1;
    let topEdge = Infinity;
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      if (b.dead) continue;
      const edge = b.y - b.r;
      if (edge < topEdge) { topEdge = edge; top = i; }
    }
    if (top >= 0) state.balls.splice(top, 1);

    state.balls = state.balls.filter(
      (b) => !b.dead && (b.y - b.r) >= DANGER_Y + 6
    );

    for (let i = 0; i < state.balls.length; i++) state.balls[i].overTime = 0;

    state.revives--;
    state.over = false;
    state.danger = false;
    state.ready = true;
    state.cooldown = 0;
    state.flash = 0.6;

    revivePanel.hidden = true;
    overlayEl.classList.remove('show');
    paintCoins(false);
    Sound.revive();
    return true;
  }

  function settle() {
    revivePanel.hidden = true;
    overPanel.hidden = false;
    overlayEl.classList.add('show');

    const rank = recordScore(state.score);
    if (state.score <= 0) {
      resultRankEl.textContent = '本局 0 分，再来一次吧';
    } else if (rank > 0) {
      resultRankEl.textContent = '本局排第 ' + rank + ' 名 · 已存到本地榜';
    } else {
      resultRankEl.textContent = '差一点就进前 20 了';
    }
    myNameLabel.textContent = getName();
    paintDialogArt();
  }

  function reset() {
    state.balls.length = 0;
    state.particles.length = 0;
    state.floats.length = 0;
    state.score = 0;
    state.over = false;
    state.danger = false;
    state.ready = true;
    state.cooldown = 0;
    state.flash = 0;
    state.freeze = 0;
    state.aimX = W / 2;
    state.revives = 0;
    state.reviveGiven = 0;
    state.recorded = false;
    state.lastRank = 0;

    state.pending = pickSpawn();
    state.next = pickSpawn(state.pending);

    overlayEl.classList.remove('show');
    revivePanel.hidden = true;
    overPanel.hidden = false;
    paintCoins(false);

    scoreEl.textContent = '0';
    bestEl.textContent = state.best;
    resultRankEl.textContent = '正在记账…';

    drawNext();
    drawChain();
    paintDialogArt();
    Sound.ensure();
  }

  /* ===========================================================
   *  绘制
   * ========================================================= */
  function drawItem(c, x, y, r, tier, angle, scale, squashShape) {
    const it = TIERS[tier];
    const s = scale === undefined ? 1 : scale;

    c.save();
    c.translate(x, y);

    if (squashShape && squashShape.k > 0.004) {
      c.rotate(squashShape.a);
      c.scale(1 - squashShape.k, 1 + squashShape.k * 0.85);
      c.rotate(-squashShape.a);
    }
    if (s !== 1) c.scale(s, s);
    c.rotate(angle || 0);

    if (it.img) {
      drawImageItem(c, it, r);
    } else {
      drawOrb(c, it, r);
    }
    c.restore();
  }

  function drawImageItem(c, it, r) {
    const img = it.img;
    if (!img) return;

    if (it.crop === 'faceball') {
      /* 透明大头贴：先画一个可见的圆底，再让脸铺在圆里。
         这样碰撞圆就是肉眼看到的球边界，不会“隔空撞”。 */
      c.save();
      c.shadowColor = 'rgba(120, 80, 40, .28)';
      c.shadowBlur = Math.max(5, r * 0.20);
      c.shadowOffsetY = Math.max(1, r * 0.07);
      const disc = c.createRadialGradient(-r * 0.30, -r * 0.36, r * 0.10, 0, 0, r * 1.02);
      disc.addColorStop(0, 'rgba(255, 253, 247, .96)');
      disc.addColorStop(0.72, 'rgba(255, 244, 228, .90)');
      disc.addColorStop(1, 'rgba(255, 226, 190, .86)');
      c.beginPath();
      c.arc(0, 0, r * 0.99, 0, TAU);
      c.fillStyle = disc;
      c.fill();
      c.restore();

      c.save();
      c.beginPath();
      c.arc(0, 0, r * 0.99, 0, TAU);
      c.clip();
      c.drawImage(img, -r, -r, r * 2, r * 2);
      c.restore();

      c.lineWidth = Math.max(1.2, r * 0.035);
      c.strokeStyle = 'rgba(255, 255, 255, .82)';
      c.beginPath();
      c.arc(0, 0, r - c.lineWidth * 0.5, 0, TAU);
      c.stroke();
      return;
    }

    if (it.crop === 'circle') {
      /* 内嵌 JPEG / 方形照片：裁成圆再画，脸占满整个球 */
      c.save();
      c.beginPath();
      c.arc(0, 0, r * 0.995, 0, TAU);
      c.clip();
      c.drawImage(img, -r, -r, r * 2, r * 2);
      c.restore();

      /* 一圈淡描边，让球边缘更清晰 */
      c.lineWidth = Math.max(1.2, r * 0.03);
      c.strokeStyle = 'rgba(90, 60, 30, .16)';
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.stroke();
      return;
    }

    /* 透明大头贴：直接画脸，加一点投影，不画空心圆环 */
    c.save();
    c.shadowColor = 'rgba(120, 80, 40, .30)';
    c.shadowBlur = Math.max(4, r * 0.18);
    c.shadowOffsetY = Math.max(1, r * 0.06);
    c.drawImage(img, -r, -r, r * 2, r * 2);
    c.restore();
  }

  function drawOrb(c, it, r) {
    const g = c.createRadialGradient(-r * 0.36, -r * 0.44, r * 0.06, 0, 0, r * 1.12);
    g.addColorStop(0, it.c1);
    g.addColorStop(0.55, it.c2);
    g.addColorStop(1, shade(it.c2, 0.78));

    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    c.fillStyle = g;
    c.fill();

    /* 底部反光 */
    c.save();
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    c.clip();
    const bg = c.createRadialGradient(0, r * 0.82, r * 0.04, 0, r * 0.7, r * 0.85);
    bg.addColorStop(0, 'rgba(255,255,255,.30)');
    bg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = bg;
    c.fillRect(-r, 0, r * 2, r);
    c.restore();

    /* 描边 */
    c.lineWidth = Math.max(1.4, r * 0.05);
    c.strokeStyle = 'rgba(255,255,255,.5)';
    c.beginPath();
    c.arc(0, 0, r - c.lineWidth * 0.5, 0, TAU);
    c.stroke();

    /* 高光 */
    c.beginPath();
    c.ellipse(-r * 0.35, -r * 0.42, r * 0.28, r * 0.17, -0.7, 0, TAU);
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.fill();

    /* 表情 */
    if (r >= 22) {
      const eyeR = r * 0.12;
      const eyeX = r * 0.31;
      const eyeY = -r * 0.04;

      c.fillStyle = 'rgba(52,36,28,.86)';
      c.beginPath(); c.arc(-eyeX, eyeY, eyeR, 0, TAU); c.fill();
      c.beginPath(); c.arc(eyeX, eyeY, eyeR, 0, TAU); c.fill();

      c.fillStyle = 'rgba(255,255,255,.92)';
      c.beginPath(); c.arc(-eyeX - eyeR * 0.28, eyeY - eyeR * 0.32, eyeR * 0.32, 0, TAU); c.fill();
      c.beginPath(); c.arc(eyeX - eyeR * 0.28, eyeY - eyeR * 0.32, eyeR * 0.32, 0, TAU); c.fill();

      c.beginPath();
      c.arc(0, r * 0.08, r * 0.18, 0.18 * Math.PI, 0.82 * Math.PI);
      c.lineWidth = Math.max(1.1, r * 0.05);
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(52,36,28,.68)';
      c.stroke();

      c.fillStyle = 'rgba(255,120,120,.26)';
      c.beginPath(); c.ellipse(-r * 0.55, r * 0.16, r * 0.15, r * 0.1, 0, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(r * 0.55, r * 0.16, r * 0.15, r * 0.1, 0, 0, TAU); c.fill();
    } else if (r >= 13) {
      c.fillStyle = 'rgba(52,36,28,.82)';
      c.beginPath(); c.arc(-r * 0.28, -r * 0.04, r * 0.11, 0, TAU); c.fill();
      c.beginPath(); c.arc(r * 0.28, -r * 0.04, r * 0.11, 0, TAU); c.fill();
    }
  }

  function drawBoard() {
    /* 左右内壁 */
    const wallG = ctx.createLinearGradient(0, 0, WALL, 0);
    wallG.addColorStop(0, 'rgba(255,255,255,.6)');
    wallG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wallG;
    ctx.fillRect(0, 0, WALL, H);

    const wallG2 = ctx.createLinearGradient(W, 0, W - WALL, 0);
    wallG2.addColorStop(0, 'rgba(255,255,255,.6)');
    wallG2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wallG2;
    ctx.fillRect(W - WALL, 0, WALL, H);

    ctx.strokeStyle = 'rgba(196,150,100,.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(WALL, 0);
    ctx.lineTo(WALL, H - WALL);
    ctx.lineTo(W - WALL, H - WALL);
    ctx.lineTo(W - WALL, 0);
    ctx.stroke();

    /* 地面柔光 */
    const floor = ctx.createLinearGradient(0, H - 90, 0, H);
    floor.addColorStop(0, 'rgba(210,155,95,0)');
    floor.addColorStop(1, 'rgba(210,155,95,.16)');
    ctx.fillStyle = floor;
    ctx.fillRect(WALL, H - 90, W - WALL * 2, 90);

    /* 警戒线 */
    const danger = state.danger;
    ctx.save();
    ctx.setLineDash([9, 9]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = danger
      ? 'rgba(255,72,72,' + (0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 140))) + ')'
      : 'rgba(226,152,120,.42)';
    ctx.beginPath();
    ctx.moveTo(WALL, DANGER_Y);
    ctx.lineTo(W - WALL, DANGER_Y);
    ctx.stroke();
    ctx.restore();
  }

  function drawBalls() {
    const now = performance.now();
    const sorted = state.balls.slice().sort((a, b) => a.r - b.r);

    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      if (b.dead) continue;

      /* 地面投影 */
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = '#7a4a1e';
      ctx.beginPath();
      ctx.ellipse(b.x, H - WALL - 1, b.r * 0.82, Math.max(3, b.r * 0.16), 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      let scale = 1;
      if (b.popAt) {
        const t = (now - b.popAt) / 220;
        if (t < 1) scale = 1 + 0.26 * (1 - t);
        else b.popAt = 0;
      }

      const shape = b.sq > 0.004 ? { a: b.sqA, k: b.sq } : null;
      drawItem(ctx, b.x, b.y, b.r, b.tier, b.angle, scale, shape);
    }
  }

  function drawAim() {
    if (state.over) return;
    const tier = state.pending;
    const it = TIERS[tier];
    const r = it.r;
    const lim = aimLimit(tier);
    const x = clamp(state.aimX, lim[0], lim[1]);
    const bob = Math.sin(performance.now() / 320) * 2.5;

    if (state.ready) {
      ctx.save();
      ctx.setLineDash([5, 8]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(196,136,88,.42)';
      ctx.beginPath();
      ctx.moveTo(x, DROP_Y + r + 4);
      ctx.lineTo(x, H - WALL);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = it.c2;
      ctx.beginPath();
      ctx.ellipse(x, H - WALL - 2, r * 0.8, Math.max(3, r * 0.16), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (!state.ready) ctx.globalAlpha = 0.4;
    drawItem(ctx, x, DROP_Y + bob, r, tier, 0, 1, null);
    ctx.restore();
  }

  function drawTopPreview() {
    const tier = state.next;
    const r = 15;
    const x = W - WALL - 32;
    const y = 34;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r + 5.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();

    ctx.font = '600 10.5px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(150,110,80,.82)';
    ctx.fillText('下一个', x - r - 12, y);
    ctx.restore();

    drawItem(ctx, x, y, r, tier, 0, 1, null);
  }

  function drawEffects(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.vy += 1400 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.99;
      p.life -= p.decay * dt;
      if (p.life <= 0) { state.particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    for (let i = state.floats.length - 1; i >= 0; i--) {
      const f = state.floats[i];
      const big = !!f.big;
      f.y -= (big ? 24 : 46) * dt;
      f.life -= dt * (big ? 0.55 : 1.05);
      if (f.life <= 0) { state.floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, f.life * 1.4);
      ctx.font = big
        ? '900 34px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
        : '700 19px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.lineWidth = big ? 8 : 4;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = big ? '#e8342f' : '#f4623a';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    drawTopPreview();
  }

  function render(dt) {
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawBoard();
    drawBalls();
    drawAim();
    drawEffects(state.freeze > 0 ? 0 : dt);

    if (state.flash > 0) {
      ctx.save();
      ctx.globalAlpha = state.flash * 0.32;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function drawNext() {
    const w = nextCanvas.width, h = nextCanvas.height;
    nextCtx.setTransform(1, 0, 0, 1, 0, 0);
    nextCtx.clearRect(0, 0, w, h);
    const tier = state.next;
    const it = TIERS[tier];
    const r = it.r;
    const k = (Math.min(w, h) * 0.40) / r;
    drawItem(nextCtx, w / 2, h / 2, r * k, tier, 0, 1, null);
  }

  function drawChain() {
    const cw = chainCanvas.width, ch = chainCanvas.height;
    chainCtx.setTransform(1, 0, 0, 1, 0, 0);
    chainCtx.clearRect(0, 0, cw, ch);

    const slot = cw / TIERS.length;
    const r = Math.min(slot * 0.34, ch * 0.36);
    const cy = ch * 0.52;

    for (let i = 0; i < TIERS.length; i++) {
      const x = slot * (i + 0.5);
      drawItem(chainCtx, x, cy, r, i, 0, 1, null);
      if (i < TIERS.length - 1) {
        chainCtx.save();
        chainCtx.globalAlpha = 0.4;
        chainCtx.fillStyle = '#b08a68';
        chainCtx.font = '600 ' + Math.round(ch * 0.18) + 'px system-ui, sans-serif';
        chainCtx.textAlign = 'center';
        chainCtx.textBaseline = 'middle';
        chainCtx.fillText('›', x + slot * 0.5, cy);
        chainCtx.restore();
      }
    }
  }

  /* ===========================================================
   *  素材加载
   * ========================================================= */
  function inspectImage(it, img) {
    let hasAlpha = false;
    let box = null;

    try {
      const S = 96;
      const cv = document.createElement('canvas');
      cv.width = S;
      cv.height = S;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      c2.drawImage(img, 0, 0, S, S);
      const data = c2.getImageData(0, 0, S, S).data;

      let minX = S, minY = S, maxX = -1, maxY = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const a = data[(y * S + x) * 4 + 3];
          if (a > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          if ((x < 1 || y < 1 || x > S - 2 || y > S - 2) && a < 200) hasAlpha = true;
        }
      }

      if (maxX >= 0) {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        box = {
          x: (minX / S) * iw,
          y: (minY / S) * ih,
          w: ((maxX - minX + 1) / S) * iw,
          h: ((maxY - minY + 1) / S) * ih
        };
      }
    } catch (e) {
      /* file:// 或跨域时读不到像素，按清单给的 crop 走 */
    }

    if (!it.crop) it.crop = hasAlpha ? 'none' : 'circle';
    if (it.crop === 'none' && box) it.trim = box;
  }

  function withBuild(url) {
    if (!url) return url;
    if (url.indexOf('data:') === 0) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + BUILD;
  }

  function loadAssets() {
    let pending = 0;

    TIERS.forEach((it) => {
      if (!it.file) {
        it.img = null;
        return;
      }
      pending++;

      const tried = [];
      function attempt(url) {
        tried.push(url);
        const img = new Image();
        img.decoding = 'async';

        img.onload = () => {
          it.img = img;
          it.src = withBuild(url);
          inspectImage(it, img);
          if (--pending === 0) refreshAll();
        };

        img.onerror = () => {
          /* 先试另一种格式（WebP 不被支持时用 PNG），再试同格式的另一个地址 */
          const next = [it.file, it.fallback].filter(
            (u) => u && tried.indexOf(u) < 0
          )[0];
          if (next) {
            attempt(next);
            return;
          }
          it.img = null;
          if (window.console) {
            console.warn('[hecheng] 图片载入失败，已用占位形象：' + url);
          }
          if (--pending === 0) refreshAll();
        };

        img.src = withBuild(url);
      }

      attempt((!WEBP_OK && it.fallback) ? it.fallback : it.file);
    });

    if (window.console) {
      console.log('[hecheng] build ' + BUILD + ' · assets ' + ASSETS.length +
        ' · webp ' + (WEBP_OK ? 'yes' : 'no'));
    }
    return pending;
  }

  function refreshAll() {
    drawNext();
    drawChain();
    paintDialogArt();
  }

  function paintDialogArt() {
    const top = TIERS[MAX_TIER];
    if (top && top.src) {
      overEmojiEl.innerHTML = '<img src="' + top.src + '" alt="">';
      if (reviveEmojiEl) reviveEmojiEl.textContent = '💫';
      const icon = document.querySelector('link[rel="icon"]');
      if (icon && top.src.indexOf('data:') !== 0) icon.href = top.src;
    } else {
      overEmojiEl.textContent = CONFIG.emoji;
    }
  }

  /* ===========================================================
   *  本地排行榜
   * ========================================================= */
  function getName() {
    let n = '';
    try { n = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* ignore */ }
    n = (n || '').trim().slice(0, 12);
    return n || '匿名玩家';
  }

  function setName(n) {
    n = (n || '').trim().slice(0, 12);
    try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ }
    myNameLabel.textContent = n || '匿名玩家';
  }

  function readBoard() {
    try {
      const v = JSON.parse(localStorage.getItem(LB_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => x && typeof x.score === 'number') : [];
    } catch (e) {
      return [];
    }
  }

  function writeBoard(list) {
    try { localStorage.setItem(LB_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function recordScore(score) {
    if (state.recorded) return state.lastRank;
    state.recorded = true;
    if (score <= 0) return 0;

    const entry = { name: getName(), score, ts: Date.now() };
    const list = readBoard();
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.ts - b.ts);
    const top = list.slice(0, 20);
    writeBoard(top);
    const idx = top.indexOf(entry);
    state.lastRank = idx >= 0 ? idx + 1 : 0;
    lastEntryTs = entry.ts;
    return state.lastRank;
  }

  let lastEntryTs = 0;

  function renderBoard() {
    const list = readBoard();
    boardList.innerHTML = '';

    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'board-empty';
      p.textContent = '还没有人上榜。玩一局，把成绩留在这里。';
      boardList.appendChild(p);
      return;
    }

    list.forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'board-row' + (i < 3 ? ' r' + (i + 1) : '') +
        (row.ts && row.ts === lastEntryTs ? ' is-mine' : '');

      const rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1);

      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = row.name || '匿名玩家';

      const score = document.createElement('span');
      score.className = 'board-score';
      score.textContent = row.score;

      div.appendChild(rank);
      div.appendChild(name);
      div.appendChild(score);
      boardList.appendChild(div);
    });
  }

  const boardModal = $('boardModal');
  const boardList = $('boardList');
  const nickInput = $('nickInput');

  function openBoard(focusName) {
    nickInput.value = getName() === '匿名玩家' ? '' : getName();
    renderBoard();
    boardModal.classList.add('show');
    boardModal.setAttribute('aria-hidden', 'false');
    if (focusName) setTimeout(() => nickInput.focus(), 80);
  }

  function closeBoard() {
    boardModal.classList.remove('show');
    boardModal.setAttribute('aria-hidden', 'true');
  }

  /* ===========================================================
   *  主循环
   * ========================================================= */
  let last = performance.now();
  let acc = 0;
  const FIXED = 1 / 60;

  function update(dt) {
    if (state.freeze > 0) {
      state.freeze = Math.max(0, state.freeze - dt);
      return;
    }
    if (state.over) return;

    if (!state.ready) {
      state.cooldown -= dt;
      if (state.cooldown <= 0) state.ready = true;
    }

    const sub = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) stepPhysics(sub);

    checkGameOver(dt);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.2);
  }

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;

    let guard = 0;
    while (acc >= FIXED && guard < 5) {
      update(FIXED);
      acc -= FIXED;
      guard++;
    }
    if (guard >= 5) acc = 0;

    render(dt);
    requestAnimationFrame(frame);
  }

  /* ===========================================================
   *  输入 / 按钮
   * ========================================================= */
  function pointerToX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (W / rect.width);
  }

  let touchAiming = false;

  stage.addEventListener('pointermove', (e) => {
    if (state.over) return;
    if (e.pointerType === 'touch' && !touchAiming) return;
    moveAim(pointerToX(e.clientX));
  });

  stage.addEventListener('pointerdown', (e) => {
    if (state.over) return;
    Sound.ensure();
    moveAim(pointerToX(e.clientX));
    if (e.pointerType === 'touch') {
      touchAiming = true;
      if (stage.setPointerCapture) {
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    } else {
      tryDrop();
    }
  });

  stage.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!touchAiming) return;
    touchAiming = false;
    if (state.over) return;
    moveAim(pointerToX(e.clientX));
    tryDrop();
  });

  stage.addEventListener('pointercancel', () => { touchAiming = false; });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable === true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.key === 'Escape') {
      closeBoard();
      return;
    }
    if (isTyping(e)) return;

    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      state.aimX = clamp(state.aimX - 14, WALL, W);
      moveAim(state.aimX);
      e.preventDefault();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      state.aimX = clamp(state.aimX + 14, WALL, W);
      moveAim(state.aimX);
      e.preventDefault();
    } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') {
      if (!state.over) { tryDrop(); e.preventDefault(); }
    } else if (e.code === 'KeyR') {
      reset();
      e.preventDefault();
    }
  });

  function paintSoundBtn() {
    const btn = $('soundBtn');
    const ico = btn.querySelector('.ico');
    const lbl = btn.querySelector('.lbl');
    if (ico) ico.textContent = Sound.muted ? '🔇' : '🔊';
    if (lbl) lbl.textContent = Sound.muted ? '音效关' : '音效开';
    btn.setAttribute('aria-pressed', String(!Sound.muted));
  }

  $('soundBtn').addEventListener('click', () => {
    Sound.muted = !Sound.muted;
    try { localStorage.setItem(MUTE_KEY, Sound.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    paintSoundBtn();
    if (!Sound.muted) Sound.merge(1);
  });

  $('resetBtn').addEventListener('click', reset);
  $('restartBtn').addEventListener('click', reset);
  $('reviveBtn').addEventListener('click', revive);
  $('giveUpBtn').addEventListener('click', settle);

  $('boardBtn').addEventListener('click', () => openBoard(false));
  $('boardBtn2').addEventListener('click', () => openBoard(false));
  $('boardClose').addEventListener('click', closeBoard);
  $('boardRefresh').addEventListener('click', renderBoard);

  $('editNameBtn').addEventListener('click', () => openBoard(true));

  boardModal.addEventListener('click', (e) => {
    if (e.target === boardModal) closeBoard();
  });

  nickInput.addEventListener('change', () => setName(nickInput.value));
  nickInput.addEventListener('blur', () => setName(nickInput.value));

  /* ===========================================================
   *  启动
   * ========================================================= */
  function boot() {
    /* 文案 */
    $('gameTitle').textContent = CONFIG.title;
    $('gameSubtitle').textContent = CONFIG.subtitle;
    document.title = CONFIG.title;
    const buildTag = $('buildTag');
    if (buildTag) buildTag.textContent = 'v' + BUILD;
    $('chainCount').textContent = TIERS.length + ' 级';
    $('chainNote').innerHTML = '✨ 两个' + TIERS[MAX_TIER].name +
      '撞在一起会一起炸掉，换 <strong>' + MAX_BONUS + ' 分</strong> + <strong>一枚复活币</strong>';
    $('tips').innerHTML =
      '鼠标：移动瞄准、点击投放；触屏：拖动瞄准、松手投放。<br>' +
      '← → 微调，空格投放，R 重开。<br>' +
      '每 <strong>' + REVIVE_STEP + ' 分</strong>攒一枚<strong>复活币</strong>，只在本局有效。';

    resizeCanvas();
    if (window.ResizeObserver) {
      new ResizeObserver(resizeCanvas).observe(stage);
    }
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));

    paintSoundBtn();
    bestEl.textContent = state.best;

    drawChain();
    reset();
    loadAssets();

    requestAnimationFrame((t) => {
      last = t;
      requestAnimationFrame(frame);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* 调试句柄 */
  window.__MERGE__ = {
    state, reset, revive, settle, gameOver, tryDrop, stepPhysics, update,
    TIERS, render, drawNext, drawChain, resizeCanvas, makeBall, addScore,
    MAX_BONUS, REVIVE_STEP, recordScore
  };
})();
