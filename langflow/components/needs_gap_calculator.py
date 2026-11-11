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
from sigap_contracts import load_snapshot
from sigap_needs import CRITICAL_KEYWORDS, STANDARDS, VULNERABLE_FIELDS, _fmt, assess_shelter, calculate, categorize_needs, population_planning

from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output
from lfx.schema.message import Message



# Kata kunci kebutuhan kritis -> kategori. Kategori kritis menambah skor prioritas.


def extract_json(text: str):
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    start = min((i for i in (candidate.find("{"), candidate.find("[")) if i != -1), default=-1)
    if start == -1:
        raise ValueError("Input tidak berisi JSON.")
    obj, _ = json.JSONDecoder().raw_decode(candidate[start:])
    return obj










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
