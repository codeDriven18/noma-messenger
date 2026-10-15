from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC timestamp (SQLite does not keep tz info)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat(timespec="milliseconds") + "Z"
