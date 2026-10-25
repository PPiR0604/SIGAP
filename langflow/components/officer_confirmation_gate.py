"""Officer Confirmation Gate — Langflow custom component (Human-in-the-Loop).

Gerbang sebelum data ditulis ke Google Sheets:
- Data HANYA diteruskan jika JSON input berisi "confirmed_by_officer": true.
- Kolom yang boleh ditulis dibatasi (whitelist): tidak ada nama, nomor HP, atau NIK.
- Dua output: "Baris Disetujui" (diteruskan ke penulis sheet) dan "Ditolak" (pesan ke petugas).
  Output yang tidak berlaku dihentikan, sehingga penulis sheet tidak pernah berjalan tanpa konfirmasi.

Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from sigap_contracts import load_snapshot, save_snapshot, quality_status, clear_options, resolve_clear_decisions
from sigap_sqlite import resolve_storage_conflicts

from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output
from lfx.schema.message import Message

WIB = timezone(timedelta(hours=7))  # waktu laporan WhatsApp di Indonesia umumnya WIB

SHEET_COLUMNS = [
    ("disaster_id", "disaster_id"),
    ("shelter_id", "shelter_id"),
    ("batch_id", "batch_id"),
    ("reported_at", "waktu_laporan"),
    ("report_id", "id_laporan"),
    ("shelter_name", "posko"),
    ("village", "desa"),
    ("shelter_type", "jenis_pengungsian"),
    ("total_people", "jumlah_jiwa"),
    ("total_families", "jumlah_kk"),
    ("male", "laki_laki"),
    ("female", "perempuan"),
    ("infants_toddlers", "bayi_balita"),
    ("children", "anak"),
    ("elderly", "lansia"),
    ("pregnant", "ibu_hamil"),
    ("breastfeeding", "ibu_menyusui"),
    ("disability", "disabilitas"),
    ("urgent_needs", "kebutuhan_mendesak"),
    ("surplus_do_not_send", "sudah_cukup"),
    ("notes", "catatan"),
    ("stock", "stok_json"),
    ("stock_context", "konteks_stok_json"),
    ("field_provenance", "provenance_json"),
    ("source_report_ids", "sumber_laporan_json"),
    ("validation_issues", "masalah_validasi_json"),
    ("unverified_numbers", "angka_tidak_terverifikasi_json"),
    ("missing_fields", "field_kosong_json"),
    ("stock_issues", "masalah_stok_json"),
    ("notes_history", "riwayat_catatan_json"),
    ("corrections", "riwayat_koreksi_json"),
    ("pending_clear_fields", "usulan_clear_json"),
    ("is_estimate", "estimasi"),
    ("validation_status", "status_validasi"),
]
JSON_FIELDS = {"stock", "stock_context", "field_provenance", "source_report_ids", "validation_issues",
               "unverified_numbers", "missing_fields", "stock_issues", "notes_history", "corrections", "pending_clear_fields"}


def extract_json(text: str):
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    start = min((i for i in (candidate.find("{"), candidate.find("[")) if i != -1), default=-1)
    if start == -1:
        raise ValueError("Input tidak berisi JSON.")
    obj, _ = json.JSONDecoder().raw_decode(candidate[start:])
    return obj


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, list):
        return "; ".join((v.get("item", "") + (f" ({v['qty']} {v.get('unit') or ''})".rstrip() if v.get("qty") else ""))
                         if isinstance(v, dict) else str(v) for v in value)
    return str(value)


def evaluate(text: str, *, require_snapshot: bool = True) -> dict:
    """Kembalikan {'approved': bool, 'reason': str, 'header': [...], 'rows': [[...]]}."""
    try:
        data = extract_json(text)
    except (ValueError, json.JSONDecodeError):
        return {"approved": False, "reason": "Input bukan JSON yang valid.", "header": [], "rows": []}
    if not isinstance(data, dict) or data.get("confirmed_by_officer") is not True:
        return {"approved": False,
                "reason": "Belum ada konfirmasi eksplisit dari petugas (confirmed_by_officer harus true).",
                "header": [], "rows": []}
    options = {}
    if require_snapshot:
        try:
            snapshot = load_snapshot(data)
            if data.get("approved_snapshot_sha256") != data["snapshot_sha256"]:
                raise ValueError("Persetujuan harus mengacu approved_snapshot_sha256 dari pratinjau yang sama.")
            records = json.loads(json.dumps(snapshot["records"]))
            records = resolve_storage_conflicts(records, data.get('conflict_decisions',{}))
            options = clear_options(records)
            if any(r.get("missing_fields") or r.get("validation_issues") or r.get("unverified_numbers") or r.get("pending_clear_fields") for r in records) and data.get("allow_partial") is not True:
                raise ValueError("Snapshot parsial/bermasalah: tampilkan batas dan minta persetujuan rekap parsial (allow_partial=true).")
            clear, decisions = resolve_clear_decisions(data, records)
            for record in records:
                fields = clear.get(record["report_id"], [])
                if not isinstance(fields, list) or any(f not in record.get("pending_clear_fields", []) for f in fields):
                    raise ValueError("Field clear tidak ada dalam usulan pratinjau snapshot.")
                if fields and data.get("confirmed_clear_fields") is not True:
                    raise ValueError("Pengosongan field memerlukan persetujuan khusus confirmed_clear_fields=true.")
                record["clear_fields"] = fields
                for field, action in decisions.get(record["report_id"], {}).items():
                    if action != "clear":
                        record.setdefault("corrections", []).append({"field":field,"value":record.get(field),"action":action,"reason":str(data.get("officer_note") or "")})
                    if action == "keep":
                        record["pending_clear_fields"] = [f for f in record.get("pending_clear_fields", []) if f != field]
                        record.setdefault("validation_issues", []).append({"field":field,"reason":"Nilai lama dipertahankan atas keputusan petugas; ketidakpastian sumber tetap perlu klarifikasi."})
                for field in fields:
                    old_value = record.get(field)
                    record[field] = None
                    record.setdefault("corrections", []).append({"field": field, "previous_value": old_value, "value": None,
                                                                 "action": "cleared_by_officer", "reason": str(data.get("officer_note") or "")})
                    record.setdefault("field_provenance", {}).setdefault(field, {})["action"] = "cleared_by_officer"
                    record["pending_clear_fields"] = [f for f in record.get("pending_clear_fields", []) if f != field]
                    if field not in record.setdefault("missing_fields", []):
                        record["missing_fields"].append(field)
        except (ValueError, OSError, KeyError, TypeError) as exc:
            return {"approved": False, "reason": str(exc), "header": [], "rows": [], "clear_options": options}
    else:
        if not isinstance(data.get("records"), list):
            return {"approved": False, "reason": "records harus array.", "header": [], "rows": []}
        records = [r for r in data.get("records", []) if isinstance(r, dict)]
        snapshot = {"records": records}
    if not records:
        return {"approved": False, "reason": "Tidak ada record untuk disimpan.", "header": [], "rows": []}
    allowed = {key for key, _ in SHEET_COLUMNS} | {"clear_fields", "report_kind", "needs_cleared", "needs_evidence", "storage_issues", "update_target", "storage_baseline", "storage_conflicts", "storage_source"}
    records = [{key: value for key, value in record.items() if key in allowed} for record in records]

    stamp = datetime.now(WIB).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M")
    note = str(data.get("officer_note") or "").strip()
    for record in records:
        record["validation_status"] = quality_status(record)
        for correction in record.get("corrections", []):
            correction.setdefault("approved_at", stamp)
    mapping = dict(SHEET_COLUMNS)
    clear_columns = []
    for record in records:
        fields = record.get("clear_fields", [])
        protected = {"disaster_id", "shelter_id", "batch_id", "reported_at", "report_id", "shelter_name", "village"}
        if not isinstance(fields, list) or any(not isinstance(f, str) or f not in mapping or f in protected for f in fields):
            return {"approved": False, "reason": "clear_fields tidak valid atau mencoba menghapus identitas.", "header": [], "rows": []}
        clear_columns.append([mapping[f] for f in fields])
        # Catatan lama tetap berada di history; kolom catatan hanya untuk kondisi terbaru.
        if record.get("notes") is None and record.get("notes_history") and not record.get("field_provenance", {}).get("notes"):
            clear_columns[-1].append("catatan")
        if record.get("needs_cleared"):
            clear_columns[-1].append("kebutuhan_mendesak")
    header = [label for _, label in SHEET_COLUMNS] + ["status", "dicatat_pada", "catatan_petugas"]
    rows = [[json.dumps(r.get(key, {} if key in ("stock", "stock_context", "field_provenance") else []), ensure_ascii=False, sort_keys=True)
             if key in JSON_FIELDS else _cell(r.get(key)) for key, _ in SHEET_COLUMNS] + ["DIKONFIRMASI PETUGAS", stamp, note]
            for r in records]
    report_records = [{key: value for key, value in record.items() if key in allowed} for record in snapshot.get("report_records", snapshot["records"])]
    effective = {"records": records, "report_records": report_records, "issues": snapshot.get("issues", []),
                 "approval": {"confirmed_by_officer": True, "approved_at": stamp, "officer_note": note,
                               "allow_partial": data.get("allow_partial") is True, "approved_clear_fields": data.get("approved_clear_fields", {})}}
    effective["approval"]["clear_decisions"] = decisions if require_snapshot else {}
    effective['approval']['conflict_decisions'] = data.get('conflict_decisions',{})
    return {"approved": True, "reason": "", "header": header, "rows": rows, "clear_columns": clear_columns,
            "update_targets": [r.get("update_target") for r in records], "effective_payload": effective}


class OfficerConfirmationGate(Component):
    display_name = "Officer Confirmation Gate"
    description = (
        "Human-in-the-Loop: meneruskan data ke penulis sheet hanya jika petugas sudah mengonfirmasi, "
        "dan hanya kolom agregat tanpa data pribadi."
    )
    icon = "user-check"
    name = "OfficerConfirmationGate"

    inputs = [
        MessageTextInput(
            name="payload",
            display_name="Data + Konfirmasi (JSON)",
            required=True,
            info='JSON snapshot_id, snapshot_sha256, approved_snapshot_sha256, confirmed_by_officer=true. Rekap parsial memerlukan allow_partial=true. Jangan kirim records bebas.',
        ),
    ]

    outputs = [
        Output(display_name="Baris Disetujui", name="approved_rows", method="build_approved", group_outputs=True),
        Output(display_name="Ditolak", name="rejected", method="build_rejected", group_outputs=True),
    ]

    def _result(self) -> dict:
        if getattr(self, "_cached_payload", None) != (self.payload or ""):
            self._cached_result = evaluate(self.payload or "")
            self._cached_payload = self.payload or ""
            if self._cached_result["approved"]:
                try:
                    result, data = self._cached_result, extract_json(self.payload)
                    result["approved_write_reference"] = save_snapshot({"kind": "approved_write", "source_snapshot": {k: data[k] for k in ("snapshot_id", "snapshot_sha256")},
                                                                       "header": result["header"], "rows": result["rows"], "clear_columns": result["clear_columns"], "update_targets": result["update_targets"],
                                                                       "effective_payload": result["effective_payload"]})
                except (ValueError, OSError, KeyError) as exc:
                    self._cached_result = {"approved": False, "reason": f"Otorisasi write tidak dapat disimpan ({exc}); tidak ada data dikirim.", "header": [], "rows": []}
        return self._cached_result

    def build_approved(self) -> Message:
        result = self._result()
        if not result["approved"]:
            self.stop("approved_rows")
            return Message(text="")
        self.status = f"{len(result['rows'])} baris disetujui"
        body = {"action": "upsert_rows", "header": result["header"], "rows": result["rows"], "clear_columns": result["clear_columns"], "update_targets": result["update_targets"]}
        body["approved_write"] = result["approved_write_reference"]
        return Message(text=json.dumps(body, ensure_ascii=False))

    def build_rejected(self) -> Message:
        result = self._result()
        if result["approved"]:
            self.stop("rejected")
            return Message(text="")
        self.status = "Ditolak"
        return Message(text=f"GAGAL: DITOLAK — data TIDAK disimpan. Alasan: {result['reason']} "
                             "Perbaiki payload tanpa membuang aksi yang diminta; officer_note tidak menjalankan clear.\n```json\n" +
                             json.dumps({"status":"rejected","reason":result["reason"],**result.get("clear_options",{})},ensure_ascii=False,indent=2) + "\n```")
