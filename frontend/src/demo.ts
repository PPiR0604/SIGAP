import type { ReviewItem } from "./reviewIndicators.js";

export type RequirementKey =
    | "air_liter_per_hari"
    | "kkal_per_hari"
    | "jamban_unit"
    | "ruang_hunian_m2";

export type Shelter = {
    planning?: import("./spherePlanning.js").SpherePlanning;
    reviewItems?: ReviewItem[];
    pendingClearFields?: string[];
    calculationKey?: string;
    requirements?: Partial<Record<RequirementKey, number | null>>;
    shortages?: Partial<Record<RequirementKey, number | null>>;
    id: string;
    shelterId?: string;
    name: string;
    village: string;
    people: number | null;
    male: number | null;
    totalFamilies?: number | null;
    children?: number | null;
    breastfeeding?: number | null;
    reportedAt?: string | null;
    lastReportedAt?: string | null;
    stock?: Partial<Record<RequirementKey, number | null>>;
    stockContext?: Partial<
        Record<
            RequirementKey,
            { unit?: string; recorded_at?: string; horizon_hours?: number }
        >
    >;
    provenance?: Record<
        string,
        {
            report_id?: string;
            reported_at?: string;
            source_excerpt?: string;
            evidence?: unknown;
        }
    >;
    female: number | null;
    elderly: number | null;
    disability: number | null;
    status:
        | "Perlu klarifikasi"
        | "Parsial"
        | "Siap ditinjau"
        | "Menunggu persetujuan";
    needs: string[];
    time: string;
    source: string;
    water: number | null;
    gap: number | null;
    note: string;
    estimate?: boolean;
    changes?: string[];
    sourceBatchId?: string;
    candidateLineage?: { batch_id: string; report_id: string }[];
    correctionTarget?: { batch_id: string; report_id: string };
    // Figma fields
    toddler?: number | null;
    pregnant?: number | null;
    subdistrict?: string;
    update_status?: string;
    is_anomalous?: boolean;
    logistics_stock_gap?: {
        water?: { text: string; status: "deficit" | "safe" | "normal" };
        food?: {
            text: string;
            subtext?: string;
            status: "critical" | "safe" | "normal";
        };
        other?: string;
    };
};

export const figmaShelters: Shelter[] = [
    {
        id: "P001",
        name: "Posko Masjid Al-Ikhlas",
        village: "Desa Sukamaju, Kec. Cimalaka",
        subdistrict: "Kec. Cimalaka",
        people: 185,
        male: 90,
        female: 95,
        toddler: 14,
        elderly: 12,
        pregnant: 5,
        disability: 2,
        status: "Siap ditinjau",
        needs: ["Air bersih", "Beras", "Minyak goreng", "Terpal"],
        time: "15m lalu",
        update_status: "Update 15m lalu",
        is_anomalous: false,
        source: "Posko Masjid Al-Ikhlas, Desa Sukamaju, Kec. Cimalaka: 185 jiwa (14 balita, 12 lansia, 5 bumil, 2 disabilitas). Stok air defisit 1.335 L, pangan cukup, terpal kurang 15.",
        water: 2775,
        gap: -1335,
        note: "Stok air defisit 1.335 L (Sphere 2.775 L/hari). Pangan cukup 388.500 kkal. Jamban 10 unit. Terpal kurang 15.",
        logistics_stock_gap: {
            water: { text: "Air –1.335 L", status: "deficit" },
            food: { text: "Pangan Cukup", status: "safe" },
            other: "Terpal Kurang 15",
        },
    },
    {
        id: "P002",
        name: "Posko Lapangan Rancakalong",
        village: "Desa Pasirbiru, Kec. Rancakalong",
        subdistrict: "Kec. Rancakalong",
        people: 320,
        male: 160,
        female: 160,
        toddler: 28,
        elderly: 22,
        pregnant: 9,
        disability: 4,
        status: "Perlu klarifikasi",
        needs: ["Air bersih", "Pangan darurat"],
        time: "26 jam lalu",
        update_status: "Senyap (26 jam)",
        is_anomalous: true,
        source: "Posko Lapangan Rancakalong, Desa Pasirbiru, Kec. Rancakalong: 320 jiwa (28 balita, 22 lansia, 9 bumil, 4 disabilitas). Lebih dari 24 jam belum ada pembaruan logistik.",
        water: 4800,
        gap: -3200,
        note: "Senyap 26 jam. Kebutuhan air Sphere 4.800 L/hari (gap -3.200 L). Pangan kritis defisit 210.000 kkal. Jamban 16 unit.",
        logistics_stock_gap: {
            water: { text: "Air –3.200 L", status: "deficit" },
            food: {
                text: "Pangan Kritis",
                subtext: "–210.000 kkal",
                status: "critical",
            },
            other: "",
        },
    },
    {
        id: "P003",
        name: "Posko Balai Desa Paseh",
        village: "Desa Paseh Kidul, Kec. Paseh",
        subdistrict: "Kec. Paseh",
        people: 140,
        male: 68,
        female: 72,
        toddler: 9,
        elderly: 15,
        pregnant: 3,
        disability: 1,
        status: "Siap ditinjau",
        needs: ["Obat-obatan", "Salap kulit"],
        time: "2j lalu",
        update_status: "Update 2j lalu",
        is_anomalous: false,
        source: "Posko Balai Desa Paseh, Desa Paseh Kidul, Kec. Paseh: 140 jiwa (9 balita, 15 lansia, 3 bumil, 1 disabilitas). Air stok aman. Medis kurang 10 paket salap.",
        water: 2100,
        gap: 0,
        note: "Kebutuhan air Sphere 2.100 L/hari terpenuhi. Medis kurang 10 paket salap. Jamban 7 unit.",
        logistics_stock_gap: {
            water: { text: "Air Stok Aman", status: "safe" },
            food: { text: "", status: "normal" },
            other: "Medis Kurang 10\nPaket Salap",
        },
    },
    {
        id: "P004",
        name: "Posko SD Negeri 2 Sumedang",
        village: "Kec. Sumedang Utara",
        subdistrict: "Kec. Sumedang Utara",
        people: 450,
        male: 220,
        female: 230,
        toddler: 35,
        elderly: 40,
        pregnant: 12,
        disability: 5,
        status: "Siap ditinjau",
        needs: ["Dapur umum"],
        time: "4j lalu",
        update_status: "Update 4j lalu",
        is_anomalous: false,
        source: "Posko SD Negeri 2 Sumedang, Kec. Sumedang Utara: 450 jiwa (35 balita, 40 lansia, 12 bumil, 5 disabilitas). Dapur umum induk aktif, logistik aman.",
        water: 6750,
        gap: 0,
        note: "Status logistik terpenuhi. Kebutuhan air Sphere 6.750 L/hari terpenuhi. Dapur umum induk beroperasi.",
        logistics_stock_gap: {
            water: { text: "", status: "normal" },
            food: { text: "Status Terpenuhi", status: "safe" },
            other: "Dapur Umum Induk",
        },
    },
];

export const baselineShelters: Shelter[] = [
    {
        id: "R001",
        name: "Posko Cibening",
        village: "Cibening",
        people: 91,
        male: 46,
        female: 45,
        elderly: 7,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih", "Beras", "Minyak goreng"],
        time: "07.15",
        source: "Posko Cibening, 91 jiwa: 46 laki-laki, 45 perempuan. Lansia 7, disabilitas 0. Butuh air bersih, beras dan minyak goreng.",
        water: 1365,
        gap: 865,
        note: "Stok air 500 L untuk 24 jam; waktu stok 2 Oktober, 07.15 WIB.",
    },
    {
        id: "R002",
        name: "Posko Harapan",
        village: "Sukamaju",
        people: 98,
        male: 45,
        female: 55,
        elderly: 12,
        disability: 2,
        status: "Perlu klarifikasi",
        needs: ["Air bersih", "Popok"],
        time: "07.32",
        source: "Posko Harapan total terbaru 98 jiwa. Laki-laki 45, perempuan 55. Lansia 12. Mohon kosongkan data disabilitas lama, perlu cek ulang.",
        water: 1470,
        gap: 970,
        note: "45 laki-laki + 55 perempuan berbeda dari total 98. Usulan pengosongan disabilitas perlu keputusan petugas.",
    },
    {
        id: "R003",
        name: "Posko Bening",
        village: "Cipandan",
        people: 100,
        male: 51,
        female: 49,
        elderly: 9,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih", "Makanan siap saji"],
        time: "07.45",
        source: "Bening, Cipandan: 100 jiwa, laki-laki 51 perempuan 49, lansia 9 disabilitas 0. Stok air nol hari ini. Butuh air bersih dan makanan siap saji.",
        water: 1500,
        gap: 1500,
        note: "Nol eksplisit. Stok air 0 L untuk 24 jam, 2 Oktober 07.45 WIB.",
    },
    {
        id: "R004",
        name: "Posko Teduh",
        village: "Mekarsari",
        people: 80,
        male: 38,
        female: 42,
        elderly: 5,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Perlengkapan kebersihan"],
        time: "08.00",
        source: "Teduh, Mekarsari: 80 jiwa, laki-laki 38 perempuan 42, lansia 5 disabilitas 0. Air 1.500 L cukup untuk 24 jam. Masih perlu perlengkapan kebersihan.",
        water: 1200,
        gap: 0,
        note: "Air cukup di lokasi ini; pernyataan cukup tidak berlaku untuk posko lain.",
    },
    {
        id: "R005",
        name: "Posko Melati",
        village: "Cisarua",
        people: 63,
        male: null,
        female: null,
        elderly: null,
        disability: null,
        status: "Parsial",
        needs: ["Selimut", "Makanan bayi"],
        time: "08.12",
        source: "Melati di Cisarua kira-kira 63 orang. Rincian masih dikumpulkan. Butuh selimut dan makanan bayi.",
        water: 945,
        gap: null,
        note: "Jumlah merupakan estimasi. Rincian kelompok rentan dan stok belum dilaporkan.",
        estimate: true,
    },
    {
        id: "R006",
        name: "Posko Nusa",
        village: "Sukamaju",
        people: 120,
        male: 59,
        female: 61,
        elderly: 8,
        disability: null,
        status: "Parsial",
        needs: ["Obat-obatan", "Air bersih"],
        time: "08.25",
        source: "Nusa Sukamaju 120 jiwa, laki-laki 59 perempuan 61, lansia 8. Ada air 2.000 L untuk 48 jam. Masih perlu air dan obat-obatan.",
        water: 1800,
        gap: null,
        note: "Periode stok 48 jam tidak cocok dengan perhitungan gap 24 jam. Data disabilitas belum tersedia.",
    },
    // Additional simulated shelters bringing total verified count to 28
    {
        id: "P007",
        name: "Posko Balai Warga Tanjungsari",
        village: "Tanjungsari, Kec. Tanjungsari",
        people: 42,
        male: 20,
        female: 22,
        elderly: 3,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih", "Tenda"],
        time: "09.00",
        source: "Tanjungsari: 42 jiwa, air aman.",
        water: 630,
        gap: 0,
        note: "Stok air cukup.",
    },
    {
        id: "P008",
        name: "Posko GOR Jatinangor",
        village: "Hegarmanah, Kec. Jatinangor",
        people: 75,
        male: 36,
        female: 39,
        elderly: 4,
        disability: 1,
        status: "Siap ditinjau",
        needs: ["Air bersih", "Selimut"],
        time: "09.15",
        source: "GOR Jatinangor: 75 jiwa.",
        water: 1125,
        gap: 0,
        note: "Stok logistik cukup.",
    },
    {
        id: "P009",
        name: "Posko Balai Desa Situraja",
        village: "Situraja, Kec. Situraja",
        people: 55,
        male: 27,
        female: 28,
        elderly: 2,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Makanan siap saji"],
        time: "09.30",
        source: "Situraja: 55 jiwa.",
        water: 825,
        gap: 0,
        note: "Kebutuhan permakanan siap saji.",
    },
    {
        id: "P010",
        name: "Posko Masjid Al-Muhajirin",
        village: "Cimalaka, Kec. Cimalaka",
        people: 38,
        male: 19,
        female: 19,
        elderly: 2,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "10.00",
        source: "Cimalaka: 38 jiwa.",
        water: 570,
        gap: 0,
        note: "Stok air terkendali.",
    },
    {
        id: "P011",
        name: "Posko SDN Cikeruh",
        village: "Cikeruh, Kec. Jatinangor",
        people: 48,
        male: 24,
        female: 24,
        elderly: 1,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Peralatan mandi"],
        time: "10.15",
        source: "Cikeruh: 48 jiwa.",
        water: 720,
        gap: 0,
        note: "Peralatan mandi diperlukan.",
    },
    {
        id: "P012",
        name: "Posko Balai Sawala Pamulihan",
        village: "Pamulihan, Kec. Pamulihan",
        people: 62,
        male: 30,
        female: 32,
        elderly: 3,
        disability: 1,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "10.30",
        source: "Pamulihan: 62 jiwa.",
        water: 930,
        gap: 0,
        note: "Air cukup.",
    },
    {
        id: "P013",
        name: "Posko Aula Kecamatan Cimanggung",
        village: "Sindangpakuon, Kec. Cimanggung",
        people: 85,
        male: 42,
        female: 43,
        elderly: 5,
        disability: 1,
        status: "Siap ditinjau",
        needs: ["Beras", "Popok"],
        time: "11.00",
        source: "Cimanggung: 85 jiwa.",
        water: 1275,
        gap: 0,
        note: "Bantuan beras dan popok bayi.",
    },
    {
        id: "P014",
        name: "Posko Gedung Dakwah Tomo",
        village: "Tomo, Kec. Tomo",
        people: 34,
        male: 17,
        female: 17,
        elderly: 2,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "11.15",
        source: "Tomo: 34 jiwa.",
        water: 510,
        gap: 0,
        note: "Air aman.",
    },
    {
        id: "P015",
        name: "Posko Balai Desa Ujungjaya",
        village: "Ujungjaya, Kec. Ujungjaya",
        people: 29,
        male: 14,
        female: 15,
        elderly: 1,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Obat-obatan"],
        time: "11.30",
        source: "Ujungjaya: 29 jiwa.",
        water: 435,
        gap: 0,
        note: "Stok obat ringan.",
    },
    {
        id: "P016",
        name: "Posko SMPN 1 Paseh",
        village: "Paseh, Kec. Paseh",
        people: 52,
        male: 25,
        female: 27,
        elderly: 3,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "11.45",
        source: "SMPN 1 Paseh: 52 jiwa.",
        water: 780,
        gap: 0,
        note: "Air cukup 24 jam.",
    },
    {
        id: "P017",
        name: "Posko Masjid Agung Sumedang",
        village: "Regol Wetan, Kec. Sumedang Selatan",
        people: 66,
        male: 32,
        female: 34,
        elderly: 4,
        disability: 1,
        status: "Siap ditinjau",
        needs: ["Makanan kering"],
        time: "12.00",
        source: "Masjid Agung: 66 jiwa.",
        water: 990,
        gap: 0,
        note: "Makanan kering cukup.",
    },
    {
        id: "P018",
        name: "Posko Balai Desa Darmaraja",
        village: "Darmaraja, Kec. Darmaraja",
        people: 40,
        male: 20,
        female: 20,
        elderly: 2,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "12.15",
        source: "Darmaraja: 40 jiwa.",
        water: 600,
        gap: 0,
        note: "Stok air aman.",
    },
    {
        id: "P019",
        name: "Posko SDN Sukatali",
        village: "Sukatali, Kec. Situraja",
        people: 31,
        male: 15,
        female: 16,
        elderly: 1,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Selimut"],
        time: "12.30",
        source: "Sukatali: 31 jiwa.",
        water: 465,
        gap: 0,
        note: "Kebutuhan selimut hangat.",
    },
    {
        id: "P020",
        name: "Posko Gedung Korpri Sumedang",
        village: "Kotakulon, Kec. Sumedang Selatan",
        people: 50,
        male: 24,
        female: 26,
        elderly: 3,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "12.45",
        source: "Gedung Korpri: 50 jiwa.",
        water: 750,
        gap: 0,
        note: "Air bersih stabil.",
    },
    {
        id: "P021",
        name: "Posko Balai Desa Conggeang",
        village: "Conggeang Kulon, Kec. Conggeang",
        people: 26,
        male: 13,
        female: 13,
        elderly: 1,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Biskuit"],
        time: "13.00",
        source: "Conggeang: 26 jiwa.",
        water: 390,
        gap: 0,
        note: "Logistik siap saji.",
    },
    {
        id: "P022",
        name: "Posko Kantor Desa Buahdua",
        village: "Buahdua, Kec. Buahdua",
        people: 35,
        male: 17,
        female: 18,
        elderly: 2,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "13.15",
        source: "Buahdua: 35 jiwa.",
        water: 525,
        gap: 0,
        note: "Stok air mencukupi.",
    },
    {
        id: "P023",
        name: "Posko Balai Desa Wado",
        village: "Wado, Kec. Wado",
        people: 44,
        male: 22,
        female: 22,
        elderly: 2,
        disability: 1,
        status: "Siap ditinjau",
        needs: ["Pembalut wanita", "Popok"],
        time: "13.30",
        source: "Wado: 44 jiwa.",
        water: 660,
        gap: 0,
        note: "Kebutuhan higienis wanita dan bayi.",
    },
    {
        id: "P024",
        name: "Posko SDN Cisitu",
        village: "Cisitu, Kec. Cisitu",
        people: 28,
        male: 14,
        female: 14,
        elderly: 1,
        disability: 0,
        status: "Siap ditinjau",
        needs: ["Air bersih"],
        time: "13.45",
        source: "Cisitu: 28 jiwa.",
        water: 420,
        gap: 0,
        note: "Kondisi aman.",
    },
];

export const shelters: Shelter[] = [...figmaShelters, ...baselineShelters];

export const sampleReport = shelters
    .map((s) => `02/10/26 ${s.time} - Relawan: ${s.source}`)
    .join("\n");

export const bulletin = `### RINGKASAN SITUASI
Posko Komando Tanggap Darurat mencatat total 1.715 jiwa pengungsi tersebar di 28 posko terverifikasi wilayah Sumedang. Distribusi bantuan diimbau memprioritaskan pasokan air bersih siap minum, kebutuhan mendesak balita, dan perlengkapan hunian darurat.

### DAFTAR LOGISTIK SURPLUS — DIIMBAU TIDAK DIKIRIM (JANGAN DIKIRIM)
> **✓ STOK BERLEBIH:** Pakaian bekas dewasa, mi instan, dan air mineral kemasan kecil di wilayah Paseh dan Cimalaka telah mencukupi kebutuhan 48 jam ke depan.  
> *Pernyataan sumber • perlu tinjauan petugas; hanya untuk barang dan posko terdata.*

### PRIORITAS DONASI PER KECAMATAN
| KECAMATAN | KEBUTUHAN MENDESAK |
| :--- | :--- |
| **Cimalaka** | Air Bersih |
| — | Terpal 4×6 |
| — | Susu Balita |
| **Rancakalong** | Air Bersih Tangki |
| — | Paket Sanitasi |
| **Paseh** | Obat Kulit & Paracetamol |

### CATATAN REKONSILIASI
Perlu rekonsiliasi: subtotal 4 baris balita 86 > agregat 84; lansia 89 > 72. Tinjau sumber sebelum pengesahan final.`;
