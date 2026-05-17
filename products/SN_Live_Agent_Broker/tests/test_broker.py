"""
Tests for SN Live Agent Broker — 10 tests, all self-contained.

AGPL-3.0 — Copyright (c) Vladimir Kapustin
"""

import unittest
from datetime import datetime, timezone

from src.broker_validator import (
    BrokerValidationError,
    LiveAgentBroker,
    SessionContinuityError,
)


class TestLiveAgentBroker(unittest.TestCase):
    """Unit tests for the LiveAgentBroker validator."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _make_message(
        *,
        session_id: str = "sess-001",
        message_type: str = "text",
        payload: dict = None,
        timestamp: str = None,
        visitor_id: str = "visitor-001",
        agent_id: str = None,
        routing_queue: str = None,
    ) -> dict:
        msg = {
            "sessionId": session_id,
            "messageType": message_type,
            "payload": payload if payload is not None else {"body": "Hello Zurich"},
            "visitorId": visitor_id,
        }
        if timestamp is not None:
            msg["timestamp"] = timestamp
        if agent_id is not None:
            msg["agentId"] = agent_id
        if routing_queue is not None:
            msg["routingQueue"] = routing_queue
        return msg

    # ------------------------------------------------------------------
    # 1. Valid inbound text message passes
    # ------------------------------------------------------------------
    def test_valid_inbound_text(self):
        broker = LiveAgentBroker()
        msg = self._make_message(visitor_id="v-123")
        broker.validate_inbound(msg)

    # ------------------------------------------------------------------
    # 2. Valid outbound text message passes
    # ------------------------------------------------------------------
    def test_valid_outbound_text(self):
        broker = LiveAgentBroker()
        msg = self._make_message(
            visitor_id="v-123",
            routing_queue="general",
            payload={"body": "Outbound hello"},
        )
        broker.validate_outbound(msg)

    # ------------------------------------------------------------------
    # 3. Missing sessionId raises BrokerValidationError
    # ------------------------------------------------------------------
    def test_missing_session_id_raises(self):
        broker = LiveAgentBroker()
        msg = self._make_message()
        del msg["sessionId"]
        with self.assertRaises(BrokerValidationError) as cm:
            broker.validate_inbound(msg)
        self.assertIn("sessionId", str(cm.exception))

    # ------------------------------------------------------------------
    # 4. Invalid messageType raises BrokerValidationError
    # ------------------------------------------------------------------
    def test_invalid_message_type_raises(self):
        broker = LiveAgentBroker()
        msg = self._make_message(message_type="pigeon")
        with self.assertRaises(BrokerValidationError) as cm:
            broker.validate_inbound(msg)
        self.assertIn("messageType", str(cm.exception))

    # ------------------------------------------------------------------
    # 5. Text message missing payload.body raises BrokerValidationError
    # ------------------------------------------------------------------
    def test_text_missing_body_raises(self):
        broker = LiveAgentBroker()
        msg = self._make_message(payload={})
        with self.assertRaises(BrokerValidationError) as cm:
            broker.validate_inbound(msg)
        self.assertIn("body", str(cm.exception))

    # ------------------------------------------------------------------
    # 6. File message missing fileName raises BrokerValidationError
    # ------------------------------------------------------------------
    def test_file_missing_filename_raises(self):
        broker = LiveAgentBroker()
        msg = self._make_message(
            message_type="file",
            payload={"fileSize": 1024},
        )
        with self.assertRaises(BrokerValidationError) as cm:
            broker.validate_inbound(msg)
        self.assertIn("fileName", str(cm.exception))

    # ------------------------------------------------------------------
    # 7. System message with invalid event raises BrokerValidationError
    # ------------------------------------------------------------------
    def test_system_invalid_event_raises(self):
        broker = LiveAgentBroker()
        msg = self._make_message(
            message_type="system",
            payload={"event": "exploded"},
        )
        with self.assertRaises(BrokerValidationError) as cm:
            broker.validate_inbound(msg)
        self.assertIn("event", str(cm.exception))

    # ------------------------------------------------------------------
    # 8. Ended message with payload.body raises BrokerValidationError
    # ------------------------------------------------------------------
    def test_ended_with_body_raises(self):
        broker = LiveAgentBroker()
        msg = self._make_message(
            message_type="ended",
            payload={"body": "No body allowed"},
        )
        with self.assertRaises(BrokerValidationError) as cm:
            broker.validate_inbound(msg)
        self.assertIn("ended", str(cm.exception))

    # ------------------------------------------------------------------
    # 9. Outbound text missing routingQueue raises BrokerValidationError
    # ------------------------------------------------------------------
    def test_outbound_text_missing_queue_raises(self):
        broker = LiveAgentBroker()
        msg = self._make_message(
            payload={"body": "Outbound hello"},
        )
        with self.assertRaises(BrokerValidationError) as cm:
            broker.validate_outbound(msg)
        self.assertIn("routingQueue", str(cm.exception))

    # ------------------------------------------------------------------
    # 10. Session continuity violation raises SessionContinuityError
    # ------------------------------------------------------------------
    def test_session_continuity_mismatch_raises(self):
        broker = LiveAgentBroker()
        session_id = "sess-continuity-01"

        first = self._make_message(
            session_id=session_id,
            visitor_id="visitor-alpha",
        )
        broker.broker_session([first], direction="inbound")

        second = self._make_message(
            session_id=session_id,
            visitor_id="visitor-beta",
        )
        with self.assertRaises(SessionContinuityError) as cm:
            broker.broker_session([second], direction="inbound")
        self.assertIn("visitorId mismatch", str(cm.exception))

    # ------------------------------------------------------------------
    # Bonus: mocked REST response helpers sanity checks
    # ------------------------------------------------------------------
    def test_mock_response_factory(self):
        resp = LiveAgentBroker.mock_sn_response(200, {"result": "ok"})
        self.assertEqual(resp["status_code"], 200)
        self.assertEqual(resp["body"]["result"], "ok")

    def test_from_mocked_api_success(self):
        resp = LiveAgentBroker.mock_sn_response(200)
        broker = LiveAgentBroker.from_mocked_api(resp)
        self.assertIsInstance(broker, LiveAgentBroker)

    def test_from_mocked_api_failure(self):
        resp = LiveAgentBroker.mock_sn_response(500, {"error": "SN outage"})
        with self.assertRaises(BrokerValidationError):
            LiveAgentBroker.from_mocked_api(resp)


if __name__ == "__main__":
    unittest.main()
