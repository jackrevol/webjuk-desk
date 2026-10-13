"use strict";
let prefs = WebJukCore.settings();
const controls = {
  enabled: document.getElementById("enabled"),
  focus: document.getElementById("focus"),
  expanded: document.getElementById("expanded"),
};
chrome.storage.local
  .get("webjuk")
  .then((result) => {
    prefs = WebJukCore.settings(result.webjuk);
    controls.enabled.checked = prefs.enabled;
    controls.focus.checked = prefs.focus;
    controls.expanded.checked = !prefs.collapsed;
  })
  .catch(() => {
    document.getElementById("status").textContent =
      "설정을 불러오지 못했습니다.";
  });
for (const [name, control] of Object.entries(controls))
  control.addEventListener("change", async () => {
    try {
      const latest = await chrome.storage.local.get("webjuk");
      prefs = WebJukCore.settings({
        ...latest.webjuk,
        [name === "expanded" ? "collapsed" : name]:
          name === "expanded" ? !control.checked : control.checked,
      });
      await chrome.storage.local.set({ webjuk: prefs });
      document.getElementById("status").textContent =
        "저장했습니다. 열린 웹죽 탭에 바로 적용됩니다.";
    } catch {
      document.getElementById("status").textContent =
        "저장하지 못했습니다. 확장을 새로고침해 주세요.";
    }
  });
