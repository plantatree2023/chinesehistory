// 详情页和图片查看器中左右滑动切换图片：
// 详情页顶部的大图有多张图片时可以左右滑动（向左滑看下一张，向右滑看上一张，首尾循环），下面的圆点表示当前是第几张（点圆点也能切换）；
// 点大图打开图片查看器并显示同一张，查看器中也能左右滑动，标题、序号和署名随之更新，关闭后大图停在查看器最后显示的那张。
// 滑动距离太短不切换；竖直方向的滑动用于滚动详情页，不切换图片，也不关闭详情页或查看器。
const { test, expect, seedEvents } = require('./helpers');

const EVENT_ID = 'e002';   // 测试数据中有 5 张图片的事件
const ONE_IMAGE_ID = 'e034';
const PHONE = { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true };

const heroImg = (page) => page.locator('#detailHero img');
const activeDot = (page) => page.locator('#detailHero .hero-dot.active');

// 用 CDP 发送真实的触摸事件（浏览器据此产生 pointer 事件，并按 touch-action 决定是否滚动）
async function touchSwipe(page, selector, dx, dy = 0) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const send = (type, px, py) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py, id: 1 }],
  });
  await send('touchStart', x, y);
  const steps = 8;
  for (let i = 1; i <= steps; i++) await send('touchMove', x + (dx * i) / steps, y + (dy * i) / steps);
  await send('touchEnd');
  await cdp.detach();
  // 快速滑动后浏览器有一段惯性（fling），期间的轻点只用来停住惯性、不产生 click（真机上也是这样），等它结束
  await page.waitForTimeout(400);
}

async function openDetail(page, id = EVENT_ID) {
  await page.goto(`/?id=${id}`);
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(heroImg(page)).toBeVisible();
}

async function imagesOf(page, id = EVENT_ID) {
  return page.evaluate(async ({ id }) => {
    const res = await fetch(`/data/${window.TIMELINE_DATASET}.json`);
    return (await res.json()).events.find((e) => e.id === id).images.map((im) => im.src);
  }, { id });
}

test.describe('手机上', () => {
  test.use(PHONE);

  test('详情页大图：向左滑看下一张，向右滑看上一张，首尾循环；圆点跟着变', async ({ page }) => {
    await openDetail(page);
    const srcs = await imagesOf(page);
    await expect(page.locator('#detailHero .hero-dot')).toHaveCount(srcs.length);
    await expect(heroImg(page)).toHaveAttribute('src', srcs[0]);
    await expect(activeDot(page)).toHaveAttribute('aria-label', '第 1 张图片');

    await touchSwipe(page, '#detailHero', -150);
    await expect(heroImg(page)).toHaveAttribute('src', srcs[1]);
    await expect(activeDot(page)).toHaveAttribute('aria-label', '第 2 张图片');
    await touchSwipe(page, '#detailHero', 150);
    await expect(heroImg(page)).toHaveAttribute('src', srcs[0]);
    await touchSwipe(page, '#detailHero', 150);
    await expect(heroImg(page)).toHaveAttribute('src', srcs[srcs.length - 1]);

    // 滑动不会打开图片查看器，也不会关闭详情页
    await expect(page.locator('#lightbox')).toBeHidden();
    await expect(page.locator('#detailModal')).toBeVisible();
  });

  test('滑动距离太短、或竖直方向滑动时不切换图片', async ({ page }) => {
    await openDetail(page);
    const srcs = await imagesOf(page);
    await touchSwipe(page, '#detailHero', -30);
    await expect(heroImg(page)).toHaveAttribute('src', srcs[0]);
    await touchSwipe(page, '#detailHero', -40, -200);
    await expect(heroImg(page)).toHaveAttribute('src', srcs[0]);
    await expect(page.locator('#detailModal')).toBeVisible();
    await expect(page.locator('#lightbox')).toBeHidden();
    // 竖直方向滑动仍然滚动详情页
    expect(await page.locator('#detailModal .modal-card').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });

  test('点大图打开查看器并显示同一张；查看器中左右滑动切换，署名随之更新；关闭后大图停在最后看的那张', async ({ page }) => {
    await seedEvents(page, (events) => {
      const ev = events.find((e) => e.id === EVENT_ID);
      ev.images[1].author = 'Jane Doe';
      ev.images[1].license = 'CC BY-SA 4.0';
      ev.images[2].license = 'unknown';
      return events;
    });
    await openDetail(page);
    const srcs = await imagesOf(page);
    await touchSwipe(page, '#detailHero', -150);
    await expect(heroImg(page)).toHaveAttribute('src', srcs[1]);
    await heroImg(page).tap();
    await expect(page.locator('#lightbox')).toBeVisible();
    await expect(page.locator('#lightboxImg')).toHaveAttribute('src', srcs[1]);
    await expect(page.locator('#lightboxCaption')).toContainText(`(2/${srcs.length})`);
    await expect(page.locator('#lightboxCredit')).toContainText('Jane Doe');

    await touchSwipe(page, '#lightbox', -150);
    await expect(page.locator('#lightboxImg')).toHaveAttribute('src', srcs[2]);
    await expect(page.locator('#lightboxCaption')).toContainText(`(3/${srcs.length})`);
    await expect(page.locator('#lightboxCredit')).toContainText('作者不详');
    await touchSwipe(page, '#lightbox', -150);
    await expect(page.locator('#lightboxImg')).toHaveAttribute('src', srcs[3]);
    await expect(page.locator('#lightboxCredit')).toBeHidden();
    await touchSwipe(page, '#lightbox', 150);
    await expect(page.locator('#lightboxImg')).toHaveAttribute('src', srcs[2]);
    // 滑动不会关闭查看器
    await expect(page.locator('#lightbox')).toBeVisible();

    await page.locator('#lightbox .lb-close').tap();
    await expect(page.locator('#lightbox')).toBeHidden();
    await expect(heroImg(page)).toHaveAttribute('src', srcs[2]);
    await expect(activeDot(page)).toHaveAttribute('aria-label', '第 3 张图片');
  });

  test('只有一张图片时没有圆点，滑动不变', async ({ page }) => {
    await openDetail(page, ONE_IMAGE_ID);
    await expect(page.locator('#detailHero .hero-dot')).toHaveCount(0);
    const src = await heroImg(page).getAttribute('src');
    await touchSwipe(page, '#detailHero', -150);
    await expect(heroImg(page)).toHaveAttribute('src', src);
  });

  test('英文界面：圆点的说明是英文', async ({ page }) => {
    await page.addInitScript(() => { delete window.TIMELINE_DATASET; });
    await page.goto('/?data=cn_en');
    await expect(page.locator('.card').first()).toBeVisible();
    const id = await page.evaluate(async () => {
      const d = await (await fetch('/data/cn_en.json')).json();
      return d.events.find((e) => (e.images || []).length > 1).id;
    });
    await page.goto(`/?data=cn_en&id=${id}`);
    await expect(page.locator('#detailModal')).toBeVisible();
    await expect(activeDot(page)).toHaveAttribute('aria-label', 'Image 1');
    await touchSwipe(page, '#detailHero', -150);
    await expect(activeDot(page)).toHaveAttribute('aria-label', 'Image 2');
  });
});

test.describe('电脑上', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('按住鼠标拖动也能切换，松开后不打开查看器；点圆点切换', async ({ page }) => {
    await openDetail(page);
    const srcs = await imagesOf(page);
    const box = await page.locator('#detailHero').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 150, y, { steps: 8 });
    await page.mouse.up();
    await expect(heroImg(page)).toHaveAttribute('src', srcs[1]);
    await expect(page.locator('#lightbox')).toBeHidden();

    await page.locator('#detailHero .hero-dot').nth(3).click();
    await expect(heroImg(page)).toHaveAttribute('src', srcs[3]);
    await expect(page.locator('#lightbox')).toBeHidden();
    await heroImg(page).click();
    await expect(page.locator('#lightboxImg')).toHaveAttribute('src', srcs[3]);
  });
});
