"""Shared authorization primitives for staging Cloud SQL access.

These helpers do not authenticate a browser session. They accept only an
identity already verified by the trusted application/worker boundary, then
make owner scoping explicit and set the transaction-local database context.
"""

from __future__ import annotations

import uuid
from typing import Any


def normalize_owner_id(value: Any, field_name: str = "owner_user_id") -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (ValueError, AttributeError) as error:
        raise ValueError(f"{field_name} must be a valid UUID.") from error


def require_owned_row(
    table: str,
    row: dict[str, Any],
    owner_user_id: str,
    owner_column: str = "owner_user_id",
) -> dict[str, Any]:
    normalized_owner = normalize_owner_id(owner_user_id)
    if not isinstance(row, dict):
        raise ValueError(f"Cloud SQL received an invalid row for {table}.")
    row_owner = normalize_owner_id(row.get(owner_column), f"{table}.{owner_column}")
    if row_owner != normalized_owner:
        raise PermissionError(f"Cloud SQL owner mismatch for {table}.")
    return dict(row)


def set_transaction_owner(cursor: Any, owner_user_id: str) -> str:
    normalized_owner = normalize_owner_id(owner_user_id)
    cursor.execute(
        "SELECT set_config('app.current_user_id', %s, true)",
        (normalized_owner,),
    )
    return normalized_owner
