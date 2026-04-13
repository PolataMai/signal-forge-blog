function slugify(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(node, tone, message) {
  if (!node) {
    return;
  }

  node.className = `status-box status-box-${tone}`;
  node.textContent = message;
}

function renderSources(node, sources) {
  if (!node) {
    return;
  }

  if (!sources?.length) {
    node.innerHTML = "";
    return;
  }

  node.innerHTML = `
    <div class="panel-card source-card">
      <div class="panel-head">
        <span class="panel-label">Sources</span>
        <span class="panel-status">${sources.length}</span>
      </div>
      <div class="source-list">
        ${sources
          .map(
            (source) => `
              <a class="source-item" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
                <strong>${escapeHtml(source.title)}</strong>
                <span>${escapeHtml(source.url)}</span>
              </a>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return payload;
}

function fillPublishForm(form, payload) {
  if (!form) {
    return;
  }

  form.elements.title.value = payload.title || "";
  if (!form.elements.slug.value || !form.elements.slug.dataset.manual) {
    form.elements.slug.value = payload.slug || "";
  }
  form.elements.excerpt.value = payload.excerpt || "";
  form.elements.category.value = payload.category || "技术研究";
  form.elements.tags.value = Array.isArray(payload.tags) ? payload.tags.join(", ") : payload.tags || "";
  form.elements.accent.value = payload.accent || "cyan";
  form.elements.date.value = payload.date || new Date().toISOString().slice(0, 10);
  form.elements.readingTime.value = payload.readingTime || "";
  form.elements.featured.checked = Boolean(payload.featured);
  form.elements.body.value = payload.body || "";
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page !== "admin") {
    return;
  }

  const authPanel = document.querySelector("[data-auth-panel]");
  const workspacePanel = document.querySelector("[data-workspace-panel]");
  const authMessage = document.querySelector("[data-auth-message]");
  const authState = document.querySelector("[data-auth-state]");
  const loginForm = document.querySelector("[data-login-form]");
  const logoutButton = document.querySelector("[data-logout-button]");
  const draftForm = document.querySelector("[data-draft-form]");
  const publishForm = document.querySelector("[data-publish-form]");
  const draftStatus = document.querySelector("[data-draft-status]");
  const publishStatus = document.querySelector("[data-publish-status]");
  const sourceList = document.querySelector("[data-source-list]");

  async function refreshSession() {
    try {
      const payload = await api("/api/session", { method: "GET", headers: {} });

      if (!payload.adminEnabled) {
        authPanel.hidden = false;
        workspacePanel.hidden = true;
        authState.textContent = "Disabled";
        setStatus(
          authMessage,
          "warn",
          "后台未启用。请设置 BLOG_ADMIN_PASSWORD 和 BLOG_SESSION_SECRET 后，再通过 node server.mjs 启动站点。"
        );
        return;
      }

      if (payload.authenticated) {
        authPanel.hidden = true;
        workspacePanel.hidden = false;
        return;
      }

      authPanel.hidden = false;
      workspacePanel.hidden = true;
      authState.textContent = "Locked";
      setStatus(authMessage, "info", "请输入后台密码登录。");
    } catch (error) {
      authPanel.hidden = false;
      workspacePanel.hidden = true;
      authState.textContent = "Error";
      setStatus(authMessage, "error", error.message);
    }
  }

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = loginForm.elements.password.value;
    setStatus(authMessage, "info", "正在登录...");

    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      loginForm.reset();
      await refreshSession();
    } catch (error) {
      authState.textContent = "Denied";
      setStatus(authMessage, "error", error.message);
    }
  });

  logoutButton?.addEventListener("click", async () => {
    try {
      await api("/api/logout", {
        method: "POST",
        body: JSON.stringify({})
      });
    } finally {
      await refreshSession();
    }
  });

  publishForm?.elements.title.addEventListener("input", (event) => {
    const slugInput = publishForm.elements.slug;
    if (!slugInput.dataset.manual) {
      slugInput.value = slugify(event.target.value);
    }
  });

  publishForm?.elements.slug.addEventListener("input", () => {
    publishForm.elements.slug.dataset.manual = publishForm.elements.slug.value ? "true" : "";
  });

  draftForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      mode: draftForm.elements.mode.value,
      input: draftForm.elements.input.value.trim(),
      notes: draftForm.elements.notes.value.trim(),
      category: draftForm.elements.category.value.trim()
    };

    setStatus(draftStatus, "info", "正在生成草稿...");
    renderSources(sourceList, []);

    try {
      const response = await api("/api/draft", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      fillPublishForm(publishForm, response.post);
      renderSources(sourceList, response.sources || []);
      const warningText = response.warnings?.length ? ` 注意：${response.warnings.join("；")}` : "";
      setStatus(draftStatus, "success", `草稿已生成，可以继续编辑后发布。${warningText}`);
    } catch (error) {
      setStatus(draftStatus, "error", error.message);
    }
  });

  publishForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: publishForm.elements.title.value.trim(),
      slug: publishForm.elements.slug.value.trim(),
      excerpt: publishForm.elements.excerpt.value.trim(),
      category: publishForm.elements.category.value.trim(),
      tags: publishForm.elements.tags.value.trim(),
      accent: publishForm.elements.accent.value,
      date: publishForm.elements.date.value,
      readingTime: publishForm.elements.readingTime.value.trim(),
      featured: publishForm.elements.featured.checked,
      body: publishForm.elements.body.value.trim()
    };

    setStatus(publishStatus, "info", "正在发布文章并同步博客...");

    try {
      const response = await api("/api/publish", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      publishStatus.innerHTML = `
        <strong>发布成功：</strong>
        <a href="${response.url}" target="_blank" rel="noreferrer">${response.url}</a>
      `;
      publishStatus.className = "status-box status-box-success";
    } catch (error) {
      setStatus(publishStatus, "error", error.message);
    }
  });

  refreshSession();
});
