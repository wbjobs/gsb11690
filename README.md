# Bézier 曲线编辑器

纯前端 Bézier 曲线编辑器，无第三方运行时依赖。

## 运行

由于 Web Worker 使用 `importScripts` 与 IndexedDB 持久化，需要通过 HTTP 提供页面（不要直接双击用 `file://` 打开）：

```bash
cd /home/wangbo/gsbProject/gsb11690/B
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

## 功能

- 控制点编辑：拖动、末尾添加（按钮 / 双击曲线）、双击空白新建、删除；删除到不足 2 点时整条曲线移除。
- 升阶：标准升阶公式，形状不变。
- 降阶：端点固定的 Bernstein 最小二乘降阶（法方程 + 部分主元高斯消元），UI 显示像素级最大偏差。
- 分割：在参数 t 处 de Casteljau 分割为两条曲线。
- 合并：
  - 精确合并——从左右控制多边形反演重建原多边形（含分割参数 t 的恢复与容差校验），分割/合并不损失形状；
  - 近似合并——端点不满足精确条件时，按弧长参数采样做最小二乘拟合，阶数自动对齐，并报告残差。
- 求值 / 切线 / 曲率：`evalFull` 返回点、切向量、切向角、速度、二阶导、（有符号）曲率与曲率半径；可视化切线与密切圆。
- 控制多边形、曲率梳（法向偏移、正负双色、按当前曲线最大曲率归一化高度）。

## 边界情况处理

- 控制点越界：控制点仍可拖到画布外，边缘绘制红色指示箭头指向真实位置；状态栏统计越界数；可选「钳制到画布」。
- 阶数过高：硬上限 48 阶；逼近上限时升阶/加按钮禁用并提示。
- 求值精度：统一使用 de Casteljau（数值稳定），自检与 Bernstein 基直接求值对比达机器精度（~1e-15）。
- 拖动性能：Pointer Events + `setPointerCapture`；拖动中使用主线程粗容差折线（降级虚线）并按 rAF 合并渲染，松手后再由 Worker 精算；命中检测复用缓存折线。
- 撤销栈：所有结构性修改与拖动均入栈，上限 60 步，支持 Ctrl+Z / Ctrl+Shift+Z。
- 折线降级：阶数 > 32、段数超预算或 Worker 不可用 / 出错时，自动切换为均匀采样折线（虚线标识），不崩溃。
- 退化输入：零速点曲率按 0 处理、曲率半径显示 ∞、t=0/1 端点切线使用端点导数。

## 技术

- Canvas 2D（devicePixelRatio 适配）
- Pointer Events（鼠标 / 触摸 / 触控笔统一）
- Web Worker（`js/worker.js`：自适应展开 + 曲率采样，版本号丢弃过期结果；失败自动主线程降级）
- IndexedDB（`js/idb.js`：文档与撤销栈自动持久化，刷新后恢复）

## 结构

- `js/bezier.js`：数学核心（求值、导数、曲率、分割、升/降阶、精确/近似合并、自适应 flatten）。
- `js/geometry.js`：点到折线距离等命中检测。
- `js/worker.js`：离屏 tessellation。
- `js/idb.js`：IndexedDB Promise 封装。
- `js/selftest.js`：12 项数学自检（页面「运行自检」按钮）。
- `js/app.js`：状态、撤销栈、交互、渲染、Worker/持久化调度。

## 快捷键

- `Ctrl/⌘+Z` 撤销，`Ctrl/⌘+Shift+Z`（或 `Ctrl+Y`）重做
- `Delete/Backspace` 删除选中点或曲线
- `+` 升阶，`-` 降阶，`S` 在 t 处分割
- 双击空白新建曲线，Shift+点击曲线体多选后合并

## 命令行自检

```bash
node -e "global.self=global;const fs=require('fs');eval(fs.readFileSync('js/bezier.js','utf8'));eval(fs.readFileSync('js/selftest.js','utf8'));for(const r of BezierSelfTest.run())console.log((r.pass?'PASS':'FAIL'),r.name);"
```
