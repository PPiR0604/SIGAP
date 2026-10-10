"""Logistics Storage Writer — Langflow custom component (Google Sheets + CSV).

Menulis baris yang SUDAH DIKONFIRMASI petugas (output "Baris Disetujui" dari Officer Confirmation Gate).
Mendukung UPSERT (update jika posko sudah ada, append jika posko baru) agar tidak terjadi
duplikasi data saat memulai sesi baru atau menerima update laporan posko yang sama.

Mode penyimpanan:
- auto          : Google Sheets jika URL terisi; CSV jika URL kosong. Gagal/timeout Google -> periksa status, tanpa fallback write.
- google_sheets : hanya Google Sheets. Jika gagal, data ditampilkan agar bisa disalin manual (tanpa CSV).
- csv           : hanya CSV (tidak menghubungi Google).

Aturan Upsert:
- Identitas stabil disaster_id/shelter_id atau nama+desa persis setelah normalisasi; bukan id_laporan.
- Jika posko sudah ada: menolak laporan usang, menjaga field kosong kecuali clear_columns disetujui, menaikkan versi.
- Jika posko belum ada: menambahkan (append) baris baru (versi 1).
- Mencegah duplikasi data antar sesi kerja petugas.
- Encoding utf-8-sig supaya langsung terbaca benar di Microsoft Excel.
- Sel yang diawali = + - @ diberi tanda ' di depan (mencegah formula injection saat dibuka di Excel).

Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import csv
import json
import re
import threading
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from sigap_contracts import load_snapshot, commit_snapshot, merge_storage_json_cells, matches_update_target

from lfx.custom.custom_component.component import Component
from lfx.io import DropdownInput, MessageTextInput, Output, SecretStrInput, StrInput
from lfx.schema.message import Message

WIB = timezone(timedelta(hours=7))
_CSV_LOCK = threading.Lock()
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
GENERIC_WORDS = {"posko", "pengungsian", "tenda", "titik", "pos", "di", "dan", "desa", "dusun", "kel", "kelurahan", "darurat"}


def parse_rows_json(text: str) -> dict:
    """Ambil {"header": [...], "rows": [[...]]} dari teks (boleh dibungkus ```json)."""
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    start = candidate.find("{")
    if start == -1:
        raise ValueError("Data baris bukan JSON.")
    data, _ = json.JSONDecoder().raw_decode(candidate[start:])
    header, rows = data.get("header", []), data.get("rows", [])
    if not header or not rows:
        raise ValueError("JSON tidak berisi header atau rows.")
    if any(len(r) != len(header) for r in rows):
        raise ValueError("Jumlah kolom pada rows tidak sama dengan header.")
    clear_columns = data.get("clear_columns", [[] for _ in rows])
    if not isinstance(clear_columns, list) or len(clear_columns) != len(rows) or any(not isinstance(c, list) for c in clear_columns):
        raise ValueError("clear_columns harus satu array per row.")
    protected = {"posko", "desa", "shelter_id", "disaster_id", "waktu_laporan", "id_laporan"}
    if any(c not in header or c in protected for cols in clear_columns for c in cols):
        raise ValueError("clear_columns memuat kolom tidak dikenal atau identitas yang dilindungi.")
    payload = {"header": header, "rows": rows, "clear_columns": clear_columns}
    targets = data.get("update_targets", [None for _ in rows])
    if not isinstance(targets, list) or len(targets) != len(rows) or any(t is not None and not isinstance(t, dict) for t in targets):
        raise ValueError("update_targets harus satu target per row.")
    payload["update_targets"] = targets
    if data.get("approved_write"):
        approved = load_snapshot(data["approved_write"])
        if approved.get("kind") != "approved_write" or any(approved.get(key) != payload[key] for key in ("header", "rows", "clear_columns")):
            raise ValueError("Baris berubah setelah persetujuan; write ditolak.")
        if approved.get("update_targets", [None for _ in rows]) != targets:
            raise ValueError("Target koreksi berubah setelah persetujuan; write ditolak.")
        load_snapshot(approved["source_snapshot"])
        payload["approved_write"] = approved
    return payload


def safe_cell(value) -> str:
    s = "" if value is None else str(value)
    return "'" + s if s.startswith(_FORMULA_PREFIXES) else s


def _clean_str(val) -> str:
    if val is None:
        return ""
    s = re.sub(r"[^\w\s]", " ", str(val).lower())
    words = [w for w in s.split() if w and w not in GENERIC_WORDS]
    return " ".join(words)


def is_row_match(row_a: list, row_b: list, i_posko: int | None, i_desa: int | None, i_id: int | None,
                 i_shelter: int | None = None, i_disaster: int | None = None) -> bool:
    """Menentukan apakah dua baris mewakili posko yang sama untuk keperluan upsert."""
    p_a = _clean_str(row_a[i_posko]) if i_posko is not None and i_posko < len(row_a) else ""
    p_b = _clean_str(row_b[i_posko]) if i_posko is not None and i_posko < len(row_b) else ""
    d_a = _clean_str(row_a[i_desa]) if i_desa is not None and i_desa < len(row_a) else ""
    d_b = _clean_str(row_b[i_desa]) if i_desa is not None and i_desa < len(row_b) else ""

    get = lambda row, index: str(row[index]).strip() if index is not None and index < len(row) and row[index] is not None else ""
    disaster_a, disaster_b = get(row_a, i_disaster), get(row_b, i_disaster)
    if disaster_a != disaster_b:
        return False
    shelter_a, shelter_b = get(row_a, i_shelter), get(row_b, i_shelter)
    if shelter_a or shelter_b:
        return bool(shelter_a and shelter_b and shelter_a == shelter_b)
    # report_id hanya identitas pesan per batch; tidak boleh menjadi identitas posko.
    return bool(p_a and p_b and d_a and d_b and p_a == p_b and d_a == d_b)


def merge_update(old: list, incoming: list, header: list[str], clear: list[str]) -> list:
    """Tolak snapshot usang; kosong tidak berarti menghapus nilai lama."""
    if "waktu_laporan" in header:
        index = header.index("waktu_laporan")
        before, after = old[index], incoming[index]
        if before:
            try:
                old_time = datetime.fromisoformat(str(before))
                new_time = datetime.fromisoformat(str(after))
                old_time = old_time.replace(tzinfo=WIB) if old_time.tzinfo is None else old_time.astimezone(WIB)
                new_time = new_time.replace(tzinfo=WIB) if new_time.tzinfo is None else new_time.astimezone(WIB)
            except ValueError as exc:
                raise ValueError("Pembaruan memerlukan waktu_laporan valid; waktu kosong tidak boleh menimpa snapshot bertanggal.") from exc
            if new_time < old_time:
                raise ValueError("Laporan usang ditolak: waktu_laporan lebih lama dari snapshot tersimpan.")
    merged = ["" if col in clear else old[i] if incoming[i] is None or incoming[i] == "" else safe_cell(incoming[i])
              for i, col in enumerate(header)]
    return merge_storage_json_cells(old, incoming, merged, header)


def write_csv(payload: dict, csv_path: str, stamp: datetime | None = None) -> dict:
    """Upsert baris ke CSV (update jika posko sudah ada, append jika baru).
    Kembalikan {'path', 'count', 'appended', 'updated', 'new_file', 'rotated'}."""
    header, incoming_rows = payload["header"], payload["rows"]
    out_header = header + ["versi", "disimpan_di"]
    path = Path(csv_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = stamp or datetime.now(WIB)
    stamp_str = stamp.strftime("%Y-%m-%d %H:%M")
    rotated = False

    with _CSV_LOCK:
        existing_rows: list[list[str]] = []
        new_file = not path.exists() or path.stat().st_size == 0
        if not new_file:
            with path.open("r", encoding="utf-8-sig", newline="") as fh:
                reader = csv.reader(fh)
                old_header = next(reader, [])
                if old_header != out_header:
                    if len(out_header) <= len(old_header) or not set(old_header).issubset(out_header):
                        raise ValueError("Schema CSV berbeda; migrasi eksplisit diperlukan sebelum menulis.")
                    # Migrasi aditif berdasarkan nama kolom; reader tetap memakai path yang sama.
                    existing_rows = [[row[old_header.index(col)] if col in old_header and old_header.index(col) < len(row) else ""
                                      for col in out_header] for row in reader]
                else:
                    existing_rows = list(reader)

        i_posko = header.index("posko") if "posko" in header else None
        i_desa = header.index("desa") if "desa" in header else None
        i_id = header.index("id_laporan") if "id_laporan" in header else None
        i_shelter = header.index("shelter_id") if "shelter_id" in header else None
        i_disaster = header.index("disaster_id") if "disaster_id" in header else None
        i_ver = out_header.index("versi")

        appended_count = 0
        updated_count = 0

        clear_columns = payload.get("clear_columns", [[] for _ in incoming_rows])
        for row_index, inc_row in enumerate(incoming_rows):
            target = payload.get("update_targets", [None for _ in incoming_rows])[row_index]
            matches = [idx for idx, ex_row in enumerate(existing_rows)
                       if (matches_update_target(ex_row, header, target) if target else
                           is_row_match(inc_row, ex_row, i_posko, i_desa, i_id, i_shelter, i_disaster))]
            if target and len(matches) != 1:
                raise ValueError("Baris asal koreksi hilang, berubah, atau ambigu. Baca ulang dan setujui kandidat baru.")
            if len(matches) > 1:
                raise ValueError("Identitas posko ambigu: beberapa baris tersimpan cocok; periksa duplikasi sebelum update.")
            matched_idx = matches[0] if matches else -1

            if matched_idx >= 0:
                # Update baris yang sudah ada
                old_ver = 1
                try:
                    old_ver = int(existing_rows[matched_idx][i_ver])
                except (IndexError, ValueError):
                    old_ver = 1
                new_ver = old_ver + 1
                updated_row = merge_update(existing_rows[matched_idx], inc_row, header, clear_columns[row_index]) + [str(new_ver), stamp_str]
                existing_rows[matched_idx] = updated_row
                updated_count += 1
            else:
                # Tambah baris baru
                new_row = [safe_cell(c) for c in inc_row] + ["1", stamp_str]
                existing_rows.append(new_row)
                appended_count += 1

        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8-sig", newline="", dir=path.parent, delete=False) as fh:
                temporary = fh.name
                writer = csv.writer(fh)
                writer.writerow(out_header)
                writer.writerows(existing_rows)
            os.replace(temporary, path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    return {
        "path": str(path.resolve()),
        "count": len(incoming_rows),
        "appended": appended_count,
        "updated": updated_count,
        "new_file": new_file,
        "rotated": rotated,
    }


def post_to_google(payload: dict, url: str, secret: str) -> dict:
    if any(payload.get("update_targets") or []):
        check = httpx.post(url, json={"action": "read_rows", "secret": secret}, timeout=30, follow_redirects=True)
        check.raise_for_status()
        result = check.json()
        if not result.get("ok") or result.get("capabilities", {}).get("targeted_updates") is not True:
            raise ValueError("Deployment Apps Script belum mendukung koreksi baris asal. Perbarui Code.gs dan deploy versi baru sebelum menyimpan koreksi.")
    body = {"action": "upsert_rows", "header": payload["header"], "rows": payload["rows"], "clear_columns": payload.get("clear_columns"), "update_targets": payload.get("update_targets"), "secret": secret}
    resp = httpx.post(url, json=body, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    result = resp.json()
    if not result.get("ok"):
        raise RuntimeError(f"Apps Script menolak: {result.get('error')}")
    return result


def rows_as_text(payload: dict) -> str:
    lines = [" | ".join(payload["header"])] + [" | ".join("" if c is None else str(c) for c in r) for r in payload["rows"]]
    return "\n".join(lines)


def success_result(payload, storage, message):
    """Revisi efektif dipublikasikan hanya setelah backend mengakui write sukses."""
    result = {"status": "saved", "count": len(payload["rows"]), "storage": storage}
    approved = payload.get("approved_write")
    if approved:
        approval = approved["effective_payload"].get("approval",{})
        result["applied_actions"] = approval.get("clear_decisions",{})
        result["applied_clear_fields"] = approval.get("approved_clear_fields",{})
        try:
            result.update(commit_snapshot(approved["source_snapshot"], approved["effective_payload"], storage))
        except (ValueError, OSError) as exc:
            result["status"] = "saved_revision_pending"
            result["revision_error"] = str(exc)
            message += " Data sudah tersimpan tetapi referensi efektif belum tersedia; lakukan read-back, jangan retry write."
    return Message(text="SIGAP_WRITE_RESULT " + json.dumps(result, ensure_ascii=False) + "\n" + message +
                        "\nGunakan referensi efektif/read-back untuk hitungan dan buletin berikutnya.\n```json\n" + json.dumps(result, ensure_ascii=False, indent=2) + "\n```")


class LogisticsStorageWriter(Component):
    display_name = "Logistics Storage Writer"
    description = (
        "Menyimpan baris yang sudah dikonfirmasi ke Google Sheets atau CSV dengan kemampuan UPSERT "
        "(update data jika posko sudah ada, append jika baru) agar data tidak terduplikasi saat sesi baru."
    )
    icon = "sheet"
    name = "LogisticsStorageWriter"

    inputs = [
        MessageTextInput(
            name="content",
            display_name="Isi",
            required=True,
            info="JSON baris dari Officer Confirmation Gate.",
        ),
        DropdownInput(
            name="storage_mode",
            display_name="Mode Penyimpanan",
            options=["auto", "google_sheets", "csv"],
            value="auto",
            info="auto: Google Sheets jika URL terisi, CSV jika kosong. Gagal/timeout Google: periksa status sebelum retry.",
        ),
        SecretStrInput(
            name="webhook_url",
            display_name="Webhook URL (Apps Script)",
            required=False,
            info="Kosongkan jika Google belum disetup; data otomatis masuk CSV.",
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
            info="Relatif terhadap folder kerja Langflow, atau isi path absolut.",
        ),
    ]

    outputs = [
        Output(display_name="Hasil", name="result", method="send"),
    ]

    def send(self) -> Message:
        text = self.content or ""
        if not text.strip():
            return Message(text="Tidak ada data untuk disimpan.")
        try:
            payload = parse_rows_json(text)
        except (ValueError, json.JSONDecodeError) as exc:
            return Message(text=f"GAGAL: {exc}")

        mode = (self.storage_mode or "auto").strip()
        url = (self.webhook_url or "").strip()
        note = ""

        if mode in ("auto", "google_sheets"):
            if url:
                try:
                    result = post_to_google(payload, url, self.shared_secret or "")
                    self.status = "Tersimpan di Google Sheets"
                    up = result.get("updated", 0)
                    app = result.get("appended", 0)
                    summary = []
                    if up > 0:
                        summary.append(f"{up} baris diperbarui")
                    if app > 0:
                        summary.append(f"{app} baris baru ditambahkan")
                    summary_str = ", ".join(summary) if summary else f"{len(payload['rows'])} baris diproses"
                    return success_result(payload, {"mode": "google_sheets", "url": result.get("url")},
                                          f"BERHASIL [mode: Google Sheets]: {summary_str} di sheet rekap. Buka: {result.get('url', '-')}")
                except (httpx.HTTPError, ValueError, RuntimeError) as exc:
                    note = f"Google Sheets gagal ({exc})."
                    # Timeout tidak membuktikan write gagal; hindari split-brain CSV/Google.
                    self.status = "Status Google Sheets perlu diperiksa"
                    return Message(text=f"STATUS SIMPAN BELUM DIPASTIKAN [mode: Google Sheets] — {note}\n"
                                        "Periksa rekap Google sebelum retry; tidak melakukan fallback write ke CSV.")
            elif mode == "google_sheets":
                self.status = "Webhook URL kosong"
                return Message(text="TIDAK TERSIMPAN [mode: Google Sheets] — Webhook URL belum diisi. "
                                    "Ganti Mode Penyimpanan ke auto/csv, atau isi Webhook URL.\n\n" + rows_as_text(payload))
            else:
                note = "Google Sheets belum dikonfigurasi."

        try:
            info = write_csv(payload, (self.csv_path or "output/rekap_posko.csv").strip())
        except (OSError, ValueError) as exc:
            self.status = "CSV gagal"
            return Message(text=f"TIDAK TERSIMPAN — {note} Penulisan CSV juga gagal ({exc}).\n"
                                "Data bisa disalin manual:\n\n" + rows_as_text(payload))
        self.status = "Tersimpan di CSV"
        extra = " File lama punya header berbeda, jadi dibuat file baru; file lama tidak diubah." if info["rotated"] else ""
        summary = []
        if info["updated"] > 0:
            summary.append(f"{info['updated']} baris diperbarui")
        if info["appended"] > 0:
            summary.append(f"{info['appended']} baris baru ditambahkan")
        summary_str = ", ".join(summary) if summary else f"{info['count']} baris diproses"
        return success_result(payload, {"mode": "csv", "path": info["path"]},
                              f"BERHASIL [mode: CSV] — {note} {summary_str} ke {info['path']} (bisa dibuka di Excel).{extra}")
