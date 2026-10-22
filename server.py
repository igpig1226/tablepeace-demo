#!/usr/bin/env python3
"""TablePeace demo server. Standard-library HTTP + SQLite; no install needed."""

import argparse
import hashlib
import http.cookies
import json
import os
import secrets
import sqlite3
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("TABLEPEACE_DB", ROOT / "tablepeace.sqlite3"))
LOCK = threading.RLock()
SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
 timezone TEXT NOT NULL, currency TEXT NOT NULL, expected_count INTEGER NOT NULL,
 owner_hash TEXT NOT NULL REFERENCES sessions(hash), revision INTEGER NOT NULL DEFAULT 0,
 closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS options (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 title TEXT NOT NULL, venue TEXT NOT NULL, start_local TEXT NOT NULL,
 duration INTEGER NOT NULL, cost INTEGER NOT NULL, noise TEXT NOT NULL,
 source TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, verification_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL REFERENCES sessions(hash), nickname TEXT NOT NULL,
 availability TEXT NOT NULL DEFAULT '[]', max_budget INTEGER,
 needs_quiet INTEGER, favorite_id TEXT, note TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0, submitted_at TEXT,
 UNIQUE(room_id,session_hash)
);
CREATE TABLE IF NOT EXISTS proposals (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 option_id TEXT NOT NULL REFERENCES options(id), room_revision INTEGER NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS responses (
 proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 decision TEXT NOT NULL, responded_at TEXT NOT NULL,
 PRIMARY KEY(proposal_id,member_id)
);
CREATE INDEX IF NOT EXISTS idx_options_room ON options(room_id);
CREATE INDEX IF NOT EXISTS idx_members_room ON members(room_id);
CREATE INDEX IF NOT EXISTS idx_proposals_room ON proposals(room_id);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ident():
    return secrets.token_urlsafe(12)


def fail(code, message, status=400, fields=None):
    raise ApiError(code, message, status, fields)


class ApiError(Exception):
    def __init__(self, code, message, status=400, fields=None):
        super().__init__(message)
        self.code, self.message, self.status, self.fields = code, message, status, fields or {}


def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def initialize():
    with db() as conn:
        conn.executescript(SCHEMA)


def required_text(value, label, limit):
    value = str(value or "").strip()
    if not value or len(value) > limit:
        fail("VALIDATION_ERROR", f"{label} is required (maximum {limit} characters).")
    return value


def optional_text(value, label, limit):
    value = str(value or "").strip()
    if len(value) > limit:
        fail("VALIDATION_ERROR", f"{label} must be {limit} characters or fewer.")
    return value


def integer(value, label, minimum=0, maximum=100000):
    if isinstance(value, bool):
        fail("VALIDATION_ERROR", f"{label} must be a whole number.")
    try:
        n = int(value)
    except (TypeError, ValueError):
        fail("VALIDATION_ERROR", f"{label} must be a whole number.")
    if str(value).strip() != str(n) or not minimum <= n <= maximum:
        fail("VALIDATION_ERROR", f"{label} must be between {minimum} and {maximum}.")
    return n


def local_time(value, zone):
    try:
        naive = datetime.strptime(value, "%Y-%m-%dT%H:%M")
        tz = ZoneInfo(zone)
        aware = naive.replace(tzinfo=tz)
        if aware.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None) != naive:
            raise ValueError("Nonexistent local time")
        return naive
    except (ValueError, TypeError):
        fail("VALIDATION_ERROR", "Choose a valid local date and time.")


def validate_option(item, zone):
    title = required_text(item.get("title"), "Plan name", 60)
    venue = required_text(item.get("venueLabel"), "Venue / activity", 80)
    start = str(item.get("startLocal") or "")
    dt = local_time(start, zone)
    duration = integer(item.get("durationMinutes"), "Duration", 30, 120)
    if duration not in (30, 60, 90, 120):
        fail("VALIDATION_ERROR", "Duration must be 30, 60, 90, or 120 minutes.")
    if (dt + timedelta(minutes=duration)).date() != dt.date():
        fail("VALIDATION_ERROR", "Plans must start and end on the same date.")
    cost = integer(item.get("costUnits"), "Cost per person", 0, 100000)
    noise = item.get("noise")
    if noise not in ("quiet", "moderate", "lively", "unknown"):
        fail("VALIDATION_ERROR", "Choose a valid environment.")
    return {"title": title, "venue": venue, "startLocal": start, "duration": duration,
            "cost": cost, "noise": noise}


def option_public(row):
    return {"id": row["id"], "title": row["title"], "venueLabel": row["venue"],
            "startLocal": row["start_local"], "durationMinutes": row["duration"],
            "costUnits": row["cost"], "noise": row["noise"], "source": row["source"],
            "verified": bool(row["verified"]), "verificationNote": row["verification_note"]}


def member_public(row):
    return {"id": row["id"], "nickname": row["nickname"],
            "availability": json.loads(row["availability"]), "maxBudgetUnits": row["max_budget"],
            "needsQuiet": None if row["needs_quiet"] is None else bool(row["needs_quiet"]),
            "favoriteOptionId": row["favorite_id"], "note": row["note"],
            "revision": row["revision"], "submittedAt": row["submitted_at"]}


def evaluate_member(option, member):
    if not member or not member["submitted_at"]:
        return {"status": "pending", "reasons": []}
    reasons, unknown = [], []
    start = datetime.strptime(option["start_local"], "%Y-%m-%dT%H:%M")
    end = start + timedelta(minutes=option["duration"])
    windows = json.loads(member["availability"])
    if not windows:
        unknown.append("TIME_UNSPECIFIED")
    elif not any(datetime.strptime(w["startLocal"], "%Y-%m-%dT%H:%M") <= start and
                 end <= datetime.strptime(w["endLocal"], "%Y-%m-%dT%H:%M") for w in windows):
        reasons.append("TIME_CONFLICT")
    if option["cost"] > 0 and member["max_budget"] is None:
        unknown.append("BUDGET_UNSPECIFIED")
    elif member["max_budget"] is not None and option["cost"] > member["max_budget"]:
        reasons.append("OVER_BUDGET")
    if member["needs_quiet"] is None:
        unknown.append("QUIET_REQUIREMENT_UNSPECIFIED")
    elif member["needs_quiet"] and option["noise"] == "unknown":
        unknown.append("VENUE_NOISE_UNVERIFIED")
    elif member["needs_quiet"] and option["noise"] != "quiet":
        reasons.append("NOT_QUIET")
    return {"status": "blocked" if reasons else "needs_info" if unknown else "compatible",
            "reasons": reasons + unknown}


def aggregate(option, members, expected):
    results = [evaluate_member(option, m) for m in members]
    blocked = sum(r["status"] == "blocked" for r in results)
    unknown = sum(r["status"] == "needs_info" for r in results)
    submitted = sum(bool(m["submitted_at"]) for m in members)
    pending = expected - submitted
    counts = {code: sum(code in r["reasons"] for r in results) for code in
              ("TIME_CONFLICT", "OVER_BUDGET", "NOT_QUIET", "TIME_UNSPECIFIED",
               "BUDGET_UNSPECIFIED", "QUIET_REQUIREMENT_UNSPECIFIED", "VENUE_NOISE_UNVERIFIED")}
    return {"optionId": option["id"], "groupStatus": "blocked" if blocked else
            "pending" if pending else "needs_info" if unknown else "compatible",
            "blockedMemberCount": blocked, "unknownMemberCount": unknown,
            "pendingMemberCount": pending, "checkedParticipantCount": submitted,
            "requiredParticipantCount": expected,
            "favoriteCount": sum(m["favorite_id"] == option["id"] for m in members if m["submitted_at"]),
            "reasonCounts": counts}


def room_and_role(conn, room_id, session_hash):
    room = conn.execute("SELECT * FROM rooms WHERE id=?", (room_id,)).fetchone()
    if not room:
        fail("ROOM_NOT_FOUND", "This decision could not be found.", 404)
    member = conn.execute("SELECT * FROM members WHERE room_id=? AND session_hash=?",
                          (room_id, session_hash)).fetchone() if session_hash else None
    return room, member, bool(session_hash and room["owner_hash"] == session_hash)


def options_for(conn, room_id):
    return conn.execute("SELECT * FROM options WHERE room_id=? ORDER BY position", (room_id,)).fetchall()


def members_for(conn, room_id):
    return conn.execute("SELECT * FROM members WHERE room_id=? ORDER BY id", (room_id,)).fetchall()


def result_for(conn, room):
    options, members = options_for(conn, room["id"]), members_for(conn, room["id"])
    return {"expectedCount": room["expected_count"], "joinedCount": len(members),
            "submittedCount": sum(bool(m["submitted_at"]) for m in members),
            "roomRevision": room["revision"],
            "options": [aggregate(o, members, room["expected_count"]) for o in options]}


def require_access(member, owner):
    if not (member or owner):
        fail("NOT_AUTHORIZED", "Join this decision to see group results.", 403)


def require_owner(owner):
    if not owner:
        fail("NOT_ORGANIZER", "Only the organizer can do that.", 403)


def require_member(member):
    if not member:
        fail("NOT_A_MEMBER", "Join this decision first.", 403)


def require_open(room):
    if room["closed"]:
        fail("ROOM_CLOSED", "This decision is closed.", 409)


def invalidate(conn, room_id):
    conn.execute("UPDATE rooms SET revision=revision+1 WHERE id=?", (room_id,))
    conn.execute("UPDATE proposals SET status='stale' WHERE room_id=? AND status IN ('open','confirmed','declined')",
                 (room_id,))


def simulate(conn, room, data):
    opts = options_for(conn, room["id"])
    by_id = {o["id"]: o for o in opts}
    try:
        base = by_id[data["baseOptionId"]]
        venue = by_id[data["venueFromOptionId"]]
        when = by_id[data["timeFromOptionId"]]
    except (KeyError, TypeError):
        fail("VALIDATION_ERROR", "Select a valid base, venue, and time.")
    if base["start_local"][:10] != when["start_local"][:10]:
        fail("VALIDATION_ERROR", "Choose a time on the same room date.")
    candidate = {"id": "simulation", "title": f"{venue['venue']} · {when['start_local'][11:16]}",
                 "venue": venue["venue"], "start_local": when["start_local"],
                 "duration": base["duration"], "cost": venue["cost"], "noise": venue["noise"],
                 "source": "rescue", "verified": 0, "verification_note": ""}
    signature = lambda o: (o["venue"], o["start_local"], o["duration"], o["cost"], o["noise"])
    if signature(candidate) == signature(base):
        fail("NO_CHANGE", "Choose a different venue or time.", 422)
    if any(signature(candidate) == signature(o) for o in opts):
        fail("DUPLICATE_OPTION", "This plan already exists.", 422)
    local_time(candidate["start_local"], room["timezone"])
    if (datetime.strptime(candidate["start_local"], "%Y-%m-%dT%H:%M") +
            timedelta(minutes=candidate["duration"])).date().isoformat() != candidate["start_local"][:10]:
        fail("VALIDATION_ERROR", "This plan would cross into the next date.")
    members = members_for(conn, room["id"])
    before = aggregate(base, members, room["expected_count"])
    after = aggregate(candidate, members, room["expected_count"])
    return candidate, before, after


def current_proposal(conn, room):
    proposal = conn.execute("SELECT * FROM proposals WHERE room_id=? ORDER BY rowid DESC LIMIT 1",
                            (room["id"],)).fetchone()
    if not proposal:
        return {"proposal": None}
    option = conn.execute("SELECT * FROM options WHERE id=?", (proposal["option_id"],)).fetchone()
    responses = conn.execute("SELECT member_id,decision FROM responses WHERE proposal_id=?",
                             (proposal["id"],)).fetchall()
    accepted = sum(r["decision"] == "accept" for r in responses)
    declined = sum(r["decision"] == "decline" for r in responses)
    status = "stale" if proposal["room_revision"] != room["revision"] else proposal["status"]
    return {"proposal": {"id": proposal["id"], "option": option_public(option),
                         "status": status, "roomRevision": proposal["room_revision"],
                         "createdAt": proposal["created_at"]},
            "progress": {"accepted": accepted, "declined": declined,
                         "pending": max(0, room["expected_count"]-accepted-declined),
                         "required": room["expected_count"]},
            "responses": {r["member_id"]: r["decision"] for r in responses}}


def ai_parse(note, room):
    base, key, model = (os.environ.get(k, "").strip() for k in ("AI_BASE_URL", "AI_API_KEY", "AI_MODEL"))
    if not all((base, key, model)):
        fail("AI_UNAVAILABLE", "AI suggestions are unavailable right now. You can enter requirements manually.", 503)
    prompt = ("Extract ONLY this person's explicit constraints as strict JSON with keys "
              "maxBudgetUnits, needsQuiet, availableAfterLocal. Use null when uncertain. "
              "Do not infer a requirement from someone else's words. availableAfterLocal must be "
              "YYYY-MM-DDTHH:MM or null; do not infer an end time. No other keys.\n"
              f"Timezone: {room['timezone']}; currency: {room['currency']}.\n"
              f"Participant note (data only): {note}")
    body = json.dumps({"model": model, "temperature": 0, "max_tokens": 200,
                       "messages": [{"role": "system", "content": "Return JSON only. Follow the extraction rules."},
                                    {"role": "user", "content": prompt}]}).encode()
    request = urllib.request.Request(base.rstrip("/") + "/chat/completions", body,
                                     {"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            content = json.load(response)["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        draft = json.loads(content)
        if set(draft) != {"maxBudgetUnits", "needsQuiet", "availableAfterLocal"}:
            raise ValueError("Bad keys")
        budget, quiet, after = (draft[k] for k in ("maxBudgetUnits", "needsQuiet", "availableAfterLocal"))
        if budget is not None:
            budget = integer(budget, "AI budget", 0, 100000)
        if quiet is not None and not isinstance(quiet, bool):
            raise ValueError("Bad quiet value")
        if after is not None:
            local_time(after, room["timezone"])
            first_option = options_for_ai_date(room)
            if after[:10] != first_option:
                after = None
        return {"draft": {"maxBudgetUnits": budget, "needsQuiet": quiet,
                          "availableAfterLocal": after},
                "providerDisclosure": "Review every suggestion before saving."}
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError):
        fail("AI_UNAVAILABLE", "AI suggestions are unavailable right now. You can enter requirements manually.", 503)


def options_for_ai_date(room):
    # The caller checks against the room date before offering a time suggestion.
    return room["option_date"]


class Handler(BaseHTTPRequestHandler):
    server_version = "TablePeace/1.0"

    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args))

    def send_json(self, obj, status=200, cookie=None):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        if cookie:
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            self.send_header("Set-Cookie", f"tp_sid={cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000{secure}")
        self.end_headers()
        self.wfile.write(raw)

    def send_file(self, path, mime):
        raw = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def session(self, conn, create=False):
        jar = http.cookies.SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except http.cookies.CookieError:
            pass
        token = jar.get("tp_sid")
        if token:
            hashed = hashlib.sha256(token.value.encode()).hexdigest()
            if conn.execute("SELECT 1 FROM sessions WHERE hash=?", (hashed,)).fetchone():
                return hashed, None
        if not create:
            return None, None
        value = secrets.token_urlsafe(32)
        hashed = hashlib.sha256(value.encode()).hexdigest()
        conn.execute("INSERT INTO sessions(hash,created_at) VALUES (?,?)", (hashed, now()))
        return hashed, value

    def input_json(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
        allowed_origin = os.environ.get("PUBLIC_BASE_URL", f"{scheme}://{host}").rstrip("/")
        if origin and origin.rstrip("/") != allowed_origin:
            fail("FORBIDDEN_ORIGIN", "Cross-origin changes are not allowed.", 403)
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            fail("VALIDATION_ERROR", "Send JSON data.", 415)
        size = int(self.headers.get("Content-Length", "0"))
        if size < 0 or size > 32768:
            fail("VALIDATION_ERROR", "Request is too large.", 413)
        try:
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (json.JSONDecodeError, ValueError):
            fail("VALIDATION_ERROR", "Invalid JSON data.")

    def route(self, method):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            if method != "GET":
                fail("NOT_FOUND", "Not found.", 404)
            static = {"/styles.css": ("styles.css", "text/css; charset=utf-8"),
                      "/app.js": ("app.js", "text/javascript; charset=utf-8")}
            if path in static:
                name, mime = static[path]
                return self.send_file(ROOT / name, mime)
            if path == "/favicon.svg":
                return self.send_file(ROOT / "favicon.svg", "image/svg+xml")
            return self.send_file(ROOT / "index.html", "text/html; charset=utf-8")
        parts = path.strip("/").split("/")
        if method in ("POST", "PUT", "DELETE"):
            data = self.input_json()
        else:
            data = {}
        with LOCK, db() as conn:
            if method in ("POST", "PUT", "DELETE"):
                conn.execute("BEGIN IMMEDIATE")
            session_hash, cookie = self.session(conn, method in ("POST", "PUT", "DELETE"))
            response, status = self.api(conn, method, parts, data, session_hash)
            conn.commit()
        self.send_json(response, status, cookie)

    def api(self, conn, method, parts, data, session_hash):
        if parts == ["api", "health"] and method == "GET":
            return {"ok": True}, 200
        if parts == ["api", "rooms"] and method == "POST":
            title = required_text(data.get("title"), "Decision title", 80)
            description = optional_text(data.get("description"), "Description", 280)
            zone = required_text(data.get("timezone"), "Timezone", 64)
            try:
                ZoneInfo(zone)
            except (ValueError, KeyError):
                fail("VALIDATION_ERROR", "Choose a valid timezone.")
            currency = data.get("currency")
            if currency not in ("CNY", "USD"):
                fail("VALIDATION_ERROR", "Choose CNY or USD.")
            expected = integer(data.get("expectedCount"), "Participant count", 3, 8)
            source_options = data.get("options")
            if not isinstance(source_options, list) or not 2 <= len(source_options) <= 4:
                fail("VALIDATION_ERROR", "Add 2–4 plans.")
            options = [validate_option(o, zone) for o in source_options]
            if len({o["startLocal"][:10] for o in options}) != 1:
                fail("VALIDATION_ERROR", "All plans must be on the same date.")
            room_id = ident()
            conn.execute("INSERT INTO rooms VALUES (?,?,?,?,?,?,?,0,0,?)",
                         (room_id, title, description, zone, currency, expected, session_hash, now()))
            for position, o in enumerate(options):
                conn.execute("INSERT INTO options VALUES (?,?,?,?,?,?,?,?,'initial',0,'',?,?)",
                             (ident(), room_id, o["title"], o["venue"], o["startLocal"],
                              o["duration"], o["cost"], o["noise"], now(), position))
            return {"roomId": room_id, "inviteUrl": f"/r/{room_id}"}, 201
        if len(parts) < 3 or parts[:2] != ["api", "rooms"]:
            fail("NOT_FOUND", "Not found.", 404)
        room_id = parts[2]
        room, member, owner = room_and_role(conn, room_id, session_hash)
        tail = parts[3:]
        if not tail and method == "GET":
            members = members_for(conn, room_id)
            return {"id": room_id, "title": room["title"], "description": room["description"],
                    "timezone": room["timezone"], "currency": room["currency"],
                    "expectedCount": room["expected_count"], "closed": bool(room["closed"]),
                    "revision": room["revision"], "isOrganizer": owner, "isMember": bool(member),
                    "myMemberId": member["id"] if member else None,
                    "myNickname": member["nickname"] if member else None,
                    "joinedCount": len(members) if (owner or member) else None,
                    "submittedCount": sum(bool(m["submitted_at"]) for m in members) if (owner or member) else None,
                    "options": [option_public(o) for o in options_for(conn, room_id)]}, 200
        if tail == ["join"] and method == "POST":
            if member:
                return {"participantId": member["id"], "nextUrl": f"/r/{room_id}/me"}, 200
            require_open(room)
            nickname = required_text(data.get("nickname"), "Nickname", 32)
            if len(members_for(conn, room_id)) >= room["expected_count"]:
                fail("ROOM_FULL", "This decision already has all expected participants.", 409)
            member_id = ident()
            conn.execute("INSERT INTO members(id,room_id,session_hash,nickname) VALUES (?,?,?,?)",
                         (member_id, room_id, session_hash, nickname))
            return {"participantId": member_id, "nextUrl": f"/r/{room_id}/me"}, 201
        if tail == ["me"] and method == "GET":
            require_member(member)
            return member_public(member), 200
        if tail == ["me"] and method == "PUT":
            require_member(member)
            require_open(room)
            if integer(data.get("expectedRevision"), "Revision") != member["revision"]:
                fail("STALE_REVISION", "Your requirements changed elsewhere. Reload before saving.", 409)
            windows = data.get("availability", [])
            if not isinstance(windows, list) or len(windows) > 8:
                fail("VALIDATION_ERROR", "Add up to 8 time windows.")
            room_date = options_for(conn, room_id)[0]["start_local"][:10]
            clean_windows = []
            for w in windows:
                if not isinstance(w, dict):
                    fail("VALIDATION_ERROR", "Choose a valid time window.")
                start = str(w.get("startLocal") or "")
                end = str(w.get("endLocal") or "")
                a, b = local_time(start, room["timezone"]), local_time(end, room["timezone"])
                if a >= b or start[:10] != room_date or end[:10] != room_date:
                    fail("BAD_TIME_WINDOW", "Time windows must start and end on the room date.", 422)
                clean_windows.append({"startLocal": start, "endLocal": end})
            budget = data.get("maxBudgetUnits")
            budget = None if budget in (None, "") else integer(budget, "Budget", 0, 100000)
            quiet = data.get("needsQuiet")
            if quiet is not None and not isinstance(quiet, bool):
                fail("VALIDATION_ERROR", "Choose your environment requirement.")
            favorite = data.get("favoriteOptionId") or None
            if favorite and favorite not in {o["id"] for o in options_for(conn, room_id)}:
                fail("VALIDATION_ERROR", "Choose a valid preferred plan.")
            note = optional_text(data.get("note"), "Note", 300)
            conn.execute("UPDATE members SET availability=?,max_budget=?,needs_quiet=?,favorite_id=?,note=?,"
                         "revision=revision+1,submitted_at=? WHERE id=?",
                         (json.dumps(clean_windows), budget, None if quiet is None else int(quiet),
                          favorite, note, now(), member["id"]))
            invalidate(conn, room_id)
            return {"revision": member["revision"] + 1, "submittedAt": now()}, 200
        if tail == ["results"] and method == "GET":
            require_access(member, owner)
            return result_for(conn, room), 200
        if tail == ["simulate"] and method == "POST":
            require_access(member, owner)
            candidate, before, after = simulate(conn, room, data)
            return {"option": option_public(candidate), "before": before, "after": after,
                    "venueVerified": False}, 200
        if tail == ["rescue"] and method == "POST":
            require_owner(owner)
            require_open(room)
            if integer(data.get("expectedRoomRevision"), "Revision") != room["revision"]:
                fail("STALE_REVISION", "The room changed. Reload before publishing.", 409)
            position = len(options_for(conn, room_id))
            if position >= 8:
                fail("VALIDATION_ERROR", "This room already has 8 plans.")
            candidate, _, _ = simulate(conn, room, data)
            option_id = ident()
            conn.execute("INSERT INTO options VALUES (?,?,?,?,?,?,?,?,'rescue',0,'',?,?)",
                         (option_id, room_id, candidate["title"], candidate["venue"],
                          candidate["start_local"], candidate["duration"], candidate["cost"],
                          candidate["noise"], now(), position))
            invalidate(conn, room_id)
            return {"optionId": option_id}, 201
        if tail == ["proposals"] and method == "POST":
            require_owner(owner)
            require_open(room)
            if integer(data.get("expectedRoomRevision"), "Revision") != room["revision"]:
                fail("STALE_REVISION", "The room changed. Reload before proposing.", 409)
            option_id = data.get("optionId")
            option = conn.execute("SELECT * FROM options WHERE room_id=? AND id=?", (room_id, option_id)).fetchone()
            if not option:
                fail("VALIDATION_ERROR", "Choose a saved plan.")
            assessment = aggregate(option, members_for(conn, room_id), room["expected_count"])
            if assessment["pendingMemberCount"]:
                fail("WAITING_FOR_MEMBERS", "Wait for all participants to submit requirements.", 422)
            if assessment["groupStatus"] != "compatible":
                fail("NOT_FEASIBLE", "This plan does not fit every recorded requirement.", 422)
            conn.execute("UPDATE proposals SET status='superseded' WHERE room_id=? AND status IN ('open','declined','confirmed')",
                         (room_id,))
            proposal_id = ident()
            conn.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?)",
                         (proposal_id, room_id, option_id, room["revision"], "open", now()))
            return {"proposalId": proposal_id}, 201
        if tail == ["proposals", "current"] and method == "GET":
            require_access(member, owner)
            result = current_proposal(conn, room)
            if result["proposal"]:
                result["myDecision"] = result.pop("responses").get(member["id"]) if member else None
            return result, 200
        if len(tail) == 3 and tail[0] == "proposals" and tail[2] == "respond" and method == "POST":
            require_member(member)
            require_open(room)
            proposal = conn.execute("SELECT * FROM proposals WHERE id=? AND room_id=?", (tail[1], room_id)).fetchone()
            if not proposal or proposal["status"] not in ("open", "declined") or proposal["room_revision"] != room["revision"]:
                fail("STALE_PROPOSAL", "This plan changed. Review the latest proposal.", 409)
            decision = data.get("decision")
            if decision not in ("accept", "decline"):
                fail("VALIDATION_ERROR", "Choose yes or no.")
            conn.execute("INSERT INTO responses VALUES (?,?,?,?) ON CONFLICT(proposal_id,member_id) "
                         "DO UPDATE SET decision=excluded.decision,responded_at=excluded.responded_at",
                         (proposal["id"], member["id"], decision, now()))
            updated = current_proposal(conn, room)
            progress = updated["progress"]
            option = conn.execute("SELECT * FROM options WHERE id=?", (proposal["option_id"],)).fetchone()
            assessment = aggregate(option, members_for(conn, room_id), room["expected_count"])
            status = ("confirmed" if progress["accepted"] == room["expected_count"] and
                      assessment["groupStatus"] == "compatible" else
                      "declined" if progress["declined"] else "open")
            conn.execute("UPDATE proposals SET status=? WHERE id=?", (status, proposal["id"]))
            return {"status": status, "progress": progress}, 200
        if len(tail) == 3 and tail[0] == "options" and tail[2] == "verify-venue" and method == "POST":
            require_owner(owner)
            option = conn.execute("SELECT * FROM options WHERE id=? AND room_id=?", (tail[1], room_id)).fetchone()
            if not option:
                fail("VALIDATION_ERROR", "Choose a saved plan.")
            verified = data.get("verified")
            if not isinstance(verified, bool):
                fail("VALIDATION_ERROR", "Choose a verification state.")
            note = optional_text(data.get("verificationNote"), "Verification note", 200)
            if verified and not note:
                fail("VALIDATION_ERROR", "Record how and when you checked the venue.")
            conn.execute("UPDATE options SET verified=?,verification_note=? WHERE id=?",
                         (int(verified), note, option["id"]))
            return {"verified": verified, "verificationNote": note}, 200
        if tail == ["ai", "parse"] and method == "POST":
            require_member(member)
            if data.get("consent") is not True:
                fail("CONSENT_REQUIRED", "Consent is required before sending your note.", 422)
            note = required_text(data.get("note"), "Note", 300)
            room_copy = dict(room)
            room_copy["option_date"] = options_for(conn, room_id)[0]["start_local"][:10]
            return ai_parse(note, room_copy), 200
        if tail == ["close"] and method == "POST":
            require_owner(owner)
            closed = data.get("closed")
            if not isinstance(closed, bool):
                fail("VALIDATION_ERROR", "Choose a room status.")
            conn.execute("UPDATE rooms SET closed=? WHERE id=?", (int(closed), room_id))
            return {"closed": closed}, 200
        if not tail and method == "DELETE":
            require_owner(owner)
            conn.execute("DELETE FROM rooms WHERE id=?", (room_id,))
            return {"deleted": True}, 200
        fail("NOT_FOUND", "Not found.", 404)

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def do_PUT(self):
        self.handle_request("PUT")

    def do_DELETE(self):
        self.handle_request("DELETE")

    def handle_request(self, method):
        try:
            self.route(method)
        except ApiError as exc:
            self.send_json({"error": {"code": exc.code, "message": exc.message,
                                      "fieldErrors": exc.fields}}, exc.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            print("Internal error:", repr(exc))
            self.send_json({"error": {"code": "SERVER_ERROR", "message": "Something went wrong. Try again."}}, 500)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run TablePeace demo")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    initialize()
    print(f"TablePeace ready: http://{args.host}:{args.port}")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
