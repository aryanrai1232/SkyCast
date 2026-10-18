"""OpenWeatherMap access + parsing (web version). The API key never leaves the server."""
from __future__ import annotations

import os
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

import requests

BASE_URL = "https://api.openweathermap.org/data/2.5"
TIMEOUT = 10


class WeatherError(Exception):
    """Error whose message is safe to show to users; `status` is the HTTP code to return."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _api_key() -> str:
    key = os.environ.get("OPENWEATHER_API_KEY", "")
    if not key:
        try:  # local development: config.py next to app.py
            from config import API_KEY as key
        except ImportError:
            key = ""
    if not key or str(key).startswith("PASTE"):
        raise WeatherError("The server has no weather API key configured.", 500)
    return str(key)


def _get(endpoint: str, params: dict) -> dict:
    params = {**params, "appid": _api_key()}
    try:
        response = requests.get(f"{BASE_URL}/{endpoint}", params=params, timeout=TIMEOUT)
    except requests.exceptions.Timeout:
        raise WeatherError("The weather service timed out. Please try again.", 504) from None
    except requests.exceptions.RequestException:
        raise WeatherError("The weather service is unreachable right now.", 503) from None

    if response.status_code == 200:
        return response.json()
    if response.status_code == 404:
        raise WeatherError("City not found. Check the spelling or try 'City,CountryCode'.", 404)
    if response.status_code == 429:
        raise WeatherError("The weather service is busy. Try again in a minute.", 429)
    if response.status_code == 401:
        raise WeatherError("The weather service rejected the server's API key.", 502)
    raise WeatherError(f"Weather service error ({response.status_code}).", 502)


def _local(ts: int, tz_offset: int) -> datetime:
    return datetime.fromtimestamp(ts + tz_offset, timezone.utc)


def _parse_current(data: dict) -> dict:
    tz = data.get("timezone", 0)
    sys = data.get("sys", {})
    weather = data["weather"][0]
    return {
        "name": data["name"],
        "country": sys.get("country", ""),
        "lat": data["coord"]["lat"],
        "lon": data["coord"]["lon"],
        "dt": data["dt"],
        "tz": tz,
        "temp": round(data["main"]["temp"]),
        "feels_like": round(data["main"]["feels_like"]),
        "humidity": data["main"]["humidity"],
        "pressure": data["main"]["pressure"],
        "wind": round(data.get("wind", {}).get("speed", 0), 1),
        "description": weather["description"].title(),
        "main": weather["main"],
        "icon": weather["icon"],
        "sunrise": _local(sys["sunrise"], tz).strftime("%H:%M") if "sunrise" in sys else "--:--",
        "sunset": _local(sys["sunset"], tz).strftime("%H:%M") if "sunset" in sys else "--:--",
    }


def _parse_forecast(data: dict, today) -> tuple[list[dict], list[dict]]:
    tz = data.get("city", {}).get("timezone", 0)
    entries = data["list"]

    hourly = [
        {
            "label": _local(e["dt"], tz).strftime("%H:%M"),
            "temp": round(e["main"]["temp"]),
            "icon": e["weather"][0]["icon"],
            "pop": round(e.get("pop", 0) * 100),
        }
        for e in entries[:8]
    ]

    by_day = defaultdict(list)
    for e in entries:
        by_day[_local(e["dt"], tz).date()].append(e)

    daily = []
    for date in sorted(by_day)[:5]:
        items = by_day[date]
        icon = Counter(i["weather"][0]["icon"].replace("n", "d") for i in items).most_common(1)[0][0]
        daily.append(
            {
                "day": "Today" if date == today else date.strftime("%a"),
                "min": round(min(i["main"]["temp_min"] for i in items)),
                "max": round(max(i["main"]["temp_max"] for i in items)),
                "icon": icon,
                "pop": round(max(i.get("pop", 0) for i in items) * 100),
            }
        )
    return hourly, daily


def fetch_weather(query: str | None = None, lat: float | None = None,
                  lon: float | None = None, units: str = "metric") -> dict:
    if query:
        params = {"q": query, "units": units}
    elif lat is not None and lon is not None:
        params = {"lat": lat, "lon": lon, "units": units}
    else:
        raise WeatherError("Please enter a city name.", 400)

    current = _parse_current(_get("weather", params))
    forecast_raw = _get("forecast", {"lat": current["lat"], "lon": current["lon"], "units": units})
    today = _local(current["dt"], current["tz"]).date()
    hourly, daily = _parse_forecast(forecast_raw, today)
    return {"current": current, "hourly": hourly, "daily": daily,
            "units": units, "fetched_at": time.time()}
