
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ICON_URL = (code) => `https://openweathermap.org/img/wn/${safeIcon(code)}@2x.png`;

  /* ---------- helpers ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem("skycast:" + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("skycast:" + key, JSON.stringify(value));
      } catch {
        /* Storage may be full or blocked. */
      }
    },
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const safeIcon = (code) => (/^\d{2}[dn]$/.test(String(code ?? "")) ? String(code) : "01d");
  const queryOf = (c) => (c.country ? `${c.name},${c.country}` : c.name);

  const BACKGROUNDS = {
    Clear: "clear",
    Clouds: "clouds",
    Rain: "rain",
    Drizzle: "rain",
    Thunderstorm: "storm",
    Snow: "snow",
    Mist: "mist",
    Haze: "mist",
    Fog: "mist",
    Smoke: "mist",
    Dust: "mist",
  };

  const WEATHER_SYMBOLS = {
    "01": "wb_sunny",
    "02": "partly_cloudy_day",
    "03": "cloud",
    "04": "cloud",
    "09": "rainy",
    "10": "rainy",
    "11": "thunderstorm",
    "13": "ac_unit",
    "50": "foggy",
  };

  const state = {
    units: store.get("units", "metric"),
    theme: store.get("theme", "dark"),
    favorites: store.get("favorites", []),
    data: null,
    reqId: 0,
  };

  if (!Array.isArray(state.favorites)) state.favorites = [];

  function symbolFor(code) {
    return WEATHER_SYMBOLS[safeIcon(code).slice(0, 2)] || "cloud";
  }

  function formatSunTime(value) {
    if (value === null || value === undefined || value === "") return "Unavailable";

    // The API may return a Unix timestamp in seconds or milliseconds.
    if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
      const n = Number(value);
      const ms = n < 100000000000 ? n * 1000 : n;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    }

    // If the backend already formatted the time, keep that value.
    return String(value);
  }

  function attachIconFallbacks(container) {
    if (!container) return;

    container.querySelectorAll("img[data-weather-code]").forEach((img) => {
      img.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "material-symbols-outlined filled forecast-icon-fallback";
        fallback.setAttribute("aria-label", img.alt || "Weather condition");
        fallback.textContent = symbolFor(img.dataset.weatherCode);
        img.replaceWith(fallback);
      }, { once: true });
    });
  }

  /* ---------- talking to the server ---------- */
  async function fetchWeather(params) {
    const qs = new URLSearchParams({ ...params, units: state.units });
    let res;

    try {
      res = await fetch("/api/weather?" + qs);
    } catch {
      throw new Error("No internet connection.");
    }

    let body = {};
    try {
      body = await res.json();
    } catch {
      /* Response wasn't JSON. */
    }

    if (!res.ok) throw new Error(body.error || `Server error (${res.status}).`);
    return body;
  }

  async function load(params, { silent = false } = {}) {
    const id = ++state.reqId;
    if (!silent) setStatus("Loading…");

    try {
      const data = await fetchWeather(params);
      if (id !== state.reqId) return;

      if (!data.current) throw new Error("The weather service returned incomplete data.");

      state.data = data;
      store.set("last", queryOf(data.current));
      store.set("cache", data);
      render(data);
      setStatus("");
    } catch (err) {
      if (id !== state.reqId) return;
      setStatus(err.message + (state.data ? " Showing saved data." : ""), true);
    }
  }

  function setStatus(text, isError = false) {
    const el = $("status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("error", isError);
  }

  /* ---------- rendering ---------- */
  function render(data) {
    const c = data.current;
    const metric = (data.units || state.units) === "metric";
    const deg = metric ? "°C" : "°F";
    const windUnit = metric ? "m/s" : "mph";

    $("empty").hidden = true;
    $("weather").hidden = false;

    $("city").textContent = c.country ? `${c.name}, ${c.country}` : c.name;
    $("temp").textContent = `${c.temp}${deg}`;
    $("desc").textContent = c.description || "Current conditions";

    // The live weather icon is always the hero's fallback if the glossy art fails.
    const hero = $("heroIcon");
    hero.alt = c.description || "Current weather";
    hero.dataset.weatherCode = safeIcon(c.icon);
    hero.src = ICON_URL(c.icon);
    hero.onerror = () => {
      const wrapper = hero.parentElement;
      if (!wrapper) return;

      const fallback = document.createElement("span");
      fallback.className = "material-symbols-outlined filled hero-symbol-fallback";
      fallback.setAttribute("role", "img");
      fallback.setAttribute("aria-label", hero.alt);
      fallback.textContent = symbolFor(c.icon);
      hero.style.display = "none";
      hero.parentElement.appendChild(fallback);
    };

    // Four key measurements live in the main card.
    const stats = [
      ["Feels like", `${c.feels_like ?? "—"}${deg}`],
      ["Humidity", `${c.humidity ?? "—"}%`],
      ["Wind", `${c.wind ?? "—"} ${windUnit}`],
      ["Pressure", `${c.pressure ?? "—"} hPa`],
    ];

    $("stats").innerHTML = stats
      .map(([label, value]) =>
        `<div class="stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`
      )
      .join("");

    // Populate the dedicated sunrise and sunset card.
    const sunrise = $("sunriseValue");
    const sunset = $("sunsetValue");
    if (sunrise) sunrise.textContent = formatSunTime(c.sunrise);
    if (sunset) sunset.textContent = formatSunTime(c.sunset);

    // Hourly forecast: validate the data and include the active temperature unit.
    const hourly = Array.isArray(data.hourly) ? data.hourly : [];
    $("hourly").innerHTML = hourly.length
      ? hourly.map((h) => {
          const code = safeIcon(h.icon);
          const pop = Number(h.pop) || 0;
          return `
            <div class="hour">
              <div>${esc(h.label || "—")}</div>
              <img data-weather-code="${code}"
                   src="${ICON_URL(code)}"
                   alt="${esc(h.description || "Weather condition")}"
                   width="44" height="44" loading="lazy">
              <b>${esc(h.temp ?? "—")}°</b>
              <span class="pop">${pop > 0 ? "💧" + esc(pop) + "%" : ""}</span>
            </div>`;
        }).join("")
      : `<p class="forecast-empty">Hourly forecast is unavailable.</p>`;

    attachIconFallbacks($("hourly"));

    // Five-day forecast.
    const daily = Array.isArray(data.daily) ? data.daily : [];
    $("daily").innerHTML = daily.length
      ? daily.map((d) => {
          const code = safeIcon(d.icon);
          const pop = Number(d.pop) || 0;
          return `
            <li class="day">
              <span>${esc(d.day || "—")}</span>
              <img data-weather-code="${code}"
                   src="${ICON_URL(code)}"
                   alt="${esc(d.description || "Weather condition")}"
                   width="40" height="40" loading="lazy">
              <span class="pop">${pop > 0 ? "💧" + esc(pop) + "%" : ""}</span>
              <span class="lo">${esc(d.min ?? "—")}°</span>
              <span class="hi">${esc(d.max ?? "—")}°</span>
            </li>`;
        }).join("")
      : `<li class="forecast-empty">Daily forecast is unavailable.</li>`;

    attachIconFallbacks($("daily"));

    // Hide the decorative external image if it fails; the live icon remains.
    const art = document.querySelector(".hero-art-image");
    if (art) {
      art.onerror = () => {
        art.style.display = "none";
      };
    }

    document.body.dataset.weather = BACKGROUNDS[c.main] || "default";
    document.title = `${c.temp}${deg} ${c.name} · SkyCast`;

    const fetchedAt = Number(data.fetched_at);
    const updated = $("updated");
    if (updated) {
      updated.textContent = fetchedAt
        ? `Last updated: ${new Date(fetchedAt * 1000).toLocaleString([], {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}`
        : "Weather updated just now";
    }

    updateStar();
  }

  /* ---------- favorites ---------- */
  function renderFavorites() {
    const sel = $("favSelect");
    sel.innerHTML = "";

    const first = new Option(
      state.favorites.length ? "★ Favorites" : "★ No favorites yet",
      ""
    );
    sel.add(first);

    state.favorites.forEach((q) => sel.add(new Option(q, q)));
    sel.value = "";
  }

  function updateStar() {
    const isFav = !!state.data &&
      state.favorites.includes(queryOf(state.data.current));
    const btn = $("starBtn");

    btn.innerHTML = `<span class="material-symbols-outlined${isFav ? " filled" : ""}">star</span>`;
    btn.setAttribute("aria-pressed", String(isFav));
    btn.setAttribute("aria-label", isFav ? "Remove from favorites" : "Add to favorites");
    btn.title = isFav ? "Remove from favorites" : "Add to favorites";
  }

  /* ---------- units + theme ---------- */
  function updateUnitButtons() {
    const metric = state.units === "metric";
    $("unitC").setAttribute("aria-pressed", String(metric));
    $("unitF").setAttribute("aria-pressed", String(!metric));
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    $("themeBtn").textContent = state.theme === "dark" ? "🌙" : "☀️";
    $("themeBtn").setAttribute(
      "aria-label",
      state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
  }

  function setUnits(units) {
    if (state.units === units) return;

    state.units = units;
    store.set("units", units);
    updateUnitButtons();

    if (state.data) {
      const c = state.data.current;
      load({ lat: c.lat, lon: c.lon });
    }
  }

  /* ---------- events ---------- */
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("q").value.trim();
    if (text) load({ q: text });
  });

  $("locBtn").addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Your browser doesn't support location. Search for a city instead.", true);
      return;
    }

    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => load({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => setStatus(
        err.code === 1
          ? "Location permission was denied. Search for a city instead."
          : "Couldn't get your location. Search for a city instead.",
        true
      ),
      { timeout: 10000, maximumAge: 300000 }
    );
  });

  $("starBtn").addEventListener("click", () => {
    if (!state.data) return;

    const q = queryOf(state.data.current);
    const i = state.favorites.indexOf(q);

    if (i >= 0) state.favorites.splice(i, 1);
    else state.favorites.push(q);

    store.set("favorites", state.favorites);
    renderFavorites();
    updateStar();
  });

  $("favSelect").addEventListener("change", (e) => {
    const q = e.target.value;
    e.target.value = "";

    if (q) {
      $("q").value = q;
      load({ q });
    }
  });

  $("unitC").addEventListener("click", () => setUnits("metric"));
  $("unitF").addEventListener("click", () => setUnits("imperial"));

  $("themeBtn").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    store.set("theme", state.theme);
    applyTheme();
  });

  /* ---------- install as app ---------- */
  let installPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("installBtn").hidden = false;
  });

  $("installBtn").addEventListener("click", async () => {
    if (!installPrompt) return;

    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("installBtn").hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    $("installBtn").hidden = true;
  });

  /* ---------- keep data fresh ---------- */
  const REFRESH_MS = 10 * 60 * 1000;

  function refreshIfStale() {
    if (!state.data || document.hidden) return;
    if (Date.now() - state.data.fetched_at * 1000 < REFRESH_MS) return;

    const c = state.data.current;
    load({ lat: c.lat, lon: c.lon }, { silent: true });
  }

  setInterval(refreshIfStale, 60 * 1000);
  document.addEventListener("visibilitychange", refreshIfStale);

  /* ---------- start ---------- */
  applyTheme();
  updateUnitButtons();
  renderFavorites();

  const cached = store.get("cache", null);
  if (
    cached &&
    cached.units === state.units &&
    cached.current &&
    Array.isArray(cached.hourly) &&
    Array.isArray(cached.daily)
  ) {
    try {
      state.data = cached;
      render(cached);
    } catch {
      state.data = null;
    }
  }

  const last = store.get("last", "");
  if (last) {
    load({ q: last }, { silent: !!state.data });
  } else {
    setStatus("");
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* The app still works without the service worker. */
      });
    });
  }
})();
