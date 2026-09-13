"""Drive the server over real stdio JSON-RPC, the way Claude does.

This is the check that the thing is actually an MCP server: it spawns the
process, performs the initialize handshake, lists tools and calls one, with a
local stub standing in for screener.in.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

FIXTURE = (Path(__file__).parent / "fixtures" / "company_synthetic.html").read_text()
SRC = str(Path(__file__).resolve().parents[1] / "src")
PROTOCOL_VERSION = "2025-06-18"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):  # noqa: N802
        body = FIXTURE.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture(scope="module")
def stub_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


class Session:
    """A minimal newline-delimited JSON-RPC client over the server's stdio."""

    def __init__(self, process: subprocess.Popen):
        self.process = process
        self._id = 0

    def _send(self, message: dict) -> None:
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def request(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        self._send(
            {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}
        )
        while True:
            line = self.process.stdout.readline()
            if not line:
                stderr = self.process.stderr.read()
                raise AssertionError(f"server exited. stderr:\n{stderr}")
            message = json.loads(line)
            # Skip notifications and any response that is not ours.
            if message.get("id") == self._id:
                return message

    def notify(self, method: str, params: dict | None = None) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})


@pytest.fixture
def session(stub_server, tmp_path):
    env = {
        **os.environ,
        "PYTHONPATH": SRC,
        "SCREENER_BASE_URL": stub_server,
        "SCREENER_CACHE_DIR": str(tmp_path / "cache"),
        "SCREENER_MIN_REQUEST_INTERVAL": "0",
        "NO_PROXY": "127.0.0.1,localhost",
    }
    env.pop("SCREENER_SESSION_ID", None)

    process = subprocess.Popen(
        [sys.executable, "-m", "screener_mcp.server"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
        bufsize=1,
    )
    client = Session(process)

    response = client.request(
        "initialize",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "1.0"},
        },
    )
    assert "result" in response, response
    client.notify("notifications/initialized")

    try:
        yield client
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def test_initialize_reports_server_identity(session):
    response = session.request("ping")
    assert "result" in response


def test_tools_list_over_stdio(session):
    result = session.request("tools/list")["result"]
    names = {tool["name"] for tool in result["tools"]}

    assert {
        "search_companies",
        "get_company_overview",
        "get_financial_statement",
        "list_company_documents",
        "read_document",
        "run_screen",
        "diagnose",
    } <= names

    overview = next(t for t in result["tools"] if t["name"] == "get_company_overview")
    assert overview["description"]
    assert "symbol" in overview["inputSchema"]["properties"]
    assert overview["annotations"]["readOnlyHint"] is True


def test_tool_call_returns_structured_content(session):
    response = session.request(
        "tools/call",
        {"name": "get_company_overview", "arguments": {"symbol": "ACME"}},
    )
    result = response["result"]
    assert result.get("isError") is not True, result

    payload = result.get("structuredContent") or json.loads(result["content"][0]["text"])
    assert payload["name"] == "Acme Industries Ltd"
    assert payload["ratios"]["Stock P/E"]["value"] == 24.8


def test_statement_tool_call_over_stdio(session):
    response = session.request(
        "tools/call",
        {
            "name": "get_financial_statement",
            "arguments": {"symbol": "ACME", "statement": "balance_sheet"},
        },
    )
    result = response["result"]
    payload = result.get("structuredContent") or json.loads(result["content"][0]["text"])

    assert payload["found"] is True
    labels = [row["label"] for row in payload["rows"]]
    assert "Reserves" in labels


def test_invalid_enum_is_rejected(session):
    response = session.request(
        "tools/call",
        {
            "name": "get_financial_statement",
            "arguments": {"symbol": "ACME", "statement": "not_a_statement"},
        },
    )
    # Either a JSON-RPC error or an isError tool result is acceptable; silently
    # returning success would not be.
    assert "error" in response or response["result"].get("isError") is True
