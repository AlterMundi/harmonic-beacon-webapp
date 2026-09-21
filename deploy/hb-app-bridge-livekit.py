#!/usr/bin/env python3
"""Fail closed unless LiveKit contains only the fixed passive bot identity."""

import base64
import hashlib
import hmac
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

ENVIRONMENT = Path('/etc/harmonic-beacon/production.env')
ORIGIN = 'http://127.0.0.1:7880'


def fail(message: str) -> "NoReturn":
    raise SystemExit(f'hb-app-bridge-livekit: {message}')


def values() -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in ENVIRONMENT.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key in {'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'BOT_IDENTITY'}:
            result[key] = value.strip()
    return result


def encoded(value: object) -> str:
    raw = json.dumps(value, separators=(',', ':'), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def token(key: str, secret: str, video: dict[str, object]) -> str:
    now = int(time.time())
    head = encoded({'alg': 'HS256', 'typ': 'JWT'})
    body = encoded({'exp': now + 30, 'iss': key, 'nbf': now - 5, 'video': video})
    signature = hmac.new(secret.encode(), f'{head}.{body}'.encode(), hashlib.sha256).digest()
    return f'{head}.{body}.{base64.urlsafe_b64encode(signature).rstrip(b"=").decode()}'


def request(method: str, bearer: str, body: dict[str, object]) -> dict[str, object]:
    call = Request(
        f'{ORIGIN}/twirp/livekit.RoomService/{method}',
        data=json.dumps(body, separators=(',', ':')).encode(),
        headers={'Authorization': f'Bearer {bearer}', 'Content-Type': 'application/json'},
        method='POST',
    )
    with urlopen(call, timeout=5) as response:
        if response.status != 200:
            fail('LiveKit continuity query failed')
        payload = json.loads(response.read(1024 * 1024))
    if not isinstance(payload, dict):
        fail('LiveKit continuity response is invalid')
    return payload


def main() -> None:
    environment = values()
    key = environment.get('LIVEKIT_API_KEY', '')
    secret = environment.get('LIVEKIT_API_SECRET', '')
    passive = environment.get('BOT_IDENTITY', 'playlist-bot')
    if not key or not secret or passive != 'playlist-bot':
        fail('LiveKit continuity configuration is incomplete')
    rooms_payload = request('ListRooms', token(key, secret, {'roomList': True}), {})
    rooms = rooms_payload.get('rooms', [])
    if not isinstance(rooms, list):
        fail('LiveKit room list is invalid')
    room_count = 0
    participant_count = 0
    for room in rooms:
        if not isinstance(room, dict) or not isinstance(room.get('name'), str):
            fail('LiveKit room entry is invalid')
        room_count += 1
        name = room['name']
        grant = {'room': name, 'roomAdmin': True}
        participants_payload = request('ListParticipants', token(key, secret, grant), {'room': name})
        participants = participants_payload.get('participants', [])
        if not isinstance(participants, list):
            fail('LiveKit participant list is invalid')
        for participant in participants:
            if (
                name != 'beacon'
                or not isinstance(participant, dict)
                or participant.get('identity') != passive
            ):
                fail('LiveKit has a non-passive participant; continuity gate refused')
            participant_count += 1
    print(json.dumps({'safe': True, 'rooms': room_count, 'passiveParticipants': participant_count}, separators=(',', ':')))


try:
    main()
except SystemExit:
    raise
except Exception:
    fail('LiveKit continuity query failed closed')
