(() => {
  "use strict";
  const Core = globalThis.TwitchSnooze, UI = globalThis.TwitchSnoozeUI, t = UI.t;
  const MAX_BYTES = 2 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  UI.localize();
  const feedback = $("feedback"), exportButton = $("export-button"), fileInput = $("import-file");
  const preview = $("import-preview"), confirmBox = $("replace-confirm");
  let state = Core.normalizeState(), pending = null;

  $("brand").append(UI.icon("moon"));
  $("version").textContent = t("version", { version: chrome.runtime.getManifest().version });

  function say(text, isError = false) {
    feedback.replaceChildren(isError ? UI.element("p", { class: "sz-alert", role: "alert", text }) : UI.toastView(text));
  }
  function renderSummary() {
    const counts = Core.backupCounts(state);
    $("export-summary").textContent = t("backupSummary", { summary: Core.describeCounts(counts) });
    exportButton.disabled = !counts.total;
  }
  async function refresh() {
    try { state = (await UI.request({ type: "TSNOOZE_GET" })).state; renderSummary(); }
    catch (error) { say(error.message, true); }
  }

  exportButton.addEventListener("click", () => {
    const backup = Core.exportBackup(state);
    const blob = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date();
    const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    const link = UI.element("a", { href: url, download: "twitch-snooze-backup-" + stamp + ".json" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say(t("backupSaved"));
  });

  fileInput.addEventListener("change", async () => {
    pending = null;
    preview.hidden = true;
    confirmBox.hidden = true;
    feedback.replaceChildren();
    const file = fileInput.files && fileInput.files[0];
    $("import-file-name").textContent = file ? file.name : t("backupNoFile");
    if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error(t("errBackupLarge"));
      let data;
      try { data = JSON.parse(await file.text()); }
      catch (_) { throw new Error(t("errBackupJson")); }
      const { counts } = Core.readBackup(data);
      pending = data;
      $("import-summary").textContent = t("backupContains", { summary: Core.describeCounts(counts) });
      preview.hidden = false;
    } catch (error) {
      say(error.message, true);
    }
  });

  async function runImport(mode) {
    if (!pending) return;
    const buttons = [...document.querySelectorAll("#import-preview button")];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const result = await UI.request({ type: "TSNOOZE_IMPORT", mode, data: pending });
      state = result.state;
      renderSummary();
      pending = null;
      preview.hidden = true;
      confirmBox.hidden = true;
      fileInput.value = "";
      $("import-file-name").textContent = t("backupNoFile");
      say(t(mode === "replace" ? "backupReplaced" : "backupMerged", { summary: Core.describeCounts(Core.backupCounts(state)) }));
    } catch (error) {
      say(error.message, true);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  $("import-merge").addEventListener("click", () => runImport("merge"));
  $("import-replace").addEventListener("click", () => { confirmBox.hidden = false; $("import-replace-cancel").focus(); });
  $("import-replace-cancel").addEventListener("click", () => { confirmBox.hidden = true; $("import-replace").focus(); });
  $("import-replace-confirm").addEventListener("click", () => runImport("replace"));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[Core.STORAGE_KEY]) { state = Core.normalizeState(changes[Core.STORAGE_KEY].newValue); renderSummary(); }
  });
  refresh();
})();
