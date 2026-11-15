# FireBridge Flask API

From the project directory, run:

```powershell
python -m pip install -r requirements.txt
python -m flask --app app run
```

If the database is missing or the input folders have changed, run `python ingest.py` first. The development API is at `http://127.0.0.1:5000`. React's local Vite origins on port 5173 are allowed. Set `FIREBRIDGE_FRONTEND_ORIGINS` to a comma-separated list of frontend origins for other environments.

| GET endpoint | Response |
|---|---|
| `/api/health` | Database readiness |
| `/api/coverage` | Coverage per satellite and dates with records from both instruments |
| `/api/daily` | Daily detections by sensor |
| `/api/hotspots` | GeoJSON points. Pass the returned `next_after` as `after` until it is null. Default page size 2,000, maximum 10,000. |
| `/api/comparison` | Active grid cells per day by sensor, adjustment factor, and held-out MAE |
| `/api/export` | CSV. Set `kind=daily` for counts or `kind=hotspots` for observations. |

The four data endpoints accept `date=2026-09-16` or inclusive `start` and `end` dates, plus optional `bbox=79.5,5.8,82,10` in west,south,east,north order. Daily, hotspots, and export also accept `sensor=MODIS` or `sensor=VIIRS`.

Dates must use `YYYY-MM-DD`. An omitted range endpoint defaults to the corresponding dataset boundary. Empty date parameters and combining `date` with `start` or `end` return HTTP 400. The readiness endpoint returns HTTP 503 for a missing, empty, or incompatible database.

`/api/map-clusters` returns 5-degree groups for one observation date. Pass a group's `lat_cell,lng_cell` as `cell` to `/api/hotspots` or `/api/export?kind=hotspots` to select that cell. Include its sensor and the original date and area filters to match the group exactly.

All dates are UTC. A null count indicates no records for that sensor and date anywhere in the database. Zero means there are records for the sensor and date, but none match the area filter. Hotspot files do not establish cloud-free observation coverage.

The comparison defaults to Northern Australia (113°E–147°E, 24°S–10°S) and returns raw detections alongside the grid counts. The comparison counts unique 1 km equal-area grid cells with detections each day, pooling satellites within each instrument. For a chosen filter with at least 10 paired days and positive training totals for both sensors, it fits the ratio of MODIS to VIIRS training totals using the first 70% of paired days. It reports mean absolute error before and after adjustment on the remaining days. This is an experimental comparison for the supplied data. Seasonal baselines require multi-year coverage.

