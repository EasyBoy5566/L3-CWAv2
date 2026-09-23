"""One database interface over a local SQLite file or Turso.

Production runs on Vercel, whose filesystem is read-only, so it talks to
Turso over its HTTP API: stateless, one request per call, and no native
extension to build. Tests and local runs use the standard ``sqlite3`` module
against ``data/weather.db``. Both speak the same SQL and the same schema.

The interface is deliberately small:

- ``query``   read rows as dicts
- ``execute`` one statement, autocommitted, returns the affected row count
- ``batch``   several statements, all or nothing
"""

from __future__ import annotations

import base64
import sqlite3
import threading
from pathlib import Path

import requests

from app import config
from app.errors import DatabaseError

Statement = tuple[str, tuple]

# SQLite accepts 32766 bound parameters per statement; stay well below it so
# a multi-row INSERT is also a reasonable HTTP body.
MAX_PARAMS = 900


class SqliteDatabase:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, isolation_level=None, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        try:
            with _closing(self._connect()) as connection:
                return [dict(row) for row in connection.execute(sql, params)]
        except sqlite3.Error as exc:
            raise DatabaseError("資料庫查詢失敗。") from exc

    def execute(self, sql: str, params: tuple = ()) -> int:
        try:
            with _closing(self._connect()) as connection:
                return connection.execute(sql, params).rowcount
        except sqlite3.Error as exc:
            raise DatabaseError("資料庫寫入失敗。") from exc

    def batch(self, statements: list[Statement]) -> None:
        try:
            with _closing(self._connect()) as connection:
                connection.execute("BEGIN")
                try:
                    for sql, params in statements:
                        connection.execute(sql, params)
                except BaseException:
                    connection.execute("ROLLBACK")
                    raise
                connection.execute("COMMIT")
        except sqlite3.Error as exc:
            raise DatabaseError("資料庫寫入失敗，已復原。") from exc

    def executescript(self, script: str) -> None:
        try:
            with _closing(self._connect()) as connection:
                connection.executescript(script)
        except sqlite3.Error as exc:
            raise DatabaseError("資料庫初始化失敗。") from exc


class TursoDatabase:
    """Turso's Hrana-over-HTTP pipeline API (``POST /v2/pipeline``)."""

    def __init__(self, url: str, token: str, timeout: float = 15):
        if url.startswith("libsql://"):
            url = "https://" + url[len("libsql://"):]
        self.endpoint = url.rstrip("/") + "/v2/pipeline"
        self.token = token
        self.timeout = timeout
        self.session = requests.Session()

    def _pipeline(self, requests_: list[dict]) -> list[dict]:
        try:
            response = self.session.post(
                self.endpoint,
                json={"requests": [*requests_, {"type": "close"}]},
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=self.timeout,
            )
        except requests.RequestException:
            raise DatabaseError("無法連線資料庫。") from None
        if response.status_code in (401, 403):
            raise DatabaseError("資料庫授權失敗。")
        if response.status_code != 200:
            raise DatabaseError(f"資料庫暫時無法使用（HTTP {response.status_code}）。")
        try:
            results = response.json()["results"]
        except (ValueError, KeyError, TypeError):
            raise DatabaseError("資料庫回應格式不正確。") from None
        return results[: len(requests_)]

    @staticmethod
    def _stmt(sql: str, params: tuple) -> dict:
        return {"sql": sql, "args": [_encode(value) for value in params]}

    @staticmethod
    def _result(entry: dict) -> dict:
        if entry.get("type") != "ok":
            message = (entry.get("error") or {}).get("message", "unknown error")
            raise DatabaseError(f"資料庫執行失敗：{message}")
        return entry["response"]["result"]

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        (entry,) = self._pipeline([{"type": "execute", "stmt": self._stmt(sql, params)}])
        result = self._result(entry)
        names = [column["name"] for column in result["cols"]]
        return [dict(zip(names, map(_decode, row))) for row in result["rows"]]

    def execute(self, sql: str, params: tuple = ()) -> int:
        (entry,) = self._pipeline([{"type": "execute", "stmt": self._stmt(sql, params)}])
        return int(self._result(entry).get("affected_row_count") or 0)

    def batch(self, statements: list[Statement]) -> None:
        """BEGIN, each statement only if the previous succeeded, then COMMIT or ROLLBACK."""
        steps = [{"stmt": {"sql": "BEGIN"}}]
        for sql, params in statements:
            steps.append({
                "stmt": self._stmt(sql, params),
                "condition": {"type": "ok", "step": len(steps) - 1},
            })
        commit = len(steps)
        steps.append({"stmt": {"sql": "COMMIT"}, "condition": {"type": "ok", "step": commit - 1}})
        steps.append({"stmt": {"sql": "ROLLBACK"}, "condition": {"type": "not", "cond": {"type": "ok", "step": commit}}})
        (entry,) = self._pipeline([{"type": "batch", "batch": {"steps": steps}}])
        result = self._result(entry)
        if result["step_results"][commit] is None:
            errors = [error for error in result.get("step_errors", []) if error]
            message = errors[0].get("message", "unknown error") if errors else "unknown error"
            raise DatabaseError(f"資料庫寫入失敗，已復原：{message}")

    def executescript(self, script: str) -> None:
        self.batch([(statement, ()) for statement in split_script(script)])


def _encode(value) -> dict:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": str(int(value))}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, bytes):
        return {"type": "blob", "base64": base64.b64encode(value).decode("ascii")}
    return {"type": "text", "value": str(value)}


def _decode(value: dict):
    kind = value.get("type")
    if kind == "null":
        return None
    if kind == "integer":
        return int(value["value"])
    if kind == "float":
        return float(value["value"])
    if kind == "blob":
        return base64.b64decode(value["base64"])
    return value.get("value")


def split_script(script: str) -> list[str]:
    """Split schema.sql into statements. The schema has no semicolons in strings."""
    lines = [line for line in script.splitlines() if not line.strip().startswith("--")]
    return [statement.strip() for statement in "\n".join(lines).split(";") if statement.strip()]


class _closing:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def __enter__(self) -> sqlite3.Connection:
        return self.connection

    def __exit__(self, *exc) -> None:
        self.connection.close()


def insert_rows(table: str, columns: list[str], rows: list[tuple], conflict: str = "") -> list[Statement]:
    """Multi-row INSERTs, chunked under the parameter limit. Names are code constants."""
    if not rows:
        return []
    per_row = len(columns)
    chunk = max(1, MAX_PARAMS // per_row)
    placeholders = "(" + ",".join("?" * per_row) + ")"
    statements = []
    for start in range(0, len(rows), chunk):
        part = rows[start:start + chunk]
        sql = (
            f"INSERT INTO {table} ({','.join(columns)}) VALUES "
            + ",".join([placeholders] * len(part))
            + (f" {conflict}" if conflict else "")
        )
        statements.append((sql, tuple(value for row in part for value in row)))
    return statements


_lock = threading.Lock()
_database = None
_database_key = None


def get_database():
    """The configured database, reused across requests in one process."""
    global _database, _database_key
    url, token = config.turso_database_url(), config.turso_auth_token()
    key = (url, token, str(config.LOCAL_DB_PATH))
    with _lock:
        if _database is None or _database_key != key:
            _database = TursoDatabase(url, token) if url else SqliteDatabase(config.LOCAL_DB_PATH)
            _database_key = key
        return _database


def init_schema(database=None) -> None:
    (database or get_database()).executescript(config.SCHEMA_PATH.read_text(encoding="utf-8"))
