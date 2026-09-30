// 底部进度条（时期更迭）：当前时期满色、其余淡化，上方只标“▼ + 时期名”，随浏览位置切换。
const { test, expect, openApp, centerOnCard } = require('./helpers');

// 分布在各个时期的事件
const SAMPLES = ['元谋人', '甲骨文', '孔子诞生', '秦统一六国', '赤壁之战', '贞观之治',
  '清明上河图', '郑和下西洋', '虎门销烟', '五四运动', '改革开放'];

function readBar(page) {
  return page.evaluate(() => {
    const on = [...document.querySelectorAll('.mm-era.on')];
    const label = document.querySelector('.mm-current');
    const bar = document.getElementById('minimap');
    const lr = label.getBoundingClientRect(), br = bar.getBoundingClientRect();
    const sr = on[0] && on[0].getBoundingClientRect();
    const labelCenter = lr.left + lr.width / 2;
    return {
      highlighted: on.map((s) => s.dataset.era),
      label: label.textContent,
      header: document.getElementById('currentEra').textContent,
      insideBar: lr.left >= br.left - 1 && lr.right <= br.right + 1,
      aboveBar: lr.bottom <= br.top + 1,
      // 标签中心落在当前色段上方（色段过窄、靠近两端时允许偏移半个标签宽度）
      overSegment: !!sr && labelCenter >= sr.left - lr.width / 2 - 2 && labelCenter <= sr.right + lr.width / 2 + 2,
      othersFaded: [...document.querySelectorAll('.mm-era:not(.on)')].every((s) => parseFloat(getComputedStyle(s).opacity) < 0.5),
    };
  });
}

for (const viewport of [{ width: 1440, height: 860 }, { width: 1024, height: 700 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('表示事件的竖条在进度条中垂直居中，上下留白相同', async ({ page }) => {
      await openApp(page);
      const r = await page.evaluate(() => {
        const bar = document.getElementById('minimap').getBoundingClientRect();
        const ticks = [...document.querySelectorAll('#minimap i')].map((t) => t.getBoundingClientRect());
        return { n: ticks.length, gaps: ticks.map((t) => [t.top - bar.top, bar.bottom - t.bottom, t.height]) };
      });
      expect(r.n).toBeGreaterThan(50);
      for (const [above, below, h] of r.gaps) {
        expect(Math.abs(above - below)).toBeLessThanOrEqual(0.5);
        expect(h).toBeGreaterThan(8);
        expect(above).toBeGreaterThan(2);
      }
    });

    test('浏览到不同时期时，高亮与标签随之切换', async ({ page }) => {
      await openApp(page);
      const seen = new Set();
      for (const title of SAMPLES) {
        await centerOnCard(page, title);
        // 标签移动带有 0.2s 过渡动画，重复读取直到状态稳定
        let bar;
        await expect(async () => {
          bar = await readBar(page);
          expect(bar.highlighted, title).toHaveLength(1);
          const era = bar.highlighted[0];
          expect(bar.header, `${title}：与右上角时期一致`).toBe(era);
          expect(bar.label, `${title}：标签只含图标和时期名`).toBe(`▼ ${era}`);
          expect(bar.insideBar && bar.aboveBar && bar.overSegment, `${title}：标签位置`).toBe(true);
          expect(bar.othersFaded, `${title}：其余时期淡化`).toBe(true);
        }).toPass({ timeout: 5_000 });
        seen.add(bar.highlighted[0]);
      }
      expect(seen.size).toBeGreaterThanOrEqual(9);
    });

    test('中华人民共和国色段延续到进度条末端', async ({ page }) => {
      await openApp(page);
      const gap = await page.evaluate(() => {
        const seg = document.querySelector('.mm-era[data-era="中华人民共和国"]').getBoundingClientRect();
        const bar = document.querySelector('.mm-eras').getBoundingClientRect();
        return bar.right - seg.right;
      });
      expect(gap).toBeLessThanOrEqual(1);
    });

    test('点击进度条跳转并更新标签', async ({ page }) => {
      await openApp(page);
      await centerOnCard(page, '改革开放');
      const before = await page.locator('.mm-current').textContent();
      const box = await page.locator('#minimap').boundingBox();
      await page.mouse.click(box.x + 5, box.y + box.height / 2);
      await expect(page.locator('.mm-current')).not.toHaveText(before);
      await expect(page.locator('.mm-era.on')).toHaveCount(1);
    });
  });
}
