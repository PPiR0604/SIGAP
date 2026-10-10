"""Duplicate & Silent Shelter Detector — Langflow custom component.

- Menandai laporan yang kemungkinan GANDA (posko sama, jarak waktu dekat, jumlah jiwa mirip).
- Menandai posko SENYAP: posko yang laporan terakhirnya lebih lama dari batas jam.
  Posko senyap sering justru yang paling terisolasi.

Hanya menandai — tidak pernah menghapus atau menggabungkan data.
Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import json
import re
from sigap_contracts import load_snapshot
from datetime import datetime, timedelta, timezone

from lfx.custom.custom_component.component import Component
from lfx.io import IntInput, MessageTextInput, Output
from lfx.schema.message import Message

WIB = timezone(timedelta(hours=7))  # waktu laporan WhatsApp di Indonesia umumnya WIB

GENERIC_WORDS = {"posko", "pengungsian", "tenda", "titik", "pos", "di", "dan", "desa", "dusun", "kel", "kelurahan"}


def extract_json(text: str):
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    start = min((i for i in (candidate.find("{"), candidate.find("[")) if i != -1), default=-1)
    if start == -1:
        raise ValueError("Input tidak berisi JSON.")
    obj, _ = json.JSONDecoder().raw_decode(candidate[start:])
    return obj


def _tokens(name: str | None) -> set[str]:
    words = re.findall(r"[a-z0-9]+", (name or "").lower())
    return {w for w in words if w not in GENERIC_WORDS}


def _similar_name(a: str | None, b: str | None) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / len(ta | tb) >= 0.6


def _same_village(a: str | None, b: str | None) -> bool:
    return not a or not b or _tokens(a) == _tokens(b)


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(WIB).replace(tzinfo=None) if parsed.tzinfo else parsed
    except (ValueError, TypeError):
        return None


def shelter_key(rec: dict) -> str:
    if rec.get("shelter_id"):
        return str(rec.get("disaster_id") or "") + "|id:" + str(rec["shelter_id"])
    return " ".join(sorted(_tokens(rec.get("shelter_name")))) + "|" + " ".join(sorted(_tokens(rec.get("village"))))


def detect(records: list[dict], now: datetime, silent_hours: int = 24, window_hours: int = 6) -> dict:
    duplicates, updates, conflicts = [], [], []
    for i, a in enumerate(records):
        for b in records[i + 1:]:
            if a.get("shelter_id") and b.get("shelter_id"):
                same = a["shelter_id"] == b["shelter_id"] and a.get("disaster_id") == b.get("disaster_id")
            else:
                same = (_similar_name(a.get("shelter_name"), b.get("shelter_name"))
                        and _same_village(a.get("village"), b.get("village")))
            if not same:
                continue
            ta, tb = _parse_time(a.get("reported_at")), _parse_time(b.get("reported_at"))
            pa, pb = a.get("total_people"), b.get("total_people")
            fields = ("total_people", "total_families", "male", "female", "infants_toddlers", "children", "elderly", "pregnant", "breastfeeding", "disability")
            known_a = {f for f in fields if a.get(f) is not None}
            known_b = {f for f in fields if b.get(f) is not None}
            entry = {
                "report_ids": [a.get("report_id"), b.get("report_id")],
                "shelter_name": a.get("shelter_name"),
                "reason": "Nama posko & desa sama, waktu berdekatan, jumlah jiwa mirip",
            }
            if a.get("validation_issues") or b.get("validation_issues") or a.get("unverified_numbers") or b.get("unverified_numbers"):
                entry["reason"] = "Ada angka/konflik yang belum terverifikasi; perlu klarifikasi, bukan otomatis duplikat."
                conflicts.append(entry)
            elif any(r.get("report_kind") in ("update", "correction") for r in (a,b)) or (ta and tb and abs((ta-tb).total_seconds()) > window_hours*3600) or (known_a != known_b and not any(r.get("report_kind") == "duplicate" for r in (a,b))):
                entry["reason"] = "Pembaruan/koreksi atau laporan pada waktu berbeda; pilih snapshot terbaru, jangan jumlahkan riwayat."
                updates.append(entry)
            elif pa is not None and pb is not None and pa != pb:
                entry["reason"] = "Jumlah jiwa berbeda tanpa penanda pembaruan; perlu klarifikasi."
                conflicts.append(entry)
            else:
                duplicates.append(entry)

    latest: dict[str, dict] = {}
    for rec in records:
        key = shelter_key(rec)
        t = _parse_time(rec.get("reported_at"))
        if key.strip("|") and (key not in latest or (t and (latest[key]["time"] is None or t > latest[key]["time"]))):
            latest[key] = {"time": t, "shelter_name": rec.get("shelter_name"), "village": rec.get("village")}

    silent, unknown_time = [], []
    for info in latest.values():
        if info["time"] is None:
            unknown_time.append(info["shelter_name"])
            continue
        hours = (now - info["time"]).total_seconds() / 3600
        if hours > silent_hours:
            silent.append({"shelter_name": info["shelter_name"], "village": info["village"],
                           "last_report": info["time"].strftime("%Y-%m-%d %H:%M"), "hours_silent": round(hours, 1)})
    silent.sort(key=lambda s: -s["hours_silent"])
    return {"checked_at": now.strftime("%Y-%m-%d %H:%M"), "silent_threshold_hours": silent_hours,
             "possible_duplicates": duplicates, "silent_shelters": silent,
             "possible_updates": updates, "possible_conflicts": conflicts,
            "shelters_without_time": unknown_time}


def render(result: dict) -> str:
    lines = [f"**Pemeriksaan per {result['checked_at']}**", ""]
    if result["silent_shelters"]:
        lines.append(f"🔴 **Posko senyap** (tidak melapor > {result['silent_threshold_hours']} jam) — "
                     "hubungi atau kirim tim cek, bisa jadi terisolasi:")
        lines += [f"- {s['shelter_name']} ({s['village'] or 'desa ?'}): terakhir {s['last_report']}, "
                  f"{s['hours_silent']} jam lalu" for s in result["silent_shelters"]]
    else:
        lines.append("✅ Tidak ada posko senyap.")
    if result["possible_duplicates"]:
        lines.append("\n🟡 **Kemungkinan laporan ganda** (jangan dijumlahkan dua kali):")
        lines += [f"- {' & '.join(d['report_ids'])}: {d['shelter_name']} — {d['reason']}"
                  for d in result["possible_duplicates"]]
    else:
        lines.append("✅ Tidak ada laporan ganda terdeteksi.")
    for key, title in (("possible_updates", "Pembaruan/koreksi (bukan laporan ganda)"), ("possible_conflicts", "Konflik yang perlu klarifikasi")):
        if result.get(key):
            lines.append("\n**" + title + "**")
            lines.extend(f"- {' & '.join(str(r) for r in item['report_ids'])}: {item['shelter_name']} — {item['reason']}" for item in result[key])
    if result["shelters_without_time"]:
        lines.append("\nPosko tanpa waktu laporan (tidak bisa dicek senyap): "
                     + ", ".join(n or "?" for n in result["shelters_without_time"]))
    lines.append("\nTool ini hanya menandai. Data tidak diubah atau dihapus tanpa keputusan petugas.")
    lines.append("\n```json\n" + json.dumps(result, ensure_ascii=False, indent=2) + "\n```")
    return "\n".join(lines)


class DuplicateSilentDetector(Component):
    display_name = "Duplicate & Silent Shelter Detector"
    description = "Menandai laporan posko yang kemungkinan ganda dan posko yang tidak melapor melewati batas jam."
    icon = "radar"
    name = "DuplicateSilentDetector"

    inputs = [
        MessageTextInput(
            name="records_json",
            display_name="Data Posko (JSON)",
            required=True,
            info="JSON berisi 'records' (semua laporan, lama + baru). Opsional: 'now' (YYYY-MM-DD HH:MM).",
        ),
        IntInput(name="silent_hours", display_name="Batas Senyap (jam)", value=24, advanced=True),
        IntInput(name="window_hours", display_name="Jendela Duplikat (jam)", value=6, advanced=True),
    ]

    outputs = [
        Output(display_name="Hasil Pemeriksaan", name="detection", method="build_detection"),
    ]

    def build_detection(self) -> Message:
        try:
            data = extract_json(self.records_json or "")
        except (ValueError, json.JSONDecodeError) as exc:
            return Message(text=f"GAGAL: input bukan JSON data posko yang valid ({exc}).")
        try:
            snapshot = load_snapshot(data)
            records = snapshot["report_records"]
        except (ValueError, OSError, KeyError) as exc:
            return Message(text=f"GAGAL: {exc}")
        now = _parse_time(data.get("now")) if isinstance(data, dict) else None
        result = detect([r for r in records if isinstance(r, dict)], now or datetime.now(WIB).replace(tzinfo=None),
                        self.silent_hours or 24, self.window_hours or 6)
        self.status = (f"{len(result['possible_duplicates'])} kemungkinan ganda, "
                       f"{len(result['silent_shelters'])} posko senyap")
        return Message(text=render(result))
