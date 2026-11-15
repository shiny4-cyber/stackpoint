#!/usr/bin/env python3
"""Render the game with Firefox (software WebGL) and capture screenshots."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8137/index.html'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/ff.png'

with sync_playwright() as p:
    browser = p.firefox.launch(headless=True, firefox_user_prefs={
        'webgl.force-enabled': True,
        'webgl.disabled': False,
        'layers.acceleration.force-enabled': True,
    })
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    errors = []
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.goto(URL, wait_until='load')
    page.wait_for_timeout(1500)
    gl = page.evaluate("""() => {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl2') || c.getContext('webgl');
      return g ? g.getParameter(g.VERSION) : 'NO WEBGL';
    }""")
    print('webgl:', gl)
    page.click('#play')
    page.wait_for_timeout(800)
    page.keyboard.press('Escape')
    page.wait_for_timeout(2600)
    page.screenshot(path=OUT)
    print('shot:', OUT)
    print('errors:', errors[:8])
    browser.close()
