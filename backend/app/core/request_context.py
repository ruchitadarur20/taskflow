from __future__ import annotations

import re
import uuid
from contextvars import ContextVar, Token

REQUEST_ID_HEADER = "X-Request-ID"

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._/-]{1,128}$")
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def current_request_id() -> str | None:
    return _request_id.get()


def set_request_id(request_id: str) -> Token[str | None]:
    return _request_id.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id.reset(token)


def request_id_from_header(value: str | None) -> str:
    if value is not None and _REQUEST_ID_PATTERN.fullmatch(value):
        return value
    return str(uuid.uuid4())
