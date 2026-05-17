#!/usr/bin/env python3
"""
SN SailPoint JML Bridge
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, requests, uuid
from typing import List, Dict, Optional


class SailPointBridge:
    ROLE_MAP = {
        "itil": "ITIL Analyst",
        "admin": "System Administrator",
        "approver": "Access Approver",
        "requestor": "Service Requestor",
        "asset": "Asset Manager",
    }

    def __init__(self, sn_url: str, sn_user: str, sn_pass: str,
                 sp_url: str, sp_token: str):
        self.sn_url = sn_url.rstrip("/")
        self.sn_auth = (sn_user, sn_pass)
        self.sp_url = sp_url.rstrip("/")
        self.sp_token = sp_token

    def fetch_user(self, user_sys_id: str) -> Dict:
        url = f"{self.sn_url}/api/now/table/sys_user/{user_sys_id}"
        try:
            resp = requests.get(url, auth=self.sn_auth, headers={"Accept":"application/json"}, timeout=30)
            resp.raise_for_status()
            return resp.json().get("result", {})
        except Exception as e:
            return {"error": str(e)}

    def fetch_user_roles(self, user_sys_id: str) -> List[str]:
        url = f"{self.sn_url}/api/now/table/sys_user_has_role"
        params = {"sysparm_query": f"user={user_sys_id}", "sysparm_fields": "role.name", "sysparm_limit": 100}
        try:
            resp = requests.get(url, params=params, auth=self.sn_auth, headers={"Accept":"application/json"}, timeout=30)
            resp.raise_for_status()
            return [r.get("role",{}).get("name","") for r in resp.json().get("result",[]) if r.get("role",{}).get("name")]
        except Exception:
            return []

    def map_roles(self, sn_roles: List[str]) -> List[str]:
        return sorted(set(self.ROLE_MAP.get(r.lower(), r) for r in sn_roles))

    def create_identity_request(self, user: Dict, roles: List[str], action: str) -> Dict:
        payload = {
            "requestId": str(uuid.uuid4()),
            "userEmail": user.get("email", user.get("user_name","") + "@example.com"),
            "userName": user.get("user_name", "unknown"),
            "action": action,  # join, move, leave
            "roles": roles,
            "department": user.get("department",""),
            "manager": user.get("manager","")
        }
        headers = {"Authorization": f"Bearer {self.sp_token}", "Content-Type": "application/json"}
        try:
            resp = requests.post(f"{self.sp_url}/identity/request", json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            return {"status": "submitted", "request_id": payload["requestId"]}
        except Exception as e:
            return {"status": "failed", "error": str(e), "request_id": payload["requestId"]}

    def process_event(self, event_type: str, user_sys_id: str) -> Dict:
        event_type = event_type.lower()
        user = self.fetch_user(user_sys_id)
        if "error" in user:
            return {"status": "error", "message": user["error"]}
        roles = self.fetch_user_roles(user_sys_id)
        sp_roles = self.map_roles(roles)
        action = {"join": "join", "move": "move", "leave": "leave"}.get(event_type, "update")
        result = self.create_identity_request(user, sp_roles, action)
        return {
            "event": event_type,
            "user": user.get("user_name"),
            "sn_roles": roles,
            "sp_roles": sp_roles,
            "result": result
        }

    def generate_audit(self, events: List[Dict], path: str):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"events": events, "count": len(events)}, f, ensure_ascii=False, indent=2)
