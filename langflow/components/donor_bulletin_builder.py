"""Donor Bulletin Builder — Langflow custom component.

Menyusun draf buletin kebutuhan publik untuk donatur: "Dibutuhkan" dan
"Sudah cukup — jangan dikirim", diringkas per desa.

Mendukung input field dalam Bahasa Indonesia maupun Inggris:
- posko / shelter_name
- desa / kelurahan / village
- jumlah_jiwa / total_people / jiwa
- kebutuhan_mendesak / urgent_needs / kebutuhan
- sudah_cukup / surplus_do_not_send / surplus

Mendukung berbagai format pembungkus JSON:
- {"records": [...]}
- {"confirmed_records": [...]}
- {"approved_records": [...]}
- {"data": {"records": [...]}}
- Langsung list: [...]

Perlindungan data: buletin publik TIDAK memuat nama posko per kelompok rentan,
jumlah penyandang disabilitas per lokasi, atau data pribadi apa pun
(Juklak BNPB 9/2023: detail kelompok rentan di lokasi pengungsian termasuk data sensitif).

Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import json
import re
import hashlib
from sigap_contracts import load_snapshot
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output
from lfx.schema.message import Message

WIB = timezone(timedelta(hours=7))  # waktu laporan WhatsApp di Indonesia umumnya WIB

GENERIC_WORDS = {
    "posko", "pengungsian", "pos", "titik", "di", "desa", "dusun", "kel", "kelurahan", "darurat",
}


def _normalize_record(rec: dict) -> dict:
    """Normalisasi record posko dari format Bahasa Indonesia atau Inggris ke format standar."""
    if not isinstance(rec, dict):
        return {}

    shelter_name = (
        rec.get("shelter_name")
        or rec.get("posko")
        or rec.get("nama_posko")
        or rec.get("shelter")
        or rec.get("lokasi")
        or ""
    )
    village = (
        rec.get("village")
        or rec.get("desa")
        or rec.get("kelurahan")
        or rec.get("dusun")
        or ""
    )
    report_id = rec.get("report_id") or rec.get("id_laporan") or rec.get("id") or ""
    reported_at = rec.get("reported_at") or rec.get("waktu_laporan") or rec.get("waktu") or ""

    # Parse jumlah jiwa (angka, string angka, atau '120 jiwa')
    raw_people = (
        rec.get("total_people")
        if rec.get("total_people") is not None
        else rec.get("jumlah_jiwa")
        if rec.get("jumlah_jiwa") is not None
        else rec.get("jiwa")
        if rec.get("jiwa") is not None
        else rec.get("people")
        if rec.get("people") is not None
        else rec.get("total_pengungsi")
    )
    people = None
    if raw_people is not None:
        if isinstance(raw_people, int) and not isinstance(raw_people, bool) and raw_people >= 0:
            people = raw_people
        else:
            match = re.fullmatch(r"\s*(\d+|\d{1,3}(?:[.,]\d{3})+)(?:\s+jiwa)?\s*", str(raw_people))
            if match:
                people = int(re.sub(r"[.,]", "", match.group(1)))

    # Parse kebutuhan mendesak
    raw_needs = (
        rec.get("urgent_needs")
        if rec.get("urgent_needs") is not None
        else rec.get("kebutuhan_mendesak")
        if rec.get("kebutuhan_mendesak") is not None
        else rec.get("kebutuhan")
        if rec.get("kebutuhan") is not None
        else rec.get("needs")
        if rec.get("needs") is not None
        else rec.get("barang_dibutuhkan")
    )
    needs: list[str] = []
    if raw_needs:
        if isinstance(raw_needs, list):
            for item in raw_needs:
                if isinstance(item, dict):
                    name = str(item.get("item") or item.get("nama") or item.get("name") or "").strip()
                    if name:
                        needs.append(name.lower())
                elif isinstance(item, str):
                    for part in re.split(r"[;,]\s*", item):
                        clean_part = re.sub(
                            r"^\d+\s*(?:dus|karton|sak|kg|unit|buah|paket|liter|l|kkal)?\s*",
                            "",
                            part.strip(),
                            flags=re.IGNORECASE,
                        )
                        clean_name = re.sub(r"\s*\(.*?\)", "", clean_part).strip().lower()
                        if clean_name:
                            needs.append(clean_name)
        elif isinstance(raw_needs, str):
            for part in re.split(r"[;,\n]\s*", raw_needs):
                clean_part = re.sub(
                    r"^\d+\s*(?:dus|karton|sak|kg|unit|buah|paket|liter|l|kkal)?\s*",
                    "",
                    part.strip(),
                    flags=re.IGNORECASE,
                )
                clean_name = re.sub(r"\s*\(.*?\)", "", clean_part).strip().lower()
                if clean_name:
                    needs.append(clean_name)

    # Parse surplus / sudah cukup
    raw_surplus = (
        rec.get("surplus_do_not_send")
        if rec.get("surplus_do_not_send") is not None
        else rec.get("sudah_cukup")
        if rec.get("sudah_cukup") is not None
        else rec.get("surplus")
        if rec.get("surplus") is not None
        else rec.get("tidak_dibutuhkan")
        if rec.get("tidak_dibutuhkan") is not None
        else rec.get("barang_cukup")
    )
    surplus: list[str] = []
    if raw_surplus:
        if isinstance(raw_surplus, list):
            for item in raw_surplus:
                if isinstance(item, dict):
                    name = str(item.get("item") or item.get("nama") or item.get("name") or "").strip()
                    if name:
                        surplus.append(name.lower())
                elif isinstance(item, str):
                    for part in re.split(r"[;,]\s*", item):
                        clean_name = re.sub(r"\s*\(.*?\)", "", part).strip().lower()
                        if clean_name:
                            surplus.append(clean_name)
        elif isinstance(raw_surplus, str):
            for part in re.split(r"[;,\n]\s*", raw_surplus):
                clean_name = re.sub(r"\s*\(.*?\)", "", part).strip().lower()
                if clean_name:
                    surplus.append(clean_name)

    return {
        "disaster_id": rec.get("disaster_id"),
        "shelter_id": rec.get("shelter_id"),
        "shelter_name": str(shelter_name).strip(),
        "village": str(village).strip(),
        "report_id": str(report_id).strip(),
        "reported_at": str(reported_at).strip(),
        "total_people": people,
        "is_estimate": rec.get("is_estimate") is True,
        "invalid_people": any(u.get("field") == "total_people" for u in rec.get("unverified_numbers", []) if isinstance(u, dict)),
        "needs_clarification": bool(rec.get("validation_issues") or rec.get("unverified_numbers") or rec.get("stock_issues") or rec.get("storage_issues") or rec.get("pending_clear_fields")),
        "field_provenance": rec.get("field_provenance") if isinstance(rec.get("field_provenance"), dict) else {},
        "urgent_needs": list(dict.fromkeys(needs)),
        "surplus_do_not_send": list(dict.fromkeys(surplus)),
    }


def extract_records(data: object) -> tuple[list[dict], dict]:
    """Mengekstrak array record posko dan metadata dari berbagai struktur amplop JSON."""
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)], {}

    if isinstance(data, dict):
        # Ekstrak bersarang: 'data' atau 'payload'
        if isinstance(data.get("data"), (dict, list)):
            inner_rec, _ = extract_records(data["data"])
            if inner_rec:
                return inner_rec, data
        if isinstance(data.get("payload"), (dict, list)):
            inner_rec, _ = extract_records(data["payload"])
            if inner_rec:
                return inner_rec, data

        for key in ("records", "confirmed_records", "approved_records", "shelters", "posko", "rows"):
            val = data.get(key)
            if isinstance(val, list) and val:
                return [r for r in val if isinstance(r, dict)], data

        # Jika objek dict langsung merepresentasikan satu record
        if any(
            k in data
            for k in (
                "shelter_name", "posko", "village", "desa",
                "urgent_needs", "kebutuhan_mendesak", "jumlah_jiwa", "total_people",
            )
        ):
            return [data], data

        return [], data

    return [], {}


def extract_json(text: str) -> object:
    """Mengekstrak JSON dari teks percakapan, mengabaikan kurung siku di teks pengantar."""
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text

    decoder = json.JSONDecoder()
    for match in re.finditer(r"[\{\[]", candidate):
        pos = match.start()
        try:
            obj, _ = decoder.raw_decode(candidate[pos:])
            if isinstance(obj, (dict, list)):
                return obj
        except Exception:
            continue

    raise ValueError("Input tidak berisi JSON yang valid.")


def latest_per_shelter(records: list[dict]) -> list[dict]:
    """Satu posko = laporan terbarunya saja, agar laporan ganda / lama tidak dijumlahkan dua kali."""
    latest: OrderedDict[str, dict] = OrderedDict()
    for raw in records:
        rec = _normalize_record(raw)
        name_part = rec["shelter_name"] or rec["report_id"] or "posko"
        village_part = rec["village"] or ""
        words = re.findall(r"[a-z0-9]+", f"{name_part} {village_part}".lower())
        meaningful_words = sorted(set(words) - GENERIC_WORDS)
        key = (str(rec["disaster_id"] or "") + "|id:" + str(rec["shelter_id"])) if rec["shelter_id"] else (" ".join(meaningful_words) if meaningful_words else name_part.lower())
        if not key:
            key = f"shelter_{len(latest) + 1}"
        if key not in latest or (rec["reported_at"] or "") >= (latest[key].get("reported_at") or ""):
            latest[key] = rec
    return list(latest.values())


def _source_time(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
        return (parsed.replace(tzinfo=WIB) if parsed.tzinfo is None else parsed.astimezone(WIB))
    except ValueError:
        return None


def build_bulletin(records: list[dict], disaster_name: str, contact: str, now: datetime) -> str:
    cleaned_records = latest_per_shelter(records)
    by_village: OrderedDict[str, dict] = OrderedDict()
    now = now.replace(tzinfo=WIB) if now.tzinfo is None else now.astimezone(WIB)
    source_times = []
    stale_count = unknown_time_count = 0

    for rec in cleaned_records:
        village = rec["village"] or "Lokasi belum disebut"
        entry = by_village.setdefault(village, {"people": 0, "unknown_people": 0, "invalid_people": 0,
            "is_estimate": False, "needs_clarification": False, "needs": OrderedDict(), "surplus": set(),
            "source_times": set(), "stale": False, "unknown_time": False})
        entry["is_estimate"] |= rec["is_estimate"]
        entry["needs_clarification"] |= rec["needs_clarification"]
        entry["invalid_people"] += int(rec["invalid_people"])
        if rec["total_people"] is None:
            entry["unknown_people"] += 1
        else:
            entry["people"] += rec["total_people"]
        times = [_source_time(rec["reported_at"])]
        for field in ("urgent_needs", "surplus_do_not_send"):
            if rec[field]:
                proof = rec["field_provenance"].get(field) or {}
                times.append(_source_time(proof.get("reported_at") or rec["reported_at"]))
        known_times = [t for t in times if t is not None]
        source_times.extend(known_times)
        entry["source_times"].update(known_times)
        stale = any((now - t).total_seconds() > 86400 for t in known_times)
        unknown = any(t is None for t in times)
        entry["stale"] |= stale
        entry["unknown_time"] |= unknown
        stale_count += int(stale)
        unknown_time_count += int(unknown)
        for name in rec["urgent_needs"]:
            if name:
                entry["needs"][name] = entry["needs"].get(name, 0) + 1
        for name in rec["surplus_do_not_send"]:
            if name:
                entry["surplus"].add(name)

    all_needs: OrderedDict[str, int] = OrderedDict()
    all_surplus: dict[str, list[str]] = {}
    for village, entry in by_village.items():
        for name, count in entry["needs"].items():
            all_needs[name] = all_needs.get(name, 0) + count
        for name in entry["surplus"]:
            all_surplus.setdefault(name, []).append(village)
    all_surplus = {name: villages for name, villages in all_surplus.items() if name not in all_needs}

    lines = [
        "**DRAF — BELUM DIVERIFIKASI. Jangan dibagikan sebelum disetujui Kepala Pos Komando.**",
        "",
        f"# Daftar Kebutuhan Pengungsi — {disaster_name}",
        f"Dibuat: {now.strftime('%d-%m-%Y %H:%M')} WIB (waktu pembuatan draf, bukan pembaruan kondisi posko)",
    ]
    if source_times:
        lines.append(f"Rentang waktu sumber: {min(source_times).strftime('%d-%m-%Y %H:%M')} s.d. {max(source_times).strftime('%d-%m-%Y %H:%M')} WIB.")
    if stale_count:
        lines.append(f"**Perlu cek ulang:** {stale_count} posko memiliki laporan/kebutuhan lebih dari 24 jam; daftar ini tidak membuktikan kondisi saat ini.")
    if unknown_time_count:
        lines.append(f"Waktu sumber belum diketahui untuk {unknown_time_count} posko; kebaruan belum dapat dipastikan.")
    lines += ["Rekap bersifat parsial bila ada jumlah belum diketahui atau konflik. Frekuensi permintaan bukan besaran gap atau ranking distribusi.",
              "", "## Kebutuhan yang tercatat dalam laporan"]
    ranked = sorted(all_needs.items(), key=lambda kv: -kv[1])
    lines += [f"- {name.capitalize()} (diminta {count} posko)" for name, count in ranked] or ["- (belum ada data kebutuhan)"]
    lines += ["", "## Sudah cukup — mohon JANGAN dikirim dulu"]
    lines.append("Berlaku hanya pada lokasi yang disebut dan waktu sumbernya; bukan larangan kirim global. Konfirmasi ulang dengan Pos Komando.")
    lines += [f"- {name.capitalize()} — {', '.join(all_surplus[name])}" for name in sorted(all_surplus)] or ["- (belum ada barang yang dilaporkan berlebih)"]
    lines += ["", "## Ringkasan per desa"]
    if by_village:
        for village, entry in by_village.items():
            needs_list = list(entry["needs"].keys())
            needs_str = ", ".join(k.capitalize() for k in needs_list) if needs_list else ("(tidak ada kebutuhan tambahan tercatat)" if entry["people"] == 0 and not entry["unknown_people"] else "(kebutuhan spesifik belum dicatat)")
            people_str = f"{'± ' if entry['is_estimate'] else ''}{entry['people']} jiwa" if entry["people"] > 0 or not entry["unknown_people"] else ("jumlah jiwa belum valid" if entry["invalid_people"] else "jumlah jiwa belum dilaporkan")
            if entry["unknown_people"]:
                people_str += f" (rekap parsial; {entry['unknown_people']} posko belum memiliki jumlah jiwa)"
            flags = []
            if entry["needs_clarification"]:
                flags.append("perlu klarifikasi data")
            if entry["stale"]:
                flags.append("sumber lebih dari 24 jam; cek ulang kebutuhan")
            if entry["unknown_time"]:
                flags.append("waktu sumber belum diketahui")
            dates = "; ".join(t.strftime('%d-%m-%Y %H:%M') for t in sorted(entry["source_times"])) or "belum diketahui"
            lines.append(f"- **{village}** — {people_str}. Dibutuhkan: {needs_str}. Waktu sumber: {dates} WIB." + (" Catatan: " + "; ".join(flags) + "." if flags else ""))
    else:
        lines.append("- (belum ada data posko tercatat)")

    lines += [
        "",
        "## Cara menyalurkan",
        f"Koordinasikan dahulu dengan Pos Komando: {contact}. Kirim ke gudang/posko utama, bukan langsung ke tenda, "
        "agar distribusi merata. Utamakan barang baru dan sesuai daftar di atas.",
    ]
    return "\n".join(lines)


class DonorBulletinBuilder(Component):
    display_name = "Donor Bulletin Builder"
    description = (
        "Menyusun draf buletin kebutuhan untuk donatur (dibutuhkan / sudah cukup) per desa, "
        "berlabel DRAF dan tanpa data pribadi."
    )
    icon = "megaphone"
    name = "DonorBulletinBuilder"

    inputs = [
        MessageTextInput(
            name="records_json",
            display_name="Data Posko (JSON)",
            required=True,
            info='JSON berisi "records" atau "confirmed_records". Opsional: "disaster_name" dan "contact".',
        ),
    ]

    outputs = [
        Output(display_name="Draf Buletin", name="bulletin", method="build_bulletin_message"),
    ]

    def build_bulletin_message(self) -> Message:
        try:
            data = extract_json(self.records_json or "")
        except (ValueError, json.JSONDecodeError) as exc:
            return Message(text=f"GAGAL: input bukan JSON data posko yang valid ({exc}).")

        if isinstance(data, dict) and data.get("snapshot_id"):
            try:
                snapshot = load_snapshot({"snapshot_id": data.get("snapshot_id"), "snapshot_sha256": data.get("snapshot_sha256")})
                raw_records, meta = snapshot["records"], data
            except (ValueError, OSError, KeyError) as exc:
                return Message(text=f"GAGAL: {exc}")
        else:
            raw_records, meta = extract_records(data)
        disaster = (
            meta.get("disaster_name")
            or meta.get("nama_bencana")
            or "Tanggap Darurat Bencana"
        )
        contact = (
            meta.get("contact")
            or meta.get("kontak")
            or meta.get("posko_kontak")
            or "(isi kontak resmi Pos Komando)"
        )

        valid_records = [r for r in raw_records if isinstance(r, dict)]
        if not valid_records:
            return Message(
                text="PERINGATAN: Tidak ada data posko (records) yang ditemukan dalam input JSON. "
                     "Pastikan input memuat daftar 'records' atau 'confirmed_records' posko."
            )

        preview_at = meta.get("preview_at") or datetime.now(WIB).replace(tzinfo=None).isoformat(timespec="minutes")
        try:
            preview_time = datetime.fromisoformat(str(preview_at))
        except ValueError:
            return Message(text="GAGAL: preview_at tidak valid.")
        text = build_bulletin(
            valid_records,
            str(disaster),
            str(contact),
            preview_time,
        )
        self.status = f"Buletin dari {len(valid_records)} laporan posko"
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        envelope = {"action": "create_doc", "content": text, "content_sha256": digest,
                    "records": valid_records, "disaster_name": str(disaster), "contact": str(contact),
                    "preview_at": preview_at, "confirmed_create_doc": meta.get("confirmed_create_doc") is True,
                    "approved_content_sha256": meta.get("approved_content_sha256")}
        if meta.get("snapshot_id"):
            envelope["snapshot_id"], envelope["snapshot_sha256"] = meta["snapshot_id"], meta["snapshot_sha256"]
        return Message(text=json.dumps(envelope, ensure_ascii=False, indent=2))
