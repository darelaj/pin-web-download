const form = document.querySelector('#download-form');
const input = document.querySelector('#pin-url');
const submit = document.querySelector('#submit');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const preview = document.querySelector('#preview');
const thumbnailStatus = document.querySelector('#thumbnail-status');
const posterProbe = new Image();
let posterGeneration = 0;
const previewButton = document.querySelector('#load-preview');
const previewStatus = document.querySelector('#preview-status');
const format = document.querySelector('#format');
const download = document.querySelector('#download');
const messages = {
  invalid_url: 'Use a full Pinterest Pin link or a pin.it short link.',
  permission_required: 'Confirm that you own the video or have the creator’s permission.',
  provider_disabled: 'Downloads are not enabled yet. An authorized Pinterest connection is required.',
  public_access_unverified: 'Public access could not be verified for this Pin. Private, protected and unspecified access is not supported.',
  pin_unavailable: 'This Pin is unavailable to the connected account. Check the link and account access.',
  short_link_unavailable: 'This short link could not be resolved. Try the full Pin link.',
  too_many_redirects: 'This short link redirects too many times. Try the full Pin link.',
  not_video: 'This Pin does not contain a supported native video.',
  video_access_unavailable: 'Pinterest has not made a direct video available to this authorized app.',
  hls_unsupported: 'This Pin offers only HLS video. HLS downloads are not supported.',
  unsupported_media: 'No compatible original MP4 is available for this Pin.',
  media_limit: 'This video exceeds the 100 MB download limit.',
  rate_limited: 'You’ve made several requests. Please wait a minute and try again.',
  busy: 'All download slots are busy. Please try again shortly.',
  timeout: 'The request took too long. Please try again.',
  ticket_expired: 'This link has expired. Find the video again to refresh it.',
};
let formats = []; let requestController; let expiryTimer;
function setStatus(message, state = '') { status.className = `status ${state}`; status.replaceChildren(); const dot = document.createElement('span'); dot.className = 'small-dot'; const text = document.createElement('span'); text.textContent = message; status.append(dot, text); }
function resetPoster(enabled = true) {
  const generation = ++posterGeneration;
  preview.removeAttribute('poster'); posterProbe.removeAttribute('src');
  thumbnailStatus.textContent = 'No thumbnail available. You can still load the video preview.';
  const url = formats[format.selectedIndex]?.thumbnail;
  if (!enabled || !url || result.hidden) return;
  thumbnailStatus.textContent = 'Loading thumbnail…';
  posterProbe.onload = () => { if (generation !== posterGeneration) return; preview.poster = url; thumbnailStatus.textContent = 'Thumbnail available.'; };
  posterProbe.onerror = () => { if (generation !== posterGeneration) return; preview.removeAttribute('poster'); thumbnailStatus.textContent = 'Thumbnail unavailable. You can still load the video preview.'; };
  posterProbe.src = url;
}
function resetPreview(keepPoster = true) { resetPoster(keepPoster); preview.pause(); preview.removeAttribute('src'); preview.load(); previewStatus.textContent = ''; previewButton.disabled = false; previewButton.textContent = 'Load preview ▷'; }
format.addEventListener('change', () => { resetPreview(); download.href = formats[format.selectedIndex].download; });
previewButton.addEventListener('click', () => { preview.src = formats[format.selectedIndex].preview; preview.load(); previewStatus.textContent = 'Loading preview…'; previewButton.disabled = true; });
preview.addEventListener('loadedmetadata', () => { previewStatus.textContent = 'Preview ready. Press play to watch.'; });
preview.addEventListener('error', () => { if (!preview.hasAttribute('src')) return; previewStatus.textContent = 'Preview unavailable or expired. Try finding the video again.'; previewButton.disabled = false; });
form.addEventListener('submit', async event => {
  event.preventDefault(); requestController?.abort(); clearTimeout(expiryTimer);
  requestController = new AbortController();
  result.hidden = true; resetPreview(); formats = []; submit.disabled = true; form.setAttribute('aria-busy', 'true'); document.querySelector('#button-label').textContent = 'Finding your video…'; setStatus('Checking the link and available formats…', 'loading');
  try {
    const response = await fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: input.value.trim(), permission: document.querySelector('#permission').checked }), signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(35000)]) });
    const data = await response.json();
    if (!response.ok) { setStatus(messages[data.error] || 'We couldn’t retrieve this video. Check the link and try again.', 'error'); return; }
    formats = data.formats;
    document.querySelector('#result-title').textContent = data.title;
    document.querySelector('#result-description').textContent = data.description;
    format.replaceChildren(...formats.map((item, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = item.label; return option; }));
    download.href = formats[0].download; download.removeAttribute('aria-disabled'); download.removeAttribute('tabindex');
    result.hidden = false; resetPoster(); setStatus('Your video is ready. Choose a format below.'); result.focus({ preventScroll: true }); result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    expiryTimer = setTimeout(() => { resetPreview(false); previewButton.disabled = true; download.removeAttribute('href'); download.setAttribute('aria-disabled', 'true'); download.setAttribute('tabindex', '-1'); setStatus(messages.ticket_expired, 'error'); }, data.expiresIn * 1000);
  } catch (error) { if (error.name !== 'AbortError') setStatus(error.name === 'TimeoutError' ? messages.timeout : 'Connection interrupted. Check your connection and try again.', 'error'); }
  finally { submit.disabled = false; form.removeAttribute('aria-busy'); document.querySelector('#button-label').textContent = 'Find my video'; }
});
