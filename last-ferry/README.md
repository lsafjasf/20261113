# 末班渡轮 · Last Ferry

150 秒实时调度小游戏：三岛、一艘四人渡轮、八名乘客。点击岛名设下一站，
靠港后从候船名单挑人上船；载重越高船越慢、越耗油，横向海流会把船推偏。

## 运行

纯静态页面，任意 HTTP 服务器即可：

```bash
cd last-ferry
python3 -m http.server 8080
# 浏览器打开 http://127.0.0.1:8080/?seed=ferry-2026
```

## 操作

- 点击画布上的岛屿，或右侧岛名按钮，设置下一站（海上可随时改目的地）。
- 靠港后点击候船条目让乘客上船；点击船上条目可请其下船（登陆顺序自定）。
- 快捷键：`1/2/3` 选岛、`空格` 暂停、`R` 重开。
- 暂停时固定步长模拟完全停止，WebAudio 发动机声也一并挂起。

## 规则

- 胜利：150 秒内完成 8 次成功送达。
- 失败：时间耗尽，或燃油在海上耗尽。
- 候船乘客耐心归零会离港，同时在别的岛刷新一名“替代乘客”，总送达目标
  仍为 8，因此绕路补救后任务依然可完成。
- 载重 0–4 人对应 5 档船速与油耗（见 `js/config.js`）；发动机振荡频率随
  载重下降，靠港、上船、送达、离港、胜负均有合成提示音。

## Seed 与可行性保证

`js/generator.js` 严格按“先航次、后乘客”的顺序生成：

1. 用 seed 驱动确定性 RNG，先构造一条 9–12 次靠港的参考航线。
2. 沿航线派生 8 名乘客，保证每人的目的岛在其出发岛之后才被访问，且参考
    greedy 装船方案在 4 人容量约束下确实能把 8 人全部送到。
3. 用与线上完全相同的固定步长物理（`js/physics.js`）重放该航次，只有
   参考用时 ≤ 123 秒且参考油耗 ≤ 油箱 78% 的 seed 才会被接受，否则重roll。
4. 乘客耐心 = 参考接船时刻 + 26–52 秒缓冲，因此理论上不可能在可行航次
   接到他之前超时。同一 seed 每次生成结果完全一致。

`node gen-test.mjs` 批量验证 300 个 seed 全部满足上述约束。

## 目录

- `index.html` / `styles.css`：DOM 候船名单、载重与 HUD。
- `js/config.js`：岛位、速度/油耗档位、海流、预算等全部常量。
- `js/rng.js`：可播种 RNG。
- `js/physics.js`：固定步长船舶运动与海流漂移，headless 与线上共用。
- `js/generator.js`：可行航次构造、乘客派生、替代乘客。
- `js/game.js`：状态机、靠港/上下船/燃料/耐心循环、暂停。
- `js/renderer.js`：海面、浪、海流箭头、岛屿、渡轮与航线尾迹。
- `js/audio.js`：WebAudio 合成发动机与提示音。
- `js/main.js`：DOM 渲染与交互；`window.__ferry` 为自动化调试钩子。
- `tests/`：Node 单测、浏览器冒烟、燃油失败与录屏脚本。
- `recordings/`：三段录屏（见下）。

## 测试与录屏

```bash
node tests/unit.test.mjs     # 物理/油耗/可行性/确定性单测
node gen-test.mjs            # 300 个 seed 的可行性批量校验
node tests/smoke.mjs         # 浏览器内自动打完整局 + 暂停冻结校验
node tests/fuel-fail.mjs     # 燃油耗尽失败路径
node tests/record.mjs        # 重新生成 recordings/ 下的 webm
```

录屏通过 `window.__ferry.setTimeScale()` 加速虚拟时钟生成，游戏本身的
150 秒规则与物理参数不随录屏改变：

- `recordings/load-change.webm`：连续上船，载重 0→4，船速与发动机音高变化。
- `recordings/timeout-fail.webm`：原地不动直到 150 秒超时，含替代乘客与失败结算。
- `recordings/win-run.webm`：自动驾驶完整通关一局。
