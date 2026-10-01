// 自动播放（右上角播放 / 暂停按钮、空格键）、背景音乐（按数据集配置，第一次操作后开始，可关闭并记住），
// 以及点击底部进度条后可以继续用键盘浏览。
const fs = require('fs');
const path = require('path');
const { test, expect, openApp, trackOffset, loadDataset, DATA_URL } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
test.use({ viewport: { width: 1440, height: 860 } });

const playBtn = (page) => page.locator('#playToggle');
const audioState = (page) => page.evaluate(() => {
  const a = document.getElementById('bgm');
  return { src: a.getAttribute('src'), paused: a.paused, volume: a.volume, loop: a.loop };
});

test.describe('自动播放', () => {
  test('点击播放后时间轴缓缓向右前进，再点暂停后停止', async ({ page }) => {
    await openApp(page);
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(playBtn(page).locator('.icon-play')).toBeVisible();
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(playBtn(page)).toHaveAttribute('aria-label', '暂停自动播放');
    await expect(playBtn(page).locator('.icon-pause')).toBeVisible();
    const t0 = await trackOffset(page);
    await page.waitForTimeout(1500);
    const t1 = await trackOffset(page);
    // 速度约为每 30 秒一屏（1440px）：1.5 秒约 72px，“缓缓”而不是跳跃
    expect(t0 - t1).toBeGreaterThan(30);
    expect(t0 - t1).toBeLessThan(200);
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute('aria-pressed', 'false');
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
  });

  test('浏览器允许自动播放时，页面加载后立即播放（不需要先操作）', async ({ page }) => {
    // 模拟允许自动播放的浏览器（例如经常访问的网站）：记录 play() 的调用并直接成功
    await page.addInitScript(() => {
      window.__media = [];
      HTMLMediaElement.prototype.play = function () { window.__media.push('play ' + this.getAttribute('src')); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { window.__media.push('pause'); };
    });
    await openApp(page);
    // 没有任何操作，加载后就开始播放，而且之后没有被暂停
    expect(await page.evaluate(() => window.__media)).toEqual(['play audio/bgm-cn.mp3']);
    await expect(page.locator('#musicToggle')).not.toHaveClass(/waiting/);
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('被浏览器拦截时音乐按钮闪动提示；点击页面任何位置（不只是拖动时间轴）立即开始', async ({ page }) => {
    // 模拟拦截：在页面上点击之前 play() 一律被拒绝（用测试自己的开关，不依赖测试浏览器的激活状态）
    await page.addInitScript(() => {
      window.__allowPlay = false;
      document.addEventListener('pointerdown', () => { window.__allowPlay = true; }, true);
      const real = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!window.__allowPlay) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        return real.call(this);
      };
    });
    await openApp(page);
    await expect(page.locator('#musicToggle')).toHaveClass(/waiting/);
    expect((await audioState(page)).paused).toBe(true);
    // 点击顶栏标题旁的空白处（不是时间轴）
    await page.mouse.click(700, 26);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(page.locator('#musicToggle')).not.toHaveClass(/waiting/);
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

  test('第一次操作就是点音乐按钮时，直接关闭而不是先开始播放', async ({ page }) => {
    await openApp(page);
    await page.click('#musicToggle');
    await page.waitForTimeout(300);
    expect((await audioState(page)).paused).toBe(true);
    await expect(page.locator('#musicToggle')).toHaveAttribute('aria-pressed', 'false');
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
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
    expect(workflow).toMatch(/cp -r [^\n]*\baudio\b[^\n]*_site/);
  });
});

test.describe('右上角按钮', () => {
  for (const viewport of [{ width: 1440, height: 860 }, { width: 390, height: 780 }, { width: 320, height: 640 }]) {
    test(`${viewport.width}×${viewport.height}：四个按钮排成一行、在顶栏内、不遮挡标题`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openApp(page);
      const bar = await page.locator('.topbar').boundingBox();
      const brand = await page.locator('.brand').boundingBox();
      const boxes = [];
      for (const id of ['#playToggle', '#musicToggle', '#themeToggle', '#barsToggle']) boxes.push(await page.locator(id).boundingBox());
      for (let i = 0; i < boxes.length; i++) {
        expect(boxes[i].y).toBeGreaterThanOrEqual(bar.y);
        expect(boxes[i].y + boxes[i].height).toBeLessThanOrEqual(bar.y + bar.height);
        if (i) expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThan(boxes[i].x);
      }
      expect(brand.x + brand.width).toBeLessThanOrEqual(boxes[0].x);
      expect(boxes[3].x + boxes[3].width).toBeLessThanOrEqual(viewport.width - 8);
    });
  }
});
