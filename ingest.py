"""Build the local FIRMS database: python ingest.py (Python 3.10+)."""

import csv
import sqlite3
from datetime import date, time
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent


def observations(path, sensor):
    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            acquired = date.fromisoformat(row["acq_date"])
            clock = row["acq_time"].replace(":", "").zfill(4)
            utc_time = time(int(clock[:2]), int(clock[2:]))
            lat, lon = float(row["latitude"]), float(row["longitude"])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError(f"Invalid coordinates in {path.name}")
            yield (sensor, row["satellite"], acquired.isoformat(),
                   utc_time.isoformat(timespec="minutes"), lat, lon,
                   row["confidence"], row["version"], row["daynight"],
                   float(row["frp"]) if row["frp"] else None, path.name)


def main():
    with TemporaryDirectory(dir=ROOT) as staging:
        db_path = Path(staging) / "hotspots.sqlite"
        db = sqlite3.connect(db_path)
        try:
            with db:
                db.executescript("""
                    CREATE TABLE hotspots (
                        sensor TEXT, satellite TEXT, day_utc TEXT, time_utc TEXT,
                        latitude REAL, longitude REAL, confidence_raw TEXT,
                        version TEXT, daynight TEXT, frp_mw REAL, source_file TEXT,
                        UNIQUE(sensor, satellite, day_utc, time_utc, latitude,
                               longitude, confidence_raw, version, daynight, frp_mw)
                    );
                """)
                for folder, sensor in (("Modis", "MODIS"), ("VIIRS", "VIIRS")):
                    paths = sorted((ROOT / folder).glob("*.txt"))
                    if not paths:
                        raise FileNotFoundError(f"No FIRMS text files in {folder}")
                    for path in paths:
                        db.executemany(
                            "INSERT INTO hotspots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                            "ON CONFLICT DO NOTHING", observations(path, sensor)
                        )
                db.executescript("""
                    CREATE INDEX hotspots_date_region
                        ON hotspots(day_utc, latitude, longitude);
                    CREATE VIEW daily_counts AS
                        SELECT sensor, satellite, day_utc, count(*) AS detections
                        FROM hotspots GROUP BY sensor, satellite, day_utc;
                    CREATE VIEW shared_dates AS
                        SELECT day_utc FROM daily_counts GROUP BY day_utc
                        HAVING count(DISTINCT sensor) = 2;
                """)
            for row in db.execute(
                "SELECT sensor, count(*), min(day_utc), max(day_utc) "
                "FROM hotspots GROUP BY sensor"
            ):
                print(*row)
            print("Shared dates:", db.execute("SELECT count(*) FROM shared_dates").fetchone()[0])
        finally:
            db.close()
        db_path.replace(ROOT / db_path.name)


if __name__ == "__main__":
    main()
