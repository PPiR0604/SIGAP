"""Shared deterministic Langflow needs calculations; no model calls or storage writes."""
import math
import re
from datetime import datetime
from sigap_contracts import normalize_stock

STANDARDS = {
    "water_l_per_person_day": 15,
    "kcal_per_person_day": 2100,
    "people_per_latrine": 20,
    "shelter_m2_per_person": 3.5,
    # Sphere 2018 Appendix 6, printed p.231: rounded population planning values.
    "protein_g_per_person_day": 53,
    "fat_g_per_person_day": 40,
}

def population_planning(rec: dict) -> dict:
    """Allocate the general population reference, never prescribe age-specific diets.

    Operational age bands confirmed for SIGAP: under-5 and 5-17 are separate.
    Pregnancy, breastfeeding and disability overlap the age bands; never add them.
    Sphere does not specify a carbohydrate target. The equivalent below is ONLY
    the remaining energy scenario at the Appendix 6 protein/fat reference values.
    """
    count = lambda value: isinstance(value, int) and not isinstance(value, bool) and value >= 0
    people = rec.get("total_people")
    valid_total = count(people)
    groups = [("under5", rec.get("infants_toddlers")), ("children", rec.get("children")),
              ("elderly", rec.get("elderly"))]
    issues = []
    missing = any(not count(n) for _, n in groups)
    known = sum(n for _, n in groups if count(n))
    inconsistent = valid_total and known > people
    if not valid_total:
        issues.append("Jumlah jiwa belum valid; alokasi belum dapat dihitung.")
    if missing:
        issues.append("Lengkapi balita, anak, dan lansia sebelum menghitung sisa dewasa; kosong bukan nol.")
    if inconsistent:
        issues.append("Jumlah balita, anak, dan lansia melebihi total; periksa pembagian usia.")
    adult = people - known if valid_total and not missing and not inconsistent else None
    # Reorder age groups; adults are a residual, not an independently reported count.
    ordered = [groups[0], groups[1], ("adults", adult), groups[2]]
    allocation_valid = valid_total and not inconsistent
    rows = [{"key": key, "people": n if count(n) else None,
             "water_l": n * STANDARDS["water_l_per_person_day"] if count(n) and allocation_valid else None,
             "energy_kcal": n * STANDARDS["kcal_per_person_day"] if count(n) and allocation_valid else None}
            for key, n in ordered]
    energy = people * STANDARDS["kcal_per_person_day"] if valid_total else None
    protein = people * STANDARDS["protein_g_per_person_day"] if valid_total else None
    fat = people * STANDARDS["fat_g_per_person_day"] if valid_total else None
    # 4 kcal/g protein and carbohydrate, 9 kcal/g fat. Not a Sphere minimum for carbs.
    carbohydrate = (energy - protein * 4 - fat * 9) / 4 if valid_total else None
    return {"schema_version": "sphere2018-population-v1", "age_groups": rows,
            "complete_age_counts": valid_total and not missing and not inconsistent,
            "nutrition": {"energy_kcal": energy, "protein_g": protein, "fat_g": fat,
                          "carbohydrate_equivalent_g": carbohydrate}, "issues": issues}

CRITICAL_KEYWORDS = {
    "air": ["air bersih", "air minum", "air ", "galon"],
    "pangan": ["makan", "beras", "sembako", "nasi", "mie", "logistik makanan"],
    "kesehatan": ["obat", "medis", "dokter", "p3k", "sakit", "demam", "diare", "luka"],
    "bayi": ["popok", "pampers", "susu bayi", "susu formula", "mpasi", "bubur bayi"],
    "perempuan": ["pembalut", "softex"],
    "hunian": ["tenda", "terpal", "selimut", "tikar", "matras"],
}

VULNERABLE_FIELDS = ["infants_toddlers", "elderly", "pregnant", "breastfeeding", "disability"]

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
        "planning": population_planning(rec),
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
