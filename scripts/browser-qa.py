"""Run against scripts/fixture-server.mjs on loopback. Requires Python Playwright + Chromium."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json
import os
import time
import re
Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, executable_path=os.environ.get('BROWSER_EXECUTABLE_PATH'), args=['--no-sandbox'])
 context=browser.new_context(accept_downloads=True, reduced_motion='reduce')
 page=context.new_page()
 errors=[]
 page.on('pageerror', lambda e: errors.append(str(e)))
 results=[]
 for width,height in [(1440,1000),(768,1024),(390,844),(320,740)]:
  page.set_viewport_size({'width':width,'height':height})
  page.goto('http://127.0.0.1:3100/')
  assert page.locator('#status').inner_text().endswith('Ready when you are.')
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow {width}'
  page.screenshot(path=f'artifacts/empty-{width}.png', full_page=True)
  page.locator('#pin-url').fill('https://pin.it/fixture')
  page.locator('#permission').check()
  page.locator('#submit').click()
  page.locator('#result').wait_for(state='visible')
  assert '<script>' in page.locator('#result-title').inner_text()
  assert page.locator('#result-title script').count()==0
  assert page.locator('#format option').count()==1
  page.locator('#load-preview').click()
  for attempt in range(100):
   if page.locator('#preview').evaluate('(v) => v.readyState') >= 1: break
   page.wait_for_timeout(50)
  assert page.locator('#preview').evaluate('(v) => v.readyState') >= 1, page.locator('#preview-status').inner_text()
  assert page.locator('#preview').evaluate('(v) => v.videoWidth')==320
  with page.expect_download() as download_info:
   page.locator('#download').click()
  download=download_info.value
  assert download.suggested_filename=='pinterest-1.mp4'
  assert Path(download.path()).read_bytes()==Path('test/fixtures/sample.mp4').read_bytes()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'result overflow {width}'
  page.screenshot(path=f'artifacts/success-{width}.png', full_page=True)
  results.append({'viewport':width,'empty':True,'form':True,'preview':True,'download_bytes':True,'no_overflow':True})
 for pin,error in [('2','does not contain'),('3','only HLS'),('4','unavailable')]:
  page.locator('#pin-url').fill(f'https://www.pinterest.com/pin/{pin}/')
  page.locator('#submit').click()
  expect(page.locator('#status')).to_have_class(re.compile(r'error'))
  assert error in page.locator('#status').inner_text()
  assert not page.locator('#result').is_visible()
 page.locator('#pin-url').fill('https://www.pinterest.com/pin/5/')
 page.locator('#submit').click()
 assert page.locator('#submit').is_disabled()
 assert page.locator('#download-form').get_attribute('aria-busy')=='true'
 assert 'Checking' in page.locator('#status').inner_text()
 page.locator('#result').wait_for(state='visible')
 # Keyboard reaches the input; native labels and focus ring styles remain available.
 page.goto('http://127.0.0.1:3100/')
 for _ in range(3): page.keyboard.press('Tab')
 assert page.locator('#pin-url').evaluate('(e) => e === document.activeElement')
 assert not errors,errors
 print(json.dumps({'responsive':results,'errors_hls_nonvideo_unavailable':True,'loading':True,'keyboard':True,'page_errors':errors},indent=2))
 browser.close()
