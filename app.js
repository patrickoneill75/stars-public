(function () {
  "use strict";

  const API = window.STARS_API_BASE_URL;

  const statusBanner = document.getElementById("status-banner");
  function showError(message) {
    statusBanner.textContent = message;
    statusBanner.classList.remove("hidden");
  }

  // ---------------------------------------------------------------------
  // Minimal Markdown -> HTML for the small vocabulary the API actually
  // sends: "### heading", "**bold**", "*italic*", and markdown line breaks
  // (a line ending in two spaces, or a blank line for a new paragraph).
  // Occupation/skill names inside these strings are already HTML-escaped
  // by the Worker before they're embedded, so building this HTML with
  // innerHTML is safe -- the escaped entities render as literal characters.
  // ---------------------------------------------------------------------
  function inlineFormat(text) {
    let out = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
    return out;
  }

  function mdToHtml(md) {
    if (!md) return "";
    const lines = String(md).split("\n");
    let html = "";
    let para = [];
    function flush() {
      if (para.length) {
        html += `<p>${para.join("<br>")}</p>`;
        para = [];
      }
    }
    for (const raw of lines) {
      if (raw.startsWith("### ")) {
        flush();
        html += `<h3>${inlineFormat(raw.slice(4))}</h3>`;
        continue;
      }
      const stripped = raw.replace(/ {2}$/, "");
      if (stripped.trim() === "") {
        flush();
        continue;
      }
      para.push(inlineFormat(stripped));
    }
    flush();
    return html;
  }

  // ---------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------
  async function apiGet(path) {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return res.json();
  }

  // ---------------------------------------------------------------------
  // Searchable combobox (replacement for gr.Dropdown's type-to-search)
  // ---------------------------------------------------------------------
  function createCombobox(inputEl, listEl, titles) {
    let filtered = [];
    let highlighted = -1;
    let selectedTitle = null;

    function render() {
      listEl.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "combobox-empty";
        empty.textContent = "No matching occupations.";
        listEl.appendChild(empty);
      } else {
        filtered.slice(0, 200).forEach((title, i) => {
          const opt = document.createElement("div");
          opt.className = "combobox-option" + (i === highlighted ? " highlighted" : "");
          opt.textContent = title;
          opt.addEventListener("mousedown", (e) => {
            e.preventDefault();
            select(title);
          });
          listEl.appendChild(opt);
        });
      }
      listEl.classList.add("open");
    }

    function select(title) {
      selectedTitle = title;
      inputEl.value = title;
      listEl.classList.remove("open");
    }

    function filterFrom(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        filtered = titles.slice(0, 200);
      } else {
        filtered = titles.filter((t) => t.toLowerCase().includes(q));
      }
      highlighted = -1;
    }

    inputEl.addEventListener("input", () => {
      selectedTitle = null;
      filterFrom(inputEl.value);
      render();
    });

    inputEl.addEventListener("focus", () => {
      filterFrom(inputEl.value);
      render();
    });

    inputEl.addEventListener("blur", () => {
      setTimeout(() => listEl.classList.remove("open"), 100);
    });

    inputEl.addEventListener("keydown", (e) => {
      if (!listEl.classList.contains("open")) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlighted = Math.min(highlighted + 1, Math.min(filtered.length, 200) - 1);
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlighted = Math.max(highlighted - 1, 0);
        render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlighted >= 0 && filtered[highlighted]) select(filtered[highlighted]);
      } else if (e.key === "Escape") {
        listEl.classList.remove("open");
      }
    });

    return {
      getSelected: () => selectedTitle,
      setValue(title) {
        select(title);
      },
    };
  }

  // ---------------------------------------------------------------------
  // Panel controller shared by the Employer and Worker tabs -- they're
  // the same interaction pattern (pick an occupation, search, click a row
  // to drill into skill gaps) against mirrored API endpoints.
  // ---------------------------------------------------------------------
  function createPanel(cfg) {
    const input = document.getElementById(`${cfg.prefix}-target-input`) ||
      document.getElementById(`${cfg.prefix}-current-input`);
    const listEl = document.getElementById(`${cfg.prefix}-combobox-list`);
    const resultCountEl = document.getElementById(`${cfg.prefix}-result-count`);
    const resultCountValueEl = document.getElementById(`${cfg.prefix}-result-count-value`);
    const wageCheckboxEl = document.getElementById(`${cfg.prefix}-lower-wage-only`) ||
      document.getElementById(`${cfg.prefix}-higher-wage-only`);
    const findButton = document.getElementById(`${cfg.prefix}-find-button`);
    const summaryEl = document.getElementById(`${cfg.prefix}-target-summary`) ||
      document.getElementById(`${cfg.prefix}-current-summary`);
    const resultsBody = document.getElementById(`${cfg.prefix}-results-body`);
    const gapHeadingEl = document.getElementById(`${cfg.prefix}-skill-gap-heading`);
    const gapBody = document.getElementById(`${cfg.prefix}-gap-body`);
    const gapNoteEl = document.getElementById(`${cfg.prefix}-gap-note`);

    let combobox = null;
    let resultTitles = [];
    let activeTitle = null;
    let selectedRowIndex = -1;
    let requestSeq = 0;

    resultCountEl.addEventListener("input", () => {
      resultCountValueEl.textContent = resultCountEl.value;
    });

    function renderEmptyResults(message) {
      resultsBody.innerHTML = `<tr><td colspan="4" class="empty-note">${message}</td></tr>`;
    }

    function renderRows(rows) {
      resultsBody.innerHTML = "";
      if (!rows.length) {
        renderEmptyResults("No occupations met the current filter.");
        return;
      }
      rows.forEach((row, i) => {
        const tr = document.createElement("tr");
        tr.dataset.index = String(i);
        row.forEach((cell) => {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        });
        tr.addEventListener("click", () => onRowClick(i));
        resultsBody.appendChild(tr);
      });
    }

    function renderGapRows(rows) {
      gapBody.innerHTML = "";
      if (!rows.length) return;
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        row.forEach((cell) => {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        });
        gapBody.appendChild(tr);
      });
    }

    function highlightSelectedRow() {
      Array.from(resultsBody.children).forEach((tr, i) => {
        tr.classList.toggle("selected", i === selectedRowIndex);
      });
    }

    async function runSearch() {
      const title = combobox.getSelected() || input.value.trim();
      if (!title) return;
      findButton.disabled = true;
      const mySeq = ++requestSeq;
      try {
        const body = {
          resultCount: Number(resultCountEl.value),
          [cfg.titleField]: title,
          [cfg.wageFlagField]: wageCheckboxEl.checked,
        };
        const result = await apiPost(cfg.searchEndpoint, body);
        if (mySeq !== requestSeq) return; // a newer search has already been issued

        activeTitle = title;
        resultTitles = result.resultTitles || [];
        selectedRowIndex = resultTitles.length ? 0 : -1;

        summaryEl.innerHTML = mdToHtml(result[cfg.summaryField]);
        renderRows(result.rows || []);
        gapHeadingEl.innerHTML = mdToHtml(result.gapHeading || "");
        renderGapRows(result.gapRows || []);
        gapNoteEl.innerHTML = mdToHtml(result.gapNote || "");
        highlightSelectedRow();
      } catch (err) {
        showError(
          "Could not reach the STARs API. If you just deployed, double-check the URL in site/config.js " +
            "matches what `wrangler deploy` printed. (" + err.message + ")"
        );
      } finally {
        findButton.disabled = false;
      }
    }

    async function onRowClick(rowIndex) {
      if (!activeTitle || !resultTitles.length) return;
      selectedRowIndex = rowIndex;
      highlightSelectedRow();
      try {
        const body = {
          resultTitles,
          rowIndex,
          [cfg.titleField]: activeTitle,
        };
        const result = await apiPost(cfg.clickEndpoint, body);
        gapHeadingEl.innerHTML = mdToHtml(result.gapHeading || "");
        renderGapRows(result.gapRows || []);
        gapNoteEl.innerHTML = mdToHtml(result.gapNote || "");
      } catch (err) {
        showError("Could not update the skill-gap panel. (" + err.message + ")");
      }
    }

    findButton.addEventListener("click", runSearch);

    return {
      init(titles) {
        combobox = createCombobox(input, listEl, titles);
      },
    };
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  const employerPanel = createPanel({
    prefix: "employer",
    titleField: "targetTitle",
    wageFlagField: "lowerWageOnly",
    summaryField: "targetSummary",
    searchEndpoint: "/api/employer/search",
    clickEndpoint: "/api/employer/skill-gap",
  });

  const workerPanel = createPanel({
    prefix: "worker",
    titleField: "currentTitle",
    wageFlagField: "higherWageOnly",
    summaryField: "currentSummary",
    searchEndpoint: "/api/worker/search",
    clickEndpoint: "/api/worker/skill-gap",
  });

  apiGet("/api/occupations")
    .then((data) => {
      const titles = data.titles || [];
      employerPanel.init(titles);
      workerPanel.init(titles);
    })
    .catch((err) => {
      showError(
        "Could not reach the STARs API. If you just deployed, double-check the URL in site/config.js " +
          "matches what `wrangler deploy` printed. (" + err.message + ")"
      );
    });
})();
