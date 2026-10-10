"""Logistics Storage Reader — Langflow custom component.

Membaca data posko yang sudah tersimpan di Google Sheets (lewat Google Apps Script)
atau dari file CSV lokal (output/rekap_posko.csv).

Dipanggil oleh IBM Bob saat memulai sesi baru atau ketika petugas ingin memeriksa
kondisi posko saat ini sebelum memproses laporan baru.

Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import csv
import json
import re
from sigap_contracts import save_snapshot, quality_status, load_snapshot, verify_readback
from datetime import datetime
from pathlib import Path

import httpx

from lfx.custom.custom_component.component import Component
from lfx.io import DropdownInput, MessageTextInput, Output, SecretStrInput, StrInput
from lfx.schema.message import Message


def read_from_google(url: str, secret: str) -> dict:
    body = {"action": "read_rows", "secret": secret}
    resp = httpx.post(url, json=body, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    result = resp.json()
    if not result.get("ok"):
        raise RuntimeError(f"Apps Script menolak: {result.get('error')}")
    return result


def read_from_csv(csv_path: str) -> dict:
    path = Path(csv_path).expanduser()
    if not path.exists() or path.stat().st_size == 0:
        return {"header": [], "rows": [], "count": 0, "path": str(path.resolve())}

    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, [])
        rows = list(reader)

    return {"header": header, "rows": rows, "count": len(rows), "path": str(path.resolve())}


def build_records(header: list[str], rows: list[list[str]]) -> list[dict]:
    """Ubah baris spreadsheet/CSV menjadi list of dict record terstruktur."""
    records = []
    for r in rows:
        rec = {}
        for idx, col in enumerate(header):
            if idx < len(r):
                val = r[idx]
                if isinstance(val, str) and val.startswith("'"):
                    val = val[1:]  # hapus formula prefix guard
                rec[col] = val
        records.append(normalize_record(rec))
    return records


COLUMN_MAP = {
    "waktu_laporan": "reported_at", "id_laporan": "report_id",
    "posko": "shelter_name", "desa": "village", "jenis_pengungsian": "shelter_type",
    "jumlah_jiwa": "total_people", "jumlah_kk": "total_families",
    "laki_laki": "male", "perempuan": "female", "bayi_balita": "infants_toddlers",
    "anak": "children", "lansia": "elderly", "ibu_hamil": "pregnant",
    "ibu_menyusui": "breastfeeding", "disabilitas": "disability",
    "kebutuhan_mendesak": "urgent_needs", "sudah_cukup": "surplus_do_not_send",
    "catatan": "notes",
    "stok_json": "stock", "konteks_stok_json": "stock_context",
    "provenance_json": "field_provenance", "sumber_laporan_json": "source_report_ids",
    "masalah_validasi_json": "validation_issues", "angka_tidak_terverifikasi_json": "unverified_numbers",
    "field_kosong_json": "missing_fields", "masalah_stok_json": "stock_issues",
    "riwayat_catatan_json": "notes_history", "riwayat_koreksi_json": "corrections",
    "usulan_clear_json": "pending_clear_fields", "estimasi": "is_estimate",
    "status_validasi": "validation_status",
}
JSON_OBJECT_FIELDS = {"stock", "stock_context", "field_provenance"}
JSON_LIST_FIELDS = {"source_report_ids", "validation_issues", "unverified_numbers", "missing_fields",
                    "stock_issues", "notes_history", "corrections", "pending_clear_fields"}
COUNT_FIELDS = {"total_people", "total_families", "male", "female", "infants_toddlers",
                "children", "elderly", "pregnant", "breastfeeding", "disability"}


def normalize_record(record: dict) -> dict:
    """Adapter penyimpanan -> schema analisis; nilai tidak valid tetap tidak diketahui."""
    rec = {COLUMN_MAP.get(k, k): v for k, v in record.items()}
    issues = []
    for field in COUNT_FIELDS:
        value = rec.get(field)
        if value is None or value == "":
            rec[field] = None
        elif isinstance(value, bool):
            rec[field] = None
            issues.append(field)
        elif isinstance(value, int) and value >= 0:
            pass
        elif isinstance(value, str) and re.fullmatch(r"\d+|\d{1,3}(?:[.,]\d{3})+", value.strip()):
            rec[field] = int(re.sub(r"[.,]", "", value.strip()))
        else:
            rec[field] = None
            issues.append(field)
    value = rec.get("reported_at")
    if isinstance(value, datetime):
        rec["reported_at"] = value.isoformat(timespec="minutes")
    elif value == "" or value is None:
        rec["reported_at"] = None
    else:
        try:
            text = re.sub(r"^(\d{4}-\d{2}-\d{2}[ T])(\d):", r"\g<1>0\2:", str(value))
            rec["reported_at"] = datetime.fromisoformat(text).isoformat(timespec="minutes")
        except ValueError:
            rec["reported_at"] = None
            issues.append("reported_at")
    for field in ("urgent_needs", "surplus_do_not_send"):
        value = rec.get(field)
        rec[field] = [s.strip() for s in value.split(";") if s.strip()] if isinstance(value, str) else (value if isinstance(value, list) else [])
    for field in JSON_OBJECT_FIELDS | JSON_LIST_FIELDS:
        value = rec.get(field)
        expected = dict if field in JSON_OBJECT_FIELDS else list
        try:
            value = json.loads(value) if isinstance(value, str) and value else (value if value is not None and value != "" else expected())
            if not isinstance(value, expected):
                raise ValueError("tipe metadata salah")
        except (ValueError, TypeError):
            issues.append(field)
            value = expected()
        rec[field] = value
    value = rec.get("is_estimate")
    if isinstance(value, bool) or value is None or value == "":
        rec["is_estimate"] = value if isinstance(value, bool) else None
    elif str(value).lower() in ("true", "false"):
        rec["is_estimate"] = str(value).lower() == "true"
    else:
        rec["is_estimate"] = None
        issues.append("is_estimate")
    if issues:
        rec["storage_issues"] = issues
    return rec


def format_shelter_summary(records: list[dict], source_info: str, *, source_count=None, query="", reference=None, verification=None) -> str:
    source_count = len(records) if source_count is None else source_count
    metadata = {"status": "ok" if records else "no_matches" if source_count else "source_empty",
                "source": source_info, "total_shelters": source_count, "matched_shelters": len(records), "records": records}
    metadata["verification"] = verification or {"status":"not_requested","reason":"Sertakan expected_snapshot_id/expected_snapshot_sha256 dari receipt writer untuk verifikasi aksi."}
    if reference:
        metadata.update(reference)
    compact = {k: metadata[k] for k in ("status", "source", "total_shelters", "matched_shelters", "snapshot_id", "snapshot_sha256") if k in metadata}
    compact["verification_status"] = metadata["verification"]["status"]
    prefix = "SIGAP_READ_RESULT " + json.dumps(compact, ensure_ascii=False) + "\n"
    if not records:
        message = (f"Tidak ada posko cocok dengan filter '{query}'. Sumber {source_info} berisi {source_count} posko; penyimpanan TIDAK kosong."
                   if source_count else f"Sheet rekap ({source_info}) saat ini masih KOSONG. Belum ada data posko yang tercatat.")
        return prefix + message + "\n```json\n" + json.dumps(metadata, ensure_ascii=False, indent=2) + "\n```"

    lines = [
        f"📊 **Data Posko Tersimpan ({source_info})** — Total: {len(records)} Posko",
        "",
    ]
    if metadata["verification"]["status"] == "mismatch":
        lines.append("VERIFIKASI BELUM SESUAI: jumlah baris terbaca tidak berarti semua aksi diterapkan.")
        lines.extend("- " + json.dumps(item,ensure_ascii=False) for item in metadata["verification"]["differences"])
    elif metadata["verification"]["status"] == "verified":
        lines.append(f"Verifikasi aksi sesuai: {metadata['verification']['matched_count']} record yang diharapkan cocok.")
    else:
        lines.append("Data terbaca; verifikasi terhadap aksi write belum diminta.")

    for i, r in enumerate(records, 1):
        posko = r.get("posko") or r.get("shelter_name") or f"Posko {i}"
        desa = r.get("desa") or r.get("village") or "-"
        jiwa = r.get("total_people") if r.get("total_people") is not None else r.get("jumlah_jiwa")
        jiwa = "?" if jiwa is None or jiwa == "" else jiwa
        kebutuhan = r.get("kebutuhan_mendesak") or r.get("urgent_needs") or "belum dicatat"
        waktu = r.get("waktu_laporan") or r.get("reported_at") or "-"
        versi = r.get("versi")
        ver_str = f" [v{versi}]" if versi else ""

        lines.append(f"{i}. **{posko}** (Desa: {desa}){ver_str}")
        lines.append(f"   • Jumlah jiwa: **{'± ' if r.get('is_estimate') else ''}{jiwa} jiwa**")
        lines.append(f"   • Kebutuhan mendesak: {kebutuhan}")
        lines.append(f"   • Waktu laporan: {waktu}")
        lines.append(f"   • Status validasi: {r.get('validation_status') or quality_status(r)} (berbeda dari persetujuan simpan)")

    lines.append("")
    lines.append("```json")
    lines.append(json.dumps(metadata, ensure_ascii=False, indent=2))
    lines.append("```")

    return prefix + "\n".join(lines)


def parse_query(text):
    """Perintah baca-semua berbeda dari filter eksplisit/literal nama."""
    text = text.strip()
    if text.startswith("{"):
        data = json.loads(text)
        if data.get("action") == "all":
            return ""
        if data.get("action") == "filter" and isinstance(data.get("term"), str):
            return data["term"].strip().lower()
        raise ValueError('Kueri JSON harus {"action":"all"} atau {"action":"filter","term":"nama/desa"}.')
    lowered = text.lower()
    if not lowered or re.search(r"\b(?:semua|seluruh|all)\b", lowered) or lowered in ("cek", "baca", "status", "halo", "hi", "lihat", "posko", "cek posko aktif"):
        return ""
    return re.sub(r"^(?:cek|baca|lihat|cari)\s+", "", lowered)


class LogisticsStorageReader(Component):
    display_name = "Logistics Storage Reader"
    description = "Membaca data posko yang sudah tersimpan di Google Sheets atau CSV untuk mengecek kondisi di awal sesi."
    icon = "database"
    name = "LogisticsStorageReader"

    inputs = [
        MessageTextInput(
            name="query",
            display_name="Kueri Pencarian / Sapaan",
            required=False,
            info="Pesan dari user, atau filter nama posko/desa (opsional, kosongkan untuk semua).",
        ),
        DropdownInput(
            name="storage_mode",
            display_name="Mode Penyimpanan",
            options=["auto", "google_sheets", "csv"],
            value="auto",
            info="auto: Google Sheets jika Webhook URL terisi, selain itu CSV.",
        ),
        SecretStrInput(
            name="webhook_url",
            display_name="Webhook URL (Apps Script)",
            required=False,
            info="URL Web App Google Apps Script. Kosongkan untuk mode CSV lokal.",
        ),
        SecretStrInput(
            name="shared_secret",
            display_name="Shared Secret",
            required=False,
            advanced=True,
            info="Harus sama dengan SHARED_SECRET di Code.gs.",
        ),
        StrInput(
            name="csv_path",
            display_name="Lokasi File CSV",
            value="output/rekap_posko.csv",
            advanced=True,
            info="Path file CSV lokal rekap posko.",
        ),
    ]

    outputs = [
        Output(display_name="Daftar Posko", name="shelter_records", method="fetch"),
    ]

    def fetch(self) -> Message:
        mode = (getattr(self, "storage_mode", None) or "auto").strip()
        url = (getattr(self, "webhook_url", None) or "").strip()
        secret = getattr(self, "shared_secret", None) or ""
        csv_path = getattr(self, "csv_path", None) or "output/rekap_posko.csv"
        records: list[dict] = []
        source_info = ""
        observed_storage = {}
        google_read_ok = False

        # 1. Coba Google Sheets jika mode mengizinkan dan URL terisi
        if mode in ("auto", "google_sheets") and url:
            try:
                res = read_from_google(url, secret)
                header = res.get("header", [])
                rows = res.get("rows", [])
                records = [normalize_record(r) for r in res["records"]] if isinstance(res.get("records"), list) else build_records(header, rows)
                google_read_ok = True
                source_info = "Google Sheets" + (": " + str(res["url"]) if res.get("url") else "")
                observed_storage = {"mode":"google_sheets","url":res.get("url")}
                self.status = f"{len(records)} posko dibaca dari Google Sheets"
            except Exception as exc:
                if mode == "google_sheets":
                    self.status = "Gagal membaca Google Sheets"
                    return Message(text=f"GAGAL membaca dari Google Sheets: {exc}")
                # Pada mode auto, lanjut coba CSV fallback
                pass

        # 2. Coba CSV jika belum berhasil dari Google Sheets
        if not google_read_ok and mode in ("auto", "csv"):
            try:
                csv_data = read_from_csv(csv_path.strip())
                records = build_records(csv_data["header"], csv_data["rows"])
                source_info = f"CSV: {csv_data['path']}"
                observed_storage = {"mode":"csv","path":csv_data["path"]}
                self.status = f"{len(records)} posko dibaca dari CSV"
            except Exception as exc:
                self.status = "Gagal membaca CSV"
                return Message(text=f"GAGAL membaca dari CSV: {exc}")

        if mode == "google_sheets" and not url:
            return Message(text="GAGAL: Webhook URL Google Sheets belum diisi.")

        # Filter jika kueri mengandung nama tertentu
        source_count = len(records)
        verification = None
        try:
            query_value = getattr(self, "query", "") or ""
            query_text = parse_query(query_value)
            request = json.loads(query_value) if query_value.strip().startswith("{") else {}
            if any(k in request for k in ("expected_snapshot_id","expected_snapshot_sha256")):
                if query_text:
                    raise ValueError("Verifikasi write memerlukan action=all, bukan filter.")
                expected = load_snapshot({"snapshot_id":request.get("expected_snapshot_id"),"snapshot_sha256":request.get("expected_snapshot_sha256")})
                if expected.get("snapshot_kind") != "committed":
                    raise ValueError("Gunakan referensi efektif dari SIGAP_WRITE_RESULT, bukan kandidat/read-back lama.")
                verification = verify_readback(expected,records)
                expected_storage = expected.get("storage",{})
                location = "url" if expected_storage.get("mode") == "google_sheets" else "path"
                same_location = expected_storage.get(location) == observed_storage.get(location)
                if location == "path" and expected_storage.get(location) and observed_storage.get(location):
                    same_location = Path(expected_storage[location]) == Path(observed_storage[location])
                if expected_storage.get("mode") != observed_storage.get("mode") or not same_location:
                    verification["status"] = "mismatch"
                    verification["differences"].append({"field":"storage","reason":"sumber read-back tidak sama dengan receipt writer"})
                    verification["difference_count"] = len(verification["differences"])
        except (ValueError, TypeError, OSError) as exc:
            return Message(text=f"GAGAL: {exc}")
        if query_text:
            filtered = [
                r for r in records
                if query_text in str(r.get("shelter_name", "")).lower() or query_text in str(r.get("village", "")).lower()
            ]
            records = filtered

        reference = None
        if records:
            try:
                reference = save_snapshot({"records": records, "report_records": records, "snapshot_kind": "storage_readback",
                                           "verification": verification or {"status":"not_requested"},
                                           "storage": {"source": source_info, "source_count": source_count, "filter": query_text}})
            except (ValueError, OSError) as exc:
                return Message(text=f"GAGAL: data terbaca tetapi referensi read-back tidak dapat dibuat ({exc}).")
        summary = format_shelter_summary(records, source_info or "Penyimpanan Lokal", source_count=source_count, query=query_text, reference=reference, verification=verification)
        return Message(text=summary)
