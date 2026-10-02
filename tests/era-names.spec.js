// 全屏模式下的时期名：每个时期开始处的左上角显示时期名和一条时期色竖线，颜色为该时期的颜色、不透明度偏低；
// 只在全屏模式（隐藏工具栏）显示；时期太短放不下名字时不显示；不影响点击卡片。
const { test, expect, openApp, loadDataset, waitForStableLayout } = require('./helpers');

const names = (page) => page.locator('#eraNames .era-start-name');
const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function enterFullscreen(page) {
  await page.click('#barsToggle');
  await expect(page.locator('.topbar')).toBeHidden();
  await waitForStableLayout(page);
}

for (const viewport of [{ width: 1440, height: 860 }, { width: 390, height: 780 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('只在全屏模式显示；退出全屏后隐藏', async ({ page }) => {
      await openApp(page);
      await expect(names(page).first()).toBeAttached();
      await expect(names(page).first()).toBeHidden();
      await enterFullscreen(page);
      await expect(names(page).first()).toBeVisible();
      await page.click('#barsToggle');
      await expect(names(page).first()).toBeHidden();
    });

    test('名字位于时期起点、舞台顶部，颜色为时期颜色、不透明度偏低，竖线标出起点；相邻名字不重叠', async ({ page }) => {
      const { eras } = await loadDataset(page);
      await openApp(page);
      await enterFullscreen(page);
      const stage = await page.locator('#stage').boundingBox();
      const items = await names(page).evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        const band = document.querySelector(`#eras .era[data-era="${e.dataset.era}"]`).getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(e);
        const text = range.getBoundingClientRect();
        return {
          era: e.dataset.era, left: r.left, top: r.top, bandLeft: band.left, textRight: text.right,
          color: s.getPropertyValue('--era-color').trim(), opacity: +s.opacity, pointer: s.pointerEvents,
        };
      }));
      expect(items.length).toBeGreaterThan(eras.length / 2);
      const byName = Object.fromEntries(eras.map((e) => [e.name, e]));
      for (const it of items) {
        expect(byName[it.era], it.era).toBeTruthy();
        expect(Math.abs(it.left - it.bandLeft), `${it.era} 在时期起点`).toBeLessThanOrEqual(1);
        expect(Math.abs(it.top - stage.y), `${it.era} 在舞台顶部`).toBeLessThanOrEqual(1);
        expect(it.color.toLowerCase(), it.era).toBe(byName[it.era].color.toLowerCase());
        expect(it.opacity).toBeGreaterThan(0.2);
        expect(it.opacity).toBeLessThan(0.8);
        expect(it.pointer).toBe('none');
      }
      // 按时间顺序，名字不伸进下一个名字
      for (let i = 1; i < items.length; i++) {
        expect(items[i].left, `${items[i - 1].era} → ${items[i].era}`).toBeGreaterThan(items[i - 1].left);
        expect(items[i - 1].textRight, `${items[i - 1].era} 与 ${items[i].era} 不重叠`).toBeLessThan(items[i].left);
      }
      // 每个名字都有一条起点竖线：位于时期起点，从舞台顶部到轴线，时期颜色从顶部一直渐隐到透明（没有实心段）
      const lines = await page.locator('#eraLines .era-start-line').evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return { era: e.dataset.era, left: r.left, top: r.top, bottom: r.bottom, width: r.width, bg: s.backgroundImage };
      }));
      expect(lines.map((l) => l.era)).toEqual(items.map((it) => it.era));
      const axisY = (await page.locator('#axis').boundingBox()).y;
      for (const [i, l] of lines.entries()) {
        expect(Math.abs(l.left - items[i].bandLeft), `${l.era} 竖线在时期起点`).toBeLessThanOrEqual(1);
        expect(Math.abs(l.top - stage.y), `${l.era} 竖线从舞台顶部开始`).toBeLessThanOrEqual(1);
        expect(Math.abs(l.bottom - axisY), `${l.era} 竖线到轴线`).toBeLessThanOrEqual(4);
        expect(l.width).toBeLessThanOrEqual(3);
        expect(l.bg, `${l.era} 竖线渐变`).toBe(`linear-gradient(${hexToRgb(byName[l.era].color)}, rgba(0, 0, 0, 0))`);
      }
    });
  });
}

test.describe('1440×860', () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  test('时期太短放不下名字时不显示，其余时期都显示（多种屏幕尺寸）', async ({ page }) => {
    await openApp(page);
    await enterFullscreen(page);
    let hiddenSomewhere = 0;
    for (const size of [{ width: 1440, height: 860 }, { width: 1024, height: 768 }, { width: 390, height: 780 }]) {
      await page.setViewportSize(size);
      await waitForStableLayout(page);
      const r = await page.evaluate(() => {
        const fontSize = parseFloat(getComputedStyle(document.querySelector('#eraNames .era-start-name')).fontSize);
        return [...document.querySelectorAll('#eras .era')].map((band) => ({
          era: band.dataset.era,
          fits: band.getBoundingClientRect().width + 2 >= band.dataset.era.length * fontSize + 24,
          shown: !!document.querySelector(`#eraNames .era-start-name[data-era="${band.dataset.era}"]`),
        }));
      });
      for (const e of r) expect(e.shown, `${size.width}×${size.height} ${e.era}（${e.fits ? '放得下' : '放不下'}）`).toBe(e.fits);
      hiddenSomewhere += r.filter((e) => !e.fits).length;
    }
    expect(hiddenSomewhere, '至少有一种屏幕尺寸下有放不下名字的短时期，规则确实起作用').toBeGreaterThan(0);
  });

  test('起点竖线在卡片下层：与卡片重叠处显示的是卡片', async ({ page }) => {
    await openApp(page);
    await enterFullscreen(page);
    let checked = 0;
    for (let step = 0; step < 6 && checked < 3; step++) {
      checked += await page.evaluate(() => {
        // 竖线不响应鼠标，elementFromPoint 会跳过它；检查时临时打开命中检测，看重叠处最上层的是竖线还是卡片
        const box = document.getElementById('eraLines');
        box.style.pointerEvents = 'auto';
        box.querySelectorAll('.era-start-line').forEach((l) => { l.style.pointerEvents = 'auto'; });
        let n = 0;
        const cards = [...document.querySelectorAll('.card')].map((c) => c.getBoundingClientRect());
        for (const line of document.querySelectorAll('#eraLines .era-start-line')) {
          const l = line.getBoundingClientRect();
          if (l.left < 0 || l.left > innerWidth) continue;
          for (const c of cards) {
            if (l.left <= c.left + 2 || l.left >= c.right - 2 || c.bottom <= l.top || c.top >= l.bottom) continue;
            const y = (Math.max(c.top, l.top) + Math.min(c.bottom, l.bottom)) / 2;
            const hit = document.elementFromPoint(l.left + 1, y);
            if (!hit || !hit.closest('.card')) throw new Error(`${line.dataset.era} 的竖线横穿卡片`);
            n++;
          }
        }
        box.style.pointerEvents = '';
        box.querySelectorAll('.era-start-line').forEach((l) => { l.style.pointerEvents = ''; });
        return n;
      });
      await page.locator('#stage').focus();
      await page.keyboard.press('ArrowRight');   // 向右翻 0.6 屏
      await page.waitForTimeout(600);
    }
    expect(checked, '至少检查到几处竖线与卡片重叠').toBeGreaterThan(0);
  });

  test('名字压在卡片上层，但点击会穿过名字落到下面的元素', async ({ page }) => {
    await openApp(page);
    await enterFullscreen(page);
    const r = await page.evaluate(() => {
      const n = document.querySelector('#eraNames .era-start-name');
      const b = n.getBoundingClientRect();
      const x = b.left + 20, y = b.top + 20;   // 名字文字所在处
      const hit = document.elementFromPoint(x, y);
      return { zNames: +getComputedStyle(document.getElementById('eraNames')).zIndex, hitInNames: !!hit.closest('#eraNames') };
    });
    expect(r.zNames, '在卡片上层').toBeGreaterThan(3);
    expect(r.hitInNames, '点击不会落在名字上').toBe(false);
  });
});
