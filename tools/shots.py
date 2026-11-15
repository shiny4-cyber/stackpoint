#!/usr/bin/env python3
"""Capture the three entry screenshots from a live build."""
import sys
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/root/work/fps/screenshots'
URL = 'http://127.0.0.1:8137/index.html?fast=1&v=33'

PROBE = """(() => {
  const d = window.__debug();
  const px = Number(d.player[0]);
  const pz = Number(d.player[1]);
  const yaw = d.yaw;
  let best = null;
  for (const b of d.bots) {
    if (b.team !== 'defender' || !b.alive) continue;
    const dx = b.x - px;
    const dz = b.z - pz;
    const dist = Math.hypot(dx, dz);
    let ang = Math.atan2(-dx, -dz) - yaw;
    while (ang > Math.PI) ang -= 2 * Math.PI;
    while (ang < -Math.PI) ang += 2 * Math.PI;
    if (!best || dist < best.dist) best = { dist, ang: Math.abs(ang) };
  }
  return { alive: d.alive, phase: d.phase, hp: d.hp, best };
})()"""

with sync_playwright() as p:
    browser = p.firefox.launch(headless=True, firefox_user_prefs={'webgl.force-enabled': True, 'webgl.disabled': False})
    page = browser.new_page(viewport={'width': 1024, 'height': 576})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_default_timeout(60000)
    page.goto(URL, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_timeout(1500)
    page.click('#play')
    page.wait_for_timeout(500)
    page.keyboard.press('Escape')
    page.evaluate('window.__advance(3)')

    # 1) hero: the approach lane with the site ahead, taken from the safe end of the lane
    page.evaluate('window.__tp(-21.0, 25.0, Math.atan2(-9.0, 12.0), -0.01)')
    page.evaluate('window.__advance(0.1)')
    page.wait_for_timeout(250)
    page.screenshot(path=f'{OUT}/1-hero.jpg', type='jpeg', quality=82)
    print('hero state', page.evaluate(PROBE))

    # 2) action: face the defenders holding the site and fire, retrying until the
    # shutter lands on a live frame
    taken = False
    for attempt in range(12):
        st0 = page.evaluate(PROBE)
        if st0['phase'] != 'live':
            page.evaluate('window.__advance(1)')
            continue
        page.evaluate('window.__tp(0, 24.0, 0, 0)')
        page.evaluate('window.__advance(0.25)')
        page.mouse.down()
        page.evaluate('window.__advance(0.03)')
        st = page.evaluate(PROBE)
        if st['alive'] and st['best'] and st['best']['dist'] < 20:
            page.wait_for_timeout(80)
            page.screenshot(path=f'{OUT}/2-action.jpg', type='jpeg', quality=82)
            page.mouse.up()
            print('action state', st, 'attempt', attempt)
            taken = True
            break
        page.mouse.up()
        page.evaluate('window.__advance(1.2)')
    if not taken:
        print('action shot failed: player kept dying')

    # 3) buy menu: a clean empty server, captured during its buy phase
    buy = browser.new_page(viewport={'width': 1024, 'height': 576})
    buy.goto(URL + '&nobots=1', wait_until='domcontentloaded')
    buy.wait_for_timeout(1200)
    buy.click('#play')
    buy.wait_for_timeout(400)
    buy.keyboard.press('KeyB')
    buy.wait_for_timeout(500)
    buy.screenshot(path=f'{OUT}/3-buy.jpg', type='jpeg', quality=82)
    buy.close()

    print('errors:', errors)
    browser.close()
print('done')
