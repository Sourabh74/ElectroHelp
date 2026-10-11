const STORAGE_KEY = "current-electrician-requests";
const SESSION_KEY = "current-electrician-session";
const USERS_KEY = "current-electrician-users";

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

let users = readStorage(USERS_KEY, []);
if (!Array.isArray(users)) users = [];
let session = readStorage(SESSION_KEY, null);
if (!session?.userId || !users.some((user) => user.id === session.userId)) {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}
let activeView = "home";

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`Unable to read ${key} from local storage`, error);
    return fallback;
  }
}

function getRequests() {
  const requests = readStorage(STORAGE_KEY, []);
  return Array.isArray(requests) ? requests : [];
}

function saveRequests(requests) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    return true;
  } catch (error) {
    console.error("Unable to save electrician requests", error);
    showToast("Could not save your request. Please check your browser storage.");
    return false;
  }
}

function saveSession(nextSession) {
  try {
    if (nextSession) localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    else localStorage.removeItem(SESSION_KEY);
    session = nextSession;
    updateProfile();
    return true;
  } catch (error) {
    console.error("Unable to save your sign-in details", error);
    showToast("Could not save your sign-in. Please check your browser storage.");
    return false;
  }
}

function saveUsers(nextUsers) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers));
    users = nextUsers;
    return true;
  } catch (error) {
    console.error("Unable to save your account", error);
    showToast("Could not save your account. Please check your browser storage.");
    return false;
  }
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: Uint8Array.from(atob(salt), (character) => character.charCodeAt(0)), iterations: 120000, hash: "SHA-256" },
    key,
    256,
  );
  return toBase64(new Uint8Array(hash));
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
  const requests = getRequests().filter((request) => request.customerEmail === session?.email);
  const pending = requests.filter((request) => request.status === "pending").length;
  const accepted = requests.filter((request) => request.status === "accepted").length;
  const completed = requests.filter((request) => request.status === "completed").length;
  document.getElementById("nav-count").textContent = String(requests.length);
  document.getElementById("nav-count").classList.toggle("hidden", requests.length === 0);

  if (activeView === "requests") {
    return `<div class="page-heading">
      <div><div class="eyebrow">Your home, taken care of</div><h1>My requests</h1><p>Keep track of your electrical service requests.</p></div>
      <button class="primary-button" type="button" data-action="new-request">${icons.bolt} New request</button>
    </div>
    <section class="panel"><div class="panel-header"><div><h2>All requests</h2><p>${requests.length} request${requests.length === 1 ? "" : "s"} in total</p></div></div>
      ${requests.length ? `<div class="request-list">${requests.slice().reverse().map(requestRow).join("")}</div>` : emptyState("No requests yet", "When something needs fixing, let us know and we'll find an electrician for you.", "Raise your first request", "new-request")}
    </section>`;
  }

  const recent = requests.slice().reverse().slice(0, 3);
  const statusMessage = requests.some((request) => request.status === "accepted" || request.status === "declined")
    ? `<div class="notification-summary">${icons.bell}<span>Request update: ${requests.filter((request) => request.status === "accepted" || request.status === "declined").length} request${requests.filter((request) => request.status === "accepted" || request.status === "declined").length === 1 ? " has" : "s have"} received an electrician response.</span></div>`
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
  const requests = getRequests().slice().reverse();
  const pending = requests.filter((request) => request.status === "pending");
  const accepted = requests.filter((request) => request.status === "accepted").length;
  const completed = requests.filter((request) => request.status === "completed").length;
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
      ${requests.length ? requests.map((request) => incomingCard(request)).join("") : emptyState("All caught up", "New customer requests will appear here as soon as they're submitted.", "", "")}
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

function openAuth(portal, mode, email = "") {
  const isRegistration = mode === "register";
  const portalLabel = portal === "electrician" ? "electrician" : "customer";
  const heading = isRegistration ? `Create ${portalLabel} account` : `${portalLabel[0].toUpperCase()}${portalLabel.slice(1)} log in`;
  const nameField = isRegistration
    ? `<div class="field"><label for="name">Your name</label><input id="name" name="name" type="text" placeholder="e.g. Alex Morgan" autocomplete="name" required autofocus maxlength="80"></div>`
    : "";
  const confirmationField = isRegistration
    ? `<div class="field"><label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></div>`
    : "";
  const switchAction = isRegistration ? "open-login" : "open-register";
  const switchLabel = isRegistration ? "Already registered? Log in" : "New here? Create an account";
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">${heading}</h2><p>${isRegistration ? "Register first, then log in to continue." : "Log in with the email and password you registered with."}</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="${isRegistration ? "register-form" : "login-form"}" class="form-grid" data-portal="${portal}">
      ${nameField}
      <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" placeholder="you@example.com" autocomplete="email" value="${escapeHtml(email)}" required maxlength="160" ${isRegistration && !email ? "autofocus" : ""}></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${isRegistration ? "new-password" : "current-password"}" required minlength="8" maxlength="128"></div>
      ${confirmationField}
      <span class="form-hint">Demo account data is stored in this browser. Use a password you don’t use elsewhere.</span>
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

function respondToRequest(id, status) {
  const requests = getRequests();
  const request = requests.find((item) => item.id === id);
  if (!request) {
    showToast("This request could not be found. Please refresh and try again.");
    return;
  }
  request.status = status;
  request.updatedAt = new Date().toISOString();
  if (!saveRequests(requests)) return;
  document.getElementById("notification-dot").classList.remove("hidden");
  render();
  showToast(status === "accepted" ? "Request accepted. The customer can see your response." : status === "declined" ? "Request declined. The customer can see your response." : "Job marked complete.");
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
    const formData = new FormData(event.target);
    const email = String(formData.get("email")).trim().toLowerCase();
    const name = String(formData.get("name")).trim();
    const password = String(formData.get("password"));
    const confirmPassword = String(formData.get("confirmPassword"));
    const portal = event.target.dataset.portal;
    if (!name || !email) return;
    if (password !== confirmPassword) {
      showToast("The passwords do not match.");
      return;
    }
    if (users.some((user) => user.email === email)) {
      showToast("An account with this email already exists. Please log in.");
      return;
    }
    try {
      const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
      const user = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        email,
        accountType: portal,
        salt,
        passwordHash: await hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      };
      if (!saveUsers([...users, user])) return;
      closeModal();
      openAuth(portal, "login", email);
      showToast("Account registered. Please log in to continue.");
    } catch (error) {
      console.error("Unable to register account", error);
      showToast("Could not register your account. Please try again.");
    }
  }
  if (event.target.id === "login-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    const email = String(formData.get("email")).trim().toLowerCase();
    const password = String(formData.get("password"));
    const portal = event.target.dataset.portal;
    const user = users.find((account) => account.email === email && account.accountType === portal);
    if (!user) {
      showToast(`No ${portal} account found. Please register first.`);
      return;
    }
    try {
      const passwordHash = await hashPassword(password, user.salt);
      if (passwordHash !== user.passwordHash) {
        showToast("Email or password is incorrect.");
        return;
      }
      if (saveSession({ userId: user.id, name: user.name, email: user.email, accountType: user.accountType })) {
        activeView = "home";
        closeModal();
        render();
        showToast(`Welcome back, ${user.name.split(" ")[0]}!`);
      }
    } catch (error) {
      console.error("Unable to log in", error);
      showToast("Could not log in right now. Please try again.");
    }
  }
  if (event.target.id === "request-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    const request = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      issue: String(formData.get("issue")),
      location: String(formData.get("location")).trim(),
      description: String(formData.get("description")).trim(),
      phone: String(formData.get("phone")).trim(),
      customerName: session.name,
      customerEmail: session.email,
      status: "pending",
      date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date()),
      createdAt: new Date().toISOString(),
    };
    const requests = getRequests();
    requests.push(request);
    if (!saveRequests(requests)) return;
    closeModal();
    activeView = "home";
    render();
    showToast("Request sent. An electrician will review it shortly.");
  }
});

document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => setView(link.dataset.view)));
document.getElementById("profile-button").addEventListener("click", () => {
  if (session) {
    saveSession(null);
    activeView = "home";
    render();
    showToast("You have signed out.");
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
    const answered = getRequests().filter((request) => request.customerEmail === session.email && ["accepted", "declined", "completed"].includes(request.status)).length;
    showToast(answered ? `You have ${answered} request update${answered === 1 ? "" : "s"}. Check your recent requests.` : "You're all caught up on notifications.");
  } else {
    const pending = getRequests().filter((request) => request.status === "pending").length;
    showToast(pending ? `You have ${pending} request${pending === 1 ? "" : "s"} waiting for your response.` : "You're all caught up on notifications.");
  }
});

updateProfile();
render();
