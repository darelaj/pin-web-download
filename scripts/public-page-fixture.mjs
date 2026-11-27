// Synthetic public-page shape; no real Pinterest HTML or content.
export function publicPin(id = '1', overrides = {}) {
  return { id, title: 'A permitted personal fixture', description: 'Synthetic HTML, locally generated media.', is_private: false, board: { privacy: 'public' }, images: { orig: { url: 'https://i.pinimg.com/generated.png' } }, videos: { video_list: { V_320: { url: 'https://v.pinimg.com/generated.mp4', width: 320, height: 180 } } }, ...overrides };
}
export function publicHTML(id = '1', overrides = {}, slot = '__PWS_DATA__') {
  const initialReduxState = { pins: { [id]: publicPin(id, overrides) } };
  const state = slot === '__PWS_DATA__' ? { props: { initialReduxState } } : { initialReduxState };
  return `<!doctype html><html><head><link rel="canonical" href="https://www.pinterest.com/pin/${id}/"><meta property="og:url" content="https://www.pinterest.com/pin/${id}/"></head><body><h1>Public Pin fixture</h1><script id="${slot}" type="application/json">${JSON.stringify(state).replaceAll('<', '\\u003c')}</script></body></html>`;
}

// Sanitized structural observation: rendered player shell without an exposed source or requested state record.
export function publicShellHTML(id = '1', canonicalID = id) {
  return `<!doctype html><html><head><link rel="canonical" href="https://www.pinterest.com/pin/${canonicalID}/"><meta property="og:url" content="https://www.pinterest.com/pin/${canonicalID}/"><style id="recaptcha">#recaptcha { display: none; } /* Verify you are human */</style></head><body><h1>A video Pin</h1><video controls><track kind="captions"></video><script>window.runtimeLabels = { captcha: "Verify you are human", login: "Log in to view" };</script><script id="__PWS_DATA__" type="application/json">{"props":{"runtimeConfig":{"captchaEnabled":true}}}</script><script id="__PWS_INITIAL_PROPS__" type="application/json">{"initialReduxState":{"pins":{}}}</script></body></html>`;
}
