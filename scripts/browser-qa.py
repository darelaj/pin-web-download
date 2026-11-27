"""Run against scripts/fixture-server.mjs on loopback. Requires Python Playwright + Chromium."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json
import os
import re
import sys
mode='public-page' if '--public-page' in sys.argv else 'official'
artifacts=Path('artifacts') / mode
artifacts.mkdir(parents=True,exist_ok=True)
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
  page.screenshot(path=f'{artifacts}/empty-{width}.png', full_page=True)
  page.locator('#pin-url').fill('https://www.pinterest.com/pin/1/' if width == 1440 else 'https://pin.it/fixture')
  page.locator('#permission').check()
  page.locator('#submit').click()
  page.locator('#result').wait_for(state='visible')
  assert '<script>' in page.locator('#result-title').inner_text()
  assert page.locator('#result-title script').count()==0
  assert page.locator('#format option').count()==1
  expect(page.locator('#thumbnail-status')).to_have_text('Thumbnail available.')
  poster=page.locator('#preview').get_attribute('poster')
  assert poster.startswith('/api/thumbnail/') and 'pinimg' not in poster
  image_response=context.request.get('http://127.0.0.1:3100'+poster)
  assert image_response.status==200 and image_response.body()==Path('test/fixtures/poster.png').read_bytes()
  page.screenshot(path=f'{artifacts}/poster-{width}.png', full_page=True)
  page.locator('#load-preview').click()
  for attempt in range(100):
   if page.locator('#preview').evaluate('(v) => v.readyState') >= 1: break
   page.wait_for_timeout(50)
  assert page.locator('#preview').evaluate('(v) => v.readyState') >= 1, page.locator('#preview-status').inner_text()
  assert page.locator('#preview').evaluate('(v) => v.videoWidth')==320
  page.locator('#preview').evaluate('(v) => v.play()')
  for attempt in range(50):
   if page.locator('#preview').evaluate('(v) => v.currentTime') > 0: break
   page.wait_for_timeout(50)
  assert page.locator('#preview').evaluate('(v) => v.currentTime') > 0
  page.locator('#preview').evaluate('(v) => v.pause()')
  with page.expect_download() as download_info:
   page.locator('#download').click()
  download=download_info.value
  assert download.suggested_filename=='pinterest-1.mp4'
  assert Path(download.path()).read_bytes()==Path('test/fixtures/sample.mp4').read_bytes()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'result overflow {width}'
  page.screenshot(path=f'{artifacts}/success-{width}.png', full_page=True)
  results.append({'viewport':width,'empty':True,'form':True,'preview':True,'thumbnail':True,'download_bytes':True,'no_overflow':True})
 for pin,error in [('2','signed-out page' if mode=='public-page' else 'does not contain'),('3','only HLS'),('4','blocked' if mode=='public-page' else 'unavailable'),('8','Public access could not be verified'),('9','Public access could not be verified'),('10','Public access could not be verified'),('11','Public access could not be verified')]:
  page.locator('#pin-url').fill(f'https://www.pinterest.com/pin/{pin}/')
  page.locator('#submit').click()
  expect(page.locator('#status')).to_have_class(re.compile(r'error'))
  assert error in page.locator('#status').inner_text()
  assert not page.locator('#result').is_visible()
 for pin,text in [('6','No thumbnail available.'),('7','Thumbnail unavailable.')]:
  page.locator('#pin-url').fill(f'https://www.pinterest.com/pin/{pin}/')
  page.locator('#submit').click()
  page.locator('#result').wait_for(state='visible')
  expect(page.locator('#thumbnail-status')).to_contain_text(text)
  assert not page.locator('#preview').get_attribute('poster')
  assert page.locator('#load-preview').is_enabled()
  assert page.locator('#download').get_attribute('href').startswith('/api/download/')
 if mode=='public-page':
  for pin,text in [('12','blocked'),('13','blocked'),('14','conflicting Pin identity'),('15','signed-out page'),('16','conflicting Pin identity'),('17','could not safely read')]:
   page.locator('#pin-url').fill(f'https://www.pinterest.com/pin/{pin}/')
   page.locator('#submit').click()
   expect(page.locator('#status')).to_have_class(re.compile(r'error'))
   assert text in page.locator('#status').inner_text()
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
 print(json.dumps({'provider':mode,'responsive':results,'errors_hls_nonvideo_unavailable':True,'thumbnail_missing_and_rejected_fallback':True,'private_unknown_adonly_denied_board':True,'loading':True,'keyboard':True,'page_errors':errors},indent=2))
 browser.close()
