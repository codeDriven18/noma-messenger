import os
import sys
import tempfile
from pathlib import Path

import pytest

# Isolated data dir per test session — must be set before the app is imported.
_tmp = tempfile.mkdtemp(prefix="noma-test-")
os.environ["NOMA_DATA_DIR"] = _tmp
os.environ["NOMA_FRONTEND_DIST"] = str(Path(_tmp) / "no-dist")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


_counter = iter(range(10_000))


@pytest.fixture
def make_user(client):
    def _make(name: str = "user"):
        username = f"{name}user{next(_counter)}"
        r = client.post("/api/auth/register", json={"username": username, "display_name": name.title(), "password": "secret1"})
        assert r.status_code == 200, r.text
        data = r.json()
        return {"id": data["user"]["id"], "username": username, "headers": {"Authorization": f"Bearer {data['token']}"}, "token": data["token"]}

    return _make
