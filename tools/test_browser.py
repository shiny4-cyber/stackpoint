#!/usr/bin/env python3
"""Functional browser tests, two sessions:

A) a normal match: buy phase, live round, bots present, firing
B) an empty server (?nobots=1): bomb plant, detonation, round transition
"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8137/index.html?fast=1&v=50'
fails = []


def check(name, cond, extra=''):
    if cond:
        print(f'ok   {name} {extra}')
    else:
        fails.append(name)
        print(f'FAIL {name} {extra}')


with sync_playwright() as p:
    browser = p.firefox.launch(headless=True, firefox_user_prefs={'webgl.force-enabled': True, 'webgl.disabled': False})
    errors = []

    # ---------- A: match with bots ----------
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_default_timeout(60000)
    page.goto(BASE, wait_until='domcontentloaded')
    page.wait_for_timeout(1500)
    page.click('#play')
    page.wait_for_timeout(400)
    page.keyboard.press('Escape')
    page.mouse.click(640, 360)   # re-request pointer lock after leaving the menu
    page.wait_for_timeout(200)

    page.keyboard.press('KeyB')
    page.wait_for_timeout(200)
    page.evaluate('''(() => { const items = [...document.querySelectorAll('#buygrid .item')]; const vest = items.find(el => el.textContent.includes('Kevlar')); if (vest) vest.click(); })()''')
    page.wait_for_timeout(150)
    bought = page.evaluate("(() => ({ money: document.getElementById('cash').textContent, ap: document.getElementById('ap').textContent }))()")
    check('buy armour spends money and grants armour', bought['money'] == '$150' and bought['ap'] == '100', json.dumps(bought))
    page.keyboard.press('KeyB')
    page.wait_for_timeout(150)

    page.evaluate('window.__advance(3)')
    d0 = page.evaluate('window.__debug()')
    check('live phase reached', d0['phase'] == 'live', d0['phase'])
    check('7 bots spawned', len(d0['bots']) == 7, len(d0['bots']))

    st = page.evaluate("window.__debug().bots.find(b => b.team === 'defender' && b.alive)")
    if st:
        page.evaluate(f"window.__tp({st['x'] - 2.0}, {st['z']}, 0, 0)")
        before = page.evaluate("document.getElementById('mag').textContent")
        page.mouse.down()
        page.evaluate('window.__advance(0.9)')
        page.mouse.up()
        page.wait_for_timeout(200)
        after = page.evaluate("document.getElementById('mag').textContent")
        check('firing consumes ammunition', after != before, f'{before} -> {after}')
    else:
        check('a defender was available to shoot', False)

    samples = page.evaluate('''(() => {
      const out = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        window.__advance(1);
        out.push(performance.now() - t0);
      }
      return out.sort((a, b) => a - b);
    })()''')
    median = samples[len(samples) // 2]
    check('1s of simulation under 250ms (median of 5)', median < 250, f'{median:.1f}ms')
    page.close()

    # ---------- B: empty server, objective flow ----------
    obj = browser.new_page(viewport={'width': 1280, 'height': 720})
    obj.on('pageerror', lambda e: errors.append(str(e)))
    obj.set_default_timeout(60000)
    obj.goto(BASE + '&nobots=1', wait_until='domcontentloaded')
    obj.wait_for_timeout(1200)
    obj.click('#play')
    obj.wait_for_timeout(300)
    obj.keyboard.press('Escape')
    obj.evaluate('window.__advance(3)')

    obj.evaluate('window.__tp(0, 9, 0, 0)')
    obj.keyboard.down('KeyE')
    planted = False
    for _ in range(6):
        obj.evaluate('window.__advance(1)')
        if obj.evaluate('window.__debug()')['bomb']:
            planted = True
            break
    obj.keyboard.up('KeyE')
    check('bomb planted', planted, json.dumps(obj.evaluate('window.__debug()')['bomb']))

    obj.evaluate('window.__advance(41)')
    d3 = obj.evaluate('window.__debug()')
    check('detonation wins the round', d3['phase'] == 'over' and d3['scoreUs'] > 0, json.dumps({'phase': d3['phase'], 'us': d3['scoreUs']}))

    obj.wait_for_timeout(2600)
    obj.evaluate('window.__advance(1)')
    d4 = obj.evaluate('window.__debug()')
    check('next round started', d4['round'] >= 2, json.dumps({'round': d4['round'], 'phase': d4['phase']}))
    obj.close()

    check('no page errors', not errors, str(errors[:2]))
    browser.close()

print('\nALL PASS' if not fails else f'\n{fails} FAILURES')
sys.exit(0 if not fails else 1)
