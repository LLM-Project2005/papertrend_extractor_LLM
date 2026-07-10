FROM python:3.13-slim

WORKDIR /app

COPY cloudsql-migration-requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r /app/requirements.txt

COPY scripts/migrate_supabase_to_cloudsql.py /app/scripts/migrate_supabase_to_cloudsql.py
COPY scripts/verify_cloudsql_parity.py /app/scripts/verify_cloudsql_parity.py
COPY scripts/verify_storage_parity.py /app/scripts/verify_storage_parity.py

ENTRYPOINT ["python", "/app/scripts/migrate_supabase_to_cloudsql.py"]
