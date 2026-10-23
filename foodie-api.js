(() => {
  const config = window.FOODIE_CONFIG || {};
  const client = config.supabaseUrl && config.supabasePublishableKey && window.supabase?.createClient
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;
  let authPromise;

  async function getAccessToken() {
    if (!client) throw new Error("Supabase is not configured. Check foodie-config.js and the Supabase client script.");
    const { data: sessionData } = await client.auth.getSession();
    if (sessionData.session?.access_token) return sessionData.session.access_token;
    if (!authPromise) {
      authPromise = client.auth.signInAnonymously().then(({ data, error }) => {
        if (error) throw error;
        return data.session?.access_token;
      }).finally(() => { authPromise = null; });
    }
    const token = await authPromise;
    if (!token) throw new Error("Could not create a search session. Check Supabase anonymous sign-in settings.");
    return token;
  }

  async function searchNearby({ latitude, longitude, area = "", searchTerm = "", cuisine = "all", radiusMeters = 5000, maxPriceTier = null }) {
    const token = await getAccessToken();
    const { data, error } = await client.functions.invoke("nearby-food", {
      body: { latitude, longitude, area, searchTerm, cuisine, radiusMeters: Math.min(radiusMeters, 10000), maxPriceTier },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) throw new Error(error.message || "Live food search is unavailable. Check the Edge Function setup.");
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function renderPlaces(container, places) {
    container.replaceChildren();
    if (!places.length) {
      const empty = document.createElement("div");
      empty.className = "empty-saved";
      empty.textContent = "No restaurant listings matched. Try a nearby area, wider radius, or another cuisine. OpenStreetMap coverage varies by location.";
      container.append(empty);
      return;
    }
    for (const place of places) {
      const row = document.createElement("article");
      row.className = "nearby-row";
      const details = document.createElement("span");
      details.className = "nearby-info";
      const name = document.createElement("strong");
      name.textContent = place.name;
      const info = document.createElement("small");
      const price = place.priceTier ? `${"$".repeat(place.priceTier)} · ` : "Price not listed · ";
      info.textContent = `${place.address} · ${price}${place.distanceKm.toFixed(2)} km away`;
      const note = document.createElement("small");
      note.className = "halal-badge";
      note.textContent = place.halalTagged ? "OpenStreetMap has a Halal tag · certification not verified" : "Halal certification not verified";
      details.append(name, info, note);
      const cuisine = document.createElement("small");
      cuisine.textContent = place.cuisine ? `Cuisine: ${place.cuisine}` : "Cuisine not tagged in OpenStreetMap";
      details.append(cuisine);
      row.append(details);
      if (place.mapUri || place.osmUri) {
        const link = document.createElement("a");
        link.href = place.mapUri || place.osmUri;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "OpenStreetMap ↗";
        row.append(link);
      }
      const directions = document.createElement("a");
      directions.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place.latitude},${place.longitude}`)}`;
      directions.target = "_blank";
      directions.rel = "noopener noreferrer";
      directions.textContent = "Directions ↗";
      row.append(directions);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "nearby-save";
      save.textContent = "♡ Save";
      save.setAttribute("aria-label", `Save ${place.name}`);
      save.onclick = () => {
        const key = "foodie-munch-live-saves-v1";
        let items = [];
        try { items = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
        const index = items.findIndex((item) => item.placeId === place.placeId);
        if (index >= 0) { items.splice(index, 1); save.textContent = "♡ Save"; }
        else { items.push(place); save.textContent = "✓ Saved"; }
        localStorage.setItem(key, JSON.stringify(items));
      };
      row.append(save);
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "nearby-save";
      skip.textContent = "Skip";
      skip.setAttribute("aria-label", `Skip ${place.name}`);
      skip.onclick = () => row.remove();
      row.append(skip);
      container.append(row);
    }
    const attribution = document.createElement("p");
    attribution.className = "api-attribution";
    attribution.innerHTML = 'Live place listings from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. Coverage and details vary; prices and Halal certification are not independently verified. Distances are straight-line estimates.';
    container.append(attribution);
  }

  async function searchAndRender({ latitude, longitude, area = "", searchTerm = "", cuisine = "all", radiusMeters = 5000, maxPriceTier = null, containerId = "cards" }) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="empty-saved">Finding nearby places…</div>';
    try {
      const result = await searchNearby({ latitude, longitude, area, searchTerm, cuisine, radiusMeters, maxPriceTier });
      renderPlaces(container, result.places || []);
      const title = document.getElementById("resultsTitle");
      if (title && containerId === "cards") title.textContent = "Restaurants near you";
    } catch (error) {
      container.innerHTML = "";
      const message = document.createElement("div");
      message.className = "empty-saved";
      message.textContent = error.message || "Live restaurant search failed. Check your connection and try again.";
      container.append(message);
    }
  }

  async function findLocation(area) {
    if (!area && window.foodieCoordinates) return window.foodieCoordinates;
    if (!area) throw new Error("Tap Locate me or enter a town or neighbourhood to find real nearby restaurants.");
    const token = await getAccessToken();
    const { data, error } = await client.functions.invoke("nearby-food", {
      body: { area, geocodeOnly: true },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) throw new Error(error.message || "Could not look up that location.");
    const result = data;
    if (result?.error) throw new Error(result.error);
    if (!result.location) throw new Error("We couldn't find that area. Try a town or neighbourhood in Malaysia.");
    window.foodieCoordinates = result.location;
    return result.location;
  }

  window.FoodieAPI = { searchNearby, searchAndRender, renderPlaces, findLocation };

  function initLiveSearch() {
    const cards = document.getElementById("cards");
    const title = document.getElementById("resultsTitle");
    if (!cards || !title) return;
    cards.style.visibility = "visible";
    document.querySelector(".demo-note")?.remove();
    const heading = document.querySelector("#results .eyebrow");
    if (heading) heading.textContent = "LIVE RESTAURANT SEARCH";
    const subtitle = document.querySelector("#results .section-sub");
    if (subtitle) subtitle.textContent = "Listings from OpenStreetMap. Coverage and details vary by area.";
    title.textContent = "Find restaurants near you";
    cards.replaceChildren();
    const prompt = document.createElement("div");
    prompt.className = "empty-saved";
    prompt.textContent = "Tap Locate me or enter a Malaysian town or neighbourhood, then choose Show food ideas for current restaurant listings.";
    cards.append(prompt);

    const searchInput = document.getElementById("foodSearch");
    if (searchInput) {
      const cleanInput = searchInput.cloneNode(true);
      searchInput.replaceWith(cleanInput);
      cleanInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runSearch(); } });
    }
    const areaInput = document.getElementById("manualLocation");
    const status = document.getElementById("locationStatus");
    const getFilters = () => ({
      searchTerm: document.getElementById("foodSearch")?.value.trim() || "",
      cuisine: document.querySelector("[data-cuisine].active")?.dataset.cuisine || "all",
      radiusMeters: document.getElementById("radius")?.value === "any" ? 10000 : Number(document.getElementById("radius")?.value || 5) * 1000,
      maxPriceTier: document.querySelector("[data-price].active")?.dataset.price === "all" ? null : Number(document.querySelector("[data-price].active")?.dataset.price),
    });
    async function runSearch(overrides = {}) {
      const button = document.getElementById("applyFilters");
      const manualArea = areaInput?.value.trim() || "";
      const params = { ...getFilters(), ...overrides };
      const dietary = [...document.querySelectorAll(".diet-filter:checked")].map((item) => item.value);
      if (dietary.includes("halal")) {
        showMessage("OpenStreetMap can contain Halal tags, but it cannot verify JAKIM certification. The strict Halal filter is unavailable until an official certification source is connected.");
        return;
      }
      if (dietary.length) {
        showMessage("Live dietary filtering is not available from the current OpenStreetMap data. Clear dietary filters to search restaurants.");
        return;
      }
      if (!window.FoodieAPI) { showMessage("The restaurant search connector failed to load. Refresh the page and try again."); return; }
      if (!window.foodieCoordinates && !manualArea) {
        locateThenSearch(params);
        return;
      }
      if (button) { button.disabled = true; button.textContent = "Searching…"; }
      if (status) status.textContent = "Searching current OpenStreetMap restaurant listings…";
      try {
        const location = await window.FoodieAPI.findLocation(manualArea);
        await window.FoodieAPI.searchAndRender({ ...params, ...location, area: manualArea, maxPriceTier: params.maxPriceTier, containerId: "cards" });
        if (title) title.textContent = "Restaurants near you";
        if (status) status.textContent = `${cards.querySelectorAll(".nearby-row").length} current listings found. Details and coverage vary by area.`;
      } catch (error) {
        showMessage(error.message || "Restaurant search failed. Check the function deployment and try again.");
        if (status) status.textContent = error.message || "Restaurant search failed.";
      } finally {
        if (button) { button.disabled = false; button.textContent = "Show food ideas"; }
      }
    }
    function showMessage(message) {
      cards.replaceChildren();
      const box = document.createElement("div"); box.className = "empty-saved"; box.textContent = message; cards.append(box);
    }
    function locateThenSearch(params = {}) {
      if (!navigator.geolocation) { showMessage("Location isn’t available in this browser. Enter a Malaysian town or neighbourhood above instead."); return; }
      if (status) status.textContent = "Getting your location after your request…";
      navigator.geolocation.getCurrentPosition(async (position) => {
        window.foodieCoordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        await runSearch(params);
      }, (error) => {
        const message = error.code === 1 ? "Location permission was declined. Enter a town or neighbourhood to search instead." : "Could not get your location. Enter a town or neighbourhood to search instead.";
        if (status) status.textContent = message;
        showMessage(message);
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    }
    document.getElementById("applyFilters").onclick = (event) => { event.preventDefault(); runSearch(); };
    document.getElementById("locate").onclick = (event) => { event.preventDefault(); locateThenSearch(); };
    document.getElementById("heroLocate").onclick = (event) => { event.preventDefault(); locateThenSearch(); };
    document.getElementById("useLocation").onclick = (event) => { event.preventDefault(); runSearch(); };
    document.querySelectorAll("[data-filter]").forEach((button) => button.onclick = () => {
      const term = button.dataset.filter === "Noodles" ? "noodle" : button.dataset.filter === "Budget friendly" ? "" : "restaurant";
      const input = document.getElementById("foodSearch"); if (input) input.value = term;
      runSearch({ searchTerm: term });
    });
    document.getElementById("spinBtn").onclick = async (event) => {
      event.preventDefault();
      const cuisines = ["Malay", "Indian", "Chinese", "Japanese", "Thai", "Western"];
      const cuisine = cuisines[Math.floor(Math.random() * cuisines.length)];
      const wheel = document.getElementById("wheel");
      if (wheel) wheel.style.transform = `rotate(${360 * 5 + Math.random() * 360}deg)`;
      if (!window.foodieCoordinates && !areaInput?.value.trim()) {
        showMessage("Choose Locate me or enter a Malaysian town or neighbourhood before spinning for nearby restaurants.");
        return;
      }
      const result = document.getElementById("wheelResult");
      if (result) { result.classList.add("show"); result.textContent = `The wheel picked ${cuisine}. Finding real restaurant listings…`; }
      await runSearch({ cuisine, searchTerm: "" });
      if (result) result.textContent = `The wheel picked ${cuisine}. Current matching restaurant listings are shown below.`;
    };
    const liveStyle = document.createElement("style");
    liveStyle.textContent = ".nearby-row{flex-wrap:wrap;padding:16px;background:#fff;border:1px solid #e8edf3;border-radius:14px;margin:10px 0}.nearby-row>a,.nearby-save{min-height:42px;padding:0 13px;border:0;border-radius:10px;background:#203d68;color:#fff;font:700 12px 'DM Sans',sans-serif;display:inline-flex;align-items:center;text-decoration:none}.nearby-save{background:#e9e2ff;color:#203d68}.api-attribution{font-size:11px;color:#60728a;line-height:1.5;margin-top:14px}.cards>.empty-saved{grid-column:1/-1}";
    document.head.append(liveStyle);
  }
  initLiveSearch();
})();

