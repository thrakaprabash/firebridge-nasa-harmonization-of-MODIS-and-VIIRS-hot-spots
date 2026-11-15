"""FireBridge API for the local FIRMS SQLite database."""

import csv
import io
import math
import os
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from flask import Flask, Response, g, jsonify, request, stream_with_context

app = Flask(__name__)
app.config["DATABASE"] = Path(__file__).with_name("hotspots.sqlite")
app.config["FRONTEND_ORIGINS"] = os.getenv(
    "FIREBRIDGE_FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
SENSORS = ("MODIS", "VIIRS")
FIELDS = ("sensor, satellite, day_utc, time_utc, latitude, longitude, "
          "confidence_raw, version, daynight, frp_mw, source_file")


def database():
    if "db" not in g:
        uri = Path(app.config["DATABASE"]).resolve().as_uri() + "?mode=ro"
        g.db = sqlite3.connect(uri, uri=True)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_database(error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


@app.after_request
def allow_frontend(response):
    origin = request.headers.get("Origin")
    if origin in app.config["FRONTEND_ORIGINS"]:
        response.headers["Access-Control-Allow-Origin"] = origin
    response.vary.add("Origin")
    return response


@app.errorhandler(ValueError)
def invalid_parameter(error):
    return jsonify(error=str(error)), 400


@app.errorhandler(sqlite3.Error)
def unavailable(error):
    app.logger.error("SQLite query failed: %s", error)
    return jsonify(error="Hotspot database unavailable. Run ingest.py and retry."), 503


@app.get("/api/health")
def health():
    database().execute("SELECT day_utc FROM hotspots LIMIT 1").fetchone()
    return jsonify(status="ok")


@app.get("/api/coverage")
def coverage():
    rows = database().execute(
        "SELECT sensor, satellite, min(day_utc) AS start, max(day_utc) AS end, "
        "count(*) AS days, sum(detections) AS detections FROM daily_counts "
        "GROUP BY sensor, satellite ORDER BY sensor, satellite"
    )
    return jsonify(satellites=[dict(row) for row in rows], shared_dates=[
        row[0] for row in database().execute("SELECT day_utc FROM shared_dates ORDER BY day_utc")
    ])


def filters(default_bbox=None):
    db = database()
    first, last = db.execute("SELECT min(day_utc), max(day_utc) FROM daily_counts").fetchone()
    if first is None:
        raise ValueError("The database contains no observations")
    day = request.args.get("date")
    try:
        start = date.fromisoformat(day or request.args.get("start", first))
        end = date.fromisoformat(day or request.args.get("end", last))
    except ValueError:
        raise ValueError("Use YYYY-MM-DD for date, start, and end") from None
    if day and ("start" in request.args or "end" in request.args):
        raise ValueError("Use date or start/end")
    if not 0 <= (end - start).days <= 366:
        raise ValueError("Choose an ordered date range spanning at most 367 days")
    sensor = request.args.get("sensor", "").upper()
    if sensor and sensor not in SENSORS:
        raise ValueError("sensor must be MODIS or VIIRS")
    clauses = ["day_utc BETWEEN ? AND ?"]
    params = [start.isoformat(), end.isoformat()]
    if sensor:
        clauses.append("sensor = ?")
        params.append(sensor)
    bbox = request.args.get("bbox", default_bbox)
    if bbox is not None:
        try:
            west, south, east, north = map(float, bbox.split(","))
        except ValueError:
            raise ValueError("bbox must contain west,south,east,north") from None
        if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south < north <= 90
                and west != east):
            raise ValueError("bbox coordinates are outside the valid range or define an empty area")
        clauses.append("latitude BETWEEN ? AND ?")
        params.extend((south, north))
        if west < east:
            clauses.append("longitude BETWEEN ? AND ?")
        else:
            clauses.append("(longitude >= ? OR longitude <= ?)")
        params.extend((west, east))
    return start, end, sensor, " AND ".join(clauses), params


def calendar(start, end, sensor, where, params, *, grid=False):
    db = database()
    available = {(row["day_utc"], row["sensor"]) for row in db.execute(
        "SELECT day_utc, sensor FROM daily_counts WHERE day_utc BETWEEN ? AND ?", params[:2]
    )}
    if grid:
        # Cylindrical equal-area projection with a 30-degree standard parallel.
        scale = math.cos(math.pi / 6)
        radius = 6371008.8
        db.create_function("grid_x", 1, lambda lon: math.floor(
            radius * scale * math.radians(lon) / 1000))
        db.create_function("grid_y", 1, lambda lat: math.floor(
            radius * math.sin(math.radians(lat)) / scale / 1000))
        query = (
            "SELECT day_utc, sensor, count(*) FROM (SELECT DISTINCT day_utc, sensor, "
            f"grid_x(longitude), grid_y(latitude) FROM hotspots WHERE {where}) "
            "GROUP BY day_utc, sensor"
        )
    else:
        query = f"SELECT day_utc, sensor, count(*) FROM hotspots WHERE {where} GROUP BY day_utc, sensor"
    counts = {(day, name): count for day, name, count in db.execute(query, params)}
    days = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    return [
        {"date": day, **{name: counts.get((day, name), 0) if (day, name) in available else None
                         for name in ((sensor,) if sensor else SENSORS)}}
        for day in days
    ]


@app.get("/api/daily")
def daily():
    return jsonify(metric="hotspot_detections", days=calendar(*filters()))


@app.get("/api/hotspots")
def hotspots():
    _, _, _, where, params = filters()
    try:
        limit = int(request.args.get("limit", "2000"))
        after = int(request.args.get("after", "0"))
    except ValueError:
        raise ValueError("limit and after must be integers") from None
    if not 1 <= limit <= 10000 or not 0 <= after <= 2**63 - 1:
        raise ValueError("limit must be 1–10000 and after must be a nonnegative SQLite row ID")
    rows = database().execute(
        f"SELECT rowid AS id, {FIELDS} FROM hotspots WHERE {where} AND rowid > ? "
        "ORDER BY rowid LIMIT ?", [*params, after, limit + 1]
    ).fetchall()
    return jsonify(type="FeatureCollection", next_after=rows[limit - 1]["id"] if len(rows) > limit else None,
                   features=[{
                       "type": "Feature", "id": row["id"],
                       "geometry": {"type": "Point", "coordinates": [row["longitude"], row["latitude"]]},
                       "properties": {key: row[key] for key in row.keys()
                                      if key not in ("id", "longitude", "latitude")},
                   } for row in rows[:limit]])


@app.get("/api/map-clusters")
def map_clusters():
    start, end, sensor, where, params = filters()
    if start != end:
        raise ValueError("Choose one observation date for the map")
    db = database()
    rows = db.execute(
        "SELECT sensor, avg(latitude) AS lat, avg(longitude) AS lng, count(*) AS count "
        f"FROM hotspots WHERE {where} "
        "GROUP BY sensor, min(35, cast((latitude+90)/5 AS integer)), "
        "min(71, cast((longitude+180)/5 AS integer))",
        params,
    ).fetchall()
    clusters = [dict(row) for row in rows]
    return jsonify(clusters=clusters, total=sum(row["count"] for row in clusters))


@app.get("/api/comparison")
def comparison():
    demo_bbox = "113,-24,147,-10"
    selected = filters(default_bbox=demo_bbox)
    if selected[2]:
        raise ValueError("Comparison requires both sensors. Omit the sensor parameter.")
    days = calendar(*selected, grid=True)
    raw_days = calendar(*selected)
    paired = [row for row in days if all(row[name] is not None for name in SENSORS)]
    validation = None
    factor = None
    if len(paired) >= 10:
        split = int(len(paired) * 0.7)
        train, holdout = paired[:split], paired[split:]
        baseline = sum(row["MODIS"] for row in train)
        candidate = sum(row["VIIRS"] for row in train)
        if baseline and candidate:
            factor = baseline / candidate
            def mae(multiplier):
                return sum(abs(row["MODIS"] - multiplier * row["VIIRS"])
                           for row in holdout) / len(holdout)
            validation = {
                "training_days": len(train), "holdout_days": len(holdout),
                "holdout_start": holdout[0]["date"], "holdout_end": holdout[-1]["date"],
                "raw_mae": mae(1),
                "adjusted_mae": mae(factor),
            }
    for row, raw in zip(days, raw_days):
        row["modis_detections"] = raw["MODIS"]
        row["viirs_detections"] = raw["VIIRS"]
        row["phase"] = (
            ("holdout" if row["date"] >= validation["holdout_start"] else "training")
            if validation and all(row[name] is not None for name in SENSORS) else None
        )
        row["viirs_adjusted"] = row["VIIRS"] * factor if factor is not None and row["VIIRS"] is not None else None
    return jsonify(metric="detected_active_cells_per_utc_day", grid_size_m=1000,
                   experimental=True, factor=factor, validation=validation, days=days,
                   region={"name": "Northern Australia" if "bbox" not in request.args else "Custom area",
                           "bbox": list(map(float, request.args.get("bbox", demo_bbox).split(",")))})


@app.get("/api/export")
def export():
    kind = request.args.get("kind", "hotspots")
    selected = filters()
    if kind == "daily":
        columns = ["date", *([selected[2]] if selected[2] else SENSORS)]
    elif kind == "hotspots":
        columns = FIELDS.split(", ")
    else:
        raise ValueError("kind must be hotspots or daily")

    @stream_with_context
    def generate():
        if kind == "daily":
            rows = ([day[column] for column in columns] for day in calendar(*selected))
        else:
            rows = database().execute(
                f"SELECT {FIELDS} FROM hotspots WHERE {selected[3]} ORDER BY day_utc, rowid", selected[4]
            )
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(columns)
        for index, row in enumerate(rows, 1):
            writer.writerow(row)
            if index % 2000 == 0:
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate()
        yield buffer.getvalue()

    return Response(generate(), mimetype="text/csv", headers={
        "Content-Disposition": f'attachment; filename="firebridge-{kind}.csv"'
    })
