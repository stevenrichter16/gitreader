import json
import os
import time
from typing import Optional

from .models import RepoIndex


def ensure_cache_dir(cache_root: str) -> None:
    os.makedirs(cache_root, exist_ok=True)


def index_path(cache_root: str, repo_id: str) -> str:
    return os.path.join(cache_root, f'{repo_id}.json')


def load_index(cache_root: str, repo_id: str) -> Optional[RepoIndex]:
    path = index_path(cache_root, repo_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return RepoIndex.from_dict(payload)


def save_index(cache_root: str, index: RepoIndex) -> str:
    ensure_cache_dir(cache_root)
    path = index_path(cache_root, index.repo_id)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(index.to_dict(), handle, indent=2, sort_keys=True)
    return path


def narration_path(cache_root: str, repo_id: str, cache_key: str) -> str:
    return os.path.join(cache_root, repo_id, f'{cache_key}.json')


def load_narration(cache_root: str, repo_id: str, cache_key: str) -> Optional[dict]:
    path = narration_path(cache_root, repo_id, cache_key)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    response = payload.get('response') if isinstance(payload.get('response'), dict) else None
    if not response:
        return None
    return response


def save_narration(cache_root: str, repo_id: str, cache_key: str, response: dict) -> str:
    ensure_cache_dir(os.path.join(cache_root, repo_id))
    path = narration_path(cache_root, repo_id, cache_key)
    payload = {
        'response': response,
        'created_at': time.time(),
    }
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    return path
