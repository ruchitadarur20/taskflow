from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger("app.realtime")


class ConnectionManager:
    """Tracks which locally-connected WebSockets are subscribed to which channels.

    Membership/authorization checks happen before a socket is ever registered here
    (see app.api.realtime); this class only knows about already-authorized channel
    membership and how to fan a message out to the sockets subscribed to it.
    """

    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, channel: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._channels[channel].add(websocket)

    async def unsubscribe(self, channel: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._channels.get(channel)
            if sockets is None:
                return
            sockets.discard(websocket)
            if not sockets:
                del self._channels[channel]

    def reset(self) -> None:
        """Drop all tracked subscriptions. Intended for test teardown only."""
        self._channels.clear()

    async def remove(self, websocket: WebSocket) -> None:
        async with self._lock:
            for channel in list(self._channels.keys()):
                self._channels[channel].discard(websocket)
                if not self._channels[channel]:
                    del self._channels[channel]

    async def dispatch(self, channel: str, message: str) -> None:
        async with self._lock:
            sockets = list(self._channels.get(channel, ()))
        for websocket in sockets:
            try:
                await websocket.send_text(message)
            except Exception:  # noqa: BLE001 - a broken socket must not break fanout
                logger.warning("Dropping unreachable websocket on channel %s", channel)
                await self.remove(websocket)


connection_manager = ConnectionManager()
