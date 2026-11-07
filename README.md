# 合成大作战 · 复刻版

一个纯前端、无依赖的「合成」小游戏：相同的形象撞在一起合成更大的一个，顶到警戒线超时判负。玩法复刻自常见的合成水果游戏，**所有形象都可以整套换成自己的图片**。

- 纯 HTML + CSS + Canvas，无构建步骤、无外部请求
- 桌面 / 手机竖屏 / 手机横屏都做了布局
- 成绩、昵称、排行榜全部存在本机浏览器
- 音效由 WebAudio 实时合成，不需要音频文件

## 在线玩

**<https://loveforlky.github.io/game-remake/>**

已经部署在 GitHub Pages 上，手机 / 电脑浏览器打开即玩，不用安装任何东西。

## 直接玩

双击 `index.html` 即可。

更推荐在本目录起一个静态服务（图片和存档行为更稳定）：

```bash
python -m http.server 8000
```

然后访问 <http://127.0.0.1:8000/>。

## 分享给别人（GitHub Pages）

这个项目是纯静态的（HTML + CSS + JS + 图片），所以丢到 GitHub Pages 上，别人拿到链接就能玩，不需要装任何东西。

本仓库已经部署在 <https://loveforlky.github.io/game-remake/>。下面是从零部署的通用步骤：

### 步骤

1. 在 GitHub 上新建一个仓库，比如叫 `game-remake`
2. 在本目录执行：

   ```bash
   git init
   git add .
   git commit -m "合成大作战"
   git branch -M main
   git remote add origin https://github.com/你的用户名/game-remake.git
   git push -u origin main
   ```

3. 进仓库的 **Settings → Pages**，把 **Source** 设成 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存
4. 等一两分钟，访问 `https://你的用户名.github.io/game-remake/` 就能玩

> 在国内访问 GitHub Pages 偶尔会卡，如果打不开，可以让对方在浏览器里打开，或者把整个文件夹打包发过去（方案 C）。

## 换成你的图片

### 方式一：一键整理（推荐）

准备一个文件夹，把图片按「从小到大」命名（`01.png` … `11.png`），然后：

```bash
python -m pip install pillow
python tools/build_assets.py 你的图片文件夹 --names "小芽,团子,小橘,小柚,小桃,小莓,小瓜,小椰,小柚,小柚,小神"
```

脚本会：

- 按自然顺序排序（`2` 不会排到 `10` 后面）
- 透明 PNG：裁掉四周空白、保留透明边缘
- 不透明照片：居中裁成正方形，游戏里裁成圆形
- 从每张图取主色，合成粒子的颜色会跟着图片走
- 输出 `assets/items/01.webp …` 和 `assets/items/manifest.js`

刷新页面即可看到新形象。

> 图片数量不必是 11。2～20 张都可以，游戏会自动按数量重新计算大小、合成表和分数节奏。
> 不给 `--names` 时，名字取自文件名。

### 方式二：手动放图 + 改清单

把图片放进 `assets/items/`，然后编辑 `assets/items/manifest.js`：

```js
window.ITEM_ASSETS = [
  { name: '小奶糖', file: 'assets/items/01.webp', crop: 'none' },
  { name: '大奶糖', file: 'assets/items/02.webp', crop: 'circle' },
];
```

- `crop: 'none'`：保留透明边缘，适合立绘、贴纸
- `crop: 'circle'`：圆形裁切，适合照片、方形图
- 不写 `crop` 时，游戏会按图片是否带透明通道自动判断
- `c1` / `c2` 可选，是粒子和「图片加载失败时」备用圆的颜色

### 改游戏名

打开 `game.js`，最上面的 `CONFIG`：

```js
const CONFIG = {
  title:    '合成大作战',
  subtitle: '相同的撞在一起，越合越大',
  emoji:    '✨'
};
```

## 玩法

- 鼠标：移动瞄准、点击投放
- 触屏：拖动瞄准、松手投放
- 键盘：`←` `→` 微调，`空格` / `回车` 投放，`R` 重开
- 两个相同等级相撞会合成下一级，加分
- 两个最大等级相撞会一起炸掉，+500 分，并送一枚复活币
- 每累计 2000 分送一枚复活币（仅本局有效），越线时可以用它清掉线上方的形象继续玩
- 顶到虚线以上、停住超过 1.5 秒判负

## 文件结构

```
index.html                 页面结构
style.css                  全部样式（含响应式）
game.js                    游戏逻辑、物理、渲染、本地榜
assets/items/manifest.js   形象清单（换图入口）
assets/items/              处理后的图片
tools/build_assets.py      图片整理工具（Pillow）
```

## 一些实现说明

- 物理是 PBD（位置约束求解）：每帧 3 个子步 × 6 次迭代，静止堆叠稳定
- 合成判定用「同等级 + 接触容差」，三连撞也只合成一次
- 有挤压回弹、滚动旋转、落地投影、合成粒子、飘分、全屏闪光
- 排行榜是本地榜：最近 20 条成绩，存在 `localStorage`
- 所有图片都在本地，页面不会发任何网络请求
