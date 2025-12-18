const statusEl = document.getElementById("status");
const openBtn = document.getElementById("openPanelBtn");

const setStatus = (text, isError = false) => {
  statusEl.textContent = text || "";
  statusEl.style.color = isError ? "#fca5a5" : "#cbd5e1";
};

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const requestShowPanel = async (tabId) =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "showPanel" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });

const ensureContentScript = async (tabId) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "injectContent", tabId },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(!!response?.ok);
      }
    );
  });

const handleOpen = async () => {
  openBtn.disabled = true;
  setStatus("正在打开悬浮窗...");
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error("无法获取当前标签页");
    }
    try {
      await requestShowPanel(tab.id);
      setStatus("已打开，可在页面右下角操作");
    } catch (err) {
      if (
        err?.message &&
        err.message.includes("Receiving end does not exist")
      ) {
        const injected = await ensureContentScript(tab.id);
        if (!injected) {
          throw new Error("无法注入页面脚本，请刷新页面后再试");
        }
        await requestShowPanel(tab.id);
        setStatus("已打开，可在页面右下角操作");
      } else {
        throw err;
      }
    }
  } catch (err) {
    setStatus(err?.message || "操作失败", true);
  } finally {
    openBtn.disabled = false;
  }
};

openBtn.addEventListener("click", handleOpen);
