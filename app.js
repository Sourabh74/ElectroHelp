const icons = {
  switch: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m10 14 4-4m-4 0 4 4" /></svg>',
  fan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c-2-3-7-3-7-1s3 3 7 1Zm0 0c1-4-1-8-3-7s-1 4 3 7Zm0 0c3 2 7 1 7-1s-4-2-7 1Zm0 0c-1 4 1 8 3 7s1-4-3-7Z" /><circle cx="12" cy="12" r="1.5" /><path d="M12 14v7" /></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4m-4-6a6 6 0 1 1 4 0c-.7.3-1 .9-1 2h-2c0-1.1-.3-1.7-1-2Z" /></svg>',
  outlet: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M9 9v3m6-3v3m-3 2v2" /></svg>',
  general: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L15 12l-3-3 2.7-2.7Z" /></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-3 9h7L9 22l2-9H5l8-11Z" /></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4" /></svg>',
};

const serviceTypes = [
  { name: "Switch not working", detail: "Lights, fans & appliances", icon: "switch" },
  { name: "Fan issue", detail: "Ceiling or exhaust fan", icon: "fan" },
  { name: "Light not working", detail: "Bulbs, fixtures & wiring", icon: "light" },
  { name: "Socket or outlet", detail: "Plug points & outlets", icon: "outlet" },
];

let session = null;
let requests = [];
let activeView = "home";

async function apiRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch (error) {
    console.error("Could not reach the Current server:", error);
    throw new Error("Cannot reach the server. Start the app with npm start and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) {
    const error = new Error(data.error || "The request could not be completed.");
    error.status = response.status;
    error.fieldErrors = data.fieldErrors;
    throw error;
  }
  return data;
}

async function refreshRequests() {
  const data = await apiRequest("/api/requests");
  requests = data.requests;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function updateProfile() {
  const name = session?.name || "Welcome";
  const initials = name === "Welcome" ? "?" : name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-role").textContent = session
    ? session.accountType === "electrician" ? "Electrician" : "Homeowner"
    : "Sign in to get started";
  document.getElementById("user-avatar").textContent = initials;
  document.getElementById("top-avatar").textContent = initials;
  document.getElementById("profile-button").setAttribute("aria-label", session ? `${name}, sign out` : "Sign in");
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  document.getElementById("page-crumb").textContent = view === "requests" ? "My requests" : "Overview";
  render();
}

function statusLabel(status) {
  const labels = { pending: "Awaiting response", accepted: "Accepted", declined: "Declined", completed: "Completed" };
  return labels[status] || "Awaiting response";
}

function requestRow(request) {
  const type = serviceTypes.find((item) => item.name === request.issue);
  return `
    <div class="request-row">
      <span class="request-icon">${icons[type?.icon || "general"]}</span>
      <div class="request-main">
        <div class="request-title">${escapeHtml(request.issue)}</div>
        <div class="request-meta">${escapeHtml(request.location)} &middot; ${escapeHtml(request.date)}</div>
      </div>
      <span class="status-pill status-${escapeHtml(request.status)}">${statusLabel(request.status)}</span>
    </div>`;
}

function emptyState(title, description, buttonLabel, action) {
  return `<div class="empty-state">
    <span class="empty-symbol">${icons.bolt}</span>
    <h3>${title}</h3><p>${description}</p>
    ${buttonLabel ? `<button class="primary-button" type="button" data-action="${action}">${buttonLabel}</button>` : ""}
  </div>`;
}

function customerView() {
  const customerRequests = requests;
  const pending = customerRequests.filter((request) => request.status === "pending").length;
  const accepted = customerRequests.filter((request) => request.status === "accepted").length;
  const completed = customerRequests.filter((request) => request.status === "completed").length;
  document.getElementById("nav-count").textContent = String(customerRequests.length);
  document.getElementById("nav-count").classList.toggle("hidden", customerRequests.length === 0);

  if (activeView === "requests") {
    return `<div class="page-heading">
      <div><div class="eyebrow">Your home, taken care of</div><h1>My requests</h1><p>Keep track of your electrical service requests.</p></div>
      <button class="primary-button" type="button" data-action="new-request">${icons.bolt} New request</button>
    </div>
    <section class="panel"><div class="panel-header"><div><h2>All requests</h2><p>${customerRequests.length} request${customerRequests.length === 1 ? "" : "s"} in total</p></div></div>
      ${customerRequests.length ? `<div class="request-list">${customerRequests.map(requestRow).join("")}</div>` : emptyState("No requests yet", "When something needs fixing, let us know and we'll find an electrician for you.", "Raise your first request", "new-request")}
    </section>`;
  }

  const recent = customerRequests.slice(0, 3);
  const statusMessage = customerRequests.some((request) => request.status === "accepted" || request.status === "declined")
    ? `<div class="notification-summary">${icons.bell}<span>Request update: ${customerRequests.filter((request) => request.status === "accepted" || request.status === "declined").length} request${customerRequests.filter((request) => request.status === "accepted" || request.status === "declined").length === 1 ? " has" : "s have"} received an electrician response.</span></div>`
    : "";

  return `${statusMessage}<div class="welcome-banner">
      <div class="welcome-text"><div class="eyebrow">A brighter home starts here</div><h1>Good to see you, ${escapeHtml(session?.name?.split(" ")[0] || "there")}.</h1><p>Something not working? Tell us what’s going on and we’ll connect you with a trusted electrician.</p></div>
      <button class="primary-button" type="button" data-action="new-request">${icons.bolt} Raise a request</button>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-icon warm">${icons.bolt}</span><div class="stat-copy"><span>Awaiting response</span><strong>${pending}</strong></div></div>
      <div class="stat-card"><span class="stat-icon">${icons.general}</span><div class="stat-copy"><span>In progress</span><strong>${accepted}</strong></div></div>
      <div class="stat-card"><span class="stat-icon neutral">${icons.outlet}</span><div class="stat-copy"><span>Completed</span><strong>${completed}</strong></div></div>
    </div>
    <h2 class="quick-title">What needs fixing?</h2>
    <div class="quick-grid">${serviceTypes.map((type) => `<button class="quick-card" type="button" data-action="quick-request" data-issue="${escapeHtml(type.name)}"><span class="quick-card-icon">${icons[type.icon]}</span><strong>${escapeHtml(type.name)}</strong><span>${escapeHtml(type.detail)}</span></button>`).join("")}</div>
    <section class="panel">
      <div class="panel-header"><div><h2>Recent requests</h2><p>Updates from your electrician</p></div>${requests.length ? '<button class="quiet-button" type="button" data-action="my-requests">View all &rarr;</button>' : ""}</div>
      ${recent.length ? `<div class="request-list">${recent.map(requestRow).join("")}</div>` : emptyState("Your home is in good hands", "Your requests and updates will show up here.", "", "")}
    </section>`;
}

function electricianView() {
  const electricianRequests = requests;
  const pending = electricianRequests.filter((request) => request.status === "pending");
  const accepted = electricianRequests.filter((request) => request.status === "accepted").length;
  const completed = electricianRequests.filter((request) => request.status === "completed").length;
  document.getElementById("nav-count").classList.add("hidden");
  document.getElementById("page-crumb").textContent = "Incoming requests";
  return `<div class="page-heading electrician-heading">
      <div><div class="eyebrow">Electrician workspace</div><h1>Incoming requests</h1><p>Review new jobs and keep customers in the loop.</p></div>
      <span class="availability">Available for work</span>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-icon warm">${icons.bolt}</span><div class="stat-copy"><span>Needs your response</span><strong>${pending.length}</strong></div></div>
      <div class="stat-card"><span class="stat-icon">${icons.general}</span><div class="stat-copy"><span>Accepted jobs</span><strong>${accepted}</strong></div></div>
      <div class="stat-card"><span class="stat-icon neutral">${icons.outlet}</span><div class="stat-copy"><span>Completed jobs</span><strong>${completed}</strong></div></div>
    </div>
    <section class="panel"><div class="panel-header"><div><h2>Customer requests</h2><p>Respond to a request to let the customer know</p></div><span class="status-pill">${pending.length} new</span></div>
      ${electricianRequests.length ? electricianRequests.map((request) => incomingCard(request)).join("") : emptyState("All caught up", "New customer requests will appear here as soon as they're submitted.", "", "")}
    </section>`;
}

function incomingCard(request) {
  const type = serviceTypes.find((item) => item.name === request.issue);
  const actionable = request.status === "pending";
  const actions = actionable
    ? `<div class="request-actions"><button class="secondary-button decline-button" type="button" data-action="respond" data-id="${escapeHtml(request.id)}" data-status="declined">Decline</button><button class="primary-button" type="button" data-action="respond" data-id="${escapeHtml(request.id)}" data-status="accepted">Accept request</button></div>`
    : request.status === "accepted"
      ? `<div class="request-actions"><button class="secondary-button" type="button" data-action="respond" data-id="${escapeHtml(request.id)}" data-status="completed">Mark complete</button></div>`
      : "";
  return `<article class="incoming-card">
    <div class="incoming-top"><span class="request-icon">${icons[type?.icon || "general"]}</span><div class="request-main"><div class="request-title">${escapeHtml(request.issue)} <span class="status-pill status-${escapeHtml(request.status)}">${statusLabel(request.status)}</span></div><div class="request-meta">${escapeHtml(request.location)} &middot; ${escapeHtml(request.date)}</div></div></div>
    ${request.description ? `<p class="incoming-description">${escapeHtml(request.description)}</p>` : ""}
    <div class="incoming-footer"><span class="customer-name">Requested by ${escapeHtml(request.customerName)}${request.phone ? ` &middot; ${escapeHtml(request.phone)}` : ""}</span>${actions}</div>
  </article>`;
}

function render() {
  const container = document.getElementById("app-view");
  if (!session) {
    container.innerHTML = `<div class="page-heading"><div><div class="eyebrow">Home electrical help</div><h1>Welcome to Current</h1><p>Register for an account, then log in to manage your service requests.</p></div></div>
      <section class="panel auth-panel">
        ${emptyState("Get the right help for your home", "Create your customer account first. Once registered, log in to report an electrical problem and follow its progress.", "", "")}
        <div class="auth-actions"><button class="primary-button" type="button" data-action="open-register" data-portal="customer">Create customer account</button><button class="secondary-button" type="button" data-action="open-login" data-portal="customer">Customer log in</button></div>
        <div class="portal-entry"><span>Are you an electrician?</span><button class="quiet-button" type="button" data-action="electrician-portal">Go to electrician portal &rarr;</button></div>
      </section>`;
    document.getElementById("nav-count").classList.add("hidden");
    return;
  }
  container.innerHTML = session.accountType === "electrician" ? electricianView() : customerView();
}

function openModal(content) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modal-backdrop";
  backdrop.innerHTML = content;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
  backdrop.querySelector("[autofocus]")?.focus();
}

function closeModal() {
  document.getElementById("modal-backdrop")?.remove();
}

function showToast(message) {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

function setFieldErrors(form, errors = {}) {
  form.querySelectorAll(".field-error").forEach((message) => {
    message.textContent = errors[message.dataset.fieldError] || "";
  });
  form.querySelectorAll("[name]").forEach((input) => {
    const invalid = Boolean(errors[input.name]);
    input.setAttribute("aria-invalid", String(invalid));
    if (invalid) input.setAttribute("aria-describedby", `${input.id}-error`);
    else input.removeAttribute("aria-describedby");
  });
}

function validateAuthForm(form) {
  const values = new FormData(form);
  const errors = {};
  const email = String(values.get("email") || "").trim();
  const password = String(values.get("password") || "");

  if (!email) errors.email = "Enter your email address.";
  else if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!password) errors.password = "Enter your password.";
  else if (password.length < 8 || password.length > 128) {
    errors.password = "Password must be between 8 and 128 characters.";
  }

  if (form.id === "register-form") {
    const name = String(values.get("name") || "").trim();
    const confirmPassword = String(values.get("confirmPassword") || "");
    if (!name) errors.name = "Enter your name.";
    else if (name.length > 80) errors.name = "Your name must be 80 characters or fewer.";
    if (!confirmPassword) errors.confirmPassword = "Confirm your password.";
    else if (password !== confirmPassword) errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

function openAuth(portal, mode, email = "") {
  const isRegistration = mode === "register";
  const portalLabel = portal === "electrician" ? "electrician" : "customer";
  const heading = isRegistration ? `Create ${portalLabel} account` : `${portalLabel[0].toUpperCase()}${portalLabel.slice(1)} log in`;
  const nameField = isRegistration
    ? `<div class="field"><label for="name">Your name</label><input id="name" name="name" type="text" placeholder="e.g. Alex Morgan" autocomplete="name" maxlength="80" aria-describedby="name-error"><span class="field-error" id="name-error" data-field-error="name" aria-live="polite"></span></div>`
    : "";
  const confirmationField = isRegistration
    ? `<div class="field"><label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" maxlength="128" aria-describedby="confirmPassword-error"><span class="field-error" id="confirmPassword-error" data-field-error="confirmPassword" aria-live="polite"></span></div>`
    : "";
  const switchAction = isRegistration ? "open-login" : "open-register";
  const switchLabel = isRegistration ? "Already registered? Log in" : "New here? Create an account";
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">${heading}</h2><p>${isRegistration ? "Register first, then log in to continue." : "Log in with the email and password you registered with."}</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="${isRegistration ? "register-form" : "login-form"}" class="form-grid" data-portal="${portal}" novalidate>
      ${nameField}
      <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" placeholder="you@example.com" autocomplete="email" value="${escapeHtml(email)}" maxlength="160" aria-describedby="email-error" ${isRegistration && !email ? "autofocus" : ""}><span class="field-error" id="email-error" data-field-error="email" aria-live="polite"></span></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${isRegistration ? "new-password" : "current-password"}" maxlength="128" aria-describedby="password-error"><span class="field-error" id="password-error" data-field-error="password" aria-live="polite"></span></div>
      ${confirmationField}
      <span class="form-hint">Your account and password hash are stored in PostgreSQL. Use a password you don’t use elsewhere.</span>
      <div class="modal-footer"><button class="primary-button" type="submit">${isRegistration ? "Create account" : "Log in"}</button></div>
    </form>
    <button class="quiet-button auth-switch" type="button" data-action="${switchAction}" data-portal="${portal}" data-email="${escapeHtml(email)}">${switchLabel}</button>
  </section>`);
}

function openRequestForm(presetIssue = "") {
  if (!session) {
    openAuth("customer", "login");
    showToast("Please register first, then log in to raise a request.");
    return;
  }
  if (session.accountType !== "customer") {
    showToast("Customer accounts can raise service requests.");
    return;
  }
  const options = serviceTypes.map((type) => `<option value="${escapeHtml(type.name)}" ${presetIssue === type.name ? "selected" : ""}>${escapeHtml(type.name)}</option>`).join("");
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">Raise a service request</h2><p>Tell us what’s wrong and an electrician will get back to you.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="request-form" class="form-grid">
      <div class="field"><label for="issue">What needs fixing?</label><select id="issue" name="issue" required><option value="">Choose an issue</option>${options}<option value="Other electrical issue">Other electrical issue</option></select></div>
      <div class="field"><label for="location">Where is the issue?</label><input id="location" name="location" type="text" placeholder="e.g. Kitchen, second floor" required maxlength="100"></div>
      <div class="field"><label for="description">Tell us a little more <span class="form-hint">(optional)</span></label><textarea id="description" name="description" placeholder="For example: the fan switch in the main bedroom doesn't turn on the fan." maxlength="1000"></textarea></div>
      <div class="field"><label for="phone">Phone number <span class="form-hint">(optional)</span></label><input id="phone" name="phone" type="tel" placeholder="So your electrician can reach you" maxlength="30"></div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Send request</button></div>
    </form>
  </section>`);
}

async function respondToRequest(id, status) {
  try {
    await apiRequest(`/api/requests/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await refreshRequests();
    document.getElementById("notification-dot").classList.remove("hidden");
    render();
    showToast(status === "accepted" ? "Request accepted. The customer can see your response." : status === "declined" ? "Request declined. The customer can see your response." : "Job marked complete.");
  } catch (error) {
    console.error("Could not update the service request:", error);
    showToast(error.message);
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action } = button.dataset;
  if (action === "open-register") openAuth(button.dataset.portal, "register", button.dataset.email || "");
  if (action === "open-login") openAuth(button.dataset.portal, "login", button.dataset.email || "");
  if (action === "electrician-portal") openAuth("electrician", "login");
  if (action === "close-modal") closeModal();
  if (action === "new-request") openRequestForm();
  if (action === "quick-request") openRequestForm(button.dataset.issue);
  if (action === "my-requests") setView("requests");
  if (action === "respond") respondToRequest(button.dataset.id, button.dataset.status);
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "register-form") {
    event.preventDefault();
    const form = event.target;
    const validationErrors = validateAuthForm(form);
    setFieldErrors(form, validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    const formData = new FormData(event.target);
    const email = String(formData.get("email")).trim().toLowerCase();
    const name = String(formData.get("name")).trim();
    const password = String(formData.get("password"));
    const confirmPassword = String(formData.get("confirmPassword"));
    const portal = event.target.dataset.portal;
    try {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, accountType: portal }),
      });
      closeModal();
      openAuth(portal, "login", email);
      showToast("Account registered. Please log in to continue.");
    } catch (error) {
      console.error("Unable to register account", error);
      if (error.fieldErrors) setFieldErrors(form, error.fieldErrors);
      else showToast(error.message);
    }
  }
  if (event.target.id === "login-form") {
    event.preventDefault();
    const form = event.target;
    const validationErrors = validateAuthForm(form);
    setFieldErrors(form, validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    const formData = new FormData(event.target);
    const email = String(formData.get("email")).trim().toLowerCase();
    const password = String(formData.get("password"));
    const portal = event.target.dataset.portal;
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, accountType: portal }),
      });
      session = data.user;
      await refreshRequests();
      updateProfile();
      activeView = "home";
      closeModal();
      render();
      showToast(`Welcome back, ${session.name.split(" ")[0]}!`);
    } catch (error) {
      console.error("Unable to log in", error);
      if (error.fieldErrors) setFieldErrors(form, error.fieldErrors);
      else showToast(error.message);
    }
  }
  if (event.target.id === "request-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    const request = {
      issue: String(formData.get("issue")),
      location: String(formData.get("location")).trim(),
      description: String(formData.get("description")).trim(),
      phone: String(formData.get("phone")).trim(),
    };
    try {
      await apiRequest("/api/requests", { method: "POST", body: JSON.stringify(request) });
      await refreshRequests();
      closeModal();
      activeView = "home";
      render();
      showToast("Request sent. An electrician will review it shortly.");
    } catch (error) {
      console.error("Could not send service request:", error);
      showToast(error.message);
    }
  }
});

document.addEventListener("input", (event) => {
  const form = event.target.form;
  if (!form || !["register-form", "login-form"].includes(form.id)) return;
  const errors = validateAuthForm(form);
  const fieldsToUpdate = new Set(
    [...form.querySelectorAll('[aria-invalid="true"]')].map((input) => input.name),
  );
  fieldsToUpdate.add(event.target.name);
  if (event.target.name === "password") fieldsToUpdate.add("confirmPassword");
  const visibleErrors = Object.fromEntries(
    [...fieldsToUpdate]
      .filter((name) => errors[name])
      .map((name) => [name, errors[name]]),
  );
  setFieldErrors(form, visibleErrors);
});

document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => setView(link.dataset.view)));
document.getElementById("profile-button").addEventListener("click", async () => {
  if (session) {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      session = null;
      requests = [];
      updateProfile();
      activeView = "home";
      render();
      showToast("You have signed out.");
    } catch (error) {
      console.error("Could not sign out:", error);
      showToast(error.message);
    }
  } else {
    openAuth("customer", "login");
  }
});
document.getElementById("notification-button").addEventListener("click", () => {
  if (!session) {
    openAuth("customer", "login");
    return;
  }
  document.getElementById("notification-dot").classList.add("hidden");
  if (session.accountType === "customer") {
    const answered = requests.filter((request) => ["accepted", "declined", "completed"].includes(request.status)).length;
    showToast(answered ? `You have ${answered} request update${answered === 1 ? "" : "s"}. Check your recent requests.` : "You're all caught up on notifications.");
  } else {
    const pending = requests.filter((request) => request.status === "pending").length;
    showToast(pending ? `You have ${pending} request${pending === 1 ? "" : "s"} waiting for your response.` : "You're all caught up on notifications.");
  }
});

async function bootstrap() {
  try {
    const data = await apiRequest("/api/auth/me");
    session = data.user;
    if (session) await refreshRequests();
  } catch (error) {
    if (error.status !== 401) {
      console.error("Could not connect to the Current API:", error);
      showToast(error.message);
    }
  }
  updateProfile();
  render();
}

bootstrap();
