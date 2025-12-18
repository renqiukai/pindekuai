(() => {
  const MIN_DIMENSION = 200;
  const DEFAULT_BASE = 'pindekuai';
  const PAGE_HOST = location.hostname || DEFAULT_BASE;
  const PANEL_ID = '__yinban_float_panel__';
  const BTN_MERGE_ID = '__yinban_merge_btn__';
  const BTN_DOWNLOAD_ID = '__yinban_download_btn__';
  const BTN_REFRESH_ID = '__yinban_refresh_btn__';
  const BTN_SELECT_ID = '__yinban_select_btn__';
  const BTN_ORIENT_H_ID = '__yinban_orient_h__';
  const BTN_ORIENT_V_ID = '__yinban_orient_v__';
  const FILTER_INPUT_ID = '__yinban_filter_input__';
  const STATUS_ID = '__yinban_status__';
  const CLOSE_ID = '__yinban_close__';
  const LIST_ID = '__yinban_list__';
  const CANVAS_LIMIT = 32767;

  let imageList = [];
  let filteredList = [];
  let selected = new Set();
  let refs = {};
  let orientation = 'horizontal';
  let filterMaxKB = 200;

  const sanitizeFileName = (text) =>
    (text || DEFAULT_BASE)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim()
      .slice(0, 80) || DEFAULT_BASE;

  const deriveFileName = (
    url,
    fallbackBase,
    idx,
    ext = 'png',
    fallbackHost = PAGE_HOST
  ) => {
    let base = '';
    let host = fallbackHost;

    try {
      const { pathname, hostname } = new URL(url);
      base = pathname.split('/').filter(Boolean).pop() || '';
      host = hostname || host;
    } catch {
      // ignore
    }
    const safeHost = sanitizeFileName(host || fallbackHost || DEFAULT_BASE);
    base = sanitizeFileName(base);
    if (!base) {
      const safeFallback = sanitizeFileName(fallbackBase);
      base =
        idx === undefined || idx === null
          ? safeFallback
          : `${safeFallback}-${idx + 1}`;
    }
    return `${DEFAULT_BASE}/${safeHost}/${base}${
      base.includes('.') ? '' : `.${ext}`
    }`;
  };

  const formatBytes = (bytes) => {
    if (!bytes || Number.isNaN(bytes)) return '未知';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1
    );
    const val = bytes / 1024 ** i;
    return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)}${units[i]}`;
  };

  const getPerfSize = (url) => {
    const entries = performance.getEntriesByName(url);
    if (!entries.length) return null;
    const best = entries.reduce(
      (max, e) =>
        Math.max(
          max,
          e.transferSize || e.encodedBodySize || e.decodedBodySize || 0
        ),
      0
    );
    return best || null;
  };

  const collectImages = () => {
    const imgs = Array.from(document.querySelectorAll('img[src]'));
    const seen = new Set();
    const candidates = [];

    imgs.forEach((img) => {
      const src = new URL(img.currentSrc || img.src, location.href).toString();
      if (!src || seen.has(src)) return;

      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || img.width;
      const height = img.naturalHeight || rect.height || img.height;
      if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

      const size = getPerfSize(src);
      candidates.push({ src, width, height, size });
      seen.add(src);
    });

    return candidates;
  };

  const fetchBitmap = async (url) => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      throw new Error(`加载失败: ${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    return createImageBitmap(blob);
  };

  const mergeImagesLocally = async (images, orient = 'horizontal') => {
    const bitmaps = [];
    let maxHeight = 0;
    let maxWidth = 0;

    for (const item of images) {
      const bmp = await fetchBitmap(item.src);
      maxHeight = Math.max(maxHeight, bmp.height);
      maxWidth = Math.max(maxWidth, bmp.width);
      bitmaps.push(bmp);
    }

    const scaledWidths = bitmaps.map((bmp) =>
      Math.round(bmp.width * (maxHeight / bmp.height))
    );
    const totalWidth = scaledWidths.reduce((sum, w) => sum + w, 0);

    const useVerticalFallback =
      orient === 'vertical' ||
      totalWidth > CANVAS_LIMIT ||
      maxHeight > CANVAS_LIMIT;

    const canvas = document.createElement('canvas');
    if (!useVerticalFallback) {
      canvas.width = totalWidth;
      canvas.height = maxHeight;
    } else {
      canvas.width = maxWidth;
      canvas.height = bitmaps
        .map((bmp) => Math.round(bmp.height * (maxWidth / bmp.width)))
        .reduce((sum, h) => sum + h, 0);
    }

    const ctx = canvas.getContext('2d');
    if (!useVerticalFallback) {
      let x = 0;
      bitmaps.forEach((bmp, idx) => {
        const drawWidth = scaledWidths[idx];
        ctx.drawImage(bmp, x, 0, drawWidth, maxHeight);
        x += drawWidth;
      });
    } else {
      let y = 0;
      bitmaps.forEach((bmp) => {
        const drawHeight = Math.round(bmp.height * (maxWidth / bmp.width));
        ctx.drawImage(bmp, 0, y, maxWidth, drawHeight);
        y += drawHeight;
      });
    }

    const blob =
      (await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      })) ||
      (await (async () => {
        const dataUrl = canvas.toDataURL('image/png');
        const res = await fetch(dataUrl);
        return res.blob();
      })());

    bitmaps.forEach((bmp) => bmp.close && bmp.close());

    if (!blob) throw new Error('无法生成拼接图片');

    return blob;
  };

  const downloadMergedLocally = (blob, pageTitle) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${DEFAULT_BASE}/${sanitizeFileName(
      PAGE_HOST
    )}/${sanitizeFileName(pageTitle)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const downloadOriginalsLocally = (imgs, pageTitle) => {
    imgs.forEach((img, idx) => {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = deriveFileName(img.src, pageTitle, idx, 'png', PAGE_HOST);
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  };

  const setStatus = (text, isError = false) => {
    const el = refs.status || document.getElementById(STATUS_ID);
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#fca5a5' : '#cbd5e1';
  };

  const applyFilter = () => {
    if (filterMaxKB === null || filterMaxKB === undefined) {
      filteredList = [...imageList];
    } else {
      const threshold = filterMaxKB * 1024;
      filteredList = imageList.filter(
        (item) => item.size == null || item.size >= threshold
      );
    }
  };

  const renderList = () => {
    const listEl = refs.list;
    if (!listEl) return;
    listEl.innerHTML = '';

    filteredList.forEach((item) => {
      const row = document.createElement('label');
      row.className = 'yb-item';
      if (selected.has(item.src)) {
        row.classList.add('yb-checked');
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.src = item.src;
      checkbox.checked = selected.has(item.src);

      const thumb = document.createElement('img');
      thumb.src = item.src;
      thumb.alt = 'thumb';
      thumb.loading = 'lazy';

      const meta = document.createElement('div');
      meta.className = 'yb-meta';

      const name = document.createElement('div');
      name.className = 'yb-url';
      name.textContent = item.src.split('/').pop() || item.src;

      const info = document.createElement('div');
      info.className = 'yb-info';
      info.textContent = `${item.width}×${item.height} · ${formatBytes(
        item.size
      )}`;

      meta.appendChild(name);
      meta.appendChild(info);

      row.appendChild(checkbox);
      row.appendChild(thumb);
      row.appendChild(meta);

      listEl.appendChild(row);
    });
  };

  const refreshAndRender = () => {
    setStatus('正在收集图片...');
    imageList = collectImages();
    applyFilter();
    selected = new Set(filteredList.map((i) => i.src));
    renderList();
    if (filteredList.length === 0) {
      setStatus('未找到符合条件的图片', true);
    } else {
      setStatus(
        `共 ${filteredList.length} 张${
          filterMaxKB ? `（≥${filterMaxKB}KB）` : ''
        }，已全选`
      );
    }
  };

  const ensurePanel = () => {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      refs.panel = existing;
      refs.list = existing.querySelector(`#${LIST_ID}`);
      refs.status = existing.querySelector(`#${STATUS_ID}`);
      return existing;
    }

    const style = document.createElement('style');
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 360px;
        max-height: 70vh;
        padding: 12px;
        box-shadow: 0 16px 36px rgba(0,0,0,0.4);
        border-radius: 14px;
        background: linear-gradient(160deg, #0f172a 0%, #0b1224 100%);
        border: 1px solid rgba(34, 211, 238, 0.15);
        color: #e2e8f0;
        font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        z-index: 2147483647;
        backdrop-filter: blur(10px);
        display: none;
        box-sizing: border-box;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} h3 {
        margin: 0;
        font-size: 15px;
        letter-spacing: 0.3px;
      }
      #${PANEL_ID} .yb-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      #${PANEL_ID} p {
        margin: 0 0 10px;
        font-size: 12px;
        color: #c7d2fe;
      }
      #${PANEL_ID} button {
        border: none;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      #${PANEL_ID} input {
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid #1e293b;
        background: #0f172a;
        color: #e2e8f0;
        width: 100px;
      }
      #${PANEL_ID} button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
      #${CLOSE_ID} {
        background: transparent;
        color: #94a3b8;
        font-size: 16px;
        padding: 4px 6px;
      }
      #${CLOSE_ID}:hover { color: #e2e8f0; }
      #${BTN_REFRESH_ID}, #${BTN_SELECT_ID} {
        padding: 6px 10px;
        border-radius: 8px;
        background: #122033;
        color: #e2e8f0;
        font-size: 12px;
      }
      #${BTN_SELECT_ID} { margin-left: 8px; }
      #${BTN_ORIENT_H_ID}, #${BTN_ORIENT_V_ID} {
        padding: 6px 10px;
        border-radius: 8px;
        background: #122033;
        color: #e2e8f0;
        font-size: 12px;
      }
      .yb-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      .yb-row label {
        font-size: 12px;
        color: #cbd5e1;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .yb-active {
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #c7d2fe !important;
      }
      #${LIST_ID} {
        max-height: 40vh;
        overflow: auto;
        border: 1px solid #1e293b;
        border-radius: 10px;
        padding: 8px;
        background: rgba(12,18,32,0.85);
      }
      #${LIST_ID} .yb-item {
        display: grid;
        grid-template-columns: 24px 60px 1fr;
        gap: 8px;
        align-items: center;
        padding: 6px;
        border-radius: 8px;
        transition: background 120ms ease, border 120ms ease;
        border: 1px solid transparent;
      }
      #${LIST_ID} .yb-item:hover { background: rgba(255,255,255,0.05); }
      #${LIST_ID} .yb-item.yb-checked {
        background: rgba(34, 211, 238, 0.12);
        border-color: rgba(34, 211, 238, 0.35);
      }
      #${LIST_ID} img {
        width: 60px;
        height: 60px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid #1e293b;
      }
      #${LIST_ID} .yb-meta {
        min-width: 0;
      }
      #${LIST_ID} .yb-url {
        font-size: 12px;
        color: #e2e8f0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${LIST_ID} .yb-info {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .yb-footer {
        margin-top: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        align-items: center;
      }
      #${BTN_MERGE_ID}, #${BTN_DOWNLOAD_ID} {
        padding: 10px 12px;
        border-radius: 10px;
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
        font-weight: 700;
      }
      #${BTN_DOWNLOAD_ID} { background: #1f2937; color: #e2e8f0; border: 1px solid #22d3ee33; }
      #${STATUS_ID} {
        grid-column: span 2;
        margin: 4px 0 0;
        font-size: 12px;
        color: #cbd5e1;
        min-height: 16px;
        line-height: 1.4;
        word-break: break-all;
      }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="yb-header">
        <h3>图片拼接</h3>
        <button id="${CLOSE_ID}" aria-label="关闭">×</button>
      </div>
      <p>列出本页图片，勾选后可直接下载或拼接。</p>
      <div class="yb-row">
        <button id="${BTN_REFRESH_ID}">刷新列表</button>
        <button id="${BTN_SELECT_ID}">全选</button>
        <label>≥KB
          <input id="${FILTER_INPUT_ID}" type="number" min="0" step="50" placeholder="大小过滤">
        </label>
      </div>
      <div class="yb-row">
        <span style="font-size:12px;color:#cbd5e1;">拼接方向：</span>
        <button id="${BTN_ORIENT_H_ID}" class="yb-active">横向</button>
        <button id="${BTN_ORIENT_V_ID}">纵向</button>
      </div>
      <div id="${LIST_ID}"></div>
      <div class="yb-footer">
        <button id="${BTN_DOWNLOAD_ID}">下载所选</button>
        <button id="${BTN_MERGE_ID}">拼接所选</button>
        <div id="${STATUS_ID}"></div>
      </div>
    `;

    document.body.appendChild(panel);

    refs = {
      panel,
      list: panel.querySelector(`#${LIST_ID}`),
      status: panel.querySelector(`#${STATUS_ID}`),
      btnRefresh: panel.querySelector(`#${BTN_REFRESH_ID}`),
      btnSelect: panel.querySelector(`#${BTN_SELECT_ID}`),
      btnDownload: panel.querySelector(`#${BTN_DOWNLOAD_ID}`),
      btnMerge: panel.querySelector(`#${BTN_MERGE_ID}`),
      btnOrientH: panel.querySelector(`#${BTN_ORIENT_H_ID}`),
      btnOrientV: panel.querySelector(`#${BTN_ORIENT_V_ID}`),
      filterInput: panel.querySelector(`#${FILTER_INPUT_ID}`),
    };

    if (refs.filterInput) {
      refs.filterInput.value = filterMaxKB ?? '';
    }

    panel.querySelector(`#${CLOSE_ID}`).addEventListener('click', () => {
      panel.style.display = 'none';
    });

    refs.btnRefresh.addEventListener('click', () => {
      refreshAndRender();
      refs.btnSelect.textContent = '全选';
    });

    refs.btnSelect.addEventListener('click', () => {
      if (selected.size === filteredList.length) {
        selected.clear();
        setStatus('已取消全选');
        refs.btnSelect.textContent = '全选';
      } else {
        selected = new Set(filteredList.map((i) => i.src));
        setStatus(`已全选 ${selected.size} 张`);
        refs.btnSelect.textContent = '取消全选';
      }
      renderList();
    });

    refs.list.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.dataset && target.dataset.src) {
        if (target.checked) {
          selected.add(target.dataset.src);
        } else {
          selected.delete(target.dataset.src);
        }
        const row = target.closest('.yb-item');
        if (row) {
          row.classList.toggle('yb-checked', target.checked);
        }
      }
      if (selected.size === filteredList.length) {
        refs.btnSelect.textContent = '取消全选';
      } else {
        refs.btnSelect.textContent = '全选';
      }
      setStatus(`已选择 ${selected.size} 张`);
    });

    refs.btnDownload.addEventListener('click', async () => {
      const chosen = filteredList.filter((i) => selected.has(i.src));
      if (!chosen.length) {
        setStatus('请先选择图片', true);
        return;
      }
      refs.btnDownload.disabled = true;
      refs.btnMerge.disabled = true;
      setStatus('正在下载所选图片...');
      try {
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'downloadImages',
            payload: {
              images: chosen,
              pageTitle: document.title || DEFAULT_BASE,
              pageHost: PAGE_HOST,
            },
          });
          if (!resp?.ok) {
            throw new Error(resp?.error || '下载失败');
          }
          setStatus('已触发下载');
        } catch (err) {
          const msg = err?.message || '';
          const needFallback =
            msg.includes('message port closed') ||
            msg.includes('Extension context invalidated');
          if (needFallback) {
            downloadOriginalsLocally(chosen, document.title || DEFAULT_BASE);
            setStatus('已触发下载（本地触发）');
          } else {
            throw err;
          }
        }
      } catch (err) {
        setStatus(err?.message || '下载失败', true);
      } finally {
        refs.btnDownload.disabled = false;
        refs.btnMerge.disabled = false;
      }
    });

    refs.btnMerge.addEventListener('click', async () => {
      const chosen = filteredList.filter((i) => selected.has(i.src));
      if (!chosen.length) {
        setStatus('请先选择图片', true);
        return;
      }
      refs.btnDownload.disabled = true;
      refs.btnMerge.disabled = true;
      setStatus(`已选择 ${chosen.length} 张，开始拼接...`);
      try {
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'mergeAndDownload',
            payload: {
              images: chosen,
              pageTitle: document.title || DEFAULT_BASE,
              pageHost: PAGE_HOST,
              orientation,
            },
          });
          if (!resp?.ok) {
            throw new Error(resp?.error || '拼接失败');
          }
          setStatus('拼接完成，已触发下载');
        } catch (err) {
          const msg = err?.message || '';
          const needFallback =
            msg.includes('message port closed') ||
            msg.includes('Extension context invalidated');
          if (needFallback) {
            setStatus('后台异常，改为本地拼接...', true);
            const blob = await mergeImagesLocally(chosen, orientation);
            downloadMergedLocally(blob, document.title || DEFAULT_BASE);
            setStatus('完成，已触发下载（本地拼接）');
          } else {
            throw err;
          }
        }
      } catch (err) {
        setStatus(err?.message || '拼接失败', true);
      } finally {
        refs.btnDownload.disabled = false;
        refs.btnMerge.disabled = false;
      }
    });

    refs.btnOrientH.addEventListener('click', () => {
      orientation = 'horizontal';
      refs.btnOrientH.classList.add('yb-active');
      refs.btnOrientV.classList.remove('yb-active');
    });

    refs.btnOrientV.addEventListener('click', () => {
      orientation = 'vertical';
      refs.btnOrientV.classList.add('yb-active');
      refs.btnOrientH.classList.remove('yb-active');
    });

    refs.filterInput.addEventListener('change', () => {
      const val = refs.filterInput.value;
      filterMaxKB = val === '' ? null : Math.max(0, Number(val) || 0);
      refreshAndRender();
      refs.btnSelect.textContent =
        selected.size === filteredList.length ? '取消全选' : '全选';
    });

    return panel;
  };

  const showPanel = () => {
    const panel = ensurePanel();
    if (panel) {
      panel.style.display = 'block';
      if (refs.filterInput) {
        refs.filterInput.value = filterMaxKB ?? '';
      }
      refreshAndRender();
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'showPanel') {
      showPanel();
      sendResponse({ ok: true });
      return;
    }
    if (message && message.type === 'collectImages') {
      sendResponse({
        images: collectImages(),
        pageTitle: document.title || DEFAULT_BASE,
        pageHost: PAGE_HOST,
      });
    }
  });

  ensurePanel();
})();
