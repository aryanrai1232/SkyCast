HEAD
# SkyCast Web

Weather website + installable phone app (PWA). Flask backend hides your API key.

```
Browser (static/app.js)  ->  /api/weather  ->  app.py  ->  OpenWeatherMap
```

## Run on your computer
1. `pip install -r requirements.txt`
2. Copy `config.example.py` to `config.py` and paste your OpenWeatherMap key
3. `python app.py`
4. Open http://127.0.0.1:5000

## Put it online (free) with Render
1. Upload this folder to a GitHub repository (do NOT upload `config.py`).
2. On https://render.com: New + > Web Service > pick your repo.
3. Build command: `pip install -r requirements.txt`
   Start command: `gunicorn app:app --workers 1 --threads 8 --timeout 30`
   Instance type: Free
4. Environment > add `OPENWEATHER_API_KEY` = your key.
5. Create Web Service. Your link looks like https://skycast-xxxx.onrender.com

## Files
| File | Purpose |
|---|---|
| `app.py` | web server: routes, caching, rate limit, security headers |
| `api.py` | OpenWeatherMap calls + parsing (key stays here) |
| `templates/index.html` | the page |
| `static/style.css`, `static/app.js` | design and behavior |
| `static/sw.js`, `static/manifest.webmanifest`, `static/icons/` | makes it installable + offline |
| `Procfile`, `render.yaml`, `requirements.txt` | hosting setup |
=======
# SkyCast
7384ddff0382b5efcc8f9af6f0893743b49dd054
