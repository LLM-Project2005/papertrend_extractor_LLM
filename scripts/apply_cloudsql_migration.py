from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import quote, urlsplit


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply one reviewed SQL migration to Cloud SQL.")
    parser.add_argument("--file", required=True)
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required.")
    if os.environ.get("CLOUD_SQL_LOCAL_PROXY", "").lower() == "true":
        parsed = urlsplit(database_url)
        database_name = parsed.path.rstrip("/").split("/")[-1]
        database_url = (
            f"postgresql://{quote(parsed.username or '', safe='')}:{quote(parsed.password or '', safe='')}"
            f"@127.0.0.1:5432/{database_name}"
        )

    import psycopg

    sql_path = Path(args.file).resolve()
    sql = sql_path.read_text(encoding="utf-8")
    with psycopg.connect(database_url, autocommit=False) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql)
        connection.commit()
    print(f"Applied {sql_path.name} successfully.")


if __name__ == "__main__":
    main()
