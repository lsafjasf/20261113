// 无头测试:抽取 index.html 内联脚本,在 Node 中验证地图生成与游戏逻辑
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到内联脚本'); process.exit(1); }

// ---- 浏览器环境桩 ----
function makeCtx() {
  const any = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any),
    apply: () => any,
    set: () => true,
  });
  return any;
}
function makeEl() {
  const el = {
    style: {}, textContent: '', innerHTML: '', value: '20261113',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, getContext: () => makeCtx(),
    width: 864, height: 720,
  };
  return el;
}
const rafQueue = [];
const sandbox = {
  console, Math, JSON, Set, Map, Uint8Array, Array, Object, Number, String, isFinite,
  performance: { now: () => simTime },
  requestAnimationFrame: cb => { rafQueue.push(cb); return rafQueue.length; },
  document: {
    getElementById: () => makeEl(),
    addEventListener() {}, createElement: () => makeEl(),
  },
  AudioContext: function () {
    const node = () => ({ connect() {}, start() {}, stop() {}, gain: { value: 0, setTargetAtTime() {} },
      frequency: { value: 0 }, type: '', buffer: null, loop: false });
    return { createOscillator: node, createGain: node, createBiquadFilter: node,
      createBufferSource: node, createBuffer: () => ({ getChannelData: () => new Float32Array(1) }),
      destination: {}, currentTime: 0, state: 'running', resume() {} };
  },
};
let simTime = 0;
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: 'index.html<script>' });

// const/let 不挂到全局对象,统一从上下文里取值
const G = vm.runInContext(
  '({ GW, GH, T_DEEP, T_SHALLOW, T_ISLAND, T_REEF, generateMap, mulberry32, hashSeed })',
  sandbox);
let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) failures++;
}

// ================= 地图生成测试 =================
console.log('== 地图生成 ==');
const GW = G.GW, GH = G.GH;
function passable(v) { return v === G.T_DEEP || v === G.T_SHALLOW; }
function reachableCount(map, sx, sy) {
  const seen = new Uint8Array(GW * GH);
  const q = [[sx, sy]]; seen[sy * GW + sx] = 1;
  let n = 0;
  while (q.length) {
    const [x, y] = q.pop(); n++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < GW && ny < GH && !seen[ny * GW + nx] &&
          passable(map.grid[ny * GW + nx])) { seen[ny * GW + nx] = 1; q.push([nx, ny]); }
    }
  }
  return { n, seen };
}

const seeds = ['20261113', 'hello', '1', '逆潮', '999983', 'abc123', '0', 'x'];
let allOk = true;
for (const s of seeds) {
  const a = G.generateMap(s), b = G.generateMap(s);
  const same = Buffer.from(a.grid).equals(Buffer.from(b.grid)) &&
    JSON.stringify(a.buoys) === JSON.stringify(b.buoys) &&
    JSON.stringify(a.currents) === JSON.stringify(b.currents);
  const { seen } = reachableCount(a, a.dock.x, a.dock.y);
  const conn = a.buoys.every(bb => seen[bb.y * GW + bb.x]);
  const buoyOnWater = a.buoys.every(bb => passable(a.grid[bb.y * GW + bb.x]));
  const dockOnWater = passable(a.grid[a.dock.y * GW + a.dock.x]);
  if (!(same && conn && buoyOnWater && dockOnWater)) allOk = false;
  console.log(`  seed=${s}: 确定=${same} 连通=${conn} 浮标在水中=${buoyOnWater} 码头在水中=${dockOnWater}`);
}
check('8 个种子全部:确定性 + 连通 + 实体在水中', allOk);

const c = G.generateMap('20261113');
const counts = [0, 0, 0, 0];
for (const v of c.grid) counts[v]++;
console.log(`  地形统计 深水=${counts[0]} 浅滩=${counts[1]} 岛屿=${counts[2]} 礁石=${counts[3]} 洋流区=${c.currents.length}`);
check('有岛屿且不过量(5%~40%)', counts[2] > GW * GH * 0.03 && counts[2] < GW * GH * 0.4);
check('有礁石', counts[3] >= 8);
check('有浅滩', counts[1] > 10);
check('有 3 座浮标 + 码头', c.buoys.length === 3 && !!c.dock);
check('有洋流区', c.currents.length >= 3);

// ================= 船体物理与流程测试 =================
console.log('== 船体物理与游戏流程 ==');
const game = sandbox.window.__game;
const st = game.state;
const DT = 1 / 60;
function steps(n) { for (let i = 0; i < n; i++) game.tick(DT); }

game.newGame('20261113');
check('新游戏进入 playing', st.mode === 'playing');
check('初始 3 封信 / 满耐久', st.mail === 3 && st.hull === 100);

// 找一段向东开阔的水域用于航行测试
function openWater() {
  for (let y = 2; y < G.GH - 2; y++) for (let x = 2; x < G.GW - 12; x++) {
    let ok = true;
    for (let dx = 0; dx < 10 && ok; dx++)
      if (!passable(st.map.grid[y * G.GW + x + dx])) ok = false;
    if (ok) return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}
const ow = openWater();
st.ship.x = ow.x; st.ship.y = ow.y; st.ship.heading = 0;

// 升帆 + 前进
game.toggleSail(); game.toggleSail(); game.toggleSail();
check('帆升到 3 级', st.ship.sail === 3);
game.press('ArrowUp');
steps(120);
const sp1 = Math.hypot(st.ship.vx, st.ship.vy);
check('满帆顶风/顺风 2 秒后航速 > 1.5 格/秒', sp1 > 1.5);
const x0 = st.ship.x, y0 = st.ship.y;
steps(60);
check('船在移动(位置改变)', Math.hypot(st.ship.x - x0, st.ship.y - y0) > 0.5);

// 惯性:松开前进后仍滑行
game.release('ArrowUp');
const spBefore = Math.hypot(st.ship.vx, st.ship.vy);
steps(10);
const spAfter = Math.hypot(st.ship.vx, st.ship.vy);
check('松开后因惯性仍滑行', spAfter > 0.15 && spAfter < spBefore);

// 转向惯性
const h0 = st.ship.heading;
game.press('ArrowLeft'); steps(20); game.release('ArrowLeft');
check('左转改变航向', st.ship.heading < h0 - 0.1);
const av1 = Math.abs(st.ship.av);
steps(30);
check('转向角速度有阻尼衰减', Math.abs(st.ship.av) < av1);

// 风随时间变化
const w0 = st.wind.angle;
steps(600);
check('风向随时间缓慢变化', Math.abs(st.wind.angle - w0) > 0.05);

// 洋流推动
const zone = st.map.currents[0];
st.ship.x = zone.x + zone.w / 2; st.ship.y = zone.y + zone.h / 2;
st.ship.vx = 0; st.ship.vy = 0;
steps(30);
check('洋流区持续推动船体', Math.hypot(st.ship.vx, st.ship.vy) > 0.05);

// 碰撞扣耐久并反弹
let isl = null;
for (let y = 0; y < G.GH && !isl; y++) for (let x = 0; x < G.GW; x++)
  if (st.map.grid[y * G.GW + x] === G.T_ISLAND) { isl = { x, y }; break; }
st.ship.x = isl.x - 0.6; st.ship.y = isl.y + 0.5;
st.ship.vx = 4; st.ship.vy = 0; st.ship.sail = 2;
const hullBefore = st.hull;
steps(5);
check('撞岛扣耐久', st.hull < hullBefore);
check('碰撞后反弹(速度向左)', st.ship.vx < 0);
const hullAfter1 = st.hull;
steps(3);
check('碰撞有无敌冷却(不连续扣血)', st.hull === hullAfter1);

// 帆越高受损越重
game.newGame('20261113');
st.ship.x = isl.x - 0.6; st.ship.y = isl.y + 0.5; st.ship.vx = 4; st.ship.sail = 0;
steps(5); const dmgSail0 = 100 - st.hull;
game.newGame('20261113');
st.ship.x = isl.x - 0.6; st.ship.y = isl.y + 0.5; st.ship.vx = 4; st.ship.sail = 3;
steps(5); const dmgSail3 = 100 - st.hull;
check(`高帆碰撞更伤 (${dmgSail0.toFixed(1)} < ${dmgSail3.toFixed(1)})`, dmgSail3 > dmgSail0);

// 暂停
game.newGame('20261113');
game.togglePause();
const px = st.ship.x;
steps(30);
check('暂停时世界冻结', st.mode === 'paused' && st.ship.x === px);
game.togglePause();
check('恢复后继续', st.mode === 'playing');

// 投递 → 全部送达 → 回码头获胜
game.newGame('20261113');
st.map.buoys.forEach((b, i) => {
  st.ship.x = b.x + 0.5; st.ship.y = b.y + 0.5; st.ship.vx = st.ship.vy = 0;
  game.tryDeliver();
  check(`浮标 ${i + 1} 投递成功`, st.delivered[i] === true);
});
check('信件送完', st.mail === 0);
st.ship.x = st.map.dock.x + 0.5; st.ship.y = st.map.dock.y + 0.5;
steps(2);
check('返回码头获胜', st.mode === 'won');

// 时间耗尽失败
game.newGame('20261113');
st.timeLeft = 0.05;
steps(10);
check('超时失败', st.mode === 'lost');

// 耐久归零失败
game.newGame('20261113');
st.hull = 1;
st.ship.x = isl.x - 0.6; st.ship.y = isl.y + 0.5; st.ship.vx = 5; st.ship.sail = 3;
steps(5);
check('耐久归零失败', st.mode === 'lost' && st.hull === 0);

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
