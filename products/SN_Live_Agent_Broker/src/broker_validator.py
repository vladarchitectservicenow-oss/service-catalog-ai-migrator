"""
SN Live Agent Broker — ServiceNow Live Agent Message Brokering Validator

Validates inbound and outbound Live Agent messages for third-party integrations.
Uses mocked REST responses in tests; no real ServiceNow auth is required.

AGPL-3.0 — Copyright (c) Vladimir Kapustin
"""

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


class BrokerValidationError(ValueError):
    """Raised when a Live Agent message fails broker validation."""
    pass


class SessionContinuityError(BrokerValidationError):
    """Raised when session continuity constraints are violated."""
    pass


class LiveAgentBroker:
    """
    Validates and brokers ServiceNow Live Agent chat messages.

    Parameters
    ----------
    session_store : dict, optional
        In-memory store mapping sessionId -> {visitorId, last_seen}.
        Primarily exposed for testing; production may use Redis/SQL.
    """

    _VALID_MESSAGE_TYPES = {"text", "file", "system", "typing", "ended"}
    _VALID_SYSTEM_EVENTS = {"joined", "left", "transferred"}
    _SESSION_WINDOW_MINUTES = 30

    def __init__(self, session_store: Optional[Dict[str, Dict[str, Any]]] = None):
        self.session_store: Dict[str, Dict[str, Any]] = session_store or {}
        self._iso_regex = re.compile(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$"
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate_inbound(self, message: Dict[str, Any]) -> None:
        """Validate an inbound Live Agent message."""
        self._validate_common(message)

    def validate_outbound(self, message: Dict[str, Any]) -> None:
        """Validate an outbound Live Agent message."""
        self._validate_common(message)
        msg_type = message.get("messageType")
        if msg_type == "text" and "routingQueue" not in message:
            raise BrokerValidationError(
                "Outbound text messages must include 'routingQueue'."
            )

    def broker_session(
        self,
        messages: List[Dict[str, Any]],
        direction: str = "inbound",
    ) -> List[Dict[str, Any]]:
        """
        Run a full brokered session: validate every message and enforce
        session continuity across the list.

        Parameters
        ----------
        messages : list
            Ordered list of Live Agent messages.
        direction : {'inbound', 'outbound'}
            Which validator to apply per message.

        Returns
        -------
        list
            The original messages when validation succeeds.
        """
        validator = {
            "inbound": self.validate_inbound,
            "outbound": self.validate_outbound,
        }.get(direction)
        if validator is None:
            raise BrokerValidationError(
                f"Invalid direction '{direction}'. Use 'inbound' or 'outbound'."
            )

        for msg in messages:
            validator(msg)
            self._check_session_continuity(msg)
            self._update_session(msg)

        return messages

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _validate_common(self, message: Dict[str, Any]) -> None:
        if not isinstance(message, dict):
            raise BrokerValidationError("Message must be a JSON object (dict).")

        # 1. sessionId
        session_id = message.get("sessionId")
        if not isinstance(session_id, str) or not session_id.strip():
            raise BrokerValidationError("'sessionId' must be a non-empty string.")

        # 2. messageType
        msg_type = message.get("messageType")
        if msg_type not in self._VALID_MESSAGE_TYPES:
            raise BrokerValidationError(
                f"'messageType' must be one of {self._VALID_MESSAGE_TYPES}."
            )

        # 3. payload checks
        payload = message.get("payload")
        if not isinstance(payload, dict):
            raise BrokerValidationError("'payload' must be a dict.")

        if msg_type == "text" and "body" not in payload:
            raise BrokerValidationError("'text' messages require 'payload.body'.")

        if msg_type == "file":
            for key in ("fileName", "fileSize"):
                if key not in payload:
                    raise BrokerValidationError(
                        f"'file' messages require 'payload.{key}'."
                    )

        if msg_type == "system":
            event = payload.get("event")
            if event not in self._VALID_SYSTEM_EVENTS:
                raise BrokerValidationError(
                    f"'system' messages require 'payload.event' in {self._VALID_SYSTEM_EVENTS}."
                )

        if msg_type == "ended" and "body" in payload:
            raise BrokerValidationError("'ended' messages must not carry 'payload.body'.")

        # 4. timestamp
        timestamp = message.get("timestamp")
        if timestamp is not None and not self._is_iso8601(timestamp):
            raise BrokerValidationError("'timestamp' must be an ISO-8601 string when present.")

        # 5. agentId / visitorId
        for key in ("agentId", "visitorId"):
            value = message.get(key)
            if value is not None and not isinstance(value, str):
                raise BrokerValidationError(f"'{key}' must be a string when present.")

    def _check_session_continuity(self, message: Dict[str, Any]) -> None:
        session_id = message["sessionId"]
        visitor_id = message.get("visitorId")
        now = datetime.now(timezone.utc)

        stored = self.session_store.get(session_id)
        if stored is None:
            return

        # If the same sessionId is reused within the window, visitorId must match.
        last_seen = stored["last_seen"]
        if now - last_seen <= timedelta(minutes=self._SESSION_WINDOW_MINUTES):
            if visitor_id is not None and visitor_id != stored["visitorId"]:
                raise SessionContinuityError(
                    f"Session '{session_id}' visitorId mismatch: "
                    f"expected '{stored['visitorId']}', got '{visitor_id}'."
                )

    def _update_session(self, message: Dict[str, Any]) -> None:
        session_id = message["sessionId"]
        visitor_id = message.get("visitorId")
        now = datetime.now(timezone.utc)
        self.session_store[session_id] = {
            "visitorId": visitor_id,
            "last_seen": now,
        }

    def _is_iso8601(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False
        if not self._iso_regex.match(value):
            return False
        try:
            # Python >= 3.11 supports Z directly
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return True
        except ValueError:
            return False

    # ------------------------------------------------------------------
    # Mocked REST helpers (self-contained, no external auth)
    # ------------------------------------------------------------------

    @staticmethod
    def mock_sn_response(status: int = 200, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Return a mocked ServiceNow REST response payload.
        Useful for unit tests and offline demos.
        """
        return {
            "status_code": status,
            "headers": {"Content-Type": "application/json"},
            "body": body or {},
        }

    @classmethod
    def from_mocked_api(cls, mock_response: Dict[str, Any]) -> "LiveAgentBroker":
        """
        Instantiate a broker from a mocked ServiceNow API response.
        Raises if the mocked response indicates an error.
        """
        status = mock_response.get("status_code", 200)
        if status >= 400:
            raise BrokerValidationError(
                f"Mocked ServiceNow API returned error status {status}."
            )
        return cls()
