"""Create or update the schema: python -m scripts.init_db

Uses Turso when TURSO_DATABASE_URL is set, otherwise data/weather.db.
Every statement in db/schema.sql is idempotent, so this is safe to re-run.
"""

from app import config
from app.db import get_database, init_schema


def main() -> None:
    config.load_local_env()
    init_schema()
    target = config.turso_database_url() or config.LOCAL_DB_PATH
    print(f"schema ready: {type(get_database()).__name__} {target}")


if __name__ == "__main__":
    main()
