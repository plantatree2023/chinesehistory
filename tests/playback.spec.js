// 自动播放（加载后默认播放、停止操作后自动继续、手动暂停后不再自动继续、播放按钮依次切换一倍速 / 二倍速 / 暂停、空格键）、背景音乐（按数据集配置，第一次操作后开始，可关闭并记住），
// 以及点击底部进度条后可以继续用键盘浏览。
const fs = require('fs');
const path = require('path');
const { test, expect, openApp, trackOffset, loadDataset, DATA_URL } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
test.use({ viewport: { width: 1440, height: 860 } });

const playBtn = (page) => page.locator('#playToggle');
const audioState = (page) => page.evaluate(() => {
  const a = document.getElementById('bgm');
  // src：数据集配置的音乐文件；音乐在后台下载完成后以 blob 地址交给 <audio>（srcAttr）
  return { src: a.getAttribute('data-music'), srcAttr: a.getAttribute('src'), paused: a.paused, volume: a.volume, loop: a.loop };
});

test.describe('自动播放', () => {
  test('点击播放后时间轴缓缓向右前进，再点切换为二倍速，第三次点击暂停', async ({ page }) => {
    await openApp(page);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(playBtn(page).locator('.icon-play')).toBeVisible();
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(playBtn(page)).toHaveAttribute('data-speed', '1');
    // 一倍速播放中：图标为双箭头（点击后切换为二倍速）
    await expect(playBtn(page)).toHaveAttribute('aria-label', '切换为二倍速播放');
    await expect(playBtn(page).locator('.icon-fast')).toBeVisible();
    await expect(playBtn(page).locator('.icon-play')).toBeHidden();
    await expect(playBtn(page).locator('.icon-pause')).toBeHidden();
    const t0 = await trackOffset(page);
    await page.waitForTimeout(1500);
    const t1 = await trackOffset(page);
    // 速度约为每 30 秒一屏（1440px）：1.5 秒约 72px，“缓缓”而不是跳跃
    expect(t0 - t1).toBeGreaterThan(30);
    expect(t0 - t1).toBeLessThan(200);
    // 第二次点击：二倍速，图标为暂停，角上显示“2×”
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(playBtn(page)).toHaveAttribute('data-speed', '2');
    await expect(playBtn(page)).toHaveAttribute('aria-label', '暂停自动播放（当前二倍速）');
    await expect(playBtn(page).locator('.icon-pause')).toBeVisible();
    await expect(playBtn(page).locator('.icon-fast')).toBeHidden();
    expect(await playBtn(page).evaluate((b) => getComputedStyle(b, '::after').content)).toBe('"2×"');
    // 第三次点击：暂停
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(playBtn(page).locator('.icon-play')).toBeVisible();
    expect(await playBtn(page).evaluate((b) => getComputedStyle(b, '::after').content)).toBe('none');
    const t2 = await trackOffset(page);
    await page.waitForTimeout(500);
    expect(await trackOffset(page)).toBe(t2);
  });

  test('空格键播放 / 暂停；在输入框中按空格不受影响', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press(' ');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(' ');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await page.click('#browseBtn');
    await page.locator('#searchInput').pressSequentially('秦 汉');
    await expect(page.locator('#searchInput')).toHaveValue('秦 汉');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('手动拖动时自动暂停；打开详情时原地停住，关闭后继续', async ({ page }) => {
    await openApp(page);
    await playBtn(page).click();
    // 打开侧栏：停住
    await page.click('#browseBtn');
    const held = await trackOffset(page);
    await page.waitForTimeout(600);
    expect(await trackOffset(page)).toBe(held);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await page.click('#closeSidebar');
    await expect.poll(() => trackOffset(page)).toBeLessThan(held - 5);
    // 拖动：暂停
    await page.mouse.move(900, 300); await page.mouse.down(); await page.mouse.move(700, 300, { steps: 5 }); await page.mouse.up();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('到达末端时自动停止；再次播放从头开始', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    const end = await page.evaluate(() => Math.min(0, document.getElementById('stage').clientWidth - document.getElementById('track').offsetWidth));
    await expect.poll(() => trackOffset(page)).toBeLessThan(end + 1);
    await playBtn(page).click();
    await expect.poll(() => trackOffset(page)).toBeGreaterThan(end + 100);   // 回到开头附近
    await playBtn(page).click();
    // 放在离末端很近的位置播放：到达末端后自动停止
    await page.evaluate((x) => { const s = document.getElementById('stage'); s.focus(); }, 0);
    await page.keyboard.press('End');
    await expect.poll(() => trackOffset(page)).toBeLessThan(end + 1);
    await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(740, 300, { steps: 4 }); await page.mouse.up();   // 往回拖 40px
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
    expect(await trackOffset(page)).toBeLessThan(end + 1);
  });
});

// 一段时间内时间轴移动的距离（像素）
async function moved(page, ms) {
  const a = await trackOffset(page);
  await page.waitForTimeout(ms);
  return a - (await trackOffset(page));
}

test.describe('默认自动播放', () => {
  test.use({ autoplay: true });

  test('加载后默认开始播放，时间轴缓缓前进', async ({ page }) => {
    await openApp(page);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await moved(page, 1000)).toBeGreaterThan(20);
  });

  test('手动浏览时暂停，停止操作约 3 秒后自动继续播放', async ({ page }) => {
    await openApp(page);
    await page.mouse.move(900, 300); await page.mouse.down(); await page.mouse.move(700, 300, { steps: 5 }); await page.mouse.up();
    const stopped = Date.now();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(1500);
    expect(await moved(page, 500), '停止操作后还不到 3 秒，不播放（只剩拖动惯性的余量）').toBeLessThan(2);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 3000 });
    expect(Date.now() - stopped).toBeGreaterThanOrEqual(2900);
    expect(await moved(page, 800)).toBeGreaterThan(10);
  });

  test('期间继续操作会重新计时', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('ArrowRight');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(2000);
    await page.keyboard.press('ArrowRight');   // 重新计时
    await page.waitForTimeout(2000);
    await expect(playBtn(page), '距上次操作只有 2 秒').toHaveAttribute('aria-pressed', 'false');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 3000 });
  });

  test('用户手动暂停（按钮或空格）后不再自动继续，再次点播放才继续', async ({ page }) => {
    await openApp(page);
    // 加载后为一倍速；点两次：二倍速 → 暂停
    await expect(playBtn(page)).toHaveAttribute('data-speed', '1');
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('data-speed', '2');
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    // 暂停后再拖动一下，也不会自动继续
    await page.mouse.move(900, 300); await page.mouse.down(); await page.mouse.move(800, 300, { steps: 3 }); await page.mouse.up();
    await page.waitForTimeout(4000);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await moved(page, 500)).toBe(0);
    // 空格：继续（从一倍速开始），再按一次暂停
    await page.locator('#stage').focus();
    await page.keyboard.press(' ');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(playBtn(page)).toHaveAttribute('data-speed', '1');
    await page.keyboard.press(' ');
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('到达末端后停止，不会自动从头开始', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect.poll(() => page.evaluate(() => document.getElementById('navRight').classList.contains('at-end'))).toBe(true);
    await page.waitForTimeout(4000);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await moved(page, 300)).toBe(0);
  });

  test('系统设置了“减少动态效果”时不自动开始', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await page.waitForTimeout(500);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await moved(page, 500)).toBe(0);
  });
});

test.describe('二倍速', () => {
  test('二倍速的速度约为一倍速的两倍；暂停后再播放回到一倍速；浏览后自动继续时保持原来的速度', async ({ page }) => {
    await openApp(page);
    await playBtn(page).click();
    await page.waitForTimeout(300);
    const normal = await moved(page, 1500);
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('data-speed', '2');
    await page.waitForTimeout(200);
    const fast = await moved(page, 1500);
    expect(fast / normal).toBeGreaterThan(1.6);
    expect(fast / normal).toBeLessThan(2.4);
    // 不保存：刷新后仍为一倍速
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /speed/.test(k)))).toEqual([]);
    await playBtn(page).click();   // 暂停
    await playBtn(page).click();   // 再播放：一倍速
    await expect(playBtn(page)).toHaveAttribute('data-speed', '1');
  });

  test.describe('自动继续', () => {
    test.use({ autoplay: true });

    test('二倍速播放时手动浏览，停下后以二倍速继续', async ({ page }) => {
      await openApp(page);
      await expect(playBtn(page)).toHaveAttribute('data-speed', '1');
      await playBtn(page).click();
      await expect(playBtn(page)).toHaveAttribute('data-speed', '2');
      await page.locator('#stage').focus();
      await page.keyboard.press('ArrowRight');
      await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
      await expect(playBtn(page)).toHaveAttribute('data-speed', '2');
    });
  });
});

test('时间轴到卡片的连线使用该事件所属朝代 / 时期的颜色', async ({ page }) => {
  await openApp(page);
  const { eras } = await loadDataset(page);
  const res = await page.evaluate(() => [...document.querySelectorAll('.links polyline')].slice(0, 12).map((p) => ({
    color: p.style.getPropertyValue('--link-color'), stroke: getComputedStyle(p).stroke,
  })));
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const parse = (css) => { const m = css.match(/[\d.]+/g).map(Number); return /^color\(srgb/.test(css) ? m.slice(0, 3).map((v) => Math.round(v * 255)) : m.slice(0, 3); };
  const names = await page.evaluate(() => [...document.querySelectorAll('.card')].slice(0, 12).map((c) => c.dataset.id));
  const { events } = await loadDataset(page);
  const eraOf = (y) => eras.filter((e) => y >= e.start).pop();
  res.forEach((r, i) => {
    const ev = events.find((e) => e.id === names[i]);
    expect(r.color, ev.title).toBe(eraOf(ev.year).color);
    expect(parse(r.stroke), ev.title).toEqual(rgb(eraOf(ev.year).color));
  });
});

test.describe('点击底部进度条后键盘可控制', () => {
  test('点击进度条后，方向键、Home、End 都能浏览；进度条是可获得焦点的滑块', async ({ page }) => {
    await openApp(page);
    const mm = page.locator('#minimap');
    await expect(mm).toHaveAttribute('role', 'slider');
    const box = await mm.boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
    await expect(mm).toBeFocused();
    const a = await trackOffset(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => trackOffset(page)).toBeLessThan(a - 300);
    const b = await trackOffset(page);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => trackOffset(page)).toBeGreaterThan(b + 300);
    await page.keyboard.press('Home');
    await expect.poll(() => trackOffset(page)).toBe(0);
    await expect(mm).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('End');
    await expect.poll(() => trackOffset(page)).toBeLessThan(-5000);
    await expect(mm).toHaveAttribute('aria-valuenow', '100');
  });
});

test.describe('背景音乐', () => {
  test('数据集中配置的音乐：本地文件、音量较小、循环', async ({ page }) => {
    const { music } = await loadDataset(page);
    await openApp(page);
    await expect(page.locator('#musicToggle')).toBeVisible();
    const a = await audioState(page);
    expect(a).toMatchObject({ src: music.src, volume: music.volume, loop: true });
    expect(music.volume).toBeLessThanOrEqual(0.3);
    // 后台下载完成后以 blob 交给 <audio>（只下载一次）
    await expect.poll(async () => (await audioState(page)).srcAttr).toMatch(/^blob:/);
  });

  test('音乐在页面开始加载时后台下载，不推迟页面加载完成；下载完成后自动播放', async ({ page }) => {
    await page.addInitScript(() => {
      window.__media = [];
      HTMLMediaElement.prototype.play = function () { window.__media.push('play'); return Promise.resolve(); };
    });
    let release;
    const held = new Promise((r) => { release = r; });
    const requested = [];
    await page.route('**/audio/**', async (route) => {
      requested.push(route.request().url());
      await held;   // 模拟很慢的音乐下载
      await route.continue();
    });
    await page.goto('/', { waitUntil: 'load' });   // 音乐还没下载完，load 事件也已经触发
    await expect(page.locator('.card').first()).toBeVisible();
    expect(requested.length).toBe(1);               // 页面开始加载时就已经请求了音乐
    expect((await audioState(page)).srcAttr).toBeNull();
    expect(await page.evaluate(() => window.__media)).toEqual([]);
    release();
    await expect.poll(() => page.evaluate(() => window.__media)).toEqual(['play']);
    expect((await audioState(page)).srcAttr).toMatch(/^blob:/);
    expect(requested.length).toBe(1);               // 只下载一次
  });

  test('音乐已关闭时不下载；开启后才下载并播放', async ({ page }) => {
    const requested = [];
    await page.route('**/audio/**', (route) => { requested.push(route.request().url()); return route.continue(); });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('zh-history-timeline:music', 'off'));
    await page.reload();
    await expect(page.locator('.card').first()).toBeVisible();
    requested.length = 0;
    await page.waitForTimeout(500);
    expect(requested).toEqual([]);
    expect((await audioState(page)).srcAttr).toBeNull();
    await page.click('#musicToggle');
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect(requested.length).toBe(1);
  });

  test('浏览器允许自动播放时，页面加载后立即播放（不需要先操作）', async ({ page }) => {
    // 模拟允许自动播放的浏览器（例如经常访问的网站）：记录 play() 的调用并直接成功
    await page.addInitScript(() => {
      window.__media = [];
      HTMLMediaElement.prototype.play = function () { window.__media.push('play ' + this.getAttribute('data-music')); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { window.__media.push('pause'); };
    });
    await openApp(page);
    // 没有任何操作，音乐下载完成后就开始播放，而且之后没有被暂停
    await expect.poll(() => page.evaluate(() => window.__media)).toEqual(['play audio/bgm-cn.mp3']);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__media)).toEqual(['play audio/bgm-cn.mp3']);
    await expect(page.locator('#musicToggle')).not.toHaveClass(/waiting/);
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-pressed', 'true');
  });

  // 模拟拦截：play() 在 allowOn 中的事件发生之前一律被拒绝（用测试自己的开关，不依赖测试浏览器的激活状态）。
  // 拒绝是异步的（与真实浏览器一样），因此按下时的失败尝试可能还没结束，抬起时就要再试。
  const blockAutoplay = (page, allowOn) => page.addInitScript((events) => {
    window.__allowPlay = false;
    window.__plays = 0;
    for (const type of events) document.addEventListener(type, () => { window.__allowPlay = true; }, true);
    const real = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays++;
      if (!window.__allowPlay) return new Promise((resolve, reject) => setTimeout(() => reject(new DOMException('blocked', 'NotAllowedError')), 50));
      return real.call(this);
    };
  }, allowOn);

  test('被浏览器拦截时音乐按钮闪动提示（几次后停止闪动）；点击页面任何位置（不只是拖动时间轴）立即开始', async ({ page }) => {
    await blockAutoplay(page, ['pointerdown']);
    await openApp(page);
    const btn = page.locator('#musicToggle');
    await expect(btn).toHaveClass(/waiting/);
    await expect(btn).toHaveAttribute('aria-label', '开始播放背景音乐');
    expect((await audioState(page)).paused).toBe(true);
    // 闪动有次数限制，不会一直闪
    const anim = await btn.evaluate((b) => ({ name: getComputedStyle(b).animationName, count: getComputedStyle(b).animationIterationCount }));
    expect(anim.name).toBe('music-wait');
    expect(anim.count).not.toBe('infinite');
    expect(Number(anim.count)).toBeLessThanOrEqual(3);
    // 点击顶栏标题旁的空白处（不是时间轴）
    await page.mouse.click(700, 26);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(btn).not.toHaveClass(/waiting/);
    await expect(btn).toHaveAttribute('aria-label', '关闭背景音乐');
  });

  test('触屏（iPhone / iPad）：手指按下不算用户操作、抬起才算；轻触或拖动时间轴后开始播放', async ({ page }) => {
    // 与 iOS 一致：只有 touchend / pointerup / click 允许播放；按下时的尝试被拒绝也不影响抬起时再试
    await blockAutoplay(page, ['pointerup', 'touchend', 'click']);
    await openApp(page);
    await expect(page.locator('#musicToggle')).toHaveClass(/waiting/);
    // 拖动时间轴：按下、移动、抬起
    await page.mouse.move(700, 300);
    await page.mouse.down();
    await page.mouse.move(600, 300, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(page.locator('#musicToggle')).not.toHaveClass(/waiting/);
  });

  test('被拦截时点闪动的音乐按钮：开始播放，而不是关闭', async ({ page }) => {
    await blockAutoplay(page, ['click']);
    await openApp(page);
    await expect(page.locator('#musicToggle')).toHaveClass(/waiting/);
    await page.click('#musicToggle');
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#musicToggle')).not.toHaveClass(/waiting/);
    // 播放中再点：关闭
    await page.click('#musicToggle');
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-pressed', 'false');
    expect((await audioState(page)).paused).toBe(true);
  });

  test('关闭后停止播放并记住选择，刷新后不再自动播放；再次开启恢复', async ({ page }) => {
    await openApp(page);
    await page.mouse.click(700, 100);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await page.click('#musicToggle');
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-label', '开启背景音乐');
    expect((await audioState(page)).paused).toBe(true);
    await page.reload();
    await expect(page.locator('.card').first()).toBeVisible();
    await page.mouse.click(700, 100);
    await page.waitForTimeout(500);
    expect((await audioState(page)).paused).toBe(true);
    await expect(page.locator('#musicToggle .icon-muted')).toBeVisible();
    await page.click('#musicToggle');
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  });

  test('正在播放时点音乐按钮：关闭（不会被页面上的点击立即重新开始）', async ({ page }) => {
    // 模拟允许自动播放的浏览器：play() 直接成功，paused 随 play / pause 变化
    await page.addInitScript(() => {
      const playing = new WeakSet();
      Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !playing.has(this); } });
      HTMLMediaElement.prototype.play = function () { playing.add(this); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { playing.delete(this); };
    });
    await openApp(page);
    expect((await audioState(page)).paused).toBe(false);
    await page.click('#musicToggle');
    await page.waitForTimeout(300);
    expect((await audioState(page)).paused).toBe(true);
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.click(700, 26);
    await page.waitForTimeout(300);
    expect((await audioState(page)).paused).toBe(true);
  });

  test('数据集没有配置音乐时不显示音乐按钮（每个国家 / 语言的数据集各自配置）', async ({ page }) => {
    await page.route(`**${DATA_URL}`, async (route) => {
      const data = await (await route.fetch()).json();
      delete data.music;
      await route.fulfill({ json: data });
    });
    await openApp(page);
    await expect(page.locator('#musicToggle')).toBeHidden();
    await page.mouse.click(700, 100);
    expect((await audioState(page)).src).toBeNull();
    expect((await audioState(page)).srcAttr).toBeNull();
  });

  test('音乐文件在本地 audio/ 下、是有效的 MP3，大小适中；部署时会一起发布', async ({ request }) => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cn_zh.json'), 'utf8'));
    expect(data.music.src).toMatch(/^audio\/[A-Za-z0-9._-]+\.mp3$/);
    const buf = fs.readFileSync(path.join(ROOT, data.music.src));
    // ID3 标签或 MPEG 帧同步头
    expect(buf.slice(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)).toBe(true);
    expect(buf.length).toBeLessThan(3 * 1024 * 1024);
    const res = await request.get('/' + data.music.src);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toBe('audio/mpeg');
    expect(require('../tools/build-site').SITE_FILES).toContain('audio');   // 部署时复制（tools/build-site.js）
  });
});

test.describe('右上角按钮', () => {
  for (const viewport of [{ width: 1440, height: 860 }, { width: 390, height: 780 }, { width: 320, height: 640 }]) {
    test(`${viewport.width}×${viewport.height}：按钮排成一行、在顶栏内、不遮挡标题`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openApp(page);
      const bar = await page.locator('.topbar').boundingBox();
      const brand = await page.locator('.brand').boundingBox();
      const boxes = [];
      // 电脑上依次是播放、音乐、深色模式、分享、关于、放大缩小；手机上深色模式、分享、关于收进“更多”菜单
      const ids = viewport.width > 640
        ? ['#playToggle', '#musicToggle', '#themeToggle', '#shareTimeline', '#aboutBtn', '#barsToggle']
        : ['#playToggle', '#musicToggle', '#moreBtn', '#barsToggle'];
      for (const id of ids) {
        await expect(page.locator(id)).toBeVisible();
        boxes.push(await page.locator(id).boundingBox());
      }
      for (let i = 0; i < boxes.length; i++) {
        expect(boxes[i].y).toBeGreaterThanOrEqual(bar.y);
        expect(boxes[i].y + boxes[i].height).toBeLessThanOrEqual(bar.y + bar.height);
        if (i) expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThan(boxes[i].x);
      }
      expect(brand.x + brand.width).toBeLessThanOrEqual(boxes[0].x);
      expect(boxes[boxes.length - 1].x + boxes[boxes.length - 1].width).toBeLessThanOrEqual(viewport.width - 8);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.brand, .brand-name')].some((e) => e.scrollWidth > e.clientWidth + 0.5));
      expect(clipped, '标题被截断').toBe(false);
    });
  }
});
