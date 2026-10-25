"""Kontrak snapshot lokal; generator menyematkan helper ini ke export komponen."""
import hashlib
import json
import math
import os
import re
import secrets
import time
import tempfile
from pathlib import Path
from datetime import datetime, timedelta, timezone


def snapshot_digest(payload):
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def save_snapshot(payload):
    directory = Path(os.environ.get("SIGAP_SNAPSHOT_DIR", "output/.sigap_snapshots")).expanduser()
    directory.mkdir(parents=True, exist_ok=True)
    identifier = secrets.token_hex(16)
    digest = snapshot_digest(payload)
    envelope = {"created_at": time.time(), "sha256": digest, "payload": payload}
    with (directory / (identifier + ".json")).open("x", encoding="utf-8") as stream:
        json.dump(envelope, stream, ensure_ascii=False, allow_nan=False)
    return {"snapshot_id": identifier, "snapshot_sha256": digest}


def load_snapshot(request):
    if not isinstance(request, dict) or not re.fullmatch(r"[a-f0-9]{32}", str(request.get("snapshot_id", ""))):
        raise ValueError("Gunakan snapshot_id dari validate_needs; JSON records bebas tidak diterima.")
    if any(key in request for key in ("records", "stock", "stock_context", "snapshot_records")):
        raise ValueError("Jangan mengirim ulang/mengubah records atau stok. Gunakan referensi snapshot; koreksi harus melalui validate_needs lagi.")
    path = Path(os.environ.get("SIGAP_SNAPSHOT_DIR", "output/.sigap_snapshots")).expanduser() / (request["snapshot_id"] + ".json")
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError("Snapshot tidak tersedia; semua flow harus memakai SIGAP_SNAPSHOT_DIR yang sama. Validasi ulang bila kedaluwarsa/hilang.") from exc
    if not isinstance(envelope, dict) or not isinstance(envelope.get("payload"), dict) or not isinstance(envelope.get("created_at"), (int, float)) or not isinstance(envelope.get("sha256"), str):
        raise ValueError("File snapshot rusak; jalankan prepare/validate ulang.")
    digest = snapshot_digest(envelope["payload"])
    if digest != envelope["sha256"] or request.get("snapshot_sha256") != digest:
        raise ValueError("Hash snapshot tidak cocok; data berubah atau referensi salah. Validasi dan tampilkan ulang.")
    if time.time() - envelope["created_at"] > 86400:
        raise ValueError("Snapshot kedaluwarsa (24 jam); validasi dan persetujuan ulang diperlukan.")
    committed = path.with_suffix(".committed.json")
    if committed.exists():
        try:
            reference = json.loads(committed.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("Status revisi snapshot tidak dapat dibaca; lakukan read-back.") from exc
        raise ValueError("Snapshot telah disimpan/direvisi. Gunakan referensi efektif: " + json.dumps(reference))
    return envelope["payload"]


def quality_status(record):
    if any(record.get(k) for k in ("validation_issues", "unverified_numbers", "stock_issues", "storage_issues", "pending_clear_fields")):
        return "PERLU_KLARIFIKASI"
    required = ("shelter_name", "village", "total_people", "male", "female", "infants_toddlers", "elderly", "pregnant", "breastfeeding", "disability")
    if record.get("missing_fields") or any(record.get(k) is None or record.get(k) == "" for k in required):
        return "PARSIAL"
    return "LOLOS_PEMERIKSAAN"


def clear_options(records):
    actions = {r["report_id"]: list(r.get("pending_clear_fields", [])) for r in records if r.get("pending_clear_fields")}
    return {"available_clear_actions": actions,
            "pending_changes": [{"report_id":r["report_id"],"shelter_name":r.get("shelter_name"),"village":r.get("village"),
                                 "field":field,"current_value":r.get(field),"proposed_value":None,
                                 "provenance":r.get("field_provenance",{}).get(field)} for r in records for field in r.get("pending_clear_fields",[])],
            "clear_request_template": {"approved_clear_fields": actions, "confirmed_clear_fields": True},
            "decision_choices": ["clear", "keep", "defer"],
            "instruction": "Gunakan report_id persis. Pilih aksi setelah jawaban petugas; officer_note bukan perintah clear. Jangan membuang aksi yang ditolak saat retry."}


def resolve_clear_decisions(data, records):
    """Setiap usulan harus memiliki aksi eksplisit; absennya parameter bukan keputusan keep."""
    options = clear_options(records)["available_clear_actions"]
    clear = data.get("approved_clear_fields", {})
    decisions = data.get("clear_decisions", {})
    if not isinstance(clear, dict) or not isinstance(decisions, dict):
        raise ValueError("approved_clear_fields/clear_decisions harus object dengan key report_id persis.")
    if (set(clear) | set(decisions)) - set(options):
        raise ValueError("Usulan clear tidak mengacu record snapshot. Gunakan available_clear_actions; jangan tambahkan kata 'snapshot' pada ID.")
    resolved = {}
    for rid, fields in options.items():
        selected = clear.get(rid, [])
        choices = decisions.get(rid, {})
        if not isinstance(selected, list) or any(f not in fields for f in selected) or not isinstance(choices, dict) or set(choices) - set(fields):
            raise ValueError("Field keputusan clear tidak ada pada usulan snapshot.")
        resolved[rid] = {}
        for field in fields:
            action = choices.get(field, "clear" if field in selected else None)
            if action not in ("clear", "keep", "defer"):
                raise ValueError(f"Usulan {rid}.{field} belum diputuskan. Deklarasikan clear/keep/defer setelah petugas memilih; catatan saja tidak cukup.")
            if field in selected and action != "clear":
                raise ValueError("approved_clear_fields bertentangan dengan clear_decisions.")
            if action == "clear" and (field not in selected or data.get("confirmed_clear_fields") is not True):
                raise ValueError("Aksi clear membutuhkan approved_clear_fields dan confirmed_clear_fields=true.")
            if action != "clear" and data.get("confirmed_clear_decisions") is not True:
                raise ValueError("Keep/defer membutuhkan keputusan petugas eksplisit: confirmed_clear_decisions=true.")
            resolved[rid][field] = action
    return clear, resolved


def verify_readback(expected, actual):
    """Bandingkan record/aksi yang disetujui, bukan sekadar jumlah baris."""
    def identity(record):
        if record.get("shelter_id"):
            return (record.get("disaster_id") or "", record["shelter_id"])
        normalize = lambda value: " ".join(w for w in re.findall(r"[a-z0-9]+", str(value or "").lower()) if w not in {"posko","desa","kelurahan","pengungsian","tenda"})
        return (normalize(record.get("shelter_name")),normalize(record.get("village")))
    def scalar(value):
        return None if value == "" else value
    def item(value):
        if isinstance(value,dict):
            return value.get("item","") + (f" ({value['qty']} {value.get('unit') or ''})".rstrip() if value.get("qty") else "")
        return str(value)
    indexed = {}
    for record in actual:
        indexed.setdefault(identity(record),[]).append(record)
    differences, matched = [], 0
    fields = ("batch_id","report_id","shelter_type","total_people","total_families","male","female","infants_toddlers","children","elderly","pregnant","breastfeeding","disability","is_estimate","validation_status")
    for record in expected.get("records",[]):
        matches = indexed.get(identity(record),[])
        rid = record.get("report_id")
        if len(matches) != 1:
            differences.append({"report_id":rid,"field":"identity","reason":"record hilang/ambigu"})
            continue
        observed, matched = matches[0], matched+1
        for field in fields:
            if record.get(field) is not None and scalar(observed.get(field)) != scalar(record[field]):
                differences.append({"report_id":rid,"field":field,"expected":record[field],"actual":observed.get(field)})
        if record.get("reported_at"):
            try:
                times=[]
                for value in (record["reported_at"],observed.get("reported_at")):
                    parsed=datetime.fromisoformat(str(value))
                    times.append((parsed.replace(tzinfo=timezone(timedelta(hours=7))) if parsed.tzinfo is None else parsed).timestamp())
                if times[0] != times[1]:
                    differences.append({"report_id":rid,"field":"reported_at","reason":"waktu laporan berbeda"})
            except ValueError:
                differences.append({"report_id":rid,"field":"reported_at","reason":"waktu laporan tidak valid/hilang"})
        for correction in record.get("corrections",[]):
            field = correction.get("field")
            if correction.get("action") == "cleared_by_officer" and record.get(field) is None and scalar(observed.get(field)) is not None:
                differences.append({"report_id":rid,"field":field,"reason":"clear disetujui tetapi belum diterapkan","actual":observed.get(field)})
        for key,amount in (record.get("stock") or {}).items():
            if amount is not None and (observed.get("stock") or {}).get(key) != amount:
                differences.append({"report_id":rid,"field":"stock."+key,"expected":amount,"actual":(observed.get("stock") or {}).get(key)})
            if amount is not None and (observed.get("stock_context") or {}).get(key) != (record.get("stock_context") or {}).get(key):
                differences.append({"report_id":rid,"field":"stock_context."+key,"reason":"metadata stok berbeda"})
        for field in ("urgent_needs","surplus_do_not_send"):
            if record.get(field) or (field == "urgent_needs" and record.get("needs_cleared")):
                if [item(v) for v in record.get(field,[])] != [item(v) for v in observed.get(field,[])]:
                    differences.append({"report_id":rid,"field":field,"reason":"daftar barang berbeda"})
    return {"status":"verified" if not differences else "mismatch", "expected_count":len(expected.get("records",[])),
            "matched_count":matched,"difference_count":len(differences),"differences":differences}


def commit_snapshot(original, effective, storage):
    """Publish revisi hanya sesudah writer sukses; referensi kandidat lama dihentikan."""
    load_snapshot(original)
    payload = dict(effective)
    payload["snapshot_kind"] = "committed"
    payload["parent_snapshot"] = original
    payload["storage"] = storage
    reference = save_snapshot(payload)
    directory = Path(os.environ.get("SIGAP_SNAPSHOT_DIR", "output/.sigap_snapshots")).expanduser()
    target = directory / (original["snapshot_id"] + ".committed.json")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as stream:
            temporary = stream.name
            json.dump(reference, stream)
        os.replace(temporary, target)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return reference


def save_source(text, correction_target=None, correction_base=None, candidate_target=None):
    payload = {"source_text": text}
    if candidate_target is not None:
        if correction_target is not None or correction_base is not None:
            raise ValueError("Pilih kandidat atau baris tersimpan, bukan kedua target sekaligus.")
        get_candidate_record(candidate_target)
        payload["candidate_target"] = candidate_target
    if correction_target is not None:
        get_correction_record(correction_target)
        payload["correction_target"] = correction_target
    if correction_base is not None:
        if correction_target is None:
            raise ValueError("Kandidat koreksi memerlukan target read-back.")
        get_correction_base(correction_base)
        payload["correction_base"] = correction_base
    reference = save_snapshot(payload)
    return {"batch_id": reference["snapshot_id"], "source_sha256": reference["snapshot_sha256"]}


def load_source(reference):
    return load_source_context(reference)["source_text"]


def load_source_context(reference):
    return load_snapshot({"snapshot_id": reference.get("batch_id"), "snapshot_sha256": reference.get("source_sha256")})


def get_correction_record(target):
    if not isinstance(target, dict):
        raise ValueError("Target koreksi harus referensi read-back.")
    snapshot = load_snapshot({k: target.get(k) for k in ("snapshot_id", "snapshot_sha256")})
    index = target.get("record_index")
    records = snapshot.get("records", [])
    if snapshot.get("snapshot_kind") != "storage_readback" or type(index) is not int or not 0 <= index < len(records):
        raise ValueError("Target koreksi tidak mengacu baris read-back yang sah.")
    record = records[index]
    if not record.get("batch_id") or not record.get("report_id") or not record.get("shelter_name"):
        raise ValueError("Baris asal belum memiliki identitas batch/laporan/posko untuk koreksi.")
    return json.loads(json.dumps(record))


def get_correction_base(reference):
    if not isinstance(reference, dict):
        raise ValueError("Referensi kandidat koreksi tidak valid.")
    snapshot = load_snapshot({k: reference.get(k) for k in ("snapshot_id", "snapshot_sha256")})
    index = reference.get("record_index")
    records = snapshot.get("records", [])
    if snapshot.get("snapshot_kind") != "correction_candidate" or type(index) is not int or not 0 <= index < len(records):
        raise ValueError("Referensi bukan kandidat koreksi yang sah.")
    return json.loads(json.dumps(records[index]))


def get_candidate_record(reference):
    if not isinstance(reference, dict):
        raise ValueError("Target kandidat harus referensi snapshot.")
    snapshot = load_snapshot({k: reference.get(k) for k in ("snapshot_id", "snapshot_sha256")})
    index = reference.get("record_index")
    records = snapshot.get("records", [])
    if snapshot.get("snapshot_kind") not in ("report_candidate", "correction_candidate") or type(index) is not int or not 0 <= index < len(records):
        raise ValueError("Target bukan kandidat yang sah.")
    record = records[index]
    if not record.get("report_id") or not record.get("batch_id") or not record.get("shelter_name"):
        raise ValueError("Kandidat belum memiliki identitas laporan/batch/posko.")
    return json.loads(json.dumps(record))


def matches_update_target(row, header, target):
    """Koreksi menunjuk baris asal; tidak boleh jatuh kembali ke append."""
    if not isinstance(target, dict) or not target.get("batch_id") or not target.get("report_id") or not isinstance(target.get("expected"), dict):
        raise ValueError("Target update tidak valid.")
    columns = {"batch_id": "batch_id", "report_id": "id_laporan", "shelter_name": "posko", "village": "desa", "disaster_id": "disaster_id", "shelter_id": "shelter_id"}
    value = lambda v: "" if v is None else str(v).strip().removeprefix("'")
    for field, column in columns.items():
        actual = row[header.index(column)] if column in header else ""
        if value(actual) != value(target.get(field)):
            return False
    for column, expected in target["expected"].items():
        if column not in header:
            return False
        actual = row[header.index(column)]
        if column in ("waktu_laporan", "dicatat_pada") and expected:
            try:
                times = []
                for item in (actual, expected):
                    parsed = datetime.fromisoformat(str(item))
                    times.append((parsed.replace(tzinfo=timezone(timedelta(hours=7))) if parsed.tzinfo is None else parsed).timestamp())
                if times[0] != times[1]:
                    return False
            except (ValueError, TypeError):
                return False
        elif isinstance(expected, bool):
            if value(actual).lower() != str(expected).lower():
                return False
        elif isinstance(expected, (dict, list)):
            try:
                if json.loads(actual) != expected:
                    return False
            except (ValueError, TypeError):
                return False
        elif value(actual) != value(expected):
            return False
    return True


STOCK_ALIASES = {"water": "air_liter_per_hari", "food": "kkal_per_hari", "latrines": "jamban_unit", "shelter_area": "ruang_hunian_m2"}
STOCK_UNITS = {"air_liter_per_hari": "L", "kkal_per_hari": "kkal", "jamban_unit": "unit", "ruang_hunian_m2": "m2"}


def normalize_stock(record):
    """Normalisasi alias eksplisit tanpa konversi ukuran atau periode."""
    stock, context, issues = {}, {}, []
    raw_stock, raw_context = record.get("stock") or {}, record.get("stock_context") or {}
    if not isinstance(raw_stock, dict) or not isinstance(raw_context, dict):
        return {}, {}, ["stock dan stock_context harus object."]
    for original in set(raw_stock) | set(raw_context):
        key = STOCK_ALIASES.get(original, original)
        if key not in STOCK_UNITS:
            issues.append(f"Key stok tidak dikenal: {original}.")
            continue
        meta = raw_context.get(original) or {}
        if not isinstance(meta, dict):
            issues.append(f"Metadata stok {original} harus object.")
            continue
        amount = raw_stock.get(original, meta.get("value"))
        if key in stock:
            issues.append(f"Alias stok ganda/ambigu untuk {key}.")
            stock[key] = None
            continue
        meta = dict(meta)
        meta.pop("value", None)
        unit = str(meta.get("unit") or "")
        meta["unit"] = {"liter": "L", "litre": "L", "l": "L", "m²": "m2"}.get(unit.lower(), unit)
        if amount is not None and (isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount < 0):
            issues.append(f"Stok {key} harus angka finite nonnegatif.")
            amount = None
        stock[key], context[key] = amount, meta
    return stock, context, issues


def merge_storage_json_cells(old, incoming, merged, header):
    """Metadata parsial di storage mengikuti aturan nilai tidak disebut, bukan replace object."""
    def get(row, column, default):
        if column not in header:
            return default
        value = row[header.index(column)]
        parsed = json.loads(value) if value else default
        if not isinstance(parsed, type(default)):
            raise ValueError(f"Metadata {column} tidak valid.")
        return parsed
    def put(column, value):
        if column in header:
            merged[header.index(column)] = json.dumps(value, ensure_ascii=False, sort_keys=True)
    if "stok_json" in header:
        before, after = get(old,"stok_json",{}), get(incoming,"stok_json",{})
        issues = get(incoming,"masalah_stok_json",[])
        changed = {k for k,v in after.items() if v is not None or any(k in str(issue) for issue in issues)}
        combined = dict(before)
        combined.update({k: after[k] for k in changed})
        put("stok_json", combined)
        context = dict(get(old,"konteks_stok_json",{}))
        new_context = get(incoming,"konteks_stok_json",{})
        context.update({k:new_context.get(k,{}) for k in changed})
        put("konteks_stok_json",context)
    if "provenance_json" in header:
        proof = dict(get(old,"provenance_json",{}))
        new_proof = get(incoming,"provenance_json",{})
        for key,value in new_proof.items():
            # Stok placeholder tidak boleh mengganti provenance nilai lama.
            if key.startswith("stock.") and "stok_json" in header and key[6:] not in changed:
                continue
            proof[key] = value
        put("provenance_json",proof)
    for column in ("riwayat_catatan_json", "riwayat_koreksi_json", "sumber_laporan_json"):
        if column in header:
            values = get(old,column,[]) + get(incoming,column,[])
            unique = {json.dumps(v,sort_keys=True,ensure_ascii=False):v for v in values}
            put(column,list(unique.values()))
    return merged
