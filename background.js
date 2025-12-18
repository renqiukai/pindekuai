const DEFAULT_BASE = "pindekuai";

const sanitizeFileName = (text) =>
  (text || DEFAULT_BASE)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim()
    .slice(0, 80) || DEFAULT_BASE;

const deriveFileName = (url, fallbackBase, idx, ext = "png") => {
  let base = "";
  try {
    const { pathname } = new URL(url);
    base = pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    base = "";
  }
  base = sanitizeFileName(base);
  if (!base) {
    const safeFallback = sanitizeFileName(fallbackBase);
    base =
      idx === undefined || idx === null
        ? safeFallback
        : `${safeFallback}-${idx + 1}`;
  }
  return `${DEFAULT_BASE}/${base}${base.includes(".") ? "" : `.${ext}`}`;
};

const fetchBitmap = async (url) => {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`加载失败: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  return createImageBitmap(blob);
};

const mergeImages = async (images, orient = "horizontal") => {
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

  const CANVAS_LIMIT = 32767;
  const useVerticalFallback =
    orient === "vertical" ||
    totalWidth > CANVAS_LIMIT ||
    maxHeight > CANVAS_LIMIT;

  let canvas;
  let ctx;

  if (!useVerticalFallback) {
    canvas = new OffscreenCanvas(totalWidth, maxHeight);
    ctx = canvas.getContext("2d");

    let x = 0;
    bitmaps.forEach((bmp, idx) => {
      const drawWidth = scaledWidths[idx];
      ctx.drawImage(bmp, x, 0, drawWidth, maxHeight);
      x += drawWidth;
    });
  } else {
    const totalHeight = bitmaps
      .map((bmp) => Math.round(bmp.height * (maxWidth / bmp.width)))
      .reduce((sum, h) => sum + h, 0);
    canvas = new OffscreenCanvas(maxWidth, totalHeight);
    ctx = canvas.getContext("2d");

    let y = 0;
    bitmaps.forEach((bmp) => {
      const drawHeight = Math.round(bmp.height * (maxWidth / bmp.width));
      ctx.drawImage(bmp, 0, y, maxWidth, drawHeight);
      y += drawHeight;
    });
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });

  bitmaps.forEach((bmp) => {
    if (typeof bmp.close === "function") bmp.close();
  });

  return blob;
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取数据失败"));
    reader.readAsDataURL(blob);
  });

const downloadBlob = async (blob, pageTitle) => {
  const fileName = `${DEFAULT_BASE}/${sanitizeFileName(pageTitle)}.png`;
  let url;

  const canObjectUrl =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

  if (canObjectUrl) {
    try {
      url = URL.createObjectURL(blob);
    } catch {
      url = null;
    }
  }

  if (!url) {
    url = await blobToDataUrl(blob);
  }

  await chrome.downloads.download({
    url,
    filename: fileName,
    saveAs: false
  });

  if (canObjectUrl && url.startsWith("blob:")) {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "injectContent" && message.tabId) {
    chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        files: ["content.js"]
      })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message }));

    return true;
  }

  if (message?.type === "mergeAndDownload") {
    const { payload } = message;
    (async () => {
      try {
        if (!payload?.images?.length) {
          throw new Error("未收到图片列表");
        }
        const blob = await mergeImages(payload.images, payload.orientation);
        await downloadBlob(blob, payload.pageTitle);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "合成失败" });
      }
    })();
    return true;
  }

  if (message?.type === "downloadImages") {
    const { images, pageTitle } = message.payload || {};
    (async () => {
      try {
        if (!images?.length) {
          throw new Error("未收到图片列表");
        }
        await Promise.all(
          images.map((img, idx) =>
            chrome.downloads.download({
              url: img.src,
              filename: deriveFileName(img.src, pageTitle, idx),
              saveAs: false
            })
          )
        );
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "下载失败" });
      }
    })();
    return true;
  }

  return false;
});
