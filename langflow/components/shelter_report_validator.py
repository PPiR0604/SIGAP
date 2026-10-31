"""Shelter Report Validator — Langflow custom component.

Memeriksa JSON hasil ekstraksi LLM terhadap teks laporan sumber:
- Membuang record yang ID laporannya tidak ada di sumber.
- Memeriksa tipe integer nonnegatif, label angka dalam sumber, dan konsistensi jumlah.
  Angka yang tidak ditemukan dikosongkan (null) dan dicatat untuk ditanyakan ke petugas.
- Mencatat kolom data terpilah (Juklak BNPB 9/2023) yang masih kosong.

Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

from sigap_sqlite import read_sqlite, compare_stored

import json
import re
from datetime import datetime, timedelta, timezone
from sigap_contracts import save_snapshot, save_candidate_snapshot, load_snapshot, normalize_stock, load_source, load_source_context, get_correction_record, get_correction_base, get_candidate_record, clear_options, quality_status

from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output, StrInput
from lfx.schema.message import Message

NUMERIC_FIELDS = [
    "total_people",
    "total_families",
    "male",
    "female",
    "infants_toddlers",
    "children",
    "elderly",
    "pregnant",
    "breastfeeding",
    "disability",
]
# Kolom minimal yang wajib ditanyakan bila kosong (data terpilah + lokasi).
REQUIRED_FIELDS = [
    "shelter_name",
    "village",
    "total_people",
    "male",
    "female",
    "infants_toddlers",
    "elderly",
    "pregnant",
    "breastfeeding",
    "disability",
]
FIELD_LABELS_ID = {
    "shelter_name": "nama posko",
    "village": "desa/kelurahan",
    "total_people": "jumlah jiwa",
    "total_families": "jumlah KK",
    "male": "jumlah laki-laki",
    "female": "jumlah perempuan",
    "infants_toddlers": "jumlah bayi/balita",
    "children": "jumlah anak",
    "elderly": "jumlah lansia",
    "pregnant": "jumlah ibu hamil",
    "breastfeeding": "jumlah ibu menyusui",
    "disability": "jumlah penyandang disabilitas",
}
REPORT_HEADER = re.compile(r"^\[(R\d{3,})\][^\n]*\n", re.M)
WORD_NUMBERS = {
    "satu": 1, "dua": 2, "tiga": 3, "empat": 4, "lima": 5, "enam": 6, "tujuh": 7,
    "delapan": 8, "sembilan": 9, "sepuluh": 10, "sebelas": 11, "seratus": 100, "seribu": 1000,
}


def extract_json(text: str):
    """Ambil objek/array JSON pertama dari teks (boleh dibungkus ```json ... ```)."""
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    start = min((i for i in (candidate.find("{"), candidate.find("[")) if i != -1), default=-1)
    if start == -1:
        raise ValueError("Tidak ada JSON di output LLM.")
    decoder = json.JSONDecoder()
    obj, _ = decoder.raw_decode(candidate[start:])
    return obj


def split_source(source_text: str) -> dict[str, str]:
    """Petakan report_id -> isi laporan dari teks keluaran Preprocessor."""
    parts: dict[str, str] = {}
    matches = list(REPORT_HEADER.finditer(source_text))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(source_text)
        parts[m.group(1)] = source_text[m.end():end]
    return parts


def numbers_in(text: str) -> set[int]:
    """Semua bilangan di teks. '1.200' dan '1,200' dibaca 1200 (format ribuan)."""
    found: set[int] = set()
    for tok in re.findall(r"\d{1,3}(?:[.,]\d{3})+|\d+", text):
        found.add(int(re.sub(r"[.,]", "", tok)))
    lowered = text.lower()
    for word, value in WORD_NUMBERS.items():
        if re.search(rf"\b{word}\b", lowered):
            found.add(value)
    return found


def _to_int(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and re.fullmatch(r"\d+|\d{1,3}(?:[.,]\d{3})+", value.strip()):
        return int(re.sub(r"[.,]", "", value.strip()))
    return None


FIELD_ALIASES = {
    "total_people": r"(?:orang|org|jiwa|pengungsi)", "total_families": r"(?:kk|keluarga)",
    "male": r"(?:laki(?:[ -]?laki|2)?|pria)", "female": r"(?:perempuan|wanita)",
    "infants_toddlers": r"(?:bayi|balita)", "children": r"anak(?:-anak)?",
    "elderly": r"(?:lansia|manula)", "pregnant": r"(?:ibu\s+hamil|bumil)",
    "breastfeeding": r"(?:ibu\s+menyusui|busui)",
    "disability": r"(?:penyandang\s+disabilitas|disabilitas|difabel|(?:pake|pakai|pengguna)\s+kursi\s+roda)",
}


def field_supported(field: str, value: int, source: str) -> bool:
    """Angka harus berdekatan dengan label field, bukan hanya muncul di laporan."""
    tokens = [str(value), f"{value:,}".replace(",", "."), f"{value:,}"]
    tokens.extend(w for w, n in WORD_NUMBERS.items() if n == value)
    number = r"(?<![\w.,+-])(?<!\d:)(?:" + "|".join(re.escape(t) for t in set(tokens)) + r")(?!\w|[.,:]\d)"
    label = r"\b" + FIELD_ALIASES[field] + r"(?:\s*nya)?\b"
    join = r"\s*(?:[:=~±]\s*)?(?:(?:ada|sebanyak|sekitar|kira2|kira-kira|kurleb|termasuk|masih|sekarang)\s+)?"
    any_label = r"\b(?:" + "|".join(FIELD_ALIASES.values()) + r")(?:\s*nya)?\b"
    any_number = r"(?:\d+|" + "|".join(WORD_NUMBERS) + r")\b"
    # 'laki 50 perempuan 70': perempuan adalah label angka berikutnya, bukan 50.
    for match in re.finditer(number + join + label, source, re.I):
        tail = source[match.end():]
        next_number = re.match(join + any_number, tail, re.I)
        if not next_number or re.match(join + any_label, tail[next_number.end():], re.I):
            return True
    # '120 org 15 balita': org tidak boleh mengikat 15 yang berlabel balita.
    for match in re.finditer(label + join + number, source, re.I):
        tail = source[match.end():]
        following = re.match(join + any_label, tail, re.I)
        if field != "total_people" and re.match(join + r"\b" + FIELD_ALIASES["total_people"] + r"\b", tail, re.I):
            return True  # 'laki-lakinya 43 orang': orang adalah satuan hitungan.
        if following and not re.match(join + any_number, tail[following.end():], re.I):
            continue
        return True
    return False


def surplus_evidence(item, source: str) -> str | None:
    """Barang datang bukan bukti cukup; butuh pernyataan eksplisit terkait barang."""
    name = str(item.get("item", "") if isinstance(item, dict) else item).strip().lower()
    if not name:
        return None
    label = r"(?:pakaian|baju)" if name == "pakaian" else re.escape(name)
    label = r"\b" + label + r"\b"
    enough = label + r"\s+(?:(?:sudah|sdh|udah|telah|masih|sangat|stoknya)\s+){0,3}(?:cukup|berlebih|kelebihan)\b"
    stop_send = r"\b(?:jangan|jgn)\s+(?:di)?kirim\b"
    # Batasi instruksi tanpa mengikat status barang lain di klausa yang sama.
    local_tail = r"(?:(?!\b(?:dan|tapi|tetapi|sedangkan)\b).){0,60}"
    for clause in re.split(r"[.!?;,\n]", source):
        if re.search(r"\b(?:belum|tidak|tdk)\s+(?:cukup|berlebih)|\bmasih\s+(?:kurang|butuh|perlu)\b", clause, re.I):
            continue
        if re.search(enough + "|" + label + local_tail + stop_send + "|" + stop_send + r"\s+" + label, clause, re.I):
            return clause.strip()
    return None


def validate(llm_output: str, source_text: str) -> dict:
    sources = split_source(source_text)
    issues: list[dict] = []

    try:
        parsed = extract_json(llm_output)
    except (ValueError, json.JSONDecodeError) as exc:
        return {
            "records": [],
            "issues": [{"type": "llm_output_invalid", "detail": str(exc)}],
            "summary": {"reports_in_source": len(sources), "records_valid": 0},
        }

    raw_records = parsed.get("records", []) if isinstance(parsed, dict) else parsed
    records: list[dict] = []
    seen: set[str] = set()

    for rec in raw_records if isinstance(raw_records, list) else []:
        if not isinstance(rec, dict):
            continue
        rid = str(rec.get("report_id", "")).strip()
        if rid not in sources:
            issues.append({"type": "unknown_report_id", "report_id": rid or None,
                           "detail": "Record dibuang: ID laporan tidak ada di teks sumber."})
            continue
        if rid in seen:
            issues.append({"type": "duplicate_report_id", "report_id": rid, "detail": "Satu report_id hanya boleh memiliki satu record; jangan menggabungkan sumber sebelum validasi."})
            continue
        seen.add(rid)
        clean = dict(rec)
        clean.pop('shelter_id', None)  # Stable identity is allocated/resolved by storage, never the LLM.
        clean.pop('disaster_id', None)
        clean.pop("update_target", None)  # Target berasal dari sumber server, bukan model.
        clean.pop("candidate_lineage", None)  # Pasangan identitas hanya dari kandidat immutable server.
        clean.pop('storage_baseline',None)  # Baseline/konflik hanya dihasilkan pembacaan SQLite server.
        clean.pop('storage_conflicts',None)
        clean.pop('storage_source',None)
        header = next((m.group(0) for m in REPORT_HEADER.finditer(source_text) if m.group(1) == rid), "")
        timestamp = re.search(r"waktu=([^|\n]+)", header)
        clean["reported_at"] = timestamp.group(1).strip() if timestamp and timestamp.group(1).strip() != "tidak diketahui" else None
        explicit_time = re.search(r"waktu laporan:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})", sources[rid], re.I)
        if explicit_time and str(rec.get("reported_at") or "").replace("T", " ") == explicit_time.group(1).replace("T", " "):
            try:
                clean["reported_at"] = datetime.fromisoformat(explicit_time.group(1)).strftime("%Y-%m-%d %H:%M")
            except ValueError:
                pass
        unverified = []

        for field in NUMERIC_FIELDS:
            value = _to_int(rec.get(field))
            clean[field] = value
        for field in NUMERIC_FIELDS:
            value = clean[field]
            original = rec.get(field)
            if original is None or original == "":
                continue
            if value is not None and field_supported(field, value, sources[rid]):
                continue
            unverified.append({"field": field, "llm_value": original})
            clean[field] = None

        # Total turunan hanya boleh memakai operand yang sudah lolos pemeriksaan sumber.
        total = _to_int(rec.get("total_people"))
        if clean["total_people"] is None and total is not None and clean["male"] is not None and clean["female"] is not None and total == clean["male"] + clean["female"]:
            clean["total_people"] = total
            unverified = [u for u in unverified if u["field"] != "total_people"]
        consistency = []
        total = clean["total_people"]
        if total is not None:
            for field in NUMERIC_FIELDS[1:]:
                if clean[field] is not None and clean[field] > total:
                    consistency.append({"field": field, "value": clean[field], "reason": "melebihi total jiwa"})
                    clean[field] = None
            if clean["male"] is not None and clean["female"] is not None and clean["male"] + clean["female"] != total:
                consistency.append({"field": "male+female", "reason": "tidak sama dengan total jiwa; perlu klarifikasi"})
        clean["validation_issues"] = consistency
        clean["field_provenance"] = {field: {"report_id": rid, "reported_at": clean["reported_at"]} for field in NUMERIC_FIELDS if clean[field] is not None}
        for field, proof in clean["field_provenance"].items():
            for line in sources[rid].splitlines():
                if field_supported(field, clean[field], line):
                    proof["source_excerpt"] = line[:600]
                    break
        stock, context, stock_issues = normalize_stock(rec)
        source_times = {}
        for match in re.finditer(r"(\d{1,2}/\d{1,2}/\d{2,4})\s*(?:jam\s*)?(\d{1,2})[.:](\d{2})", sources[rid], re.I):
            try:
                day, month, year = map(int, match.group(1).split("/"))
                time_value = datetime(year+2000 if year<100 else year, month, day, int(match.group(2)), int(match.group(3))).strftime("%Y-%m-%d %H:%M")
                source_times[time_value] = match.group(0)
            except ValueError:
                pass
        stock_evidence = {}
        units = {"air_liter_per_hari": r"(?:liter|l)", "kkal_per_hari": r"kkal", "jamban_unit": r"unit", "ruang_hunian_m2": r"m(?:2|²)"}
        for key, amount in list(stock.items()):
            if amount is not None:
                text_amount = str(int(amount)) if float(amount).is_integer() else str(amount)
                tokens = {text_amount}
                if float(amount).is_integer():
                    tokens.update((f"{int(amount):,}", f"{int(amount):,}".replace(",", ".")))
                if not re.search(r"(?<![\d.,+-])(?:" + "|".join(re.escape(t) for t in tokens) + r")\s*" + units[key] + r"\b", sources[rid], re.I):
                    stock[key] = None
                    stock_issues.append(f"Kuantitas stok {key} tidak didukung sumber laporan {rid}.")
                if key in ("jamban_unit","ruang_hunian_m2") and stock[key] is not None:
                    label = r"\bjamban\b" if key == "jamban_unit" else r"\b(?:ruang\s+)?hunian\b"
                    proof = re.search(label + r"[^\d.!?\n]{0,60}(?:" + "|".join(re.escape(t) for t in tokens) + r")\s*" + units[key] + r"\b", sources[rid], re.I)
                    if proof is None:
                        proof = re.search(r"(?<![\d.,+-])(?:" + "|".join(re.escape(t) for t in tokens) + r")\s*" + units[key] + r"\s+" + label, sources[rid], re.I)
                    if proof:
                        stock_evidence[key] = {"report_id":rid,"quantity_quote":proof.group(0)}
                        if not context[key].get("unit"):
                            context[key]["unit"] = "unit" if key == "jamban_unit" else "m2"
                        if not context[key].get("recorded_at") and len(source_times) == 1 and re.search(r"\bsaat pemeriksaan itu\b", sources[rid], re.I):
                            context[key]["recorded_at"] = next(iter(source_times))
                            stock_evidence[key]["time_quote"] = next(iter(source_times.values())) + " / saat pemeriksaan itu"
                    else:
                        stock[key] = None
                        stock_issues.append(f"Pemetaan kuantitas stok {key} tidak didukung label sumber; perlu klarifikasi.")
                expected_unit = {"air_liter_per_hari":"L","kkal_per_hari":"kkal","jamban_unit":"unit","ruang_hunian_m2":"m2"}[key]
                if context[key].get("unit") != expected_unit:
                    stock_issues.append(f"Unit stok {key} harus {expected_unit}; metadata unit tidak valid.")
            if key in ("air_liter_per_hari", "kkal_per_hari") and amount is not None:
                horizons = {int(n) for n in re.findall(r"(?:untuk|horizon|periode)\s*(?:kebutuhan\s*)?(\d+)\s*jam", sources[rid], re.I)}
                if context[key].get("horizon_hours") not in horizons:
                    context[key].pop("horizon_hours", None)
                    stock_issues.append(f"Horizon stok {key} tidak didukung sumber; gap belum diketahui.")
            if amount is not None:
                valid_times = {clean["reported_at"]}
                valid_times.update(source_times)
                reported_stock_time = str(context[key].get("recorded_at") or "").replace("T", " ")
                if reported_stock_time not in valid_times:
                    context[key].pop("recorded_at", None)
                    stock_issues.append(f"Waktu stok {key} tidak didukung sumber; gap belum diketahui.")
        clean["stock"], clean["stock_context"], clean["stock_issues"] = stock, context, stock_issues
        clean["stock_evidence"] = stock_evidence
        if consistency:
            issues.append({"type": "inconsistent_counts", "report_id": rid, "detail": "Jumlah tidak konsisten; periksa validation_issues dan klarifikasi sebelum digunakan."})

        for key in ("urgent_needs", "surplus_do_not_send"):
            if not isinstance(clean.get(key), list):
                clean[key] = []
        source = sources[rid]
        supported_surplus = []
        for item in clean["surplus_do_not_send"]:
            evidence = surplus_evidence(item, source)
            if evidence:
                supported_surplus.append(item)
            else:
                reason = "Usulan sudah cukup tidak didukung sumber; barang datang bukan bukti cukup."
                clean["validation_issues"].append({"field": "surplus_do_not_send", "reason": reason})
                issues.append({"type": "unsupported_surplus", "report_id": rid, "item": item, "detail": reason})
        clean["surplus_do_not_send"] = supported_surplus
        clean["report_kind"] = "correction" if re.search(r"\bkoreksi\b", source, re.I) else "duplicate" if re.search(r"\bkirim ulang\b", source, re.I) else "update" if re.search(r"\b(?:update|pembaruan|sekarang|skrg|nambah)\b", source, re.I) else "report"
        clean["needs_cleared"] = bool(re.search(r"\btidak ada permintaan barang tambahan\b|\btidak (?:ada|butuh) bantuan tambahan\b", source, re.I))
        water = next((clause for clause in re.finditer(r"\bair\b[^.!?\n]{0,200}", source, re.I)
                      if re.search(r"\b(?:habis|kurang)\b|\btidak cukup\b", clause.group(0), re.I)
                      and not re.search(r"(?:sudah|sdh)\s+cukup|(?:tidak|belum)\s+(?:lagi\s+)?(?:habis|kurang)", clause.group(0), re.I)), None)
        if water:
            items = [str(n.get("item", "") if isinstance(n, dict) else n).lower() for n in clean["urgent_needs"]]
            if not any(re.search(r"\bair\b", item) for item in items):
                clean["urgent_needs"].append({"item": "air bersih", "qty": None, "unit": None})
                clean["needs_evidence"] = [{"item": "air bersih", "quote": water.group(0), "report_id": rid}]
        clean["unverified_numbers"] = unverified
        clean["missing_fields"] = [f for f in REQUIRED_FIELDS if clean.get(f) in (None, "", [])]
        clean.setdefault("is_estimate", False)
        records.append(clean)

        if unverified:
            issues.append({"type": "number_not_in_source", "report_id": rid,
                            "detail": "Angka/tipe atau pemetaan field tidak didukung sumber, dikosongkan: "
                           + ", ".join(f"{FIELD_LABELS_ID[u['field']]} ({u['llm_value']})" for u in unverified)})

    skipped = [rid for rid in sources if rid not in seen]
    if skipped:
        issues.append({"type": "report_not_extracted", "report_id": None, "skipped_ids": skipped,
                       "detail": f"{len(skipped)} pesan tidak menghasilkan data (kemungkinan bukan laporan kondisi "
                                 f"posko, mis. info admin): {', '.join(skipped)}. Cek jika ada yang terlewat."})

    return {
        "records": records,
        "issues": issues,
        "summary": {"reports_in_source": len(sources), "records_valid": len(records)},
    }


def build_snapshots(records, sources):
    """Gabungkan HANYA record yang telah divalidasi, dengan jejak sumber per field."""
    def identity(rec):
        if rec.get("shelter_id"):
            return (str(rec.get("disaster_id") or ""), str(rec["shelter_id"]))
        normalize = lambda s: " ".join(w for w in re.findall(r"[a-z0-9]+", str(s or "").lower()) if w not in {"posko", "pengungsian", "desa", "kelurahan", "tenda"})
        name, village = normalize(rec.get("shelter_name")), normalize(rec.get("village"))
        return (name, village) if name and village else ("unresolved", rec["report_id"])
    def timestamp(rec):
        try:
            value = datetime.fromisoformat(str(rec.get("reported_at")))
            return value.replace(tzinfo=timezone(timedelta(hours=7))).timestamp() if value.tzinfo is None else value.timestamp()
        except ValueError:
            return float("-inf")
    snapshots = {}
    for rec in sorted(records, key=timestamp):
        key = identity(rec)
        old = snapshots.get(key)
        merged = json.loads(json.dumps(old or rec))
        provenance = dict(merged.get("field_provenance", {}))
        invalid = {u["field"] for u in rec["unverified_numbers"]} | {u.get("field") for u in rec["validation_issues"] if u.get("field") in NUMERIC_FIELDS}
        for field in NUMERIC_FIELDS:
            if rec.get(field) is not None or field in invalid:
                merged[field] = rec.get(field)
                provenance[field] = {"report_id": rec["report_id"], "reported_at": rec["reported_at"], "verified": field not in invalid}
        for field in ("urgent_needs", "surplus_do_not_send"):
            if rec.get(field):
                merged[field] = rec[field]
                provenance[field] = {"report_id": rec["report_id"], "reported_at": rec["reported_at"]}
                if field == "urgent_needs" and rec.get("needs_evidence"):
                    provenance[field]["evidence"] = rec["needs_evidence"]
        if rec.get("needs_cleared"):
            merged["urgent_needs"] = []
        item_key = lambda item: str(item.get("item", "") if isinstance(item, dict) else item).strip().lower()
        surplus_now = {item_key(item) for item in rec.get("surplus_do_not_send", [])}
        merged["urgent_needs"] = [item for item in merged.get("urgent_needs", []) if item_key(item) not in surplus_now]
        requested_now = {item_key(item) for item in merged["urgent_needs"]}
        merged["surplus_do_not_send"] = [item for item in merged.get("surplus_do_not_send", []) if item_key(item) not in requested_now]
        merged.setdefault("stock", {})
        merged.setdefault("stock_context", {})
        for stock_key, amount in rec.get("stock", {}).items():
            # NULL berarti tidak diperbarui; stok nol eksplisit tetap memperbarui.
            if amount is not None:
                merged["stock"][stock_key] = amount
                merged["stock_context"][stock_key] = rec["stock_context"].get(stock_key, {})
                provenance["stock." + stock_key] = {"report_id": rec["report_id"], "reported_at": rec["reported_at"]}
                if rec.get("stock_evidence", {}).get(stock_key):
                    provenance["stock." + stock_key]["evidence"] = rec["stock_evidence"][stock_key]
            elif any(stock_key in issue for issue in rec.get("stock_issues", [])):
                merged["stock"][stock_key] = None
                merged["stock_context"][stock_key] = rec["stock_context"].get(stock_key, {})
                provenance["stock." + stock_key] = {"report_id": rec["report_id"], "reported_at": rec["reported_at"], "verified": False}
        if rec.get("total_people") is not None:
            merged["is_estimate"] = rec.get("is_estimate", False)
        history = list((old or {}).get("notes_history", []))
        if rec.get("notes"):
            entry = {"batch_id": rec.get("batch_id"), "report_id": rec["report_id"], "reported_at": rec["reported_at"], "text": rec["notes"]}
            if entry not in history:
                history.append(entry)
            merged["notes"] = rec["notes"]
            provenance["notes"] = {"report_id": rec["report_id"], "reported_at": rec["reported_at"]}
        elif old and old.get("notes"):
            merged["notes"] = None  # Tidak menyajikan catatan lama sebagai kondisi terkini.
            provenance.pop("notes", None)
        merged["notes_history"] = history
        merged["report_kind"] = rec.get("report_kind", "report")
        merged["report_id"], merged["reported_at"] = rec["report_id"], rec["reported_at"]
        merged["source_report_ids"] = list(dict.fromkeys((old or {}).get("source_report_ids", []) + [rec["report_id"]]))
        merged["field_provenance"] = provenance
        merged["unverified_numbers"] = [u for u in (old or {}).get("unverified_numbers", []) if u["field"] not in rec["field_provenance"]] + rec["unverified_numbers"]
        merged["validation_issues"] = rec["validation_issues"]
        updated_stock = [k for k, v in rec.get("stock", {}).items() if v is not None]
        old_stock_issues = [issue for issue in (old or {}).get("stock_issues", []) if not any(k in issue for k in updated_stock)]
        merged["stock_issues"] = list(dict.fromkeys(old_stock_issues + rec["stock_issues"]))
        merged["pending_clear_fields"] = list((old or {}).get("pending_clear_fields", []))
        source = sources[rec["report_id"]].lower()
        if re.search(r"\b(?:kosongkan|mengosongkan|pengosongan|dikosongkan)\s+(?:field\s+)?(?:disabilitas|disability)\b|\b(?:disabilitas|disability)\s+dikosongkan\b", source):
            if "disability" not in merged["pending_clear_fields"]:
                merged["pending_clear_fields"].append("disability")
        # Clear proposals are read from explicit source instructions, never applied before approval.
        allowed_clear = set(NUMERIC_FIELDS) | {"urgent_needs", "stock", "stock_context", "notes"}
        for field in re.findall(r"usulkan pengosongan field:\s*([a-z_]+)\b", source, re.I):
            if field in allowed_clear and field not in merged["pending_clear_fields"]:
                merged["pending_clear_fields"].append(field)
        total, male, female = merged.get("total_people"), merged.get("male"), merged.get("female")
        if total is not None and male is not None and female is not None and male + female != total:
            merged["validation_issues"] = merged["validation_issues"] + [{"field": "male+female", "reason": "Data terpilah dari sumber/waktu berbeda tidak cocok dengan total terbaru; perlu klarifikasi."}]
        merged["missing_fields"] = [f for f in REQUIRED_FIELDS if merged.get(f) in (None, "", [])]
        snapshots[key] = merged
    return list(snapshots.values())


def merge_correction(records, target, base=None, candidate=False, source_text=""):
    """Gabungkan hanya patch tervalidasi ke baris read-back yang dipilih."""
    if len(records) != 1:
        raise ValueError("Koreksi harus menghasilkan tepat satu laporan untuk satu posko.")
    old = get_candidate_record(target) if candidate else get_correction_record(target)
    patch = records[0]
    normalize = lambda s: " ".join(w for w in re.findall(r"[a-z0-9]+", str(s or "").lower()) if w not in {"posko", "pengungsian"})
    # A rename must be explicit in the immutable human source, never supplied as an LLM target.
    rename_matches = list(re.finditer(r"\b(?:ubah|ganti|koreksi)\s+nama\s+posko(?:\s+ini)?\s+(?:menjadi|jadi|ke)\s+([^.!?\n|]+)", source_text, re.I))
    if len(rename_matches) > 1:
        raise ValueError("Ada beberapa usulan nama posko; pilih satu nama yang pasti.")
    new_name = rename_matches[0].group(1).strip(' \t\"\'“”') if rename_matches else None
    if new_name is not None and (not new_name or len(new_name)>200):
        raise ValueError("Nama posko baru kosong atau terlalu panjang.")
    accepted_names = {normalize(old.get("shelter_name"))}
    if new_name: accepted_names.add(normalize(new_name))
    if normalize(patch.get("shelter_name")) not in accepted_names:
        raise ValueError("Nama posko koreksi tidak cocok dengan baris asal.")
    columns = {"total_people": "jumlah_jiwa", "total_families": "jumlah_kk", "male": "laki_laki", "female": "perempuan", "infants_toddlers": "bayi_balita", "children": "anak", "elderly": "lansia", "pregnant": "ibu_hamil", "breastfeeding": "ibu_menyusui", "disability": "disabilitas"}
    update_target = {key: old.get(key) or "" for key in ("batch_id", "report_id", "shelter_name", "village", "disaster_id", "shelter_id")}
    update_target["expected"] = {column: "" if old.get(field) is None else str(old[field]) for field, column in columns.items()}
    for field, column in {"stock":"stok_json", "stock_context":"konteks_stok_json", "field_provenance":"provenance_json",
                          "notes_history":"riwayat_catatan_json", "corrections":"riwayat_koreksi_json",
                          "validation_issues":"masalah_validasi_json", "pending_clear_fields":"usulan_clear_json",
                          "unverified_numbers":"angka_tidak_terverifikasi_json", "missing_fields":"field_kosong_json",
                          "stock_issues":"masalah_stok_json", "source_report_ids":"sumber_laporan_json"}.items():
        if field in old:
            update_target["expected"][column] = old[field]
    for field, column in {"notes":"catatan", "shelter_type":"jenis_pengungsian", "reported_at":"waktu_laporan",
                          "is_estimate":"estimasi", "validation_status":"status_validasi", "status":"status",
                          "dicatat_pada":"dicatat_pada", "catatan_petugas":"catatan_petugas", "versi":"versi"}.items():
        if field in old:
            update_target["expected"][column] = old[field] if old[field] is not None else ""
    for field, column in {"urgent_needs":"kebutuhan_mendesak", "surplus_do_not_send":"sudah_cukup"}.items():
        if field in old:
            update_target["expected"][column] = "; ".join((v.get("item", "") + (f" ({v['qty']} {v.get('unit') or ''})".rstrip() if v.get("qty") else "")) if isinstance(v, dict) else str(v) for v in old[field])
    if candidate:
        update_target = old.get("update_target")
    elif base is not None:
        previous = get_correction_base(base)
        if previous.get("update_target") != update_target:
            raise ValueError("Data tersimpan berubah sejak kandidat pertama. Baca ulang dan buat koreksi baru.")
        old = previous
    merged = json.loads(json.dumps(old))
    if candidate:
        identity = {"batch_id": old["batch_id"], "report_id": old["report_id"]}
        lineage = list(old.get("candidate_lineage", []))
        if identity not in lineage:
            lineage.append(identity)
        merged["candidate_lineage"] = lineage
    changed = set()
    provenance = merged.setdefault("field_provenance", {})
    if new_name:
        merged["shelter_name"] = new_name
        changed.add("shelter_name")
        provenance["shelter_name"] = {"report_id":patch["report_id"],"reported_at":patch.get("reported_at"),"source_excerpt":rename_matches[0].group(0)}
    for field in NUMERIC_FIELDS:
        if patch.get(field) is not None:
            merged[field] = patch[field]
            changed.add(field)
            provenance[field] = patch.get("field_provenance", {}).get(field, {"report_id": patch["report_id"]})
    for field in ("village", "shelter_type", "notes"):
        if patch.get(field):
            merged[field] = patch[field]
            if field in patch.get("field_provenance", {}):
                provenance[field] = patch["field_provenance"][field]
    for field in ("urgent_needs", "surplus_do_not_send"):
        if patch.get(field):
            merged[field] = patch[field]
            if field == "urgent_needs":
                merged["needs_cleared"] = False
    if patch.get("needs_cleared"):
        merged["urgent_needs"] = []
        merged["needs_cleared"] = True
    for key, amount in patch.get("stock", {}).items():
        if amount is not None:
            merged.setdefault("stock", {})[key] = amount
            merged.setdefault("stock_context", {})[key] = patch.get("stock_context", {}).get(key, {})
            if "stock." + key in patch.get("field_provenance", {}):
                provenance["stock." + key] = patch["field_provenance"]["stock." + key]
    merged["report_id"], merged["batch_id"] = old["report_id"] if candidate else patch["report_id"], patch["batch_id"]
    if "total_people" in changed:
        merged["is_estimate"] = patch.get("is_estimate", False)
    if re.search(r"jumlah jiwa merupakan estimasi", source_text, re.I):
        merged["is_estimate"] = True
    elif re.search(r"jumlah jiwa sudah dikonfirmasi", source_text, re.I):
        merged["is_estimate"] = False
    updated_stock = [key for key, amount in patch.get("stock", {}).items() if amount is not None]
    merged["stock_issues"] = [issue for issue in old.get("stock_issues", []) if not any(key in str(issue) for key in updated_stock)] + patch.get("stock_issues", [])
    merged["reported_at"] = patch.get("reported_at") or datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M")
    merged["pending_clear_fields"] = list(dict.fromkeys(old.get("pending_clear_fields", []) + patch.get("pending_clear_fields", [])))
    merged["unverified_numbers"] = [u for u in old.get("unverified_numbers", []) if u.get("field") not in changed] + patch.get("unverified_numbers", [])
    derived_constraint = lambda i: i.get("field") == "male+female" or (i.get("field") in NUMERIC_FIELDS and i.get("reason") == "melebihi total jiwa")
    merged["validation_issues"] = [i for i in old.get("validation_issues", []) if i.get("field") not in changed and not derived_constraint(i)]
    merged["validation_issues"] += [i for i in patch.get("validation_issues", []) if not derived_constraint(i)]
    total = merged.get("total_people")
    if total is not None:
        for field in NUMERIC_FIELDS[1:]:
            if merged.get(field) is not None and merged[field] > total:
                merged["validation_issues"].append({"field": field, "reason": "melebihi total jiwa", "value": merged[field]})
        if merged.get("male") is not None and merged.get("female") is not None and merged["male"] + merged["female"] != total:
            merged["validation_issues"].append({"field": "male+female", "reason": "tidak sama dengan total jiwa; perlu klarifikasi"})
    merged["missing_fields"] = [f for f in REQUIRED_FIELDS if merged.get(f) in (None, "", [])]
    merged["source_report_ids"] = list(dict.fromkeys(old.get("source_report_ids", [old["report_id"]]) + [patch["report_id"]]))
    merged["notes_history"] = old.get("notes_history", []) + patch.get("notes_history", [])
    merged["corrections"] = old.get("corrections", []) + [{"field": field, "previous_value": old.get(field), "value": merged[field], "action": "corrected", "batch_id": patch["batch_id"], "report_id": patch["report_id"]} for field in sorted(changed) if old.get(field) != merged[field]]
    if update_target is not None:
        merged["update_target"] = update_target
    else:
        merged.pop("update_target", None)
    merged["report_kind"] = "correction"
    merged["validation_status"] = quality_status(merged)
    return [merged]


def render(result: dict) -> str:
    """Ringkasan untuk dibaca petugas + JSON lengkap untuk tool berikutnya."""
    lines = [f"**Hasil ekstraksi:** {result['summary']['records_valid']} dari "
              f"{result['summary']['reports_in_source']} laporan menghasilkan data."]
    if result.get("snapshot_issues"):
        lines.append("\n**KONFLIK SNAPSHOT — wajib ditampilkan sebelum persetujuan:**")
        lines.extend("- " + issue["detail"] for issue in result["snapshot_issues"])
    if result.get("snapshot_records"):
        lines.append("\n**PRATINJAU KANONIS — salin nilai/penanda ini tanpa menambahkan estimasi atau ukuran barang:**")
        lines.extend(["| Report | Posko | Desa | Jiwa | Kebutuhan terbaru | Status |", "| --- | --- | --- | ---: | --- | --- |"])
        for record in result["snapshot_records"]:
            people = "?" if record.get("total_people") is None else str(record["total_people"])
            if record.get("is_estimate") is True:
                people = "± " + people
            needs = "; ".join(str(n.get("item","") if isinstance(n,dict) else n) for n in record.get("urgent_needs",[])) or "—"
            lines.append(f"| {record['report_id']} | {record.get('shelter_name') or '?'} | {record.get('village') or '?'} | {people} | {needs} | {quality_status(record)} |")
        if result.get("clear_options",{}).get("available_clear_actions"):
            lines.append("\nKeputusan clear masih diperlukan: " + json.dumps(result["clear_options"],ensure_ascii=False))
    for rec in result["records"]:
        name = rec.get("shelter_name") or "(nama posko belum jelas)"
        people = rec.get("total_people")
        lines.append(f"- {rec['report_id']} · {name} · {people if people is not None else '?'} jiwa")
        if rec["missing_fields"]:
            lines.append("  - Perlu ditanyakan: " + ", ".join(FIELD_LABELS_ID.get(f, f) for f in rec["missing_fields"]))
    if result["issues"]:
        lines.append("\n**Perlu perhatian petugas:**")
        lines.extend(f"- {i.get('report_id') or '-'}: {i['detail']}" for i in result["issues"])
    lines.append("\nData ini BELUM tersimpan. Periksa dan konfirmasi sebelum disimpan ke sheet.")
    if result.get("snapshot_id"):
        summary = {"snapshot_id": result["snapshot_id"], "snapshot_sha256": result["snapshot_sha256"],
                   "report_count": len(result["records"]), "shelter_count": len(result["snapshot_records"]), "status": "candidate_not_saved",
                   "snapshot_conflict_count": len(result.get("snapshot_issues",[])),
                   "available_clear_actions": result.get("clear_options",{}).get("available_clear_actions",{})}
        lines.insert(0, "SIGAP_REFERENCE " + json.dumps(summary, ensure_ascii=False))
        lines.append(f"\nSnapshot: {result['snapshot_id']} · {len(result['snapshot_records'])} posko. Gunakan snapshot_id dan snapshot_sha256 untuk calculate_gap/upsert_shelter; jangan kirim ulang records. flag_anomalies memakai records per laporan SEBELUM penggabungan.")
    lines.append("\n```json\n" + json.dumps(result, ensure_ascii=False, indent=2) + "\n```")
    return "\n".join(lines)


PAYLOAD_JSON = re.compile(r"<<<\s*JSON\s*>>>", re.I)
PAYLOAD_SRC = re.compile(r"<<<\s*SUMBER\s*>>>", re.I)


def split_payload(payload: str) -> tuple[str, str]:
    """Pisahkan '<<<JSON>>> ... <<<SUMBER>>> ...' menjadi (json_llm, teks_sumber)."""
    # 1. Cek apakah payload berupa JSON object gabungan
    try:
        obj = extract_json(payload)
        if isinstance(obj, dict):
            if "records" in obj and "batch_id" in obj and "source_sha256" in obj:
                return json.dumps(obj), ""
            if "records" in obj and "source_text" in obj:
                src = str(obj.pop("source_text"))
                return json.dumps(obj), src
            if "json" in obj and ("source" in obj or "source_text" in obj):
                src = obj.get("source") or obj.get("source_text")
                llm = obj["json"]
                llm_str = json.dumps(llm) if isinstance(llm, (dict, list)) else str(llm)
                return llm_str, str(src)
    except Exception:
        pass

    # 2. Format tag pembatas <<<JSON>>> dan <<<SUMBER>>>
    j = PAYLOAD_JSON.search(payload)
    s = PAYLOAD_SRC.search(payload)
    if j and s:
        if j.start() < s.start():
            return payload[j.end():s.start()], payload[s.end():]
        return payload[j.end():], payload[s.end():j.start()]

    # 3. Format pembatas alternatif
    alt_sep = re.search(r"\n\s*---+\s*(?:SUMBER|LAPORAN|SOURCE)\s*---+\s*\n", payload, re.I)
    if alt_sep:
        return payload[:alt_sep.start()], payload[alt_sep.end():]

    raise ValueError(
        'Format salah. Kirim JSON {"batch_id":"...","source_sha256":"...","records":[...]}. '
        "Format delimiter lama hanya diterima bila SOURCE_REF valid ikut disertakan."
    )


class ShelterReportValidator(Component):
    display_name = "Shelter Report Validator"
    description = (
        "Memvalidasi JSON ekstraksi LLM API Langflow: angka yang tidak ada di laporan asli "
        "dikosongkan; tipe/rentang, label angka dan konsistensi jumlah diperiksa. Validasi semantik tetap heuristik."
    )
    icon = "badge-check"
    name = "ShelterReportValidator"

    inputs = [
        StrInput(name='sqlite_path',display_name='Database Rekap SQLite',value='',advanced=True,info='Path rekap yang sama dengan reader/writer untuk memeriksa konflik.'),
        MessageTextInput(
            name="payload",
            display_name="Payload (Referensi Sumber + Records)",
            required=False,
            info='JSON {"batch_id":"ID dari SOURCE_REF","source_sha256":"hash sumber","records":[...]}. Sumber diambil server; jangan mengirim salinan teks sumber bebas.',
        ),
        MessageTextInput(
            name="llm_output",
            display_name="Output LLM (Opsional)",
            required=False,
            advanced=True,
            info="JSON records jika dihubungkan langsung dari komponen lain.",
        ),
        MessageTextInput(
            name="source_text",
            display_name="Laporan Sumber (Opsional)",
            required=False,
            advanced=True,
            info="Teks laporan sumber jika dihubungkan langsung dari Preprocessor.",
        ),
    ]

    outputs = [
        Output(display_name="Data Tervalidasi", name="validated", method="build_validated"),
    ]

    def build_validated(self) -> Message:
        payload_val = getattr(self, "payload", None)
        if payload_val:
            p_text = payload_val.text if hasattr(payload_val, "text") else str(payload_val)
            try:
                llm_output, source_text = split_payload(p_text)
            except ValueError as exc:
                result = {
                    "records": [],
                    "issues": [{"type": "payload_invalid", "detail": str(exc)}],
                    "summary": {"reports_in_source": 0, "records_valid": 0},
                }
                self.status = "payload tidak valid"
                return Message(text=render(result))
        else:
            lo = getattr(self, "llm_output", "")
            st = getattr(self, "source_text", "")
            llm_output = lo.text if hasattr(lo, "text") else str(lo or "")
            source_text = st.text if hasattr(st, "text") else str(st or "")

        try:
            parsed = extract_json(llm_output)
            reference = parsed if isinstance(parsed, dict) and "batch_id" in parsed else None
            if reference is None:
                marker = re.search(r"<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>", source_text, re.S)
                if not marker:
                    raise ValueError("Sertakan batch_id/source_sha256 dari prepare_needs atau SOURCE_REF lengkap. Sumber bebas dari Bob tidak diterima.")
                reference = json.loads(marker.group(1))
            source_context = load_source_context(reference)
            source_text = source_context["source_text"]
        except (ValueError, OSError, KeyError) as exc:
            return Message(text=f"GAGAL: sumber validasi tidak tersedia/terverifikasi ({exc}). Jalankan prepare_needs ulang; jangan menghitung/write dari JSON bebas.")
        result = validate(llm_output, source_text)
        for record in result["records"]:
            record["batch_id"] = reference["batch_id"]
        result["snapshot_records"] = build_snapshots(result["records"], split_source(source_text))
        audit_records = result["records"]
        if source_context.get("candidate_target"):
            try:
                target = source_context["candidate_target"]
                patched = merge_correction(result["snapshot_records"], target, candidate=True, source_text=source_text)[0]
                snapshot = load_snapshot({k: target[k] for k in ("snapshot_id", "snapshot_sha256")})
                result["snapshot_records"] = json.loads(json.dumps(snapshot["records"]))
                result["snapshot_records"][target["record_index"]] = patched
                audit_records = json.loads(json.dumps(snapshot.get("report_records", snapshot["records"]))) + result["records"]
                previous_source_issues = [issue for issue in snapshot.get("issues", []) if issue.get("type") != "snapshot_conflict"]
                result["issues"] = previous_source_issues + result["issues"]
            except (ValueError, OSError, KeyError, TypeError) as exc:
                return Message(text=f"GAGAL: kandidat tidak dapat dikoreksi ({exc}). Pilih kandidat terbaru.")
        elif source_context.get("correction_target"):
            try:
                result["snapshot_records"] = merge_correction(result["snapshot_records"], source_context["correction_target"], source_context.get("correction_base"), source_text=source_text)
            except (ValueError, OSError, KeyError, TypeError) as exc:
                return Message(text=f"GAGAL: koreksi tidak dapat dipasangkan ke baris asal ({exc}). Baca ulang rekap dan pilih target yang benar.")
        try:
            stored = read_sqlite(getattr(self,'sqlite_path',None))
            result['snapshot_records'] = compare_stored(result['snapshot_records'], stored)
            for record in result['snapshot_records']:
                record['storage_source']={'mode':'sqlite','path':stored['path']}
        except Exception as exc:
            return Message(text=f'GAGAL: rekap SQLite belum dapat dibandingkan ({exc}). Tidak menerbitkan kandidat tanpa pemeriksaan konflik.')
        result["snapshot_issues"] = []
        for record in result["snapshot_records"]:
            for issue in record.get("validation_issues",[]):
                detail = f"{record.get('shelter_name')} ({record.get('village')}) [{record['report_id']}]: {issue['reason']}"
                if issue.get("field") == "male+female":
                    detail += f" Laki-laki {record.get('male')} + perempuan {record.get('female')} ≠ total {record.get('total_people')}."
                    detail += " Provenance: " + json.dumps({k:record.get('field_provenance',{}).get(k) for k in ('male','female','total_people')},ensure_ascii=False)
                elif issue.get("value") is not None:
                    detail += f" Nilai {issue['field']}={issue['value']}, total={record.get('total_people')}."
                result["snapshot_issues"].append({"type":"snapshot_conflict","report_id":record["report_id"],"field":issue.get("field"),"detail":detail})
        result["clear_options"] = clear_options(result["snapshot_records"])
        for record in result["records"] + result["snapshot_records"]:
            for proof in record.get("field_provenance", {}).values():
                proof.setdefault("batch_id", reference["batch_id"])
        result["batch_id"] = reference["batch_id"]
        try:
            result.update(save_candidate_snapshot({"snapshot_kind": "correction_candidate" if source_context.get("correction_target") or any(r.get("update_target") for r in result["snapshot_records"]) else "report_candidate", "records": result["snapshot_records"], "report_records": audit_records,
                                         "issues": result["issues"] + result["snapshot_issues"], "snapshot_issues":result["snapshot_issues"]}))
        except (OSError, ValueError) as exc:
            return Message(text=f"GAGAL: tidak dapat menyimpan snapshot validasi ({exc}). Jangan menghitung/menulis dari JSON bebas.")
        self.status = f"{result['summary']['records_valid']} record valid, {len(result['issues'])} catatan"
        return Message(text=render(result))
