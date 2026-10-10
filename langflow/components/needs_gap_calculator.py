"""Needs Gap Calculator — Langflow custom component.

Menghitung kebutuhan dasar per posko dengan RUMUS TETAP (bukan LLM), lalu memberi
skor prioritas yang bisa dijelaskan. Setiap angka disertai rumusnya.

Standar minimum (Sphere Handbook):
- Air: 15 liter/orang/hari
- Pangan: 2.100 kkal/orang/hari
- Jamban: 1 unit per 20 orang
- Ruang hunian tertutup: 3,5 m2/orang
Kelompok rentan diprioritaskan sesuai UU 24/2007 Pasal 55.

Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime
from sigap_contracts import load_snapshot, normalize_stock

from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output
from lfx.schema.message import Message

STANDARDS = {
    "water_l_per_person_day": 15,
    "kcal_per_person_day": 2100,
    "people_per_latrine": 20,
    "shelter_m2_per_person": 3.5,
}
# Kata kunci kebutuhan kritis -> kategori. Kategori kritis menambah skor prioritas.
CRITICAL_KEYWORDS = {
    "air": ["air bersih", "air minum", "air ", "galon"],
    "pangan": ["makan", "beras", "sembako", "nasi", "mie", "logistik makanan"],
    "kesehatan": ["obat", "medis", "dokter", "p3k", "sakit", "demam", "diare", "luka"],
    "bayi": ["popok", "pampers", "susu bayi", "susu formula", "mpasi", "bubur bayi"],
    "perempuan": ["pembalut", "softex"],
    "hunian": ["tenda", "terpal", "selimut", "tikar", "matras"],
}
VULNERABLE_FIELDS = ["infants_toddlers", "elderly", "pregnant", "breastfeeding", "disability"]


def extract_json(text: str):
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    start = min((i for i in (candidate.find("{"), candidate.find("[")) if i != -1), default=-1)
    if start == -1:
        raise ValueError("Input tidak berisi JSON.")
    obj, _ = json.JSONDecoder().raw_decode(candidate[start:])
    return obj


def _fmt(n: float) -> str:
    """Format angka gaya Indonesia: 1.800 / 3,5."""
    if float(n).is_integer():
        return f"{int(n):,}".replace(",", ".")
    return f"{n:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".")


def categorize_needs(needs: list) -> set[str]:
    cats: set[str] = set()
    for need in needs:
        item = (need.get("item") if isinstance(need, dict) else str(need)) or ""
        text = f" {item.lower()} "
        for cat, words in CRITICAL_KEYWORDS.items():
            if any(w in text for w in words):
                cats.add(cat)
    return cats


def assess_shelter(rec: dict) -> dict:
    people = rec.get("total_people")
    name = rec.get("shelter_name") or rec.get("report_id") or "?"
    result = {
        "report_id": rec.get("report_id"),
        "shelter_name": name,
        "village": rec.get("village"),
        "total_people": people,
        "is_estimate": rec.get("is_estimate") is True,
        "needs": {},
        "gaps": {},
        "priority": "PERLU DATA",
        "score": None,
        "reasons": [],
        "issues": [i.get("reason", str(i)) for i in rec.get("validation_issues", [])] + list(rec.get("stock_issues", [])),
    }
    if people is None:
        result["reasons"].append("Jumlah jiwa belum diketahui; kebutuhan tidak bisa dihitung.")
        return result
    if isinstance(people, bool) or not isinstance(people, int) or people < 0:
        result["total_people"] = None
        result["issues"].append("total_people harus integer nonnegatif; input perlu dikoreksi.")
        return result
    if result["is_estimate"]:
        result["reasons"].append("Jumlah jiwa adalah estimasi sumber; hasil rumus mengikuti estimasi tersebut.")

    s = STANDARDS
    needs = {
        "air_liter_per_hari": (people * s["water_l_per_person_day"],
                               f"{_fmt(people)} jiwa × {s['water_l_per_person_day']} L"),
        "kkal_per_hari": (people * s["kcal_per_person_day"],
                          f"{_fmt(people)} jiwa × {_fmt(s['kcal_per_person_day'])} kkal"),
        "jamban_unit": (math.ceil(people / s["people_per_latrine"]),
                        f"{_fmt(people)} jiwa ÷ {s['people_per_latrine']}, dibulatkan ke atas"),
        "ruang_hunian_m2": (people * s["shelter_m2_per_person"],
                            f"{_fmt(people)} jiwa × {_fmt(s['shelter_m2_per_person'])} m²"),
    }
    result["needs"] = {k: {"value": v, "formula": f} for k, (v, f) in needs.items()}

    stock, context, schema_issues = normalize_stock(rec)
    result["issues"].extend(schema_issues)
    units = {"air_liter_per_hari": "L", "kkal_per_hari": "kkal", "jamban_unit": "unit", "ruang_hunian_m2": "m2"}
    if not isinstance(stock, dict) or not isinstance(context, dict):
        result["issues"].append("stock dan stock_context harus object; gap belum diketahui.")
        stock, context = {}, {}
    for key, (value, _) in needs.items():
        if key in stock and stock[key] is not None:
            amount, meta = stock[key], context.get(key)
            valid = isinstance(amount, (int, float)) and not isinstance(amount, bool) and math.isfinite(amount) and amount >= 0
            valid = valid and isinstance(meta, dict) and meta.get("unit") == units[key]
            if valid:
                try:
                    datetime.fromisoformat(str(meta.get("recorded_at", "")))
                except ValueError:
                    valid = False
            if key in ("air_liter_per_hari", "kkal_per_hari"):
                valid = valid and meta.get("horizon_hours") == 24
            if valid:
                result["gaps"][key] = max(0, value - amount)
            else:
                result["issues"].append(f"Stok {key} tidak valid: perlu angka nonnegatif, unit {units[key]}, waktu stok dan horizon 24 jam untuk kebutuhan harian. Gap belum diketahui.")

    score = 0
    cats = categorize_needs(rec.get("urgent_needs") or [])
    for cat in sorted(cats):
        points = 3 if cat in ("air", "pangan", "kesehatan") else 2
        score += points
        result["reasons"].append(f"+{points} kebutuhan mendesak kategori '{cat}'")

    present = [f for f in VULNERABLE_FIELDS if isinstance(rec.get(f), int) and not isinstance(rec.get(f), bool) and rec[f] > 0]
    if present:
        points = min(3, len(present))
        score += points
        result["reasons"].append(f"+{points} keberadaan {len(present)} kategori rentan; bukan jumlah individu unik")
    if rec.get("disability"):
        score += 1
        result["reasons"].append(f"+1 ada {rec['disability']} penyandang disabilitas")
    unknown_vulnerable = [f for f in VULNERABLE_FIELDS if rec.get(f) is None]
    if unknown_vulnerable:
        result["reasons"].append("Data kelompok rentan belum lengkap — skor bisa lebih tinggi dari ini.")

    result["score"] = score
    result["priority"] = "TINGGI" if score >= 6 else "SEDANG" if score >= 3 else "RENDAH"
    if unknown_vulnerable and score < 6:
        result["priority"] = "BELUM PASTI"
    return result


def calculate(records: list[dict]) -> dict:
    # Jangan menjumlahkan riwayat atau memilih pembaruan secara diam-diam.
    seen, duplicates = set(), []
    for rec in records:
        identity = rec.get("shelter_id")
        if identity:
            key = (str(rec.get("disaster_id") or ""), str(identity))
        else:
            normalize = lambda s: " ".join(w for w in re.findall(r"[a-z0-9]+", str(s or "").lower()) if w not in {"posko", "pengungsian", "desa", "kelurahan"})
            key = (normalize(rec.get("shelter_name")), normalize(rec.get("village")))
        if key != ("", ""):
            if key in seen:
                duplicates.append(key)
            seen.add(key)
    if duplicates:
        return {"standards": STANDARDS, "shelters": [], "totals": {"total_people": None, "air_liter_per_hari": None, "kkal_per_hari": None},
                "issues": ["Perhitungan diblokir: lebih dari satu snapshot untuk posko yang sama. Petugas harus memeriksa duplikasi/pembaruan dan memilih satu snapshot per posko."], "partial": True}
    assessed = [assess_shelter(r) for r in records]
    order = {"TINGGI": 0, "PERLU DATA": 1, "BELUM PASTI": 1, "SEDANG": 2, "RENDAH": 3}
    assessed.sort(key=lambda a: (order[a["priority"]], -(a["score"] or 0)))
    known = [a["total_people"] for a in assessed if a["total_people"] is not None]
    total_people = sum(known) if known else None
    return {
        "standards": STANDARDS,
        "shelters": assessed,
        "totals": {
            "total_people": total_people,
            "air_liter_per_hari": total_people * STANDARDS["water_l_per_person_day"] if total_people is not None else None,
            "kkal_per_hari": total_people * STANDARDS["kcal_per_person_day"] if total_people is not None else None,
        },
        "partial": len(known) != len(assessed),
        "is_estimate": any(a["is_estimate"] for a in assessed),
        "issues": [],
    }


def render(result: dict) -> str:
    if result.get("issues"):
        return "GAGAL: " + " ".join(result["issues"]) + "\n```json\n" + json.dumps(result, ensure_ascii=False, indent=2) + "\n```"
    lines = [
        "**Kebutuhan dasar per posko** (rumus standar Sphere, dihitung otomatis — bukan perkiraan AI)",
        "",
        "| Prioritas | Posko | Desa | Jiwa | Air/hari | Pangan/hari | Jamban | Gap air | Gap pangan | Alasan skor |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for a in result["shelters"]:
        n = a["needs"]
        cell = lambda k, unit: f"{_fmt(n[k]['value'])} {unit}" if k in n else "-"  # noqa: E731
        lines.append(
            f"| {a['priority']} | {a['shelter_name']} | {a['village'] or '?'} | {'± ' if a['is_estimate'] else ''}{_fmt(a['total_people']) if a['total_people'] is not None else '?'} "
            f"| {cell('air_liter_per_hari', 'L')} | {cell('kkal_per_hari', 'kkal')} | {cell('jamban_unit', 'unit')} "
            f"| {_fmt(a['gaps']['air_liter_per_hari']) + ' L' if 'air_liter_per_hari' in a['gaps'] else 'belum diketahui'} "
            f"| {_fmt(a['gaps']['kkal_per_hari']) + ' kkal' if 'kkal_per_hari' in a['gaps'] else 'belum diketahui'} | {'; '.join(a['reasons']) or '-'} |"
        )
        for issue in a["issues"]:
            lines.append(f"- {a['shelter_name']}: {issue}")
        if not a["gaps"]:
            lines.append(f"- {a['shelter_name']}: gap belum diketahui tanpa stok valid dan periode yang cocok.")
    t = result["totals"]
    lines += [
        "",
        f"**Total {'parsial (hanya populasi diketahui)' if result.get('partial') else ''}:** "
        + (f"{_fmt(t['total_people'])} jiwa · air {_fmt(t['air_liter_per_hari'])} L/hari · pangan {_fmt(t['kkal_per_hari'])} kkal/hari" if t['total_people'] is not None else "belum diketahui"),
        "",
        "Rumus: air = jiwa × 15 L; pangan = jiwa × 2.100 kkal; jamban = jiwa ÷ 20; hunian = jiwa × 3,5 m².",
        "Skor prioritas: air/pangan/kesehatan +3, kebutuhan bayi/perempuan/hunian +2, kelompok rentan "
        "+1 s.d. +3 berdasarkan keberadaan kategori (bukan rasio individu), disabilitas +1. TINGGI ≥ 6, SEDANG 3–5, RENDAH < 3; data rentan kosong dapat menghasilkan BELUM PASTI.",
        "Prioritas adalah REKOMENDASI; keputusan distribusi tetap di Kepala Pos Komando.",
        "",
        "```json\n" + json.dumps(result, ensure_ascii=False, indent=2) + "\n```",
    ]
    return "\n".join(lines)


class NeedsGapCalculator(Component):
    display_name = "Needs Gap Calculator"
    description = (
        "Menghitung kebutuhan air, pangan, jamban, dan ruang hunian per posko dengan rumus standar "
        "Sphere serta skor prioritas yang dapat dijelaskan. Tanpa LLM."
    )
    icon = "calculator"
    name = "NeedsGapCalculator"

    inputs = [
        MessageTextInput(
            name="records_json",
            display_name="Data Posko (JSON)",
            required=True,
            info='JSON {"snapshot_id":"...","snapshot_sha256":"..."} dari validate_needs. Tidak menerima records/stok bebas; koreksi harus divalidasi ulang.',
        ),
    ]

    outputs = [
        Output(display_name="Kebutuhan & Prioritas", name="needs_gap", method="build_needs_gap"),
    ]

    def build_needs_gap(self) -> Message:
        try:
            data = extract_json(self.records_json or "")
        except (ValueError, json.JSONDecodeError) as exc:
            self.status = "Input tidak valid"
            return Message(text=f"GAGAL: input bukan JSON data posko yang valid ({exc}). "
                                "Jalankan validate_needs terlebih dahulu.")
        try:
            snapshot = load_snapshot(data)
            records = snapshot["records"]
            if not isinstance(records, list):
                raise ValueError("Snapshot records tidak valid.")
        except (ValueError, OSError, KeyError) as exc:
            return Message(text=f"GAGAL: {exc}")
        result = calculate([r for r in records if isinstance(r, dict)])
        result["snapshot_id"], result["snapshot_sha256"] = data["snapshot_id"], data["snapshot_sha256"]
        self.status = f"{len(result['shelters'])} posko dihitung"
        return Message(text=render(result))
