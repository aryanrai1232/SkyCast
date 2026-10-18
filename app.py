"""SkyCast web server (Flask).

Browser  ->  /api/weather  ->  this server  ->  OpenWeatherMap
The API key lives only on the server (environment variable or config.py).
"""
from __future__ import annotations

import os
import threading
import time

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

import api

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # correct client IP behind a proxy

CACHE_TTL = 600        # seconds: identical lookups reuse the answer (saves your API quota)
CACHE_MAX = 500
RATE_LIMIT = 60        # requests per IP ...
RATE_WINDOW = 60       # ... per this many seconds

_lock = threading.Lock()
_cache: dict = {}
_hits: dict = {}


def _rate_limited(ip: str) -> bool:
    now = time.time()
    with _lock:
        recent = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        recent.append(now)
        _hits[ip] = recent
        if len(_hits) > 5000:  # forget idle visitors
            for key in [k for k, v in _hits.items() if now - v[-1] > RATE_WINDOW]:
                del _hits[key]
        return len(recent) > RATE_LIMIT


def _cache_get(key):
    with _lock:
        item = _cache.get(key)
        if item and time.time() - item[0] < CACHE_TTL:
            return item[1]
    return None


def _cache_put(key, value):
    with _lock:
        if len(_cache) >= CACHE_MAX:
            oldest = sorted(_cache, key=lambda k: _cache[k][0])[: CACHE_MAX // 5]
            for k in oldest:
                del _cache[k]
        _cache[key] = (time.time(), value)


def _error(message: str, status: int):
    return jsonify(error=message), status


@app.get("/api/weather")
def weather():
    if _rate_limited(request.remote_addr or "unknown"):
        return _error("Too many requests. Please wait a minute.", 429)

    units = request.args.get("units", "metric")
    if units not in ("metric", "imperial"):
        units = "metric"

    query = (request.args.get("q") or "").strip()
    lat_arg, lon_arg = request.args.get("lat"), request.args.get("lon")

    if query:
        if len(query) > 80:
            return _error("That city name is too long.", 400)
        key, kwargs = ("q", query.lower(), units), {"query": query}
    elif lat_arg is not None and lon_arg is not None:
        try:
            lat, lon = float(lat_arg), float(lon_arg)
        except ValueError:
            return _error("Invalid coordinates.", 400)
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return _error("Invalid coordinates.", 400)
        key, kwargs = ("ll", round(lat, 2), round(lon, 2), units), {"lat": lat, "lon": lon}
    else:
        return _error("Please enter a city name.", 400)

    cached = _cache_get(key)
    if cached:
        return jsonify(cached)
    try:
        bundle = api.fetch_weather(units=units, **kwargs)
    except api.WeatherError as exc:
        return _error(str(exc), exc.status)
    _cache_put(key, bundle)
    return jsonify(bundle)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/healthz")
def healthz():
    return "ok", 200, {"Content-Type": "text/plain"}


@app.get("/sw.js")
def service_worker():
    # must be served from the site root so it can control the whole app
    response = send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(app.static_folder, "manifest.webmanifest",
                               mimetype="application/manifest+json")



@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' https://openweathermap.org https://lh3.googleusercontent.com data:; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "script-src 'self'; script-src 'self'; connect-src 'self' https://openweathermap.org; https://openweathermap.org; "
        "frame-ancestors 'none'; base-uri 'self'"
    )
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response



if __name__ == "__main__":
    # local development only; production uses gunicorn (see Procfile)
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=True)
