"""The Turso client speaks Hrana over HTTP; these check the wire format against a fake server."""

import pytest

from app import config
from app.db import SqliteDatabase, TursoDatabase, get_database, insert_rows, split_script
from app.errors import DatabaseError


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def post(self, url, json, headers, timeout):
        self.requests.append({"url": url, "json": json, "headers": headers})
        return self.responses.pop(0)


def ok(result):
    return {"type": "ok", "response": {"type": "execute", "result": result}}


def turso(*responses):
    database = TursoDatabase("libsql://weather-demo.turso.io", "secret-token")
    database.session = FakeSession(*responses)
    return database


def test_query_encodes_args_and_decodes_rows():
    result = {"cols": [{"name": "name"}, {"name": "n"}, {"name": "t"}, {"name": "gone"}],
              "rows": [[{"type": "text", "value": "臺北市"}, {"type": "integer", "value": "7"},
                        {"type": "float", "value": 24.5}, {"type": "null"}]]}
    database = turso(FakeResponse(200, {"results": [ok(result), {"type": "ok"}]}))
    rows = database.query("SELECT ? , ?, ?", ("臺北市", 7, 24.5))
    assert rows == [{"name": "臺北市", "n": 7, "t": 24.5, "gone": None}]
    sent = database.session.requests[0]
    assert sent["url"] == "https://weather-demo.turso.io/v2/pipeline"
    assert sent["headers"]["Authorization"] == "Bearer secret-token"
    args = sent["json"]["requests"][0]["stmt"]["args"]
    assert args == [{"type": "text", "value": "臺北市"}, {"type": "integer", "value": "7"}, {"type": "float", "value": 24.5}]
    assert sent["json"]["requests"][-1] == {"type": "close"}


def test_batch_chains_conditions_and_detects_rollback():
    step_results = [{}, {}, None, None, {}]  # the second statement failed; ROLLBACK ran
    step_errors = [None, None, {"message": "UNIQUE constraint failed"}, None, None]
    response = {"results": [{"type": "ok", "response": {"type": "batch", "result": {"step_results": step_results, "step_errors": step_errors}}}]}
    database = turso(FakeResponse(200, response))
    with pytest.raises(DatabaseError, match="UNIQUE"):
        database.batch([("INSERT 1", ()), ("INSERT 2", ())])
    steps = database.session.requests[0]["json"]["requests"][0]["batch"]["steps"]
    assert [step["stmt"]["sql"] for step in steps] == ["BEGIN", "INSERT 1", "INSERT 2", "COMMIT", "ROLLBACK"]
    assert steps[2]["condition"] == {"type": "ok", "step": 1}
    assert steps[4]["condition"] == {"type": "not", "cond": {"type": "ok", "step": 3}}


def test_auth_failure_does_not_echo_token():
    database = turso(FakeResponse(401, {}))
    with pytest.raises(DatabaseError) as error:
        database.query("SELECT 1")
    assert "secret-token" not in str(error.value)


def test_statement_error_is_raised():
    database = turso(FakeResponse(200, {"results": [{"type": "error", "error": {"message": "no such table"}}]}))
    with pytest.raises(DatabaseError, match="no such table"):
        database.query("SELECT * FROM nope")


def test_backend_follows_environment(monkeypatch):
    assert isinstance(get_database(), SqliteDatabase)
    monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://x.turso.io")
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "t")
    assert isinstance(get_database(), TursoDatabase)


def test_schema_splits_into_statements():
    statements = split_script(config.SCHEMA_PATH.read_text(encoding="utf-8"))
    assert len(statements) == 14
    assert any(statement.startswith("CREATE VIEW") for statement in statements)


def test_insert_rows_chunks_under_parameter_limit():
    rows = [(i, "x", 1.0) for i in range(1000)]
    statements = insert_rows("T", ["a", "b", "c"], rows, "ON CONFLICT DO NOTHING")
    assert sum(len(params) for _, params in statements) == 3000
    assert all(len(params) <= 900 for _, params in statements)
    assert statements[0][0].endswith("ON CONFLICT DO NOTHING")
