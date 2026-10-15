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
let registrationDraft = null;
let resetEmail = "";
let resetPortal = "customer";
const locationMaps = new WeakMap();
const locationMarkers = new WeakMap();
let activeLocationMap = null;
let activeLocationMapForm = null;
let lastGeocoderRequestAt = 0;

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
  const changed = JSON.stringify(requests) !== JSON.stringify(data.requests);
  requests = data.requests;
  return changed;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function locationPickerMarkup(formId) {
  return `<div class="location-picker">
    <div class="location-tools">
      <button class="secondary-button" type="button" data-action="find-address" data-form="${formId}">Find typed address</button>
      <button class="secondary-button" type="button" data-action="open-map" data-form="${formId}">Choose on map</button>
      <button class="quiet-button" type="button" data-action="use-device-location" data-form="${formId}">Use current location</button>
    </div>
    <p class="form-hint">Map and address lookup use OpenStreetMap. Finding a typed address or selecting a map point sends that location to OpenStreetMap. You can edit the address and city; a map point is needed to match nearby electricians.</p>
    <div class="map-canvas hidden" id="${formId}-map" aria-label="Choose a location on the map"></div>
  </div>`;
}

function formLocationFields(form) {
  return {
    address: form.querySelector('[name="serviceAddress"]'),
    city: form.querySelector('[name="serviceCity"]'),
    latitude: form.querySelector('[name="latitude"]'),
    longitude: form.querySelector('[name="longitude"]'),
  };
}

function updateMapMarker(form, latitude, longitude) {
  const map = locationMaps.get(form);
  if (!map || !window.L) return;
  const point = [latitude, longitude];
  const marker = locationMarkers.get(form);
  if (marker) marker.setLatLng(point);
  else locationMarkers.set(form, window.L.marker(point).addTo(map));
  map.setView(point, 15);
}

async function geocoderRequest(url) {
  const wait = Math.max(0, 1000 - (Date.now() - lastGeocoderRequestAt));
  if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
  lastGeocoderRequestAt = Date.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error("The map address service is unavailable. Please try again.");
  return response.json();
}

function applyResolvedLocation(form, result, preserveAddress = false) {
  const fields = formLocationFields(form);
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("The map returned an invalid location.");
  }
  fields.latitude.value = String(latitude);
  fields.longitude.value = String(longitude);
  const address = result.address || {};
  const city = address.city || address.town || address.village || address.municipality ||
    address.city_district || "";
  if (city) fields.city.value = city;
  if (fields.address && !preserveAddress) fields.address.value = result.display_name || "";
  updateMapMarker(form, latitude, longitude);
}

async function geocodeAddress(form) {
  const { address, city } = formLocationFields(form);
  const query = [address?.value.trim(), city.value.trim()].filter(Boolean).join(", ");
  if (!query) throw new Error("Enter an address or city to find it on the map.");
  const params = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "1", q: query });
  const results = await geocoderRequest(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!results.length) throw new Error("Address not found. Check the address and city, or choose the location on the map.");
  applyResolvedLocation(form, results[0], true);
}

async function reverseGeocode(form, latitude, longitude) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    lat: String(latitude),
    lon: String(longitude),
  });
  const result = await geocoderRequest(`https://nominatim.openstreetmap.org/reverse?${params}`);
  if (!result.address) throw new Error("The map could not find an address here. Choose another point.");
  applyResolvedLocation(form, { ...result, lat: latitude, lon: longitude });
}

function openLocationMap(form) {
  if (!window.L) {
    showToast("The map could not load. Check your internet connection and try again.");
    return;
  }
  const mapElement = document.getElementById(`${form.id}-map`);
  mapElement.classList.remove("hidden");
  let map = locationMaps.get(form);
  if (!map) {
    const fields = formLocationFields(form);
    const hasCoordinates = fields.latitude.value && fields.longitude.value;
    const center = hasCoordinates
      ? [Number(fields.latitude.value), Number(fields.longitude.value)]
      : [20, 0];
    map = window.L.map(mapElement).setView(center, hasCoordinates ? 14 : 2);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on("click", async (event) => {
      const { lat, lng } = event.latlng;
      updateMapMarker(form, lat, lng);
      fields.latitude.value = String(lat);
      fields.longitude.value = String(lng);
      try {
        await reverseGeocode(form, lat, lng);
      } catch (error) {
        console.error("Could not find the address for the selected map location:", error);
        showToast(error.message);
      }
    });
    const currentLocationControl = window.L.control({ position: "topleft" });
    currentLocationControl.onAdd = () => {
      const button = window.L.DomUtil.create("button", "map-location-control");
      button.type = "button";
      button.title = "Use current location";
      button.setAttribute("aria-label", "Use current location");
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>';
      window.L.DomEvent.disableClickPropagation(button);
      window.L.DomEvent.on(button, "click", () => useDeviceLocation(form));
      return button;
    };
    currentLocationControl.addTo(map);
    locationMaps.set(form, map);
    activeLocationMap = map;
    activeLocationMapForm = form;
    if (hasCoordinates) updateMapMarker(form, center[0], center[1]);
  }
  window.setTimeout(() => map.invalidateSize(), 50);
}

async function useDeviceLocation(form) {
  if (!navigator.geolocation) {
    showToast("This browser does not support location access. Choose a point on the map instead.");
    return;
  }
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
    });
    openLocationMap(form);
    const { latitude, longitude } = position.coords;
    formLocationFields(form).latitude.value = String(latitude);
    formLocationFields(form).longitude.value = String(longitude);
    updateMapMarker(form, latitude, longitude);
    await reverseGeocode(form, latitude, longitude);
  } catch (error) {
    console.error("Could not get the device location:", error);
    showToast(error.code ? "Location access failed. Allow location access or choose a point on the map." : error.message);
  }
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
  document.getElementById("profile-button").classList.toggle("hidden", Boolean(session));
  document.getElementById("logout-button").classList.toggle("hidden", !session);
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
  const electricianDetails = request.electricianName
    ? `<div class="request-assignment"><span class="electrician-mark" aria-hidden="true">${icons.bolt}</span><span>Electrician: ${escapeHtml(request.electricianName)}${request.electricianPhone ? ` &middot; <a href="tel:${escapeHtml(request.electricianPhone)}">${escapeHtml(request.electricianPhone)}</a>` : ""}${request.estimatedResolution ? ` &middot; Estimated time: ${escapeHtml(request.estimatedResolution)}` : ""}</span></div>`
    : "";
  const addressInstructions = request.addressInstructions
    ? `<div class="request-address-instructions">Address instructions: ${escapeHtml(request.addressInstructions)}</div>`
    : "";
  const changeElectrician = request.status === "accepted"
    ? `<button class="change-electrician-button" type="button" data-action="change-electrician" data-id="${escapeHtml(request.id)}">Change electrician</button>`
    : "";
  const customerActions = request.status === "pending"
    ? `<div class="customer-request-actions"><button class="quiet-button" type="button" data-action="edit-request" data-id="${escapeHtml(request.id)}">Edit</button><button class="quiet-button delete-request-button" type="button" data-action="delete-request" data-id="${escapeHtml(request.id)}">Delete</button></div>`
    : "";
  return `
    <div class="request-row">
      <span class="request-icon">${icons[type?.icon || "general"]}</span>
      <div class="request-main">
        <div class="request-title">${escapeHtml(request.issue)}</div>
        <div class="request-meta">${escapeHtml(request.location)} &middot; ${escapeHtml(request.serviceAddress)} &middot; ${escapeHtml(request.serviceCity)} &middot; ${escapeHtml(request.date)}</div>
        ${addressInstructions}
        ${electricianDetails}${changeElectrician}
        ${customerActions}
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
      <button class="secondary-button service-area-button" type="button" data-action="edit-service-area">${session.serviceCity ? `Service city: ${escapeHtml(session.serviceCity)} · Edit` : "Set your service city"}</button>
    </div>
    ${session.serviceCity ? "" : `<div class="notification-summary">${icons.bell}<span>Set your service city and map location to receive nearby requests. Requests are first offered to the closest electrician, then shared with the city after 15 minutes.</span><button class="quiet-button" type="button" data-action="edit-service-area">Set location</button></div>`}
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
  const assignmentDetails = request.electricianName
    ? `<p class="incoming-assignment">Your contact: ${escapeHtml(request.electricianPhone || "Phone not provided")} &middot; Estimated time: ${escapeHtml(request.estimatedResolution || "Not provided")}</p>`
    : "";
  return `<article class="incoming-card">
    <div class="incoming-top"><span class="request-icon">${icons[type?.icon || "general"]}</span><div class="request-main"><div class="request-title">${escapeHtml(request.issue)} <span class="status-pill status-${escapeHtml(request.status)}">${statusLabel(request.status)}</span></div><div class="request-meta">${escapeHtml(request.location)} &middot; ${escapeHtml(request.serviceAddress)}, ${escapeHtml(request.serviceCity)} &middot; ${escapeHtml(request.date)}</div></div></div>
    ${request.addressInstructions ? `<p class="request-address-instructions incoming-address-instructions">Address instructions: ${escapeHtml(request.addressInstructions)}</p>` : ""}
    ${request.description ? `<p class="incoming-description">${escapeHtml(request.description)}</p>` : ""}
    ${assignmentDetails}
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
  if (activeLocationMap) activeLocationMap.remove();
  if (activeLocationMapForm) {
    locationMaps.delete(activeLocationMapForm);
    locationMarkers.delete(activeLocationMapForm);
  }
  activeLocationMap = null;
  activeLocationMapForm = null;
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

  if (["register-form", "login-form", "reset-request-form"].includes(form.id)) {
    if (!email) errors.email = "Enter your email address.";
    else if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Enter a valid email address.";
    }
  }
  if (["register-form", "login-form", "reset-form"].includes(form.id) && !password) {
    errors.password = form.id === "reset-form" ? "Enter your new password." : "Enter your password.";
  } else if (password && (password.length < 8 || password.length > 128)) {
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
  if (["register-otp-form", "reset-form"].includes(form.id)) {
    const code = String(values.get("code") || "").trim();
    if (!/^\d{6}$/.test(code)) errors.code = "Enter the 6-digit code sent to your email.";
  }
  if (form.id === "reset-form") {
    const confirmPassword = String(values.get("confirmPassword") || "");
    if (!confirmPassword) errors.confirmPassword = "Confirm your new password.";
    else if (password !== confirmPassword) errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

function openAuth(portal, mode, email = "") {
  registrationDraft = null;
  resetEmail = "";
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
    <div class="modal-heading"><div><h2 id="modal-title">${heading}</h2><p>${isRegistration ? "Verify your email before creating your account." : "Log in with the email and password you registered with."}</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="${isRegistration ? "register-form" : "login-form"}" class="form-grid" data-portal="${portal}" novalidate>
      ${nameField}
      <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" placeholder="you@example.com" autocomplete="email" value="${escapeHtml(email)}" maxlength="160" aria-describedby="email-error" ${isRegistration && !email ? "autofocus" : ""}><span class="field-error" id="email-error" data-field-error="email" aria-live="polite"></span></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${isRegistration ? "new-password" : "current-password"}" maxlength="128" aria-describedby="password-error"><span class="field-error" id="password-error" data-field-error="password" aria-live="polite"></span></div>
      ${confirmationField}
      ${isRegistration ? '<span class="form-hint">We’ll email you a verification code before creating your account.</span>' : '<span class="form-hint">Your password is stored securely. Use a password you don’t use elsewhere.</span>'}
      <div class="modal-footer"><button class="primary-button" type="submit">${isRegistration ? "Send verification code" : "Log in"}</button></div>
    </form>
    ${isRegistration ? "" : `<button class="quiet-button auth-switch" type="button" data-action="forgot-password" data-portal="${portal}" data-email="${escapeHtml(email)}">Forgot password?</button>`}
    <button class="quiet-button auth-switch" type="button" data-action="${switchAction}" data-portal="${portal}" data-email="${escapeHtml(email)}">${switchLabel}</button>
  </section>`);
}

function openRegistrationOtp() {
  const { email } = registrationDraft;
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">Verify your email</h2><p>Enter the 6-digit code we sent to ${escapeHtml(email)}. The code expires in 10 minutes.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="register-otp-form" class="form-grid" novalidate>
      <div class="field"><label for="code">Verification code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" aria-describedby="code-error" autofocus><span class="field-error" id="code-error" data-field-error="code" aria-live="polite"></span></div>
      <div class="modal-footer"><button class="primary-button" type="submit">Verify and create account</button></div>
    </form>
    <button class="quiet-button auth-switch" type="button" data-action="register-resend-code">Send a new code</button>
  </section>`);
}

function openPasswordReset(portal, email = "", showCodeForm = false) {
  resetPortal = portal;
  if (showCodeForm) {
    openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-heading"><div><h2 id="modal-title">Choose a new password</h2><p>If an account exists for ${escapeHtml(resetEmail)}, a verification code was sent. Enter that code and your new password.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
      <form id="reset-form" class="form-grid" novalidate>
        <div class="field"><label for="code">Verification code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" aria-describedby="code-error" autofocus><span class="field-error" id="code-error" data-field-error="code" aria-live="polite"></span></div>
        <div class="field"><label for="password">New password</label><input id="password" name="password" type="password" autocomplete="new-password" maxlength="128" aria-describedby="password-error"><span class="field-error" id="password-error" data-field-error="password" aria-live="polite"></span></div>
        <div class="field"><label for="confirm-password">Confirm new password</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" maxlength="128" aria-describedby="confirmPassword-error"><span class="field-error" id="confirmPassword-error" data-field-error="confirmPassword" aria-live="polite"></span></div>
        <div class="modal-footer"><button class="primary-button" type="submit">Reset password</button></div>
      </form>
      <button class="quiet-button auth-switch" type="button" data-action="reset-resend-code">Send a new code</button>
      <button class="quiet-button auth-switch" type="button" data-action="back-to-login">Back to log in</button>
    </section>`);
    return;
  }

  resetEmail = email.trim().toLowerCase();
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">Reset your password</h2><p>We’ll email you a code to verify your address.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="reset-request-form" class="form-grid" novalidate>
      <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" placeholder="you@example.com" autocomplete="email" value="${escapeHtml(email)}" maxlength="160" aria-describedby="email-error" autofocus><span class="field-error" id="email-error" data-field-error="email" aria-live="polite"></span></div>
      <div class="modal-footer"><button class="primary-button" type="submit">Send reset code</button></div>
    </form>
    <button class="quiet-button auth-switch" type="button" data-action="back-to-login">Back to log in</button>
  </section>`);
}

function openRequestForm(presetIssue = "", existingRequest = null) {
  if (!session) {
    openAuth("customer", "login");
    showToast("Please register first, then log in to raise a request.");
    return;
  }
  if (session.accountType !== "customer") {
    showToast("Customer accounts can raise service requests.");
    return;
  }
  const selectedIssue = existingRequest?.issue || presetIssue;
  const options = serviceTypes.map((type) => `<option value="${escapeHtml(type.name)}" ${selectedIssue === type.name ? "selected" : ""}>${escapeHtml(type.name)}</option>`).join("");
  const extraIssue = selectedIssue && selectedIssue !== "Other electrical issue" &&
    !serviceTypes.some((type) => type.name === selectedIssue)
    ? `<option value="${escapeHtml(selectedIssue)}" selected>${escapeHtml(selectedIssue)}</option>`
    : "";
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">${existingRequest ? "Edit your service request" : "Raise a service request"}</h2><p>${existingRequest ? "Update the details while the request is still unassigned." : "Tell us what’s wrong and an electrician will get back to you."}</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="request-form" class="form-grid" ${existingRequest ? `data-id="${escapeHtml(existingRequest.id)}"` : ""}>
      <div class="field"><label for="issue">What needs fixing?</label><select id="issue" name="issue" required><option value="">Choose an issue</option>${options}${extraIssue}<option value="Other electrical issue" ${selectedIssue === "Other electrical issue" ? "selected" : ""}>Other electrical issue</option></select></div>
      <div class="field"><label for="location">Where in the home is the issue?</label><input id="location" name="location" type="text" placeholder="e.g. Kitchen, second floor" required maxlength="100" value="${escapeHtml(existingRequest?.location || "")}"></div>
      <div class="field"><label for="service-address">Service address</label><input id="service-address" name="serviceAddress" type="text" placeholder="Street address and building" autocomplete="street-address" required maxlength="250" value="${escapeHtml(existingRequest?.serviceAddress || "")}"></div>
      <div class="field"><label for="address-instructions">Address instructions <span class="form-hint">(optional)</span></label><textarea id="address-instructions" name="addressInstructions" placeholder="Add directions, gate or entry details, landmarks, or anything else helpful." maxlength="500">${escapeHtml(existingRequest?.addressInstructions || "")}</textarea></div>
      <div class="field"><label for="service-city">City</label><input id="service-city" name="serviceCity" type="text" placeholder="City where service is needed" autocomplete="address-level2" required maxlength="120" value="${escapeHtml(existingRequest?.serviceCity || "")}"></div>
      ${locationPickerMarkup("request-form")}
      <input type="hidden" name="latitude" value="${existingRequest?.latitude ?? ""}">
      <input type="hidden" name="longitude" value="${existingRequest?.longitude ?? ""}">
      <div class="field"><label for="description">Tell us a little more <span class="form-hint">(optional)</span></label><textarea id="description" name="description" placeholder="For example: the fan switch in the main bedroom doesn't turn on the fan." maxlength="1000">${escapeHtml(existingRequest?.description || "")}</textarea></div>
      <div class="field"><label for="phone">Phone number <span class="form-hint">(optional)</span></label><input id="phone" name="phone" type="tel" placeholder="So your electrician can reach you" maxlength="30" value="${escapeHtml(existingRequest?.phone || "")}"></div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">${existingRequest ? "Save changes" : "Send request"}</button></div>
    </form>
  </section>`);
  if (existingRequest) {
    const form = document.getElementById("request-form");
    updateMapMarker(form, existingRequest.latitude, existingRequest.longitude);
  }
}

function openAcceptanceForm(id) {
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">Accept this request</h2><p>Share your contact number and expected time to resolve the issue.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="accept-request-form" class="form-grid" data-id="${escapeHtml(id)}">
      <div class="field"><label for="electrician-phone">Your phone number</label><input id="electrician-phone" name="electricianPhone" type="tel" autocomplete="tel" maxlength="30" required></div>
      <div class="field"><label for="estimated-resolution">Estimated time to resolve</label><input id="estimated-resolution" name="estimatedResolution" type="text" placeholder="e.g. 2–3 hours or by tomorrow" maxlength="100" required></div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Confirm acceptance</button></div>
    </form>
  </section>`);
}

function openServiceAreaForm() {
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">Your service location</h2><p>Set your base city and choose your location on the map so nearby jobs can be routed to you.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="service-area-form" class="form-grid">
      <div class="field"><label for="electrician-service-city">Service city</label><input id="electrician-service-city" name="serviceCity" type="text" placeholder="City where you take jobs" autocomplete="address-level2" maxlength="120" required value="${escapeHtml(session.serviceCity || "")}"></div>
      ${locationPickerMarkup("service-area-form")}
      <input type="hidden" name="latitude" value="${session.serviceLatitude ?? ""}">
      <input type="hidden" name="longitude" value="${session.serviceLongitude ?? ""}">
      <div class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Save service location</button></div>
    </form>
  </section>`);
}

function confirmChangeElectrician(id) {
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">Change electrician?</h2><p>Your request will be offered to another electrician. The current electrician won’t be assigned to it again.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <div class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Keep electrician</button><button class="primary-button" type="button" data-action="confirm-change-electrician" data-id="${escapeHtml(id)}">Find another electrician</button></div>
  </section>`);
}

function confirmDeleteRequest(id) {
  const request = requests.find((item) => item.id === id);
  if (!request) return;
  openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-heading"><div><h2 id="modal-title">Delete this request?</h2><p>“${escapeHtml(request.issue)}” will be permanently removed. You can only delete a request before an electrician accepts it.</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <div class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Keep request</button><button class="primary-button delete-confirm-button" type="button" data-action="confirm-delete-request" data-id="${escapeHtml(id)}">Delete request</button></div>
  </section>`);
}

async function deleteRequest(id) {
  try {
    await apiRequest(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshRequests();
    closeModal();
    render();
    showToast("Request deleted.");
  } catch (error) {
    console.error("Could not delete the service request:", error);
    if (error.status === 409) {
      try {
        await refreshRequests();
      } catch (refreshError) {
        console.error("Could not refresh requests after a delete conflict:", refreshError);
      }
      closeModal();
      render();
    }
    showToast(error.message);
  }
}

async function respondToRequest(id, status) {
  if (status === "accepted") {
    openAcceptanceForm(id);
    return;
  }
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

async function changeElectrician(id) {
  try {
    await apiRequest(`/api/requests/${encodeURIComponent(id)}/change-electrician`, { method: "POST" });
    await refreshRequests();
    closeModal();
    render();
    showToast("Request reopened. We’ll find another electrician for you.");
  } catch (error) {
    console.error("Could not change the assigned electrician:", error);
    showToast(error.message);
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action } = button.dataset;
  if (action === "open-register") openAuth(button.dataset.portal, "register", button.dataset.email || "");
  if (action === "open-login") openAuth(button.dataset.portal, "login", button.dataset.email || "");
  if (action === "forgot-password") openPasswordReset(button.dataset.portal, button.dataset.email || "");
  if (action === "back-to-login") openAuth(resetPortal, "login", resetEmail);
  if (action === "register-resend-code" && registrationDraft) {
    try {
      await apiRequest("/api/auth/register/send-code", {
        method: "POST",
        body: JSON.stringify(registrationDraft),
      });
      showToast("A new verification code has been sent.");
    } catch (error) {
      console.error("Unable to resend registration verification code:", error);
      showToast(error.message);
    }
  }
  if (action === "reset-resend-code" && resetEmail) {
    try {
      await apiRequest("/api/auth/password-reset/send-code", {
        method: "POST",
        body: JSON.stringify({ email: resetEmail }),
      });
      showToast("If that email is registered, a new code has been sent.");
    } catch (error) {
      console.error("Unable to resend password reset code:", error);
      showToast(error.message);
    }
  }
  if (action === "electrician-portal") openAuth("electrician", "login");
  if (action === "close-modal") closeModal();
  if (action === "new-request") openRequestForm();
  if (action === "quick-request") openRequestForm(button.dataset.issue);
  if (action === "edit-request") {
    const request = requests.find((item) => item.id === button.dataset.id);
    if (request?.status === "pending") openRequestForm("", request);
  }
  if (action === "delete-request") confirmDeleteRequest(button.dataset.id);
  if (action === "confirm-delete-request") deleteRequest(button.dataset.id);
  if (action === "my-requests") setView("requests");
  if (action === "respond") respondToRequest(button.dataset.id, button.dataset.status);
  if (action === "change-electrician") confirmChangeElectrician(button.dataset.id);
  if (action === "confirm-change-electrician") changeElectrician(button.dataset.id);
  if (action === "edit-service-area") openServiceAreaForm();
  if (action === "open-map") openLocationMap(document.getElementById(button.dataset.form));
  if (action === "find-address") {
    const form = document.getElementById(button.dataset.form);
    geocodeAddress(form).then(() => {
      openLocationMap(form);
      showToast("Address found. Check or adjust its pin on the map.");
    }).catch((error) => {
      console.error("Could not find the entered address on the map:", error);
      showToast(error.message);
    });
  }
  if (action === "use-device-location") useDeviceLocation(document.getElementById(button.dataset.form));
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "register-form") {
    event.preventDefault();
    const form = event.target;
    const validationErrors = validateAuthForm(form);
    setFieldErrors(form, validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    const formData = new FormData(form);
    const email = String(formData.get("email")).trim().toLowerCase();
    const name = String(formData.get("name")).trim();
    const password = String(formData.get("password"));
    const portal = form.dataset.portal;
    const draft = { name, email, password, accountType: portal };
    try {
      await apiRequest("/api/auth/register/send-code", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      registrationDraft = draft;
      openRegistrationOtp();
      showToast("A verification code has been sent to your email.");
    } catch (error) {
      console.error("Unable to send registration verification code:", error);
      if (error.fieldErrors) setFieldErrors(form, error.fieldErrors);
      else showToast(error.message);
    }
  }
  if (event.target.id === "register-otp-form") {
    event.preventDefault();
    const form = event.target;
    const validationErrors = validateAuthForm(form);
    setFieldErrors(form, validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    if (!registrationDraft) {
      openAuth("customer", "register");
      showToast("Please enter your registration details again.");
      return;
    }
    const code = String(new FormData(form).get("code")).trim();
    try {
      await apiRequest("/api/auth/register/verify-code", {
        method: "POST",
        body: JSON.stringify({ ...registrationDraft, code }),
      });
      const { accountType, email } = registrationDraft;
      registrationDraft = null;
      closeModal();
      openAuth(accountType, "login", email);
      showToast("Email verified and account created. Please log in.");
    } catch (error) {
      console.error("Unable to verify registration code:", error);
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
  if (event.target.id === "reset-request-form") {
    event.preventDefault();
    const form = event.target;
    const validationErrors = validateAuthForm(form);
    setFieldErrors(form, validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    const email = String(new FormData(form).get("email")).trim().toLowerCase();
    try {
      await apiRequest("/api/auth/password-reset/send-code", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      resetEmail = email;
      openPasswordReset(resetPortal, email, true);
      showToast("If that email is registered, a reset code has been sent.");
    } catch (error) {
      console.error("Unable to send password reset code:", error);
      if (error.fieldErrors) setFieldErrors(form, error.fieldErrors);
      else showToast(error.message);
    }
  }
  if (event.target.id === "reset-form") {
    event.preventDefault();
    const form = event.target;
    const validationErrors = validateAuthForm(form);
    setFieldErrors(form, validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    const formData = new FormData(form);
    const code = String(formData.get("code")).trim();
    const password = String(formData.get("password"));
    try {
      await apiRequest("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ email: resetEmail, code, password }),
      });
      const email = resetEmail;
      resetEmail = "";
      closeModal();
      openAuth(resetPortal, "login", email);
      showToast("Password updated. Please log in with your new password.");
    } catch (error) {
      console.error("Unable to reset password:", error);
      if (error.fieldErrors) setFieldErrors(form, error.fieldErrors);
      else showToast(error.message);
    }
  }
  if (event.target.id === "request-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    const latitude = Number(formData.get("latitude"));
    const longitude = Number(formData.get("longitude"));
    if (!String(formData.get("latitude")) || !String(formData.get("longitude")) ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      showToast("Find your typed address on the map or choose the service location on the map.");
      return;
    }
    const request = {
      issue: String(formData.get("issue")),
      location: String(formData.get("location")).trim(),
      serviceAddress: String(formData.get("serviceAddress")).trim(),
      addressInstructions: String(formData.get("addressInstructions")).trim(),
      serviceCity: String(formData.get("serviceCity")).trim(),
      latitude,
      longitude,
      description: String(formData.get("description")).trim(),
      phone: String(formData.get("phone")).trim(),
    };
    try {
      const requestId = event.target.dataset.id;
      await apiRequest(requestId ? `/api/requests/${encodeURIComponent(requestId)}` : "/api/requests", {
        method: requestId ? "PUT" : "POST",
        body: JSON.stringify(request),
      });
      await refreshRequests();
      closeModal();
      if (!requestId) activeView = "home";
      render();
      showToast(requestId
        ? "Request updated. Electricians will see the latest details."
        : "Request sent. An electrician will review it shortly.");
    } catch (error) {
      console.error("Could not send service request:", error);
      if (requestId && error.status === 409) {
        try {
          await refreshRequests();
        } catch (refreshError) {
          console.error("Could not refresh requests after an edit conflict:", refreshError);
        }
        closeModal();
        render();
      }
      showToast(error.message);
    }
  }
  if (event.target.id === "accept-request-form") {
    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    try {
      await apiRequest(`/api/requests/${encodeURIComponent(form.dataset.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "accepted",
          electricianPhone: String(formData.get("electricianPhone")).trim(),
          estimatedResolution: String(formData.get("estimatedResolution")).trim(),
        }),
      });
      await refreshRequests();
      closeModal();
      document.getElementById("notification-dot").classList.remove("hidden");
      render();
      showToast("Request accepted. The customer can see your contact details and estimate.");
    } catch (error) {
      console.error("Could not accept the service request:", error);
      showToast(error.message);
    }
  }
  if (event.target.id === "service-area-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    const latitude = Number(formData.get("latitude"));
    const longitude = Number(formData.get("longitude"));
    if (!String(formData.get("latitude")) || !String(formData.get("longitude")) ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      showToast("Choose your service location on the map before saving.");
      return;
    }
    try {
      const data = await apiRequest("/api/profile/service-area", {
        method: "PUT",
        body: JSON.stringify({
          city: String(formData.get("serviceCity")).trim(),
          latitude,
          longitude,
        }),
      });
      session = data.user;
      closeModal();
      render();
      showToast("Your service location is saved.");
    } catch (error) {
      console.error("Could not save the electrician service location:", error);
      showToast(error.message);
    }
  }
});

document.addEventListener("input", (event) => {
  const form = event.target.form;
  if (!form) return;
  if (["request-form", "service-area-form"].includes(form.id) &&
      ["serviceAddress", "serviceCity"].includes(event.target.name)) {
    formLocationFields(form).latitude.value = "";
    formLocationFields(form).longitude.value = "";
    locationMarkers.get(form)?.remove();
    locationMarkers.delete(form);
    return;
  }
  if (!["register-form", "login-form"].includes(form.id)) return;
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
document.getElementById("profile-button").addEventListener("click", () => {
  openAuth("customer", "login");
});
document.getElementById("logout-button").addEventListener("click", async () => {
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
  let refreshInProgress = false;
  window.setInterval(async () => {
    if (!session || document.hidden || refreshInProgress) return;
    refreshInProgress = true;
    try {
      if (await refreshRequests()) {
        document.getElementById("notification-dot").classList.remove("hidden");
        render();
      }
    } catch (error) {
      console.error("Could not refresh incoming service requests:", error);
    } finally {
      refreshInProgress = false;
    }
  }, 5_000);
}

bootstrap();
