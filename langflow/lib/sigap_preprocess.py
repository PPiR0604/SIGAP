"""Posko Report Preprocessor — Langflow custom component.

Mengubah teks laporan posko (hasil "Export chat" WhatsApp atau teks yang ditempel)
menjadi daftar laporan bernomor (R001, R002, ...) dan menyamarkan data pribadi
SEBELUM teks dikirim ke LLM.

Dasar daftar data sensitif: Juklak BNPB No. 9 Tahun 2023, Bab Perlindungan Data.
Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import re
import json
from datetime import datetime
from sigap_contracts import save_source


# ---------------------------------------------------------------------------
# Parsing ekspor WhatsApp
# ---------------------------------------------------------------------------

# Contoh baris yang didukung:
#   27/09/26 07.15 - Pak Rudi: teks            (Android, locale Indonesia)
#   27/09/2026, 07:15 - Pak Rudi: teks
#   9/27/26, 7:15 AM - Pak Rudi: teks           (Android, locale Inggris)
#   [27/09/26 07.15.30] Pak Rudi: teks          (iPhone)
WA_LINE = re.compile(
    r"^‎?\[?(?P<date>\d{1,2}/\d{1,2}/\d{2,4}),?\s+"
    r"(?P<time>\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\]?"
    r"\s*(?:-\s*)?(?P<rest>.*)$"
)
SENDER_SPLIT = re.compile(r"^(?P<sender>[^:]{1,60}?):\s(?P<msg>.*)$")

# Pasted report cards also have explicit message boundaries. A blank line within
# one message is not a boundary, and an inline stock measurement is not a header.
CARD_HEADER = re.compile(
    r"^(?:(?P<time>\d{1,2}[.:]\d{2})\s*[—–-]\s*[^\n]*\bposko\b[^\n]*|"
    r"pesan yang diteruskan ulang\s*[—–-]\s*[^\n]+)$", re.I
)
REFERENCE_DATE = re.compile(
    r"^Tanggal acuan(?: seluruh laporan)?\s*:\s*(\d{1,2})\s+"
    r"(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)"
    r"\s+(\d{4})(?:\s*,?\s*WIB)?\.?$", re.I
)


def _card_heading(line: str):
    heading = re.sub(r"^#{1,6}\s+", "", line.strip())
    if heading.startswith('**') and heading.endswith('**'):
        heading = heading[2:-2].strip()
    return CARD_HEADER.fullmatch(heading)


def _parse_cards(lines: list[str]) -> list[dict] | None:
    headers = [(i, _card_heading(line)) for i, line in enumerate(lines)]
    headers = [(i, match) for i, match in headers if match]
    if not headers:
        return None
    # Only consume a recognized date preamble. Preserve arbitrary text preceding
    # the first heading through the existing plain-text parser instead of losing it.
    prefix = [line.strip() for line in lines[:headers[0][0]] if line.strip()]
    declarations = [REFERENCE_DATE.fullmatch(line) for line in prefix]
    if any(match is None for match in declarations):
        return None
    day = None
    if len(declarations) == 1:
        months = 'januari februari maret april mei juni juli agustus september oktober november desember'.split()
        match = declarations[0]
        try:
            day = datetime(int(match[3]), months.index(match[2].lower()) + 1, int(match[1]))
        except ValueError:
            pass
    reports = []
    for index, (start, header) in enumerate(headers):
        stop = headers[index + 1][0] if index + 1 < len(headers) else len(lines)
        clock = header['time']
        if not clock:
            original = re.search(r'\basli\s+pukul\s+(\d{1,2}[.:]\d{2})\b', header[0], re.I)
            clock = original[1] if original else None
        timestamp = _parse_datetime(day.strftime('%d/%m/%Y'), clock) if day and clock else None
        # Retain the original heading and its date declaration as source evidence.
        body = '\n'.join(lines[start:stop]).strip()
        reports.append({'timestamp': timestamp, 'sender': None,
                        'text': '\n'.join(prefix + [body])})
    return reports

SKIP_MESSAGES = (
    "<media omitted>",
    "<media tidak disertakan>",
    "media tidak disertakan",
    "pesan ini telah dihapus",
    "this message was deleted",
    "anda menghapus pesan ini",
    "you deleted this message",
    "null",
)


def _parse_datetime(date_str: str, time_str: str, date_order: str = "DMY") -> str | None:
    """Kembalikan 'YYYY-MM-DD HH:MM' atau None jika tidak bisa diparse."""
    try:
        a, b, year = (int(x) for x in date_str.split("/"))
        if year < 100:
            year += 2000
        if a > 12:
            day, month = a, b
        elif b > 12:
            month, day = a, b
        elif date_order.upper() == "MDY":
            month, day = a, b
        else:
            day, month = a, b

        t = time_str.strip().lower().replace(".", ":")
        is_pm = "p" in t
        is_am = "a" in t
        t = re.sub(r"[^\d:]", "", t)
        parts = [int(x) for x in t.split(":") if x]
        hour, minute = parts[0], parts[1]
        if is_pm and hour < 12:
            hour += 12
        if is_am and hour == 12:
            hour = 0
        return datetime(year, month, day, hour, minute).strftime("%Y-%m-%d %H:%M")
    except (ValueError, IndexError):
        return None


def parse_reports(raw_text: str, date_order: str = "DMY") -> list[dict]:
    """Pisahkan teks menjadi laporan.

    - Jika teks berformat ekspor WhatsApp: satu pesan = satu laporan, lengkap dengan waktu & pengirim.
    - Kartu berjudul jam — posko: satu judul = satu laporan, dengan tanggal acuan eksplisit bila tersedia.
    - Jika teks tempelan biasa: laporan dipisah dua baris kosong atau garis '---'.
    """
    lines = raw_text.replace("\r\n", "\n").split("\n")
    wa_hits = sum(1 for ln in lines if WA_LINE.match(ln.strip()))

    reports: list[dict] = []
    if wa_hits >= 1 and wa_hits >= 0.3 * max(1, sum(1 for ln in lines if ln.strip())):
        current: dict | None = None
        for line in lines:
            m = WA_LINE.match(line.strip())
            if m:
                sender_match = SENDER_SPLIT.match(m.group("rest"))
                if not sender_match:
                    current = None  # pesan sistem (anggota bergabung, enkripsi, dll.)
                    continue
                current = {
                    "timestamp": _parse_datetime(m.group("date"), m.group("time"), date_order),
                    "sender": sender_match.group("sender").strip(),
                    "text": sender_match.group("msg").strip(),
                }
                reports.append(current)
            elif current is not None and line.strip():
                current["text"] += "\n" + line.strip()
        reports = [r for r in reports if r["text"].strip().lower() not in SKIP_MESSAGES]
    else:
        reports = _parse_cards(lines)
        if reports is None:
            chunks = re.split(r"\n\s*-{3,}\s*\n|\n\s*\n\s*\n", raw_text.strip())
            reports = [{"timestamp": None, "sender": None, "text": c.strip()} for c in chunks if c.strip()]

    for i, r in enumerate(reports, start=1):
        r["report_id"] = f"R{i:03d}"
    return reports


# ---------------------------------------------------------------------------
# Penyamaran data pribadi (PII)
# ---------------------------------------------------------------------------

PHONE = re.compile(r"(?<![\d])(?:\+?62[\s-]?|0)8(?:[\s.-]?[\dxX*]){8,11}(?![\dxX*])")
NIK_LABELLED = re.compile(r"(?i)\bNIK\s*[:.]?\s*\d[\d\s]{14,22}\d")
NIK_BARE = re.compile(r"(?<!\d)\d{16}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
BANK = re.compile(
    r"(?i)(\b(?:no\.?\s*)?rek(?:ening)?\.?\s*(?:[A-Za-z]{2,10}\s+){0,3}[:.]?\s*)(\d[\d\s-]{6,20}\d)"
)
HONORIFIC_NAME = re.compile(
    r"\b(Pak|Bu|Bapak|Ibu|Mas|Mbak|Bang|Kak|Om|Tante|Sdr|Sdri)\.?\s+([A-Z][a-zA-Z']+)(\s+[A-Z][a-zA-Z']+)?"
)
# Kata setelah sapaan yang BUKAN nama orang (peran/kelompok) — tidak disamarkan.
NOT_A_NAME = {
    "Hamil", "Menyusui", "Lansia", "RT", "RW", "Kades", "Lurah", "Camat", "Kepala",
    "Dokter", "Bidan", "Guru", "Ustadz", "Ustad", "Kapolsek", "Danramil", "Babinsa",
    "Bupati", "Wali", "Sekdes", "Kadus", "Relawan", "Posko", "Ketua", "Koordinator",
}
# Kata yang menandakan nama kontak adalah organisasi/tempat, bukan orang.
ORG_WORDS = {
    "posko", "masjid", "musala", "mushola", "gereja", "balai", "desa", "kelurahan", "sekolah",
    "sd", "smp", "sma", "relawan", "bpbd", "tim", "pmi", "tagana", "dapur", "gudang", "admin",
}


def redact_pii(text: str, known_names: list[str] | None = None) -> tuple[str, dict]:
    """Samarkan data pribadi. Mengembalikan (teks_bersih, jumlah_per_jenis)."""
    counts = {"no_hp": 0, "nik": 0, "email": 0, "no_rekening": 0, "nama": 0}

    def sub(pattern: re.Pattern, repl, key: str, s: str) -> str:
        new, n = pattern.subn(repl, s)
        counts[key] += n
        return new

    text = sub(NIK_LABELLED, "NIK [NIK]", "nik", text)
    text = sub(NIK_BARE, "[NIK]", "nik", text)
    text = sub(EMAIL, "[EMAIL]", "email", text)
    text = sub(BANK, lambda m: m.group(1) + "[NO_REKENING]", "no_rekening", text)
    text = sub(PHONE, "[NO_HP]", "no_hp", text)

    def honorific(m: re.Match) -> str:
        if m.group(2) in NOT_A_NAME:
            return m.group(0)
        counts["nama"] += 1
        return f"{m.group(1)} [NAMA]"

    text = HONORIFIC_NAME.sub(honorific, text)

    for name in sorted(known_names or [], key=len, reverse=True):
        clean = re.sub(r"^(Pak|Bu|Bapak|Ibu|Mas|Mbak)\s+", "", name).strip()
        # Nama kontak seperti "Posko Masjid Al-Ikhlas" adalah nama tempat, bukan orang:
        # jangan disamarkan agar lokasi posko tidak hilang dari laporan.
        if any(w.lower() in ORG_WORDS for w in re.split(r"[\s\-_]+", clean)):
            continue
        if len(clean) >= 3 and not clean.startswith("+") and not clean[0].isdigit():
            pattern = re.compile(rf"\b{re.escape(clean)}\b")
            text, n = pattern.subn("[NAMA]", text)
            counts["nama"] += n
    return text, counts


def preprocess(raw_text: str, date_order: str = "DMY") -> tuple[str, list[dict], dict]:
    """Parse + samarkan. Mengembalikan (teks_untuk_llm, laporan, total_penyamaran)."""
    reports = parse_reports(raw_text, date_order)
    senders = [r["sender"] for r in reports if r.get("sender")]
    pseudonyms: dict[str, str] = {}
    totals = {"no_hp": 0, "nik": 0, "email": 0, "no_rekening": 0, "nama": 0}

    for r in reports:
        clean, counts = redact_pii(r["text"], senders)
        for k, v in counts.items():
            totals[k] += v
        r["text"] = clean
        if r.get("sender"):
            pseudonyms.setdefault(r["sender"], f"Pelapor-{len(pseudonyms) + 1}")
            r["sender"] = pseudonyms[r["sender"]]

    blocks = []
    for r in reports:
        header = f"[{r['report_id']}] waktu={r['timestamp'] or 'tidak diketahui'} | pelapor={r['sender'] or '-'}"
        blocks.append(header + "\n" + r["text"])
    return "\n\n".join(blocks), reports, totals


# ---------------------------------------------------------------------------
# Komponen Langflow
# ---------------------------------------------------------------------------



def prepare_source(raw_text: str, date_order: str = "DMY") -> tuple[str, str]:
    """Create the same immutable, redacted source for standalone and inline validation."""
    raw = raw_text or ""
    correction_target = correction_base = candidate_target = None
    try:
        if raw.lstrip().startswith("{"):
            request = json.loads(raw)
            if isinstance(request, dict) and any(k in request for k in ("correction_target", "candidate_target")):
                if not isinstance(request.get("report_text"), str):
                    raise ValueError("report_text koreksi harus string.")
                raw, correction_target = request["report_text"], request.get("correction_target")
                correction_base = request.get("correction_base")
                candidate_target = request.get("candidate_target")
    except (ValueError, TypeError) as exc:
        return f"GAGAL: input koreksi tidak valid ({exc}).", "input tidak valid"
    text, reports, totals = preprocess(raw, date_order or "DMY")
    redacted = ", ".join(f"{k}={v}" for k, v in totals.items() if v) or "tidak ada"
    status = f"{len(reports)} laporan; data pribadi disamarkan: {redacted}"
    try:
        reference = save_source(text, correction_target, correction_base, candidate_target)
    except (OSError, ValueError) as exc:
        return f"GAGAL: sumber bersih tidak dapat disimpan ({exc}). Jangan lanjutkan ekstraksi/write.", status
    return "<<<SOURCE_REF>>>" + json.dumps(reference) + "<<<END_SOURCE_REF>>>\n\n" + text, status
