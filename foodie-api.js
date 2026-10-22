(() => {
  const config = window.FOODIE_CONFIG || {};
  if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase?.createClient) return;

  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  let authPromise;

  async function getAccessToken() {
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

  async function searchNearby({ latitude, longitude, cuisine = "all", radiusMeters = 5000, maxPriceTier = null }) {
    const token = await getAccessToken();
    const { data, error } = await client.functions.invoke("nearby-food", {
      body: { latitude, longitude, cuisine, radiusMeters, maxPriceTier },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) throw new Error("Live food search is unavailable. Check the Edge Function setup.");
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function renderPlaces(container, places) {
    container.replaceChildren();
    if (!places.length) {
      const empty = document.createElement("div");
      empty.className = "empty-saved";
      empty.textContent = "No live places matched these filters. Try a wider radius or price cap.";
      container.append(empty);
      return;
    }
    for (const place of places) {
      const row = document.createElement("article");
      row.className = "nearby-row";
      const emoji = document.createElement("span");
      emoji.className = "nearby-emoji";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = "🍽️";
      const details = document.createElement("span");
      details.className = "nearby-info";
      const name = document.createElement("strong");
      name.textContent = place.name;
      const info = document.createElement("small");
      const price = place.priceTier ? `${"$".repeat(place.priceTier)} · ` : "Price unavailable · ";
      info.textContent = `${place.address} · ${price}${place.distanceKm.toFixed(2)} km away`;
      const note = document.createElement("small");
      note.className = "halal-badge";
      note.textContent = "Halal certification not verified";
      details.append(name, info, note);
      row.append(emoji, details);
      if (place.googleMapsUri) {
        const link = document.createElement("a");
        link.href = place.googleMapsUri;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Map ↗";
        row.append(link);
      }
      container.append(row);
    }
    const attribution = document.createElement("p");
    attribution.className = "api-attribution";
    attribution.textContent = "Place data from Google Maps. Check details before travelling.";
    container.append(attribution);
  }

  async function searchAndRender({ latitude, longitude, cuisine = "all", radiusMeters = 5000, maxPriceTier = null, containerId = "cards" }) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="empty-saved">Finding nearby places…</div>';
    try {
      const result = await searchNearby({ latitude, longitude, cuisine, radiusMeters, maxPriceTier });
      renderPlaces(container, result.places || []);
      const title = document.getElementById("resultsTitle");
      if (title && containerId === "cards") title.textContent = "Live places near you";
    } catch (error) {
      container.innerHTML = "";
      const message = document.createElement("div");
      message.className = "empty-saved";
      message.textContent = `${error.message} Demo suggestions are still available below.`;
      container.append(message);
    }
  }

  window.FoodieAPI = { searchNearby, searchAndRender, renderPlaces };
})();

