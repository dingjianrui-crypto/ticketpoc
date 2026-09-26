export const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cloudflare Ticket Cache POC</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #19212d; background: #f5f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #fff3e6, transparent 35rem), #f5f7fb; }
    main { width: min(920px, calc(100% - 32px)); margin: 48px auto; }
    h1 { margin: 0 0 8px; font-size: clamp(1.75rem, 5vw, 2.5rem); }
    .subtitle { margin: 0 0 28px; color: #657084; }
    .build { display: inline-block; margin-left: 8px; border-radius: 999px; padding: 3px 8px; color: #596579; background: #e9edf3; font: 700 .7rem ui-monospace, monospace; vertical-align: middle; }
    .card { overflow: hidden; border: 1px solid #dfe4ec; border-radius: 16px; background: #fff; box-shadow: 0 14px 45px rgb(24 35 52 / 8%); }
    .tabs { display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid #e6e9ef; background: #fafbfc; }
    .tab { flex: 1; border: 0; border-radius: 10px; padding: 12px; color: #5a6475; background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
    .tab[aria-selected="true"] { color: #a64300; background: #fff0e3; }
    .panel { padding: clamp(20px, 4vw, 36px); }
    .panel[hidden] { display: none; }
    form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 16px; align-items: end; }
    label { display: grid; gap: 7px; color: #465063; font-size: .875rem; font-weight: 700; }
    input { width: 100%; border: 1px solid #cbd2dd; border-radius: 9px; padding: 11px 12px; font: inherit; }
    input:focus { outline: 3px solid #fbd7bc; border-color: #d8610b; }
    .action { border: 0; border-radius: 9px; padding: 12px 22px; color: #fff; background: #d95f08; font: inherit; font-weight: 750; cursor: pointer; }
    .action:disabled { opacity: .55; cursor: wait; }
    .diagnostic-action { border: 1px solid #cbd2dd; border-radius: 7px; padding: 6px 10px; color: #465063; background: white; font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; }
    .error { min-height: 24px; margin: 14px 0 0; color: #b42318; }
    .result { display: none; margin-top: 20px; padding-top: 20px; border-top: 1px solid #edf0f4; }
    .result.visible { display: block; }
    dl { display: grid; grid-template-columns: 110px 1fr; gap: 8px 14px; margin: 0 0 20px; }
    dt { color: #657084; font-weight: 700; }
    dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86rem; }
    a { color: #b84d00; }
    .preview { position: relative; display: grid; min-height: 190px; place-items: center; overflow: auto; border: 1px solid #e0e4eb; border-radius: 12px; padding: 52px 18px 18px; background: repeating-conic-gradient(#f7f8fa 0 25%, white 0 50%) 50% / 20px 20px; }
    .preview img { display: block; max-width: min(100%, 420px); height: auto; }
    .preview-refresh { position: absolute; top: 12px; right: 12px; border: 1px solid #cbd2dd; border-radius: 8px; padding: 8px 12px; color: #465063; background: rgb(255 255 255 / 92%); box-shadow: 0 2px 8px rgb(24 35 52 / 10%); font: inherit; font-size: .82rem; font-weight: 750; cursor: pointer; }
    .preview-refresh:disabled { opacity: .55; cursor: wait; }
    .hint { margin: 14px 0 0; color: #657084; font-size: .84rem; }
    @media (max-width: 700px) { form { grid-template-columns: 1fr; } .action { width: 100%; } dl { grid-template-columns: 1fr; gap: 3px; } dd { margin-bottom: 8px; } }
  </style>
</head>
<body>
<main>
  <h1>Ticket Cache Lab</h1>
  <p class="subtitle">Compare Worker Cache API delivery with R2 and Tiered Cache. <span class="build">build: edge-diag-v2</span></p>
  <section class="card">
    <div class="tabs" role="tablist" aria-label="Ticket generation mode">
      <button class="tab" role="tab" id="tab-edge" aria-controls="panel-edge" aria-selected="true">Edge SVG</button>
      <button class="tab" role="tab" id="tab-r2" aria-controls="panel-r2" aria-selected="false">R2 JPEG</button>
    </div>
    <section class="panel" id="panel-edge" role="tabpanel" aria-labelledby="tab-edge">
      <form data-mode="edge">
        <label>User ID<input name="userId" maxlength="128" required autocomplete="off"></label>
        <label>Ticket ID<input name="ticketId" maxlength="128" required autocomplete="off"></label>
        <button class="action" type="submit">Get</button>
      </form>
      <p class="error" role="alert"></p>
      <div class="result">
        <dl>
          <dt>Barcode ID</dt><dd data-id></dd>
          <dt>Image URL</dt><dd><a data-url target="_blank" rel="noopener"></a></dd>
          <dt>Source</dt><dd data-source>Not checked</dd>
          <dt>HTTP status</dt><dd data-http-status>—</dd>
          <dt>X-POC-Cache-Status</dt><dd data-cache>Not checked</dd>
          <dt>CF-Cache-Status</dt><dd data-cf-cache-status>—</dd>
          <dt>Cache API age</dt><dd data-poc-age>—</dd>
          <dt>CDN Age</dt><dd data-age>—</dd>
          <dt>Cache-Control</dt><dd data-cache-control>—</dd>
          <dt>ETag</dt><dd data-etag>—</dd>
          <dt>Content-Type</dt><dd data-content-type>—</dd>
          <dt>CF-Ray</dt><dd data-cf-ray>—</dd>
          <dt>Checked at</dt><dd><span data-checked-at>—</span></dd>
        </dl>
        <div class="preview"><button type="button" class="preview-refresh" data-edge-refresh>Refresh image + headers</button><img data-preview alt="Generated ticket QR code"></div>
        <p class="hint">Each refresh retrieves the SVG directly and displays the headers from that exact request.</p>
      </div>
    </section>
    <section class="panel" id="panel-r2" role="tabpanel" aria-labelledby="tab-r2" hidden>
      <form data-mode="r2">
        <label>User ID<input name="userId" maxlength="128" required autocomplete="off"></label>
        <label>Ticket ID<input name="ticketId" maxlength="128" required autocomplete="off"></label>
        <button class="action" type="submit">Generate</button>
      </form>
      <p class="error" role="alert"></p>
      <div class="result">
        <dl>
          <dt>Barcode ID</dt><dd data-id></dd>
          <dt>Image URL</dt><dd><a data-url target="_blank" rel="noopener"></a></dd>
          <dt>R2 object</dt><dd data-object></dd>
          <dt>Source</dt><dd data-source>Not checked</dd>
          <dt>HTTP status</dt><dd data-http-status>—</dd>
          <dt>CF-Cache-Status</dt><dd data-cache>Not checked</dd>
          <dt>Age</dt><dd data-age>—</dd>
          <dt>Cache-Control</dt><dd data-cache-control>—</dd>
          <dt>ETag</dt><dd data-etag>—</dd>
          <dt>Content-Type</dt><dd data-content-type>—</dd>
          <dt>CF-Ray</dt><dd data-cf-ray>—</dd>
          <dt>Checked at</dt><dd><span data-checked-at>—</span></dd>
        </dl>
        <div class="preview"><button type="button" class="preview-refresh" data-refresh>Refresh image + headers</button><img data-preview alt="Generated ticket barcode"></div>
        <p class="hint">Each refresh first measures a GET to the exact R2 URL, displays its headers, and then reloads the preview.</p>
      </div>
    </section>
  </section>
</main>
<script>
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach((tab, index) => tab.addEventListener('click', () => {
    tabs.forEach((item, i) => {
      const selected = i === index;
      item.setAttribute('aria-selected', String(selected));
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
  }));
  tabs.forEach((tab, index) => tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].click();
    document.activeElement.blur();
  }));

  async function retrieveR2Image(panel, barcodeId, previewUrl, imageUrl) {
    const refresh = panel.querySelector('[data-refresh]');
    refresh.disabled = true;
    refresh.textContent = 'Refreshing…';
    panel.querySelector('[data-cache]').textContent = 'Checking…';
    try {
      const response = await fetch('/api/r2-cache-diagnostics/' + barcodeId + '.jpg', { cache: 'no-store' });
      const diagnostic = await response.json();
      if (!response.ok) throw new Error(diagnostic.error || 'Diagnostic request failed.');
      const headers = diagnostic.headers;
      panel.querySelector('[data-source]').textContent = diagnostic.source;
      panel.querySelector('[data-http-status]').textContent = String(diagnostic.httpStatus);
      panel.querySelector('[data-cache]').textContent = headers.cfCacheStatus;
      panel.querySelector('[data-age]').textContent = headers.age === null ? '—' : headers.age + ' seconds';
      panel.querySelector('[data-cache-control]').textContent = headers.cacheControl || '—';
      panel.querySelector('[data-etag]').textContent = headers.etag || '—';
      panel.querySelector('[data-content-type]').textContent = headers.contentType || '—';
      panel.querySelector('[data-cf-ray]').textContent = headers.cfRay || '—';
      panel.querySelector('[data-checked-at]').textContent = new Date(diagnostic.checkedAt).toLocaleString();

      const image = panel.querySelector('[data-preview]');
      image.removeAttribute('src');
      await new Promise(resolve => requestAnimationFrame(resolve));
      image.src = previewUrl || imageUrl;
    } catch (cause) {
      panel.querySelector('[data-source]').textContent = 'Diagnostic failed';
      panel.querySelector('[data-cache]').textContent = cause instanceof Error ? cause.message : 'Unknown error';
      // Local preview can still work even when the configured public R2 URL
      // does not exist yet. Always try to display the image after diagnostics.
      const image = panel.querySelector('[data-preview]');
      image.src = previewUrl || imageUrl;
    } finally {
      refresh.disabled = false;
      refresh.textContent = 'Refresh image + headers';
    }
  }

  async function retrieveEdgeImage(panel, imageUrl) {
    const refresh = panel.querySelector('[data-edge-refresh]');
    refresh.disabled = true;
    refresh.textContent = 'Refreshing…';
    panel.querySelector('[data-cache]').textContent = 'Checking…';
    try {
      const response = await fetch(imageUrl, { cache: 'no-store' });
      const status = response.headers.get('X-POC-Cache-Status') || 'UNAVAILABLE';
      panel.querySelector('[data-source]').textContent = status === 'HIT' ? 'Workers Cache API' : status === 'MISS' ? 'Worker generated response' : 'Unknown';
      panel.querySelector('[data-http-status]').textContent = String(response.status);
      panel.querySelector('[data-cache]').textContent = status;
      const pocAge = response.headers.get('X-POC-Cache-Age');
      panel.querySelector('[data-poc-age]').textContent = pocAge === null ? '—' : pocAge + ' seconds';
      panel.querySelector('[data-cf-cache-status]').textContent = response.headers.get('CF-Cache-Status') || '—';
      const age = response.headers.get('Age');
      panel.querySelector('[data-age]').textContent = age === null ? '—' : age + ' seconds';
      panel.querySelector('[data-cache-control]').textContent = response.headers.get('Cache-Control') || '—';
      panel.querySelector('[data-etag]').textContent = response.headers.get('ETag') || '—';
      panel.querySelector('[data-content-type]').textContent = response.headers.get('Content-Type') || '—';
      panel.querySelector('[data-cf-ray]').textContent = response.headers.get('CF-Ray') || '—';
      panel.querySelector('[data-checked-at]').textContent = new Date().toLocaleString();
      if (!response.ok) throw new Error('Image request returned HTTP ' + response.status);
      const blobUrl = URL.createObjectURL(await response.blob());
      const image = panel.querySelector('[data-preview]');
      const previousBlobUrl = panel.dataset.blobUrl;
      image.onload = () => { if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl); };
      image.src = blobUrl;
      panel.dataset.blobUrl = blobUrl;
    } catch (cause) {
      panel.querySelector('[data-source]').textContent = 'Request failed';
      panel.querySelector('[data-cache]').textContent = cause instanceof Error ? cause.message : 'Unknown error';
    } finally {
      refresh.disabled = false;
      refresh.textContent = 'Refresh image + headers';
    }
  }

  document.querySelector('[data-refresh]').addEventListener('click', event => {
    const panel = event.currentTarget.closest('.panel');
    const barcodeId = panel.querySelector('[data-id]').textContent;
    if (barcodeId) retrieveR2Image(panel, barcodeId, panel.dataset.previewUrl, panel.dataset.imageUrl);
  });

  document.querySelector('[data-edge-refresh]').addEventListener('click', event => {
    const panel = event.currentTarget.closest('.panel');
    if (panel.dataset.imageUrl) retrieveEdgeImage(panel, panel.dataset.imageUrl);
  });

  document.querySelectorAll('form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const panel = form.closest('.panel');
    const button = form.querySelector('button');
    const error = panel.querySelector('.error');
    const result = panel.querySelector('.result');
    button.disabled = true;
    error.textContent = '';
    result.classList.remove('visible');
    try {
      const data = new FormData(form);
      const mode = form.dataset.mode;
      const response = await fetch(mode === 'edge' ? '/api/svg-tickets' : '/api/r2-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.get('userId'), ticketId: data.get('ticketId') }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Request failed.');
      panel.querySelector('[data-id]').textContent = body.barcodeId;
      const link = panel.querySelector('[data-url]');
      link.href = body.imageUrl;
      link.textContent = body.imageUrl;
      const object = panel.querySelector('[data-object]');
      if (object) object.textContent = body.objectKey + (body.created ? ' (created)' : ' (already existed)');
      const image = panel.querySelector('[data-preview]');
      result.classList.add('visible');
      if (mode === 'r2') {
        panel.dataset.previewUrl = body.previewUrl || '';
        panel.dataset.imageUrl = body.imageUrl;
        await retrieveR2Image(panel, body.barcodeId, body.previewUrl, body.imageUrl);
      } else {
        panel.dataset.imageUrl = body.imageUrl;
        await retrieveEdgeImage(panel, body.imageUrl);
      }
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Unexpected error.';
    } finally { button.disabled = false; }
  }));
</script>
</body>
</html>`;
